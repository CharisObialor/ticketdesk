// Microsoft 365 mail through the Microsoft Graph API, using an Entra ID app registration (client credentials).
// Microsoft has turned off password sign-in for IMAP and SMTP, so this is the supported way to send and read
// mail for a Microsoft 365 mailbox from a server. Needs application permissions Mail.Send and Mail.ReadWrite.
const config = require('./config');

const GRAPH = 'https://graph.microsoft.com/v1.0';
let token = { value: null, expires: 0 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mailboxPath = () => `/users/${encodeURIComponent(config.graph.mailbox)}`;

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
      const err = await res.json().catch(() => ({}));
      throw new Error(`Microsoft Graph ${method} ${path.split('?')[0]} failed (${res.status}): ${(err.error && err.error.message) || res.statusText}`);
    }
    if (raw) return Buffer.from(await res.arrayBuffer());
    return res.status === 202 || res.status === 204 ? null : res.json().catch(() => null);
  }
  throw new Error('Microsoft Graph request failed');
}

// Sends a complete MIME message (built by nodemailer) so our threading and auto-reply headers are kept.
const sendMime = (mime) => call('POST', `${mailboxPath()}/sendMail`, { body: Buffer.from(mime).toString('base64'), contentType: 'text/plain' });

async function listUnread(max = 25) {
  const data = await call('GET', `${mailboxPath()}/mailFolders/inbox/messages?$filter=isRead eq false&$select=id&$top=${max}`);
  return (data && data.value ? data.value : []).map((m) => m.id);
}

const getMime = (id) => call('GET', `${mailboxPath()}/messages/${encodeURIComponent(id)}/$value`, { raw: true });
const markRead = (id) => call('PATCH', `${mailboxPath()}/messages/${encodeURIComponent(id)}`, { body: { isRead: true } });

module.exports = { getToken, sendMime, listUnread, getMime, markRead };
