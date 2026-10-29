const crypto = require('crypto');
const config = require('./config');

// Each ticket email gets a personal Reply-To such as support+t42u7-1a2b3c4d5e@company.com.
// The signature proves which ticket and person a reply belongs to, so it cannot be forged by guessing.
const sign = (ticketId, userId) =>
  crypto.createHmac('sha256', config.jwtSecret).update(`reply:${ticketId}:${userId}`).digest('hex').slice(0, 12);

function replyAddress(ticketId, userId) {
  const inbox = config.inbound.address;
  if (!config.inbound.enabled || !inbox || !inbox.includes('@')) return null;
  const [local, domain] = inbox.split('@');
  return `${local}+t${ticketId}u${userId}-${sign(ticketId, userId)}@${domain}`;
}

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

module.exports = { replyAddress, parseReplyAddress };
