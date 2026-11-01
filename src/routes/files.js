const path = require('path');
const router = require('express').Router();
const db = require('../db');
const { uploadsDir, transcriptsDir, INLINE } = require('../uploads');
const { requireAuth, requireStaff, isStaff, canAccessTicket } = require('../auth');
const { wrap, HttpError } = require('../util');

router.get(
  '/files/:id',
  requireAuth,
  wrap(async (req, res) => {
    const a = await db.one(
      `SELECT a.*, t.company_id, m.is_internal FROM attachments a
       JOIN tickets t ON t.id = a.ticket_id LEFT JOIN messages m ON m.id = a.message_id WHERE a.id = ?`,
      [Number(req.params.id)]
    );
    if (!canAccessTicket(req.user, a) || (a.is_internal && !isStaff(req.user))) throw new HttpError(404, 'File not found');
    const inline = INLINE.test(a.mime) && req.query.download !== '1';
    res.attachment(a.original_name);
    if (inline) res.set('Content-Disposition', res.get('Content-Disposition').replace(/^attachment/, 'inline'));
    res.type(inline ? a.mime : 'application/octet-stream');
    res.set('Cache-Control', 'private, max-age=86400');
    res.sendFile(path.join(uploadsDir, path.basename(a.stored_name)));
  })
);

router.get(
  '/transcripts',
  requireStaff,
  wrap(async (req, res) => {
    const q = String(req.query.q || '').trim().slice(0, 100);
    const params = [];
    let where = '';
    if (q) {
      where = /^#?\d+$/.test(q) ? 'WHERE t.id = ?' : 'WHERE (t.subject LIKE ? OR c.name LIKE ?)';
      params.push(...(/^#?\d+$/.test(q) ? [Number(q.replace('#', ''))] : [`%${q}%`, `%${q}%`]));
    }
    const rows = await db.query(
      `SELECT tr.id, tr.ticket_id, tr.filename, tr.size, tr.message_count, tr.reason, tr.created_at,
        t.subject, c.name AS company_name, u.name AS created_by_name
       FROM transcripts tr JOIN tickets t ON t.id = tr.ticket_id JOIN companies c ON c.id = t.company_id
       LEFT JOIN users u ON u.id = tr.created_by ${where} ORDER BY tr.id DESC LIMIT 300`,
      params
    );
    res.json({ transcripts: rows });
  })
);

router.get(
  '/transcripts/:id/download',
  requireStaff,
  wrap(async (req, res) => {
    const tr = await db.one('SELECT * FROM transcripts WHERE id = ?', [Number(req.params.id)]);
    if (!tr) throw new HttpError(404, 'Transcript not found');
    res.download(path.join(transcriptsDir, path.basename(tr.filename)), tr.filename);
  })
);

module.exports = router;
