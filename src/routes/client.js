// Client-facing pages: home summary, their sites, their service performance, duplicate checks, and confirming and
// signing off site visits. Everything is limited to the signed-in client's own company.
const router = require('express').Router();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../db');
const svc = require('../services/tickets');
const { requireAuth, isStaff } = require('../auth');
const { companyStats } = require('../company-stats');
const { parseRange } = require('../periods');
const { wrap, now, HttpError, OPEN_STATUSES } = require('../util');

const { uploadsDir } = require('../uploads');

const clean = (v, max) => String(v ?? '').trim().slice(0, max);

// Only clients with a company use these pages.
function clientOnly(req, res, next) {
  if (!req.user || isStaff(req.user) || !req.user.company_id) return next(new HttpError(403, 'This page is for client accounts'));
  next();
}

// Visits as a client may see them: when, where and how far along, never which engineer.
const CLIENT_VISIT = `SELECT v.id, v.ticket_id, v.scheduled_at, v.duration_min, v.location, v.status, v.started_at, v.completed_at,
  v.client_confirmed_at, v.client_signed_at, v.client_signed_name, t.subject
  FROM site_visits v JOIN tickets t ON t.id = v.ticket_id`;

router.get(
  '/client/home',
  requireAuth,
  clientOnly,
  wrap(async (req, res) => {
    const cid = req.user.company_id;
    const openIn = db.inList(OPEN_STATUSES);
    const monthAgo = now(new Date(Date.now() - 30 * 864e5));
    const [open, toRate, upcoming, toSign] = await Promise.all([
      db.query(`${svc.TICKET_SELECT} WHERE t.company_id = ? AND t.status IN (${openIn}) ORDER BY t.last_activity_at DESC LIMIT 50`, [cid, ...OPEN_STATUSES]),
      db.query(
        `${svc.TICKET_SELECT} WHERE t.company_id = ? AND t.status IN ('resolved', 'closed') AND t.resolved_at >= ?
         AND NOT EXISTS (SELECT 1 FROM ticket_ratings r WHERE r.ticket_id = t.id) ORDER BY t.resolved_at DESC LIMIT 10`,
        [cid, monthAgo]
      ),
      db.query(`${CLIENT_VISIT} WHERE t.company_id = ? AND v.status IN ('scheduled', 'in_progress') ORDER BY v.scheduled_at LIMIT 20`, [cid]),
      db.query(`${CLIENT_VISIT} WHERE t.company_id = ? AND v.status = 'completed' AND v.client_signed_at IS NULL AND v.completed_at >= ? ORDER BY v.completed_at DESC LIMIT 20`, [
        cid,
        monthAgo,
      ]),
    ]);
    res.json({
      open: open.filter((t) => t.status !== 'awaiting_client'),
      awaitingYou: open.filter((t) => t.status === 'awaiting_client'),
      toRate,
      visits: upcoming,
      visitsToSign: toSign,
    });
  })
);

// The company's sites with how many tickets each has, for the client Sites page.
router.get(
  '/client/sites',
  requireAuth,
  clientOnly,
  wrap(async (req, res) => {
    const openIn = db.inList(OPEN_STATUSES);
    const rows = await db.query(
      `SELECT s.id, s.code, s.location, s.details,
        (SELECT COUNT(*) FROM tickets t WHERE t.site_id = s.id AND t.status IN (${openIn})) AS open_count,
        (SELECT COUNT(*) FROM tickets t WHERE t.site_id = s.id) AS total_count,
        (SELECT MAX(t.created_at) FROM tickets t WHERE t.site_id = s.id) AS last_ticket_at
       FROM sites s WHERE s.company_id = ? AND s.is_active = 1 ORDER BY s.code`,
      [...OPEN_STATUSES, req.user.company_id]
    );
    res.json({ sites: rows.map((s) => ({ ...s, open_count: Number(s.open_count), total_count: Number(s.total_count) })) });
  })
);

// The client's own service figures: tickets, response and resolution against the SLA, visits and ratings.
router.get(
  '/client/performance',
  requireAuth,
  clientOnly,
  wrap(async (req, res) => {
    res.json(await companyStats(req.user.company_id, parseRange(req.query)));
  })
);

// Open tickets that may be the same issue: same site, or same fault category. Shown before logging a new one.
router.get(
  '/tickets-similar',
  requireAuth,
  wrap(async (req, res) => {
    const cid = isStaff(req.user) ? Number(req.query.company_id) : req.user.company_id;
    const siteId = Number(req.query.site_id) || null;
    const category = clean(req.query.category, 120);
    if (!cid || (!siteId && !category)) return res.json({ tickets: [] });
    const openIn = db.inList(OPEN_STATUSES);
    const rows = await db.query(
      `SELECT t.id, t.subject, t.status, t.category, t.created_at, s.code AS site_code FROM tickets t LEFT JOIN sites s ON s.id = t.site_id
       WHERE t.company_id = ? AND t.status IN (${openIn}) AND (${siteId ? 't.site_id = ?' : '1 = 0'} OR ${category && siteId ? '(t.site_id IS NULL AND t.category = ?)' : category ? 't.category = ?' : '1 = 0'})
       ORDER BY t.created_at DESC LIMIT 5`,
      [cid, ...OPEN_STATUSES, ...(siteId ? [siteId] : []), ...(category ? [category] : [])]
    );
    res.json({ tickets: rows });
  })
);

async function clientVisit(req) {
  const v = await db.one(`${CLIENT_VISIT} WHERE v.id = ? AND t.company_id = ?`, [Number(req.params.id), req.user.company_id]);
  if (!v) throw new HttpError(404, 'Visit not found');
  return v;
}

// The client confirms the engineer has arrived on site.
router.post(
  '/client/visits/:id/arrived',
  requireAuth,
  clientOnly,
  wrap(async (req, res) => {
    const v = await clientVisit(req);
    if (!['scheduled', 'in_progress'].includes(v.status)) throw new HttpError(400, 'This visit has already finished');
    if (v.client_confirmed_at) throw new HttpError(400, 'You have already confirmed the engineer arrived');
    const ts = now();
    await db.query('UPDATE site_visits SET client_confirmed_at = ?, client_confirmed_by = ?, updated_at = ? WHERE id = ?', [ts, req.user.id, ts, v.id]);
    const t = await svc.getTicket(v.ticket_id);
    await svc.systemMessage(t, req.user, `${req.user.name} confirmed the engineer arrived on site.`);
    await svc.touch(t.id);
    res.json({ visit: await clientVisit(req) });
  })
);

// The client signs the job completion certificate (JCC) for a completed visit, on screen.
router.post(
  '/client/visits/:id/sign',
  requireAuth,
  clientOnly,
  wrap(async (req, res) => {
    const v = await clientVisit(req);
    if (v.status !== 'completed') throw new HttpError(400, 'You can sign once the engineer has completed the visit');
    if (v.client_signed_at) throw new HttpError(400, 'This job has already been signed off');
    const name = clean(req.body.name, 190);
    if (!name) throw new HttpError(400, 'Enter your name');
    const satisfied = req.body.satisfied !== false;
    const comment = clean(req.body.comment, 2000) || null;
    const sig = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body.signature || ''));
    if (!sig) throw new HttpError(400, 'Sign in the box');
    const buf = Buffer.from(sig[1], 'base64');
    if (buf.length > 2 * 1024 * 1024) throw new HttpError(400, 'The signature image is too large');
    if (!buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) throw new HttpError(400, 'The signature is not a valid image');
    const filename = crypto.randomBytes(16).toString('hex');
    await fs.promises.writeFile(path.join(uploadsDir, filename), buf);
    const ts = now();
    await db.query('UPDATE site_visits SET client_signed_at = ?, client_signed_by = ?, client_signed_name = ?, client_satisfied = ?, client_comment = ?, updated_at = ? WHERE id = ?', [
      ts,
      req.user.id,
      name,
      satisfied ? 1 : 0,
      comment,
      ts,
      v.id,
    ]);
    const t = await svc.getTicket(v.ticket_id);
    const lines = [
      'Job completion certificate (JCC) signed',
      '',
      `Visit: ${v.location || t.company_name}, completed ${v.completed_at}`,
      `Signed by: ${name}`,
      `Work satisfactory: ${satisfied ? 'Yes' : 'No'}`,
    ];
    if (comment) lines.push('', comment);
    await svc.postReply(t, req.user, {
      body: lines.join('\n'),
      files: [{ originalname: `jcc-visit-${v.id}.png`, filename, mimetype: 'image/png', size: buf.length, path: path.join(uploadsDir, filename) }],
    });
    res.json({ visit: await clientVisit(req) });
  })
);

module.exports = router;
