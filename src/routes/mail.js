// Admins' own Microsoft 365 mailbox inside the portal: folders, messages, reading, replying and composing.
// The mailbox is always the signed-in admin's own address; it is never taken from the request.
const path = require('path');
const crypto = require('crypto');
const dns = require('dns');
const router = require('express').Router();
const config = require('../config');
const db = require('../db');
const graph = require('../msgraph');
const imageProxy = require('../image-proxy');
const exchange = require('../exchange');
const sanitizeHtml = require('sanitize-html');
const { signatureBlock, signatureFor, avatarUrl } = require('../email-template');
const { mailUpload, cleanup } = require('../uploads');
const { requireAdmin } = require('../auth');
const { wrap, HttpError, escapeHtml } = require('../util');

const EMAIL_RE = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;
const FOLDERS = new Set(['inbox', 'sentitems', 'drafts', 'archive', 'junkemail', 'deleteditems']);

// Whether this user can use the Mail page: an admin whose portal email is a Microsoft 365 mailbox here.
function mailboxFor(user) {
  if (!user || user.role !== 'admin') return null;
  if (config.mailProvider !== 'graph' || !config.graph.clientId) return null;
  const email = String(user.email).toLowerCase();
  return config.graph.senderDomains.includes(email.split('@')[1]) ? email : null;
}

// Remote pictures in emails, fetched by the portal (see image-proxy.js). Signed links stand in for the session.
router.get('/image', wrap(imageProxy.handler));

// The admin's own mailbox first, then shared mailboxes (info@, systems@ ...) Exchange says they have Full Access to.
async function mailboxesFor(user) {
  const own = mailboxFor(user);
  if (!own) return [];
  const shared = await exchange.sharedFor(own).catch(() => []);
  return [{ address: own, name: user.name, own: true }, ...shared.filter((s) => s.address !== own).map((s) => ({ ...s, own: false }))];
}

router.use(requireAdmin);
router.use(
  wrap(async (req, res, next) => {
    const own = mailboxFor(req.user);
    if (!own) {
      throw new HttpError(400, 'The Mail page needs your portal account to use your Microsoft 365 email address (for example name@dateheight.com).');
    }
    // Which mailbox this request is for: the admin's own unless they picked a shared one they have access to.
    const wanted = String(req.get('x-mailbox') || req.query.mailbox || own).trim().toLowerCase();
    if (wanted !== own && !(await mailboxesFor(req.user)).some((m) => m.address === wanted)) {
      throw new HttpError(403, 'You do not have access to that mailbox.');
    }
    req.mailbox = wanted;
    next();
  })
);

// Unread inbox counts are cached briefly so the sidebar badge (polled by every admin) stays light on Microsoft.
const unreadCache = new Map();
async function unreadFor(address) {
  const hit = unreadCache.get(address);
  if (hit && Date.now() - hit.at < 30_000) return hit.n;
  const n = await graph.inboxUnread(address).catch(() => (hit ? hit.n : 0));
  unreadCache.set(address, { at: Date.now(), n });
  return n;
}

router.get(
  '/mailboxes',
  wrap(async (req, res) => {
    const boxes = await mailboxesFor(req.user);
    const withCounts = await Promise.all(boxes.map(async (b) => ({ ...b, unread: await unreadFor(b.address) })));
    res.json({ mailboxes: withCounts, shared: exchange.status() });
  })
);

// A sender's picture for the Mail page, from the first of: their Microsoft 365 profile photo (addresses in our
// organisation), their portal photo, their Gravatar, or their company's BIMI logo (the brand logo Gmail and Yahoo
// show). 404 when there is none (the page shows initials). Google and Yahoo do not share their users' own photos.
// Results are kept for a few hours so nobody is asked again for every email in the list.
const PHOTO_TTL = 6 * 3600e3;
const photoCache = new Map();
let photosRefusedUntil = 0;
const imageType = (buf) => (buf[0] === 0x89 && buf[1] === 0x50 ? 'image/png' : buf[0] === 0x47 && buf[1] === 0x49 ? 'image/gif' : 'image/jpeg');

async function lookupPhoto(email) {
  if (config.graph.senderDomains.includes(email.split('@')[1]) && Date.now() > photosRefusedUntil) {
    try {
      const buf = await graph.userPhoto(email);
      if (buf && buf.length) return { buf, type: imageType(buf), microsoft: true };
    } catch (err) {
      // No permission for photos (or Microsoft is unavailable): stop asking for a while and use portal photos.
      if (err.status === 403 || err.status === 401) {
        if (Date.now() > photosRefusedUntil) console.warn(`[mail] profile photos unavailable (${err.code || err.status}); add ProfilePhoto.Read.All to the app`);
        photosRefusedUntil = Date.now() + 3600e3;
      } else if (err.status !== 404) return undefined; // a passing failure: do not remember it
    }
  }
  const { avatarPath } = require('../auth');
  const u = await db.one('SELECT avatar FROM users WHERE LOWER(email) = ? AND is_active = 1', [email]);
  const avatar = u && avatarPath(u.avatar);
  if (avatar) return { redirect: `${config.appUrl}${avatar}` };
  return (await gravatar(email)) || (await bimiLogo(email.split('@')[1])) || null;
}

// Whether this answer for one of our own addresses stands in for a Microsoft 365 picture Microsoft would not give.
const standIn = (email, found) =>
  config.graph.senderDomains.includes(email.split('@')[1]) && Date.now() <= photosRefusedUntil && !(found && found.microsoft);

const PHOTO_MAX_BYTES = 512 * 1024;
const fetchPicture = async (url) => {
  const img = await imageProxy.fetchImage(url).catch(() => null);
  return img && img.data.length && img.data.length <= PHOTO_MAX_BYTES ? { buf: img.data, type: img.type } : null;
};

// Gravatar answers 404 (d=404) when the address has no picture. Only a hash of the address is sent.
const gravatar = (email) => fetchPicture(`https://gravatar.com/avatar/${crypto.createHash('sha256').update(email).digest('hex')}?s=96&d=404`);

// BIMI: a company's published email logo, from a DNS record at default._bimi.<domain> (or its parent domain).
// Personal email services are skipped: their logo would show for every one of their users.
const PERSONAL_MAIL = /^(gmail|googlemail|yahoo|ymail|rocketmail|outlook|hotmail|live|msn|icloud|me|mac|aol|proton|protonmail|pm|zoho|gmx|mail|yandex)\.(com|net|me|ch|de|ru|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})$/i;
const bimiCache = new Map();
async function bimiLogo(domain) {
  if (!domain || PERSONAL_MAIL.test(domain)) return null;
  const hit = bimiCache.get(domain);
  if (hit && Date.now() - hit.at < PHOTO_TTL) return hit.logo;
  let logo = null;
  const labels = domain.split('.');
  for (let i = 0; i <= labels.length - 2 && !logo; i++) {
    const records = await dns.promises.resolveTxt(`default._bimi.${labels.slice(i).join('.')}`).catch(() => []);
    const record = records.map((r) => r.join('')).find((r) => /^v=BIMI1/i.test(r.trim()));
    const url = record && (/(?:^|;)\s*l=([^;\s]+)/i.exec(record) || [])[1];
    if (url && url.startsWith('https://')) logo = await fetchPicture(url);
    if (record) break;
  }
  bimiCache.set(domain, { at: Date.now(), logo });
  if (bimiCache.size > 2000) bimiCache.delete(bimiCache.keys().next().value);
  return logo;
}

router.get(
  '/photo',
  wrap(async (req, res) => {
    const email = String(req.query.email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email) || email.length > 254) throw new HttpError(400, 'Not an email address');
    // One lookup per address at a time: requests arriving while it runs wait for the same answer.
    let hit = photoCache.get(email);
    if (!hit || (!hit.pending && Date.now() - hit.at > PHOTO_TTL)) {
      hit = { at: Date.now(), pending: lookupPhoto(email).catch(() => undefined) };
      photoCache.set(email, hit);
      if (photoCache.size > 2000) photoCache.delete(photoCache.keys().next().value);
    }
    const found = hit.pending ? await hit.pending : hit.found;
    if (hit.pending) {
      // A passing failure is not remembered, so the next request tries again.
      if (found === undefined) photoCache.delete(email);
      else Object.assign(hit, { pending: null, found, at: Date.now(), standIn: standIn(email, found) });
    }
    // A colleague shown without their Microsoft 365 picture because Microsoft refused: kept only briefly, so their
    // real picture appears soon after the permission is granted.
    if (hit.standIn) hit.at = Math.min(hit.at, Date.now() - PHOTO_TTL + 10 * 60000);
    res.set('Cache-Control', `private, max-age=${hit.standIn ? 300 : found ? 21600 : 3600}`);
    if (!found) return res.status(404).end();
    if (found.redirect) return res.redirect(302, found.redirect);
    // Pictures from other servers can be SVG: never let one run anything if opened directly.
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    res.type(found.type).send(found.buf);
  })
);

// The admin's signature as HTML, placed at the bottom of new emails in the editor (where it can be edited).
router.get(
  '/signature',
  wrap(async (req, res) => {
    res.json({ html: signatureBlock(signatureFor(req.user), avatarUrl(req.user)) });
  })
);

// Microsoft errors become clear messages instead of a generic failure.
const graphWrap = (fn) =>
  wrap(async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      // The portal's own messages (missing subject, bad address ...) pass through unchanged.
      if (err instanceof HttpError) throw err;
      if (err.status === 404) throw new HttpError(404, 'Message not found. It may have been moved or deleted.');
      if (err.status === 403) throw new HttpError(403, 'The portal is not allowed to open this mailbox. Ask your Microsoft 365 administrator to add it to the support portal access group.');
      if (err.status) throw new HttpError(502, 'Microsoft 365 did not respond as expected. Please try again.');
      throw err;
    }
  });

const id = (req) => {
  const v = String(req.params.id || '');
  if (!/^[A-Za-z0-9=_\-+/]{10,400}$/.test(v)) throw new HttpError(400, 'Invalid message');
  return v;
};

router.get(
  '/folders',
  graphWrap(async (req, res) => {
    res.json({ mailbox: req.mailbox, folders: await graph.folders(req.mailbox) });
  })
);

router.get(
  '/messages',
  graphWrap(async (req, res) => {
    const folder = FOLDERS.has(req.query.folder) ? req.query.folder : 'inbox';
    const skip = Math.max(0, Math.min(Number(req.query.skip) || 0, 5000));
    const search = String(req.query.q || '').trim().slice(0, 100);
    const top = Math.max(1, Math.min(Number(req.query.top) || 30, 50));
    res.json(await graph.listMessages(req.mailbox, { folder, search, skip, top }));
  })
);

router.get(
  '/messages/:id',
  graphWrap(async (req, res) => {
    const message = await graph.getMessage(req.mailbox, id(req));
    if (message.body && message.body.contentType !== 'text') message.body.content = imageProxy.rewriteImages(cleanIncoming(message.body.content));
    if (!message.isRead) {
      await graph.setRead(req.mailbox, message.id, true).catch(() => {});
      unreadCache.delete(req.mailbox);
    }
    res.json({ message });
  })
);

// Attachments always download (never render in the portal), so a malicious HTML or SVG file cannot run here.
router.get(
  '/messages/:id/attachments/:attachmentId',
  graphWrap(async (req, res) => {
    const aid = String(req.params.attachmentId);
    if (!/^[A-Za-z0-9=_\-+/]{10,600}$/.test(aid)) throw new HttpError(400, 'Invalid attachment');
    const name = path.basename(String(req.query.name || 'attachment')).replace(/[^\w.\- ()]/g, '_').slice(0, 150) || 'attachment';
    const data = await graph.getAttachment(req.mailbox, id(req), aid);
    // ?inline=1 shows images and PDFs in the preview. The type comes from the file's first bytes, not its name or the
    // sender's label, so nothing else (such as a web page renamed to .png) can ever render inside the portal.
    const shown = req.query.inline === '1' ? previewType(Buffer.from(data)) : null;
    res.set('Content-Disposition', `${shown ? 'inline' : 'attachment'}; filename="${name}"`);
    res.type(shown || 'application/octet-stream');
    res.set('Cache-Control', 'private, no-store');
    res.send(data);
  })
);

// File types the attachment preview can show, recognised by their first bytes.
const PREVIEWABLE = [
  ['image/png', (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))],
  ['image/jpeg', (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ['image/gif', (b) => ['GIF87a', 'GIF89a'].includes(b.toString('ascii', 0, 6))],
  ['image/webp', (b) => b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP'],
  ['application/pdf', (b) => b.toString('ascii', 0, 5) === '%PDF-'],
];
const previewType = (buf) => (PREVIEWABLE.find(([, test]) => buf.length > 12 && test(buf)) || [null])[0];

router.post(
  '/messages/:id/read',
  graphWrap(async (req, res) => {
    await graph.setRead(req.mailbox, id(req), req.body.isRead !== false);
    res.json({ ok: true });
  })
);

// Read/unread and flag in one call, as the reading pane and list both change them.
router.patch(
  '/messages/:id',
  graphWrap(async (req, res) => {
    if (req.body.isRead !== undefined) await graph.setRead(req.mailbox, id(req), !!req.body.isRead);
    if (req.body.flagged !== undefined) await graph.setFlag(req.mailbox, id(req), !!req.body.flagged);
    unreadCache.delete(req.mailbox);
    res.json({ ok: true });
  })
);

const MOVE_TARGETS = new Set(['inbox', 'archive', 'junkemail', 'deleteditems']);
router.post(
  '/messages/:id/move',
  graphWrap(async (req, res) => {
    const folder = String(req.body.folder || '');
    if (!MOVE_TARGETS.has(folder)) throw new HttpError(400, 'Choose Inbox, Archive, Junk or Deleted Items');
    await graph.moveTo(req.mailbox, id(req), folder);
    unreadCache.delete(req.mailbox);
    res.json({ ok: true });
  })
);

// Delete moves to Deleted Items; deleting from Deleted Items removes the email for good.
router.delete(
  '/messages/:id',
  graphWrap(async (req, res) => {
    if (req.query.permanent === '1') await graph.deleteMessage(req.mailbox, id(req));
    else await graph.moveTo(req.mailbox, id(req), 'deleteditems');
    unreadCache.delete(req.mailbox);
    res.json({ ok: true });
  })
);

// A clean, printable page for one email (sanitised, so the email's own code never runs on the portal).
router.get(
  '/messages/:id/print',
  graphWrap(async (req, res) => {
    const m = await graph.getMessage(req.mailbox, id(req));
    const who = (a) => (a && a.emailAddress ? `${a.emailAddress.name || ''} <${a.emailAddress.address || ''}>`.trim() : '');
    const list = (l) => (l || []).map(who).join('; ');
    const body =
      m.body && m.body.contentType === 'text'
        ? `<pre style="white-space:pre-wrap;font:inherit">${escapeHtml(m.body.content || '')}</pre>`
        : cleanHtml(imageProxy.rewriteImages((m.body && m.body.content) || ''));
    const row = (label, value) => (value ? `<tr><th>${label}</th><td>${escapeHtml(value)}</td></tr>` : '');
    const when = new Date(m.receivedDateTime || m.sentDateTime || Date.now()).toLocaleString('en-GB', { dateStyle: 'full', timeStyle: 'short', timeZone: config.timezone });
    res.set('Cache-Control', 'private, no-store');
    res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(m.subject || 'Email')}</title>
<style>body{font:14px/1.5 'Segoe UI',Roboto,Arial,sans-serif;color:#111827;max-width:800px;margin:24px auto;padding:0 16px}h1{font-size:20px;margin:0 0 12px}
table.meta{border-collapse:collapse;margin-bottom:16px;font-size:13px}table.meta th{text-align:left;color:#6b7280;font-weight:500;padding:2px 12px 2px 0;vertical-align:top}
hr{border:0;border-top:1px solid #e5e7eb;margin:16px 0}img{max-width:100%;height:auto}@media print{body{margin:0}}</style></head><body>
<h1>${escapeHtml(m.subject || '(no subject)')}</h1><table class="meta">${row('From', who(m.from))}${row('Sent', when)}${row('To', list(m.toRecipients))}${row('Cc', list(m.ccRecipients))}${row('Attachments', (m.attachments || []).map((x) => x.name).join(', '))}</table><hr>
${body}<script src="/print.js"></script></body></html>`);
  })
);

// The original email as an .eml file (opens in Outlook or any mail app).
router.get(
  '/messages/:id/eml',
  graphWrap(async (req, res) => {
    const data = await graph.getMessageMime(req.mailbox, id(req));
    const name = path.basename(String(req.query.name || 'email')).replace(/[^\w.\- ()]/g, '_').slice(0, 120) || 'email';
    res.attachment(`${name}.eml`);
    res.type('message/rfc822');
    res.set('Cache-Control', 'private, no-store');
    res.send(data);
  })
);

const addressList = (v) => {
  const list = String(v || '')
    .split(/[,;\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const bad = list.filter((e) => !EMAIL_RE.test(e));
  if (bad.length) throw new HttpError(400, `Not a valid email address: ${bad.join(', ')}`);
  return [...new Set(list)];
};

// Received emails, before the Mail page shows them: the email keeps its look (layout, styles, tables, pictures, links)
// but loses anything a phishing email uses to imitate a sign-in page or act on its own: forms, text and password
// boxes, buttons, frames, plugins, scripts, page refreshes, event handlers and javascript: links. Shown on our own
// site, a fake Microsoft sign-in form would make browsers' phishing checks flag the portal itself.
const INCOMING_DROP = new Set(['script', 'noscript', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'input', 'button', 'select', 'textarea', 'option', 'optgroup', 'datalist', 'keygen', 'output', 'meta', 'base', 'link', 'portal', 'dialog', 'template', 'svg', 'math']);
function cleanIncoming(html) {
  return sanitizeHtml(String(html || ''), {
    allowedTags: false,
    allowedAttributes: false,
    allowVulnerableTags: true, // <style> is kept for the email's own layout; the frame it is shown in runs no scripts
    allowedSchemes: ['http', 'https', 'mailto', 'tel', 'cid', 'data'],
    allowedSchemesByTag: { a: ['http', 'https', 'mailto', 'tel'], img: ['http', 'https', 'data', 'cid'] },
    allowedSchemesAppliedToAttributes: ['href', 'src', 'cite', 'action', 'background', 'poster', 'formaction', 'srcset', 'xlink:href'],
    exclusiveFilter: (frame) => INCOMING_DROP.has(frame.tag),
    nonTextTags: ['script', 'noscript', 'textarea', 'option', 'title', 'template'],
    transformTags: {
      // A form's contents stay (minus its controls), but it can no longer be a form.
      form: 'div',
      '*': (tagName, attribs) => ({
        tagName,
        attribs: Object.fromEntries(Object.entries(attribs).filter(([k]) => !/^on/i.test(k) && !['action', 'formaction', 'http-equiv', 'srcdoc', 'contenteditable'].includes(k.toLowerCase()))),
      }),
    },
  });
}

// Formatted emails from the editor: only ordinary formatting survives (no scripts, forms, frames or event handlers),
// so a pasted page can never smuggle anything harmful into an email sent from a company mailbox.
function cleanHtml(html) {
  return sanitizeHtml(html, {
    allowedTags: ['p', 'br', 'div', 'span', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del', 'sub', 'sup', 'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'blockquote', 'a', 'img', 'hr', 'pre', 'code', 'mark', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'font'],
    allowedAttributes: { a: ['href', 'target', 'rel', 'title'], img: ['src', 'alt', 'width', 'height', 'title'], td: ['colspan', 'rowspan', 'width'], th: ['colspan', 'rowspan', 'width'], font: ['color', 'face', 'size'], '*': ['style'] },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowedSchemesByTag: { img: ['http', 'https', 'data', 'cid'] },
    allowedStyles: { '*': Object.fromEntries([...'color background-color font-size font-family font-weight font-style text-decoration text-align line-height width height max-width vertical-align list-style-type'.split(' '), 'margin', 'margin-top', 'margin-bottom', 'margin-left', 'margin-right', 'padding', 'padding-left', 'padding-right', 'padding-top', 'padding-bottom', 'border', 'border-left', 'border-collapse'].map((k) => [k, [/^[^;{}<>]*$/]])) },
    transformTags: { a: (tag, attribs) => ({ tagName: 'a', attribs: { ...attribs, target: '_blank', rel: 'noopener noreferrer' } }) },
  });
}

// Pictures pasted into the editor arrive as data: URLs; they are turned into inline attachments, because Gmail and
// several other mail apps do not show data: images.
function extractInlineImages(html) {
  const images = [];
  const out = html.replace(/(<img\b[^>]*?\bsrc=")data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=]+)(")/gi, (m, pre, type, b64, post) => {
    const data = Buffer.from(b64, 'base64');
    if (data.length > 3 * 1024 * 1024 || images.length >= 20) return `${pre}${post}`;
    const contentId = `img${images.length + 1}.${Date.now().toString(36)}@portal`;
    images.push({ contentId, name: `image${images.length + 1}.${type.split('/')[1].replace('jpeg', 'jpg')}`, contentType: type, data });
    return `${pre}cid:${contentId}${post}`;
  });
  return { html: out, images };
}

// Plain text typed in the portal becomes a standard email body: the portal's font and body size, paragraphs kept,
// and a signature with the admin's name, company and address.
const FONT = "'Inter','Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";
function textToHtml(text, user) {
  const paragraphs = String(text || '')
    .split(/\r?\n\s*\r?\n/)
    .filter((p) => p.trim())
    .map((p) => `<p style="margin:0 0 16px;font-size:15px;line-height:24px;color:#1f2937">${escapeHtml(p.trim()).replace(/\r?\n/g, '<br>')}</p>`)
    .join('');
  // The admin's own signature (editable on their profile), or a default one.
  const signature = signatureBlock(signatureFor(user), avatarUrl(user));
  return `<div style="font-family:${FONT};font-size:15px;line-height:24px;color:#1f2937">${paragraphs}${signature}</div>`;
}

router.post(
  '/send',
  mailUpload.array('files'),
  graphWrap(async (req, res) => {
    try {
      const total = (req.files || []).reduce((n, f) => n + f.size, 0);
      if (total > config.mailUpload.maxTotalMb * 1024 * 1024) {
        throw new HttpError(413, `Attachments are too large. An email can carry up to ${config.mailUpload.maxTotalMb} MB in total.`);
      }
      const to = addressList(req.body.to);
      const cc = addressList(req.body.cc);
      const bcc = addressList(req.body.bcc);
      const mode = ['reply', 'replyAll', 'forward'].includes(req.body.mode) ? req.body.mode : null;
      const refId = mode ? String(req.body.refId || '') : null;
      if (mode && !/^[A-Za-z0-9=_\-+/]{10,400}$/.test(refId)) throw new HttpError(400, 'Invalid message');
      if (!to.length && !cc.length && !bcc.length) throw new HttpError(400, 'Add at least one recipient');
      if (to.length + cc.length + bcc.length > 100) throw new HttpError(400, 'Too many recipients (100 at most)');
      const subject = String(req.body.subject || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 255);
      if (!subject && !mode) throw new HttpError(400, 'Add a subject');
      // The editor sends formatted HTML (with the signature already in it); plain text is still accepted.
      let html;
      let inlineImages = [];
      if (req.body.html) {
        const raw = String(req.body.html).slice(0, 4 * 1024 * 1024);
        ({ html, images: inlineImages } = extractInlineImages(cleanHtml(raw)));
        html = `<div style="font-family:${FONT};font-size:15px;line-height:24px;color:#1f2937">${html}</div>`;
      } else {
        html = textToHtml(String(req.body.body || '').slice(0, 100000), req.user);
      }
      await graph.compose(req.mailbox, {
        to,
        cc,
        bcc,
        subject,
        html,
        inlineImages,
        importance: ['low', 'normal', 'high'].includes(req.body.importance) ? req.body.importance : 'normal',
        refId,
        mode,
        attachments: (req.files || []).map((f) => ({ filename: f.originalname, path: f.path, contentType: f.mimetype })),
      });
      res.status(201).json({ ok: true });
    } finally {
      // Files were only needed to build the email; Microsoft keeps the sent copy.
      cleanup(req.files);
    }
  })
);

router.mailboxFor = mailboxFor;
router.cleanHtml = cleanHtml;
module.exports = router;
