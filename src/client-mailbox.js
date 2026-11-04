// Which mailbox emails to clients about a ticket come from (for example info@): the ticket's own choice if an admin
// set one, otherwise the portal-wide default (System page, or MS_CLIENT_MAILBOX in .env). With neither, client emails
// keep coming from the admin who acted, as before. Emails to staff and automatic emails are not affected.
const db = require('./db');
const config = require('./config');
const { now } = require('./util');

let saved = null;

async function load() {
  const row = await db.one("SELECT value FROM settings WHERE name = 'client_mailbox'");
  saved = row && row.value ? String(row.value).toLowerCase() : null;
}

const getDefault = () => saved || config.graph.clientMailbox || null;
const forTicket = (t) => (t && t.send_from ? String(t.send_from).toLowerCase() : getDefault());

async function setDefault(address) {
  const value = address ? String(address).toLowerCase() : null;
  const ts = now();
  const updated = await db.query("UPDATE settings SET value = ?, updated_at = ? WHERE name = 'client_mailbox'", [value, ts]);
  if (!updated.affectedRows) await db.query("INSERT INTO settings (name, value, updated_at) VALUES ('client_mailbox', ?, ?)", [value, ts]);
  saved = value;
}

// Mailboxes an admin may send client emails from: the support mailbox, and shared mailboxes (info@, systems@ ...)
// that Exchange says they have Full Access to.
async function optionsFor(user) {
  const shared = await require('./exchange')
    .sharedFor(String(user.email).toLowerCase())
    .catch(() => []);
  const list = [
    ...(config.graph.mailbox ? [{ address: String(config.graph.mailbox).toLowerCase(), name: 'Support mailbox' }] : []),
    ...shared.map((s) => ({ address: String(s.address).toLowerCase(), name: s.name && !s.name.includes('@') ? s.name : s.address })),
  ];
  return list.filter((m, i) => list.findIndex((x) => x.address === m.address) === i);
}

module.exports = { load, getDefault, forTicket, setDefault, optionsFor };
