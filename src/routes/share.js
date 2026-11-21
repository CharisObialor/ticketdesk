// Ticket transcripts shared by link: anyone with the link can read the copy that was made when it was shared (the
// client's version, without internal notes). The token is 32 random bytes, so links cannot be guessed; a revoked
// link, or one for a deleted ticket, simply stops working.
const fs = require('fs');
const path = require('path');
const router = require('express').Router();
const db = require('../db');
const { transcriptsDir } = require('../uploads');
const { wrap, now } = require('../util');

const notFound = (res) =>
  res
    .status(404)
    .type('text/html')
    .send(
      '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Link not available</title></head><body style="margin:0;background:#f3f4f6;font:15px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827"><div style="max-width:520px;margin:64px auto;padding:0 16px"><h1 style="font-size:20px">This link is no longer available</h1><p style="color:#6b7280">The transcript may have been withdrawn. Please ask the person who sent it to you for a new link.</p></div></body></html>'
    );

router.get(
  '/transcript/:token',
  wrap(async (req, res) => {
    const token = String(req.params.token || '');
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return notFound(res);
    const s = await db.one('SELECT id, filename, revoked_at FROM transcript_shares WHERE token = ?', [token]);
    if (!s || s.revoked_at) return notFound(res);
    const file = path.join(transcriptsDir, path.basename(s.filename));
    if (!fs.existsSync(file)) return notFound(res);
    db.query('UPDATE transcript_shares SET views = views + 1, last_viewed_at = ? WHERE id = ?', [now(), s.id]).catch(() => {});
    res.set({ 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer' });
    res.type('text/html').sendFile(file);
  })
);

module.exports = router;
