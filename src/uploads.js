const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const config = require('./config');
const { HttpError } = require('./util');

const uploadsDir = path.join(config.storageDir, 'uploads');
const transcriptsDir = path.join(config.storageDir, 'transcripts');
fs.mkdirSync(uploadsDir, { recursive: true });
fs.mkdirSync(transcriptsDir, { recursive: true });

const BLOCKED = /\.(exe|bat|cmd|com|msi|msp|scr|pif|cpl|ps1|psm1|vb|vbs|vbe|js|jse|mjs|wsf|ws|wsh|jar|war|sh|bash|php\d?|phtml|phar|cgi|pl|py|rb|dll|sys|hta|lnk|reg|scf|jsp|jspx|asp|aspx|ashx|asmx|cfm|shtml|htaccess)$/i;

// Browsers send UTF-8 filenames that busboy decodes as latin1; recover the original.
function fixName(name) {
  const utf8 = Buffer.from(name, 'latin1').toString('utf8');
  return utf8.includes('�') ? name : utf8;
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => cb(null, crypto.randomBytes(16).toString('hex')),
  }),
  limits: { fileSize: config.upload.maxMb * 1024 * 1024, files: config.upload.maxFiles },
  fileFilter(req, file, cb) {
    file.originalname = fixName(file.originalname).slice(0, 200);
    if (BLOCKED.test(file.originalname)) return cb(new HttpError(400, `File type not allowed: ${file.originalname}`));
    cb(null, true);
  },
});

// Largest request an upload may be: every allowed file at full size plus room for the form fields.
const WORK_UPDATE = /^\/tickets\/\d+\/work-updates$/;
const maxRequestBytes = (req) =>
  (req.path === '/mail/send'
    ? config.mailUpload.maxTotalMb + 1
    : WORK_UPDATE.test(req.path)
      ? config.workUpload.maxTotalMb + 1
      : config.upload.maxMb * config.upload.maxFiles + 1) *
  1024 *
  1024;
function limitRequestSize(req, res, next) {
  const declared = Number(req.headers['content-length'] || 0);
  if (declared > maxRequestBytes(req)) {
    if (req.path === '/mail/send') {
      req.resume();
      return next(new HttpError(413, `Attachments are too large. An email can carry up to ${config.mailUpload.maxTotalMb} MB in total.`));
    }
    if (WORK_UPDATE.test(req.path)) {
      req.resume();
      return next(new HttpError(413, `Photos are too large. A work update can carry up to ${config.workUpload.maxTotalMb} MB in total.`));
    }
    req.resume();
    return next(new HttpError(413, `Upload too large. Attach up to ${config.upload.maxFiles} files of ${config.upload.maxMb} MB each.`));
  }
  next();
}

// Mail page attachments: written straight to disk as they arrive (never held in memory), larger limit.
const mailUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => cb(null, crypto.randomBytes(16).toString('hex')),
  }),
  limits: { fileSize: config.mailUpload.maxTotalMb * 1024 * 1024, files: config.mailUpload.maxFiles },
  fileFilter(req, file, cb) {
    file.originalname = fixName(file.originalname).slice(0, 200);
    if (BLOCKED.test(file.originalname)) return cb(new HttpError(400, `File type not allowed: ${file.originalname}`));
    cb(null, true);
  },
});

// Work update photos: more files per update than ordinary attachments.
const workUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => cb(null, crypto.randomBytes(16).toString('hex')),
  }),
  limits: { fileSize: config.workUpload.maxMb * 1024 * 1024, files: config.workUpload.maxFiles },
  fileFilter(req, file, cb) {
    file.originalname = fixName(file.originalname).slice(0, 200);
    if (BLOCKED.test(file.originalname)) return cb(new HttpError(400, `File type not allowed: ${file.originalname}`));
    cb(null, true);
  },
});

function cleanup(files = []) {
  for (const f of files) fs.unlink(f.path, () => {});
}

module.exports = { upload, mailUpload, workUpload, cleanup, limitRequestSize, uploadsDir, transcriptsDir };
