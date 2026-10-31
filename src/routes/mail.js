// Admins' own Microsoft 365 mailbox inside the portal: folders, messages, reading, replying and composing.
// The mailbox is always the signed-in admin's own address; it is never taken from the request.
const path = require('path');
const router = require('express').Router();
const config = require('../config');
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
    if (message.body && message.body.contentType !== 'text') message.body.content = imageProxy.rewriteImages(message.body.content);
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
    res.attachment(name);
    res.type('application/octet-stream');
    res.set('Cache-Control', 'private, no-store');
    res.send(data);
  })
);

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
