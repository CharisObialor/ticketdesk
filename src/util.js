// UTC timestamp in 'YYYY-MM-DD HH:MM:SS' form - stored identically in MySQL and SQLite.
function now(date = new Date()) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

// Reads the stored form by position, which is many times faster than Date's string parser (the dashboard
// and reports parse tens of thousands of these). Anything else falls back to the general parser.
function parseTs(s) {
  if (!s) return null;
  const v = String(s);
  if (v.length === 19 && v[4] === '-' && v[7] === '-' && v[10] === ' ' && v[13] === ':') {
    return new Date(Date.UTC(+v.slice(0, 4), +v.slice(5, 7) - 1, +v.slice(8, 10), +v.slice(11, 13), +v.slice(14, 16), +v.slice(17, 19)));
  }
  return new Date(v.replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(v) ? '' : 'Z'));
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const HTML_ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => HTML_ESC[c]);
}

function errorHandler(err, req, res, next) {
  if (err.name === 'MulterError') {
    const msg =
      err.code === 'LIMIT_FILE_SIZE'
        ? String(req.originalUrl).startsWith('/api/mail/send')
          ? `Attachments are too large (${require('./config').mailUpload.maxTotalMb} MB per email at most)`
          : `File is too large (${require('./config').upload.maxMb} MB per file at most)`
        : err.code === 'LIMIT_FILE_COUNT'
          ? /\/work-updates$/.test(req.path)
            ? `Too many photos (${require('./config').workUpload.maxFiles} per work update at most)`
            : `Too many files (${require('./config').upload.maxFiles} per message at most)`
          : err.message;
    return res.status(400).json({ error: msg });
  }
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Something went wrong' : err.message });
}

const STATUSES = ['open', 'in_progress', 'awaiting_client', 'resolved', 'closed'];
const OPEN_STATUSES = ['open', 'in_progress', 'awaiting_client'];
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const CATEGORIES = ['General', 'Bug / Issue', 'Feature request', 'Access / Accounts', 'Billing', 'Other'];
const STATUS_LABELS = {
  open: 'Open',
  in_progress: 'In progress',
  awaiting_client: 'Awaiting client',
  resolved: 'Resolved',
  closed: 'Closed',
};

module.exports = {
  now,
  parseTs,
  HttpError,
  wrap,
  escapeHtml,
  errorHandler,
  STATUSES,
  OPEN_STATUSES,
  PRIORITIES,
  CATEGORIES,
  STATUS_LABELS,
};
