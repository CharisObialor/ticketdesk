const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(root, '.env') });

const env = process.env;
const isProd = env.NODE_ENV === 'production';

let jwtSecret = env.JWT_SECRET;
if (!jwtSecret || jwtSecret === 'change-me') {
  if (isProd) throw new Error('JWT_SECRET must be set in .env for production');
  jwtSecret = crypto.randomBytes(32).toString('hex');
  console.warn('[config] JWT_SECRET not set - using a random one (sessions reset on restart)');
}

const int = (v, d) => (v === undefined || v === '' ? d : parseInt(v, 10));

module.exports = {
  root,
  isProd,
  port: int(env.PORT, 3000),
  appName: env.APP_NAME || 'DateHeight Support',
  companyName: env.COMPANY_NAME || 'DateHeight Integrated Nigeria Limited',
  appUrl: (env.APP_URL || `http://localhost:${int(env.PORT, 3000)}`).replace(/\/+$/, ''),
  jwtSecret,
  sessionDays: 7,
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
  smtp: {
    host: env.SMTP_HOST,
    port: int(env.SMTP_PORT, 465),
    secure: (env.SMTP_SECURE || 'true') === 'true',
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
    from: env.MAIL_FROM || env.SMTP_USER || 'support@localhost',
    replyTo: env.MAIL_REPLY_TO || '',
  },
  // Inbound email (reply by email). Enabled when IMAP_HOST is set; defaults to the SMTP account.
  inbound: {
    enabled: !!env.IMAP_HOST,
    host: env.IMAP_HOST,
    port: int(env.IMAP_PORT, 993),
    secure: (env.IMAP_SECURE || 'true') === 'true',
    user: env.IMAP_USER || env.SMTP_USER,
    pass: env.IMAP_PASS || env.SMTP_PASS,
    address: (env.INBOUND_ADDRESS || env.IMAP_USER || env.SMTP_USER || '').trim(),
    pollSeconds: int(env.IMAP_POLL_SECONDS, 60),
  },
  // Times in emails (site visits) are shown in this zone.
  timezone: env.APP_TIMEZONE || 'Africa/Lagos',
  autoCloseDays: int(env.AUTO_CLOSE_DAYS, 7),
  chatDigestMinutes: int(env.CHAT_DIGEST_MINUTES, 15),
  backup: { hour: int(env.BACKUP_HOUR, 2), keep: int(env.BACKUP_KEEP, 14) },
  storageDir: path.resolve(root, env.STORAGE_DIR || 'storage'),
  upload: { maxMb: int(env.UPLOAD_MAX_MB, 25), maxFiles: int(env.UPLOAD_MAX_FILES, 10) },
  slaMinutes: {
    urgent: int(env.SLA_URGENT_MIN, 60),
    high: int(env.SLA_HIGH_MIN, 240),
    normal: int(env.SLA_NORMAL_MIN, 1440),
    low: int(env.SLA_LOW_MIN, 2880),
  },
};
