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

const BLOCKED = /\.(exe|bat|cmd|com|msi|scr|ps1|vbs|vbe|js|jse|wsf|jar|sh|php\d?|phtml|cgi|pl|py|dll|hta|lnk|reg)$/i;

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

function cleanup(files = []) {
  for (const f of files) fs.unlink(f.path, () => {});
}

module.exports = { upload, cleanup, uploadsDir, transcriptsDir };
