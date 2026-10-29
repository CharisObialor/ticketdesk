// UTC timestamp in 'YYYY-MM-DD HH:MM:SS' form - stored identically in MySQL and SQLite.
function now(date = new Date()) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function parseTs(s) {
  return s ? new Date(String(s).replace(' ', 'T') + 'Z') : null;
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
      err.code === 'LIMIT_FILE_SIZE' ? 'File is too large' : err.code === 'LIMIT_FILE_COUNT' ? 'Too many files' : err.message;
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
