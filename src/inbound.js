const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');
const db = require('./db');
const svc = require('./services/tickets');
const { REPLY_MARKER } = require('./mailer');
const { parseReplyAddress } = require('./replyto');
const { uploadsDir } = require('./uploads');
const { isStaff, canAccessTicket } = require('./auth');

const status = { enabled: config.inbound.enabled, lastRunAt: null, lastError: null, processed: 0 };
let running = false;

const BLOCKED = /\.(exe|bat|cmd|com|msi|scr|ps1|vbs|vbe|js|jse|wsf|jar|sh|php\d?|phtml|cgi|pl|py|dll|hta|lnk|reg)$/i;

// Keeps only what the person wrote: cuts at our marker or at the usual "On ... wrote:" / forwarded headers.
function stripReply(text) {
  let body = String(text || '').replace(/\r\n/g, '\n');
  const cuts = [
    body.indexOf(REPLY_MARKER),
    body.search(/^On .{5,200}wrote:\s*$/m),
    body.search(/^-{2,}\s*Original Message\s*-{2,}/im),
    body.search(/^_{10,}\s*$/m),
    body.search(/^From: .+\n(Sent|Date): /m),
    body.search(/^Le .{5,200}a écrit\s*:/m),
  ].filter((i) => i >= 0);
  if (cuts.length) body = body.slice(0, Math.min(...cuts));
  // Drop trailing quoted lines and common mobile signatures.
  const lines = body.split('\n');
  while (lines.length && (/^\s*>/.test(lines[lines.length - 1]) || !lines[lines.length - 1].trim())) lines.pop();
  return lines
    .join('\n')
    .replace(/\n*(Sent from my (iPhone|iPad|Android|Samsung).*|Get Outlook for (iOS|Android).*)$/i, '')
    .trim();
}

function isAutomated(parsed) {
  const h = parsed.headers;
  const auto = String(h.get('auto-submitted') || 'no').toLowerCase();
  const from = (parsed.from && parsed.from.value[0] && parsed.from.value[0].address) || '';
  return (
    auto !== 'no' ||
    h.has('x-autoreply') ||
    h.has('x-autorespond') ||
    /^(bulk|junk|list|auto_reply)$/i.test(String(h.get('precedence') || '')) ||
    /^(mailer-daemon|postmaster|no-?reply)@/i.test(from) ||
    from.toLowerCase() === config.inbound.address.toLowerCase()
  );
}

// Saves real attachments (skips small inline images, which are usually signatures and logos).
async function saveAttachments(parsed) {
  const files = [];
  for (const a of parsed.attachments || []) {
    if (!a.content || !a.filename || BLOCKED.test(a.filename)) continue;
    if (a.contentDisposition === 'inline' && a.cid && a.size < 30 * 1024) continue;
    if (a.size > config.upload.maxMb * 1024 * 1024 || files.length >= config.upload.maxFiles) continue;
    const filename = crypto.randomBytes(16).toString('hex');
    await fs.promises.writeFile(path.join(uploadsDir, filename), a.content);
    files.push({ originalname: a.filename.slice(0, 200), filename, mimetype: a.contentType || 'application/octet-stream', size: a.size });
  }
  return files;
}

// Handles one parsed email. Returns a short description of what happened (for logs and tests).
async function processMessage(parsed) {
  if (isAutomated(parsed)) return 'ignored: automated';
  const fromAddr = String((parsed.from && parsed.from.value[0] && parsed.from.value[0].address) || '').toLowerCase();
  const user = fromAddr
    ? await db.one(
        `SELECT u.*, c.name AS company_name, c.is_active AS company_active FROM users u LEFT JOIN companies c ON c.id = u.company_id
         WHERE u.email = ? AND u.is_active = 1`,
        [fromAddr]
      )
    : null;
  if (!user || (user.role === 'client' && Number(user.company_active) === 0)) return `ignored: unknown sender ${fromAddr}`;

  const recipients = ['to', 'cc', 'bcc']
    .flatMap((k) => (parsed[k] ? [].concat(parsed[k]).flatMap((v) => v.value.map((x) => x.address)) : []))
    .concat([parsed.headers.get('delivered-to'), parsed.headers.get('x-original-to')].flat().filter(Boolean).map(String));

  // Find the ticket: a signed reply address is best; otherwise "[Ticket #N]" in the subject from someone with access.
  let ticket = null;
  const token = parseReplyAddress(recipients);
  if (token && token.userId === user.id) ticket = await svc.getTicket(token.ticketId);
  if (!ticket) {
    const m = /\[Ticket #(\d+)\]/i.exec(parsed.subject || '');
    if (m) ticket = await svc.getTicket(Number(m[1]));
  }
  if (ticket && !canAccessTicket(user, ticket)) return 'ignored: no access to ticket';

  const files = await saveAttachments(parsed);
  const body = stripReply(parsed.text || (parsed.html ? parsed.html.replace(/<[^>]+>/g, ' ') : ''));
  if (!body && !files.length) return 'ignored: empty';

  if (ticket) {
    if (ticket.status === 'closed' && !isStaff(user)) {
      // A reply to a closed ticket starts a new one that refers back to it.
      const t = await svc.createTicket({
        actor: user,
        companyId: user.company_id,
        createdBy: user.id,
        subject: `Follow-up to #${ticket.id}: ${ticket.subject}`.slice(0, 255),
        body: `${body || '(attachment)'}\n\n(Sent by email as a reply to closed ticket #${ticket.id}.)`,
        category: ticket.category,
        priority: ticket.priority,
        files,
      });
      return `created ticket #${t.id} (follow-up to closed #${ticket.id})`;
    }
    await svc.postReply(ticket, user, { body: body || '(attachment)', files });
    return `replied to ticket #${ticket.id}`;
  }

  // No ticket reference: a client emailing support opens a new ticket.
  if (user.role === 'client' && user.company_id) {
    const subject = String(parsed.subject || '').replace(/^\s*((re|fw|fwd)\s*:\s*)+/i, '').trim() || 'Support request by email';
    const t = await svc.createTicket({
      actor: user,
      companyId: user.company_id,
      createdBy: user.id,
      subject: subject.slice(0, 255),
      body: body || '(attachment)',
      files,
    });
    return `created ticket #${t.id}`;
  }
  return 'ignored: staff email without a ticket reference';
}

// Checks the mailbox for unread mail, processes each message, then marks it read.
async function poll() {
  if (!config.inbound.enabled || running) return;
  running = true;
  const { ImapFlow } = require('imapflow');
  const { simpleParser } = require('mailparser');
  const client = new ImapFlow({
    host: config.inbound.host,
    port: config.inbound.port,
    secure: config.inbound.secure,
    auth: { user: config.inbound.user, pass: config.inbound.pass },
    logger: false,
  });
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const uids = await client.search({ seen: false }, { uid: true });
      for (const uid of uids || []) {
        const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
        let outcome;
        try {
          outcome = await processMessage(await simpleParser(msg.source));
        } catch (err) {
          outcome = `error: ${err.message}`;
        }
        await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
        status.processed++;
        console.log(`[inbound] uid ${uid}: ${outcome}`);
      }
    } finally {
      lock.release();
    }
    await client.logout();
    status.lastError = null;
  } catch (err) {
    status.lastError = err.message;
    console.error('[inbound] mailbox check failed:', err.message);
    client.close();
  } finally {
    status.lastRunAt = new Date().toISOString();
    running = false;
  }
}

module.exports = { poll, processMessage, stripReply, status };
