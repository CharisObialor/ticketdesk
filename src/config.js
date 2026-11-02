const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(root, '.env') });

const env = process.env;
const isProd = env.NODE_ENV === 'production';

let jwtSecret = env.JWT_SECRET;
// The secret signs every session; a short or sample value would let anyone forge an admin session.
if (isProd && jwtSecret && (jwtSecret.length < 32 || /change|example|local-dev|secret/i.test(jwtSecret))) {
  throw new Error('JWT_SECRET is too weak for production. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"');
}
if (!jwtSecret || jwtSecret === 'change-me') {
  if (isProd) throw new Error('JWT_SECRET must be set in .env for production');
  jwtSecret = crypto.randomBytes(32).toString('hex');
  console.warn('[config] JWT_SECRET not set - using a random one (sessions reset on restart)');
}

const graphReady = !!(env.MS_TENANT_ID && env.MS_CLIENT_ID && env.MS_CLIENT_SECRET && env.MS_MAILBOX);

const int = (v, d) => (v === undefined || v === '' ? d : parseInt(v, 10));

module.exports = {
  root,
  isProd,
  trustProxy: /^\d+$/.test(env.TRUST_PROXY || '') ? Number(env.TRUST_PROXY) : 1,
  port: int(env.PORT, 3000),
  appName: env.APP_NAME || 'DateHeight Support',
  companyName: env.COMPANY_NAME || 'DateHeight Integrated Nigeria Limited',
  appUrl: (env.APP_URL || `http://localhost:${int(env.PORT, 3000)}`).replace(/\/+$/, ''),
  // Where the API runs, when the website and the API are on different addresses (dateheightsupport.com and
  // api.dateheightsupport.com). Leave unset when one app serves both.
  apiUrl: (env.API_URL || env.APP_URL || `http://localhost:${int(env.PORT, 3000)}`).replace(/\/+$/, ''),
  // Share the sign-in cookies across subdomains (".dateheightsupport.com") so the website can send the CSRF token.
  cookieDomain: env.COOKIE_DOMAIN || undefined,
  jwtSecret,
  sessionDays: 7,
  // Signed out after this many minutes without activity (0 = never).
  sessionIdleMinutes: int(env.SESSION_IDLE_MINUTES, 30),
  db: {
    client: (env.DB_CLIENT || 'mysql').toLowerCase(),
    host: env.DB_HOST || 'localhost',
    port: int(env.DB_PORT, 3306),
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    sqlitePath: path.resolve(root, env.SQLITE_PATH || 'storage/ticketdesk.sqlite'),
  },
  admin: { name: env.ADMIN_NAME || 'Admin', email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD },
  // The only admin who can create, edit or invite other admins (and promote people to admin).
  // Admins who have the portal open get updates in the bell only; email waits until they have been away this long.
  adminAwayMinutes: int(env.ADMIN_AWAY_MINUTES, 30),
  ownerEmail: (env.OWNER_EMAIL || 'charis.obialor@dateheight.com').trim().toLowerCase(),
  // 'graph' = Microsoft 365 through Microsoft Graph; 'smtp' = any SMTP/IMAP host (e.g. cPanel mail).
  // Microsoft 365 is used only once all four MS_* values are set, so a half-finished setup never breaks email.
  mailProvider: (env.MAIL_PROVIDER || (graphReady ? 'graph' : 'smtp')).toLowerCase(),
  graph: {
    tenantId: env.MS_TENANT_ID,
    clientId: env.MS_CLIENT_ID,
    clientSecret: env.MS_CLIENT_SECRET,
    mailbox: env.MS_MAILBOX || env.SMTP_USER,
    // Emails an admin triggers (replies, status changes, visits) are sent from their own Microsoft 365 mailbox
    // when their address is on one of these domains; everything else uses the support mailbox.
    sendAsStaff: env.MS_SEND_AS_STAFF !== 'false',
    senderDomains: (env.MS_SENDER_DOMAINS || String(env.MS_MAILBOX || '').split('@')[1] || '')
      .split(',')
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean),
    // Optional hand-written list of shared mailboxes and who may open them, used when Exchange cannot be asked.
    sharedMailboxes: env.MS_SHARED_MAILBOXES || '',
    // Automatic emails (reminders, SLA alerts, digests, statements, account emails) go out from this shared mailbox,
    // as long as the delegate has Full Access to it in Exchange. Otherwise they use the support mailbox.
    systemMailbox: (env.MS_SYSTEM_MAILBOX || '').trim().toLowerCase(),
    systemDelegate: (env.MS_SYSTEM_DELEGATE || env.OWNER_EMAIL || 'charis.obialor@dateheight.com').trim().toLowerCase(),
  },
  smtp: {
    host: env.SMTP_HOST,
    port: int(env.SMTP_PORT, 465),
    secure: (env.SMTP_SECURE || 'true') === 'true',
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
    from: env.MAIL_FROM || (env.MS_MAILBOX ? `DateHeight Support <${env.MS_MAILBOX}>` : '') || env.SMTP_USER || 'support@localhost',
    replyTo: env.MAIL_REPLY_TO || '',
  },
  // Inbound email (reply by email). With Microsoft 365 it reads the MS_MAILBOX inbox (set REPLY_BY_EMAIL=false to turn off);
  // otherwise it is enabled when IMAP_HOST is set and defaults to the SMTP account.
  inbound: {
    enabled: graphReady && (env.MAIL_PROVIDER || 'graph').toLowerCase() === 'graph' ? env.REPLY_BY_EMAIL !== 'false' : !!env.IMAP_HOST,
    // REPLY_BY_EMAIL=replies-only: only emails sent to the portal's reply addresses are read; the rest of the inbox is
    // left untouched (for a personal mailbox). New tickets cannot be opened by email in this mode.
    repliesOnly: env.REPLY_BY_EMAIL === 'replies-only',
    host: env.IMAP_HOST,
    port: int(env.IMAP_PORT, 993),
    secure: (env.IMAP_SECURE || 'true') === 'true',
    user: env.IMAP_USER || env.SMTP_USER,
    pass: env.IMAP_PASS || env.SMTP_PASS,
    address: (env.INBOUND_ADDRESS || env.MS_MAILBOX || env.IMAP_USER || env.SMTP_USER || '').trim(),
    pollSeconds: int(env.IMAP_POLL_SECONDS, 60),
    // Emails without a signed reply address must pass SPF/DKIM/DMARC (set to false only if your host adds no Authentication-Results).
    requireVerifiedSender: env.INBOUND_REQUIRE_VERIFIED_SENDER !== 'false',
  },
  // Ticket assistant: built-in (free) by default; Ollama (free, self-hosted) or Claude (paid) when configured.
  ai: {
    provider: env.AI_PROVIDER || '',
    apiKey: env.ANTHROPIC_API_KEY || '',
    model: env.AI_MODEL || 'claude-opus-5-5',
    ollamaUrl: env.OLLAMA_URL || '',
    ollamaModel: env.OLLAMA_MODEL || 'llama3.1:8b',
  },
  // Admin action reminders: weekday summary email hour (APP_TIMEZONE), and immediate emails for urgent items.
  actions: { dailyHour: int(env.ACTIONS_DAILY_HOUR, 8), urgentEmails: env.ACTIONS_URGENT_EMAILS !== 'false' },
  // Times in emails (site visits) are shown in this zone.
  timezone: env.APP_TIMEZONE || 'Africa/Lagos',
  autoCloseDays: int(env.AUTO_CLOSE_DAYS, 7),
  chatDigestMinutes: int(env.CHAT_DIGEST_MINUTES, 15),
  // How long after sending people can edit a chat message, and delete it for everyone (minutes).
  chat: { editMinutes: int(env.CHAT_EDIT_MINUTES, 15), deleteMinutes: int(env.CHAT_DELETE_MINUTES, 60) },
  backup: { hour: int(env.BACKUP_HOUR, 2), keep: int(env.BACKUP_KEEP, 14) },
  storageDir: path.resolve(root, env.STORAGE_DIR || 'storage'),
  // Kept modest so uploads (and emails that carry them) stay light on the server.
  upload: { maxMb: int(env.UPLOAD_MAX_MB, 10), maxFiles: int(env.UPLOAD_MAX_FILES, 5) },
  // Photos on an engineer's work update (before and after): more files, with a cap on the total per update.
  // Messages (group chats, admin chats, ticket replies): any number of files, each within UPLOAD_MAX_MB, up to this total.
  messageUpload: { maxMb: int(env.UPLOAD_MAX_MB, 10), maxTotalMb: int(env.MESSAGE_ATTACHMENTS_MAX_TOTAL_MB, 200) },
  workUpload: { maxFiles: int(env.WORK_PHOTOS_MAX, 40), maxMb: int(env.UPLOAD_MAX_MB, 10), maxTotalMb: int(env.WORK_PHOTOS_MAX_TOTAL_MB, 200) },
  // Attachments on emails sent from the Mail page (total per email). Microsoft 365 must allow this size too.
  mailUpload: { maxTotalMb: int(env.MAIL_ATTACHMENT_MAX_MB, 100), maxFiles: int(env.MAIL_ATTACHMENT_MAX_FILES, 20) },
  slaMinutes: {
    urgent: int(env.SLA_URGENT_MIN, 60),
    high: int(env.SLA_HIGH_MIN, 240),
    normal: int(env.SLA_NORMAL_MIN, 1440),
    low: int(env.SLA_LOW_MIN, 2880),
  },
};
