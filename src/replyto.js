const crypto = require('crypto');
const config = require('./config');

// Each ticket email gets a personal Reply-To such as support+t42u7-1a2b3c4d5e@company.com.
// The signature proves which ticket and person a reply belongs to, so it cannot be forged by guessing.
// When all tickets are cleared and numbering starts again, the epoch changes so reply addresses from before (for an
// old #5) can never land on a new ticket with the same number. Empty until the first clear.
let epoch = '';
const setEpoch = (value) => {
  epoch = value ? String(value) : '';
};
// Loads the current epoch at startup.
async function loadEpoch() {
  const row = await require('./db').one("SELECT value FROM settings WHERE name = 'reply_epoch'");
  setEpoch(row && row.value);
}
const sign = (ticketId, userId) =>
  crypto
    .createHmac('sha256', config.jwtSecret)
    .update(epoch ? `reply:${epoch}:${ticketId}:${userId}` : `reply:${ticketId}:${userId}`)
    .digest('hex')
    .slice(0, 12);

function replyAddress(ticketId, userId) {
  const inbox = config.inbound.address;
  if (!config.inbound.enabled || !inbox || !inbox.includes('@')) return null;
  const [local, domain] = inbox.split('@');
  return `${local}+t${ticketId}u${userId}-${sign(ticketId, userId)}@${domain}`;
}

// Shared reply address for a ticket (user 0), used on emails with CC/BCC so anyone on the thread can reply.
const ticketReplyAddress = (ticketId) => replyAddress(ticketId, 0);

// Finds a valid reply token in any of the given addresses. Returns { ticketId, userId } or null.
function parseReplyAddress(addresses) {
  for (const addr of addresses) {
    const m = /\+t(\d+)u(\d+)-([0-9a-f]{12})@/i.exec(String(addr));
    if (!m) continue;
    const [, ticketId, userId, sig] = m;
    const expected = sign(ticketId, userId);
    if (crypto.timingSafeEqual(Buffer.from(sig.toLowerCase()), Buffer.from(expected))) {
      return { ticketId: Number(ticketId), userId: Number(userId) };
    }
  }
  return null;
}

// Signed link that turns off a person's notification emails without signing in (List-Unsubscribe).
const unsubToken = (userId) => crypto.createHmac('sha256', config.jwtSecret).update(`unsub:${userId}`).digest('hex').slice(0, 24);
const unsubscribeUrl = (userId) => `${config.apiUrl}/api/auth/unsubscribe?u=${userId}&t=${unsubToken(userId)}`;
function checkUnsubscribe(u, t) {
  const expected = unsubToken(Number(u));
  return typeof t === 'string' && t.length === expected.length && crypto.timingSafeEqual(Buffer.from(t), Buffer.from(expected));
}

module.exports = { replyAddress, ticketReplyAddress, parseReplyAddress, unsubscribeUrl, checkUnsubscribe, setEpoch, loadEpoch };
