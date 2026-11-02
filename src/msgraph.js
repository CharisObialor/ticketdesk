// Microsoft 365 mail through the Microsoft Graph API, using an Entra ID app registration (client credentials).
// Microsoft has turned off password sign-in for IMAP and SMTP, so this is the supported way to send and read
// mail for a Microsoft 365 mailbox from a server. Needs application permissions Mail.Send and Mail.ReadWrite.
const config = require('./config');

const GRAPH = 'https://graph.microsoft.com/v1.0';
let token = { value: null, expires: 0 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mailboxPath = (mailbox = config.graph.mailbox) => `/users/${encodeURIComponent(mailbox)}`;

async function getToken() {
  if (token.value && Date.now() < token.expires - 60000) return token.value;
  const { tenantId, clientId, clientSecret } = config.graph;
  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'https://graph.microsoft.com/.default',
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Microsoft sign-in failed: ${data.error_description || data.error || res.status}`);
  token = { value: data.access_token, expires: Date.now() + Number(data.expires_in || 3600) * 1000 };
  return token.value;
}

// Calls Graph, refreshing the token once on 401 and waiting when Microsoft asks us to slow down (429/503).
async function call(method, path, { body, contentType = 'application/json', raw = false } = {}) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(GRAPH + path, {
      method,
      headers: { Authorization: `Bearer ${await getToken()}`, ...(body !== undefined ? { 'Content-Type': contentType } : {}) },
      body: body === undefined ? undefined : contentType === 'application/json' ? JSON.stringify(body) : body,
    });
    if (res.status === 401 && attempt === 1) {
      token = { value: null, expires: 0 };
      continue;
    }
    if ((res.status === 429 || res.status === 503) && attempt < 3) {
      await sleep(Math.min(Number(res.headers.get('retry-after')) || 5, 60) * 1000);
      continue;
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const err = new Error(`Microsoft Graph ${method} ${path.split('?')[0]} failed (${res.status}): ${(body.error && body.error.message) || res.statusText}`);
      err.status = res.status;
      err.code = body.error && body.error.code;
      throw err;
    }
    if (raw) return Buffer.from(await res.arrayBuffer());
    return res.status === 202 || res.status === 204 ? null : res.json().catch(() => null);
  }
  throw new Error('Microsoft Graph request failed');
}

// Sends a complete MIME message (built by nodemailer) so our threading and auto-reply headers are kept.
// `mailbox` is the account it is sent from (and saved to Sent Items of): the support mailbox or a staff member's.
const sendMime = (mime, mailbox) =>
  call('POST', `${mailboxPath(mailbox)}/sendMail`, { body: Buffer.from(mime).toString('base64'), contentType: 'text/plain' });

async function listUnread(max = 25) {
  const data = await call('GET', `${mailboxPath()}/mailFolders/inbox/messages?$filter=isRead eq false&$select=id&$top=${max}`);
  return (data && data.value ? data.value : []).map((m) => m.id);
}

// Unread inbox messages from the last week with only their recipients (no subject or body), so a personal mailbox
// can be scanned for portal reply addresses without reading anything else.
async function listUnreadRecipients(max = 50) {
  const since = new Date(Date.now() - 7 * 864e5).toISOString().replace(/\.\d+Z$/, 'Z');
  const data = await call(
    'GET',
    `${mailboxPath()}/mailFolders/inbox/messages?$filter=isRead eq false and receivedDateTime ge ${since}&$select=id,toRecipients,ccRecipients&$top=${max}`
  );
  return (data && data.value ? data.value : []).map((m) => ({
    id: m.id,
    recipients: [...(m.toRecipients || []), ...(m.ccRecipients || [])].map((r) => r.emailAddress && r.emailAddress.address).filter(Boolean),
  }));
}

const getMessageMime = (mailbox, id) => call('GET', `${msgPath(mailbox, id)}/$value`, { raw: true });
const getMime = (id) => call('GET', `${mailboxPath()}/messages/${encodeURIComponent(id)}/$value`, { raw: true });
const markRead = (id) => call('PATCH', `${mailboxPath()}/messages/${encodeURIComponent(id)}`, { body: { isRead: true } });

// ---- Drafts and attachments (large emails and the Mail page) ----

const fs = require('fs');
const SMALL_ATTACHMENT = 3 * 1024 * 1024;
const CHUNK = 320 * 1024 * 10; // upload sessions want multiples of 320 KB

const recipients = (list) => [].concat(list || []).filter(Boolean).map((address) => ({ emailAddress: { address: String(address) } }));
const msgPath = (mailbox, id) => `${mailboxPath(mailbox)}/messages/${encodeURIComponent(id)}`;

// Adds a file to a draft: directly when small, through an upload session when large (up to 150 MB).
async function addAttachment(mailbox, draftId, { filename, path: filePath, contentType }) {
  const size = (await fs.promises.stat(filePath)).size;
  if (size <= SMALL_ATTACHMENT) {
    await call('POST', `${msgPath(mailbox, draftId)}/attachments`, {
      body: {
        '@odata.type': '#microsoft.graph.fileAttachment',
        name: filename,
        contentType: contentType || 'application/octet-stream',
        contentBytes: (await fs.promises.readFile(filePath)).toString('base64'),
      },
    });
    return;
  }
  const session = await call('POST', `${msgPath(mailbox, draftId)}/attachments/createUploadSession`, {
    body: { AttachmentItem: { attachmentType: 'file', name: filename, size, contentType: contentType || 'application/octet-stream' } },
  });
  const fh = await fs.promises.open(filePath, 'r');
  try {
    for (let start = 0; start < size; start += CHUNK) {
      const length = Math.min(CHUNK, size - start);
      const buf = Buffer.alloc(length);
      await fh.read(buf, 0, length, start);
      // The upload URL carries its own authorisation; no bearer token is sent.
      const res = await fetch(session.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(length), 'Content-Range': `bytes ${start}-${start + length - 1}/${size}` },
        body: buf,
      });
      if (!res.ok) throw new Error(`Attachment upload failed (${res.status})`);
    }
  } finally {
    await fh.close();
  }
}

// Sends an email that is too big for a single MIME request: draft, attachments, then send.
async function sendLarge(mailbox, options) {
  const box = mailbox || config.graph.mailbox;
  const draft = await call('POST', `${mailboxPath(box)}/messages`, {
    body: {
      subject: options.subject,
      body: { contentType: 'HTML', content: options.html || '' },
      toRecipients: recipients(options.to),
      ccRecipients: recipients(options.cc),
      bccRecipients: recipients(options.bcc),
      replyTo: options.replyTo ? recipients(options.replyTo) : [],
    },
  });
  for (const a of options.attachments || []) await addAttachment(box, draft.id, a);
  await call('POST', `${msgPath(box, draft.id)}/send`);
}

const WELL_KNOWN = ['inbox', 'sentitems', 'drafts', 'archive', 'junkemail', 'deleteditems'];

async function folders(mailbox) {
  const out = await Promise.all(
    WELL_KNOWN.map((name) =>
      call('GET', `${mailboxPath(mailbox)}/mailFolders/${name}?$select=id,displayName,unreadItemCount,totalItemCount`)
        .then((f) => ({ key: name, id: f.id, name: f.displayName, unread: f.unreadItemCount, total: f.totalItemCount }))
        .catch(() => null)
    )
  );
  return out.filter(Boolean);
}

const LIST_FIELDS = 'id,subject,from,toRecipients,receivedDateTime,sentDateTime,isRead,hasAttachments,bodyPreview,importance,flag,isDraft';

// One page of a folder, newest first, optionally searched. `skip` comes from the previous page.
async function listMessages(mailbox, { folder = 'inbox', search, skip = 0, top = 30 }) {
  const params = new URLSearchParams({ $select: LIST_FIELDS, $top: String(top) });
  if (search) params.set('$search', `"${String(search).replace(/"/g, '')}"`);
  else {
    params.set('$orderby', 'receivedDateTime desc');
    if (skip) params.set('$skip', String(skip));
  }
  const data = await call('GET', `${mailboxPath(mailbox)}/mailFolders/${encodeURIComponent(folder)}/messages?${params}`);
  return { messages: data.value || [], hasMore: !search && !!data['@odata.nextLink'] };
}

// A full message with its attachments listed; inline images are embedded so the body displays without remote loads.
async function getMessage(mailbox, id) {
  const m = await call(
    'GET',
    `${msgPath(mailbox, id)}?$select=id,subject,from,toRecipients,ccRecipients,bccRecipients,replyTo,receivedDateTime,sentDateTime,isRead,hasAttachments,body,importance,flag,isDraft,parentFolderId`
  );
  let attachments = [];
  if (m.hasAttachments || /cid:/i.test((m.body && m.body.content) || '')) {
    const list = await call('GET', `${msgPath(mailbox, id)}/attachments?$select=id,name,contentType,size,isInline`);
    attachments = list.value || [];
    // Pictures pasted into the email are embedded directly (up to 5 MB each, 15 MB in all).
    let budget = 15 * 1024 * 1024;
    for (const a of attachments.filter((x) => x.isInline && x.size < 5 * 1024 * 1024 && (budget -= x.size) >= 0)) {
      const full = await call('GET', `${msgPath(mailbox, id)}/attachments/${encodeURIComponent(a.id)}`).catch(() => null);
      if (full && full.contentId && full.contentBytes && m.body && m.body.content) {
        const cid = String(full.contentId).replace(/[<>]/g, '');
        m.body.content = m.body.content.split(`cid:${cid}`).join(`data:${full.contentType};base64,${full.contentBytes}`);
      }
    }
  }
  return { ...m, attachments: attachments.filter((a) => !a.isInline).map(({ id: aid, name, contentType, size }) => ({ id: aid, name, contentType, size })) };
}

const getAttachment = (mailbox, id, attachmentId) => call('GET', `${msgPath(mailbox, id)}/attachments/${encodeURIComponent(attachmentId)}/$value`, { raw: true });
const setRead = (mailbox, id, isRead) => call('PATCH', msgPath(mailbox, id), { body: { isRead } });
const moveTo = (mailbox, id, folder) => call('POST', `${msgPath(mailbox, id)}/move`, { body: { destinationId: folder } });
const setFlag = (mailbox, id, flagged) => call('PATCH', msgPath(mailbox, id), { body: { flag: { flagStatus: flagged ? 'flagged' : 'notFlagged' } } });
const deleteMessage = (mailbox, id) => call('DELETE', msgPath(mailbox, id));
const inboxUnread = async (mailbox) => Number((await call('GET', `${mailboxPath(mailbox)}/mailFolders/inbox?$select=unreadItemCount`)).unreadItemCount) || 0;

// Pictures placed in the email body travel as inline attachments referenced by cid:, which every mail app shows.
const addInlineImage = (mailbox, draftId, { contentId, name, contentType, data }) =>
  call('POST', `${msgPath(mailbox, draftId)}/attachments`, {
    body: { '@odata.type': '#microsoft.graph.fileAttachment', name, contentType, contentBytes: data.toString('base64'), isInline: true, contentId },
  });

// Composes and sends from `mailbox`. With `refId` and a mode, Microsoft builds the reply/forward (threading, quoted original).
async function compose(mailbox, { to, cc, bcc, subject, html, attachments = [], inlineImages = [], refId, mode, importance = 'normal' }) {
  let draft;
  if (refId && ['reply', 'replyAll', 'forward'].includes(mode)) {
    const action = { reply: 'createReply', replyAll: 'createReplyAll', forward: 'createForward' }[mode];
    draft = await call('POST', `${msgPath(mailbox, refId)}/${action}`, { body: {} });
    await call('PATCH', msgPath(mailbox, draft.id), {
      body: {
        subject: subject || draft.subject,
        body: { contentType: 'HTML', content: `${html}<br>${(draft.body && draft.body.content) || ''}` },
        toRecipients: recipients(to),
        ccRecipients: recipients(cc),
        bccRecipients: recipients(bcc),
        importance,
      },
    });
  } else {
    draft = await call('POST', `${mailboxPath(mailbox)}/messages`, {
      body: { subject, importance, body: { contentType: 'HTML', content: html }, toRecipients: recipients(to), ccRecipients: recipients(cc), bccRecipients: recipients(bcc) },
    });
  }
  for (const img of inlineImages) await addInlineImage(mailbox, draft.id, img);
  for (const a of attachments) await addAttachment(mailbox, draft.id, a);
  await call('POST', `${msgPath(mailbox, draft.id)}/send`);
}

module.exports = {
  getToken,
  sendMime,
  sendLarge,
  listUnread,
  listUnreadRecipients,
  getMime,
  markRead,
  folders,
  listMessages,
  getMessage,
  getAttachment,
  setRead,
  moveTo,
  setFlag,
  getMessageMime,
  deleteMessage,
  inboxUnread,
  compose,
};
