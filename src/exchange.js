// Which shared mailboxes (info@, systems@ ...) each admin may open, read from the delegation set up in Exchange.
// Microsoft Graph can read and send from a shared mailbox but cannot say who has been given access to it, so
// this asks Exchange Online directly (the same admin API the Exchange Online PowerShell module uses).
// Needs, on the same app registration: API permission Office 365 Exchange Online > Exchange.ManageAsApp
// (admin consent), and a directory role that can read mailbox permissions, e.g. "Exchange Recipient Administrator"
// or the narrower "View-Only Recipients" management role, assigned to the app.
// Without those, MS_SHARED_MAILBOXES in .env can list them by hand: info@x.com=a@x.com|b@x.com;systems@x.com=*
const config = require('./config');

const CACHE_MS = 10 * 60 * 1000;
let token = { value: null, expires: 0 };
let cache = { at: 0, map: null, error: null, source: null };

async function getToken() {
  if (token.value && Date.now() < token.expires - 60000) return token.value;
  const { tenantId, clientId, clientSecret } = config.graph;
  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret, scope: 'https://outlook.office365.com/.default' }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Exchange sign-in failed: ${data.error_description || data.error || res.status}`);
  token = { value: data.access_token, expires: Date.now() + Number(data.expires_in || 3600) * 1000 };
  return token.value;
}

// Runs one read-only Exchange cmdlet and returns every row (following paging).
async function invoke(cmdlet, parameters = {}) {
  let url = `https://outlook.office365.com/adminapi/beta/${encodeURIComponent(config.graph.tenantId)}/InvokeCommand`;
  const rows = [];
  for (let page = 0; url && page < 50; page++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await getToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ CmdletInput: { CmdletName: cmdlet, Parameters: parameters } }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(`Exchange ${cmdlet} failed (${res.status}): ${(data.error && (data.error.message || data.error.code)) || res.statusText}`);
      err.status = res.status;
      throw err;
    }
    rows.push(...(data.value || []));
    url = data['@odata.nextLink'] || null;
  }
  return rows;
}

const lower = (s) => String(s || '').trim().toLowerCase();

// From Exchange: { 'info@x.com': { name, users: Set(['a@x.com', ...]) } }
async function fromExchange() {
  const boxes = await invoke('Get-Mailbox', { RecipientTypeDetails: 'SharedMailbox', ResultSize: 'Unlimited' });
  const map = {};
  for (const b of boxes) {
    const address = lower(b.PrimarySmtpAddress);
    if (!address) continue;
    const perms = await invoke('Get-MailboxPermission', { Identity: address });
    const users = new Set(
      perms
        .filter((p) => !p.Deny && !p.IsInherited && String(p.AccessRights || '').includes('FullAccess'))
        .map((p) => lower(p.User))
        .filter((u) => u.includes('@'))
    );
    map[address] = { name: b.DisplayName || address, users };
  }
  return map;
}

// From .env: MS_SHARED_MAILBOXES=info@x.com=a@x.com|b@x.com;systems@x.com=*
function fromConfig() {
  const map = {};
  for (const part of String(config.graph.sharedMailboxes || '').split(/[;\n]/)) {
    const [box, who] = part.split('=');
    if (!box || !box.includes('@')) continue;
    map[lower(box)] = { name: lower(box), users: new Set(String(who || '').split(/[|,]/).map(lower).filter(Boolean)) };
  }
  return map;
}

async function load() {
  if (cache.map && Date.now() - cache.at < CACHE_MS) return cache;
  const manual = fromConfig();
  try {
    const map = await fromExchange();
    cache = { at: Date.now(), map: { ...manual, ...map }, error: null, source: 'exchange' };
  } catch (err) {
    // Keep the last good answer for a while if Exchange is briefly unreachable.
    cache = { at: Date.now(), map: cache.source === 'exchange' && cache.map ? cache.map : manual, error: err.message, source: Object.keys(manual).length ? 'config' : null };
    if (!/403|401|Forbidden|Unauthorized/.test(err.message)) console.warn('[exchange]', err.message);
  }
  return cache;
}

// Shared mailboxes this person has Full Access to: [{ address, name }].
async function sharedFor(email) {
  if (!config.graph.clientId) return [];
  const me = lower(email);
  const { map } = await load();
  return Object.entries(map || {})
    .filter(([, v]) => v.users.has(me) || v.users.has('*'))
    .map(([address, v]) => ({ address, name: v.name }))
    .sort((a, b) => a.address.localeCompare(b.address));
}

const status = () => ({ source: cache.source, error: cache.error, checkedAt: cache.at ? new Date(cache.at).toISOString() : null, count: cache.map ? Object.keys(cache.map).length : 0 });
const refresh = () => {
  cache.at = 0;
  return load();
};

module.exports = { sharedFor, status, refresh, invoke };
