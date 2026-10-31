const nodemailer = require('nodemailer');
const config = require('./config');
const { escapeHtml } = require('./util');

const useGraph = () => config.mailProvider === 'graph' && !!config.graph.clientId;
// True when mail really leaves the server (otherwise it is only logged, for local development).
const configured = () => useGraph() || !!config.smtp.host;

let transport;
function getTransport() {
  if (!transport) {
    if (useGraph()) {
      // nodemailer builds the full MIME message; Microsoft Graph sends it from the support mailbox.
      const builder = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'windows' });
      const graph = require('./msgraph');
      transport = {
        sendMail: async ({ mailbox, ...options }) => {
          const { message } = await builder.sendMail(options);
          // Graph accepts MIME up to about 4 MB; bigger emails (large attachments) are uploaded as a draft instead.
          if (message.length <= 3.5 * 1024 * 1024) await graph.sendMime(message, mailbox);
          else await graph.sendLarge(mailbox, options);
        },
      };
    } else {
      transport = config.smtp.host
        ? nodemailer.createTransport({
            host: config.smtp.host,
            port: config.smtp.port,
            secure: config.smtp.secure,
            auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
          })
        : nodemailer.createTransport({ jsonTransport: true });
    }
  }
  return transport;
}

const mailDomain = () => new URL(config.appUrl).hostname || 'localhost';

// Every email about a ticket references the same root id so mail clients group them into one thread.
const threadHeaders = (ticketId) => {
  if (!ticketId) return {};
  const root = `<ticket-${ticketId}@${mailDomain()}>`;
  return { inReplyTo: root, references: [root] };
};

// Staff whose mailbox Microsoft refused to send from recently (not in the organisation, no mailbox, or outside
// the app's allowed scope). They fall back to the support mailbox for an hour before trying again.
const sendAsBlocked = new Map();
const SEND_AS_REFUSED = /^(ErrorAccessDenied|ErrorInvalidUser|ErrorSendAsDenied|MailboxNotEnabledForRESTAPI|ResourceNotFound|ErrorItemNotFound)$/;

// Whether this email can go out from the sender's own Microsoft 365 mailbox.
function sendAsMailbox(sender) {
  if (!sender || !sender.email || !useGraph() || !config.graph.sendAsStaff) return null;
  const email = String(sender.email).toLowerCase();
  if (email === String(config.graph.mailbox).toLowerCase()) return null;
  if (!config.graph.senderDomains.includes(email.split('@')[1])) return null;
  if ((sendAsBlocked.get(email) || 0) > Date.now()) return null;
  return email;
}

// One delivery attempt. If Microsoft refuses to send as the staff member, it goes from the support mailbox instead.
async function deliver({ to, cc, bcc, attachments, subject, html, text, ticketId, replyTo, sender, unsubscribeUrl }) {
  let mailbox = sendAsMailbox(sender);
  for (;;) {
    try {
      await getTransport().sendMail({
        from: mailbox ? { name: `${sender.name} (${config.appName})`, address: mailbox } : config.smtp.from,
        replyTo: replyTo || config.smtp.replyTo || undefined,
        to,
        cc: cc && cc.length ? cc : undefined,
        bcc: bcc && bcc.length ? bcc : undefined,
        attachments: attachments && attachments.length ? attachments : undefined,
        subject,
        html,
        text,
        mailbox: mailbox || undefined,
        ...threadHeaders(ticketId),
        headers: {
          'X-Auto-Response-Suppress': 'OOF, AutoReply',
          'Auto-Submitted': 'auto-generated',
          ...(unsubscribeUrl ? { 'List-Unsubscribe': `<${unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } : {}),
        },
      });
      if (!configured()) console.log(`[mail:dev] to=${to} subject="${subject}"`);
      return;
    } catch (err) {
      if (mailbox && (err.status === 403 || err.status === 404 || SEND_AS_REFUSED.test(err.code || ''))) {
        console.warn(`[mail] cannot send as ${mailbox} (${err.code || err.status}); using the support mailbox`);
        sendAsBlocked.set(mailbox, Date.now() + 3600e3);
        mailbox = null;
        continue;
      }
      throw err;
    }
  }
}

// ---- Outbox: every email is saved first, then sent; failures are retried for up to a day ----

// Minutes to wait before each retry; after the last one the email is marked failed.
const RETRY_MINUTES = [1, 5, 15, 30, 60, 120, 240, 480, 720];
// Errors that will not fix themselves (bad address, message rejected): no point retrying.
const permanent = (err) => [400, 413, 422].includes(err.status) || /ErrorInvalidRecipients|InvalidRecipients|ErrorMessageSizeExceeded/i.test(err.code || err.message || '');
const errorText = (err) => `${err.message}${err.cause && err.cause.code ? ` (${err.cause.code})` : ''}`.slice(0, 500);
let draining = false;

// Queues an email and returns at once, so a slow or unreachable mail server never delays the person's request.
// `sender` ({ name, email }) is the staff member who triggered it; with Microsoft 365 it is sent from their mailbox.
function send(message) {
  if (!message || !message.to) return;
  const db = require('./db');
  if (!db.ready()) {
    // Outside the running app (scripts): send directly.
    deliver(message).catch((err) => console.error(`[mail] to ${message.to} failed: ${errorText(err)}`));
    return;
  }
  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
  db.query("INSERT INTO mail_outbox (recipient, subject, payload, status, attempts, next_attempt_at, created_at) VALUES (?, ?, ?, 'pending', 0, ?, ?)", [
    String(message.to).slice(0, 255),
    String(message.subject || '').slice(0, 255),
    JSON.stringify(message),
    ts,
    ts,
  ])
    .then(() => setImmediate(processOutbox))
    .catch((err) => {
      console.error('[mail] could not queue email, sending directly:', err.message);
      deliver(message).catch((e) => console.error(`[mail] to ${message.to} failed: ${errorText(e)}`));
    });
}

// Sends every queued email that is due. Runs right after queueing and every 30 seconds.
async function processOutbox() {
  const db = require('./db');
  if (draining || !db.ready()) return;
  draining = true;
  try {
    const now = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
    const due = await db.query("SELECT * FROM mail_outbox WHERE status = 'pending' AND next_attempt_at <= ? ORDER BY id LIMIT 25", [now()]);
    for (const row of due) {
      try {
        await deliver(JSON.parse(row.payload));
        await db.query("UPDATE mail_outbox SET status = 'sent', attempts = attempts + 1, sent_at = ?, last_error = NULL WHERE id = ?", [now(), row.id]);
      } catch (err) {
        const attempts = Number(row.attempts) + 1;
        const giveUp = permanent(err) || attempts > RETRY_MINUTES.length;
        const next = new Date(Date.now() + (RETRY_MINUTES[attempts - 1] || 0) * 60000).toISOString().slice(0, 19).replace('T', ' ');
        await db.query('UPDATE mail_outbox SET status = ?, attempts = ?, next_attempt_at = ?, last_error = ? WHERE id = ?', [
          giveUp ? 'failed' : 'pending',
          attempts,
          next,
          errorText(err),
          row.id,
        ]);
        console.error(`[mail] to ${row.recipient} ${giveUp ? 'failed for good' : `failed (try ${attempts}), retrying in ${RETRY_MINUTES[attempts - 1]} min`}: ${errorText(err)}`);
        // The connection is down: stop here and let the next run retry the rest.
        if (!giveUp && /fetch failed|ENOTFOUND|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ECONNREFUSED/.test(errorText(err))) break;
      }
    }
    // Keep a week of sent mail for troubleshooting.
    await db.query("DELETE FROM mail_outbox WHERE status = 'sent' AND sent_at < ?", [new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 19).replace('T', ' ')]);
  } catch (err) {
    console.error('[mail] outbox run failed:', err.message);
  } finally {
    draining = false;
  }
}

async function outboxStatus() {
  const db = require('./db');
  const rows = await db.query("SELECT status, COUNT(*) AS n, MIN(created_at) AS oldest FROM mail_outbox WHERE status IN ('pending', 'failed') GROUP BY status");
  const by = Object.fromEntries(rows.map((r) => [r.status, r]));
  const failed = await db.query("SELECT id, recipient, subject, attempts, last_error, created_at FROM mail_outbox WHERE status = 'failed' ORDER BY id DESC LIMIT 20");
  return {
    pending: Number((by.pending && by.pending.n) || 0),
    oldestPending: (by.pending && by.pending.oldest) || null,
    failedCount: Number((by.failed && by.failed.n) || 0),
    failed,
  };
}

// Puts failed emails back in the queue (after the connection or settings are fixed).
async function retryFailed(ids) {
  const db = require('./db');
  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const list = (ids || []).map(Number).filter(Boolean);
  if (list.length) {
    await db.query(`UPDATE mail_outbox SET status = 'pending', attempts = 0, next_attempt_at = ? WHERE status = 'failed' AND id IN (${db.inList(list)})`, [ts, ...list]);
  } else {
    await db.query("UPDATE mail_outbox SET status = 'pending', attempts = 0, next_attempt_at = ? WHERE status = 'failed'", [ts]);
  }
  setImmediate(processOutbox);
}

// The email layout lives in email-template.js.
const { render, REPLY_MARKER } = require('./email-template');

module.exports = { send, deliver, processOutbox, outboxStatus, retryFailed, render, configured, REPLY_MARKER };
