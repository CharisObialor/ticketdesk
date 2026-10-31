// Notifications (the bell), saved replies, site visits and system tools (backups, email status).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const router = require('express').Router();
const config = require('../config');
const db = require('../db');
const notify = require('../notify');
const mailer = require('../mailer');
const realtime = require('../realtime');
const backup = require('../backup');
const inbound = require('../inbound');
const svc = require('../services/tickets');
const { upload, cleanup, uploadsDir } = require('../uploads');
const { requireAuth, requireStaff, requireAdmin, isStaff, canAccessTicket, STAFF_ROLES } = require('../auth');
const { wrap, now, HttpError } = require('../util');

// Site visits run from a 15-minute check to a week-long installation.
const MAX_VISIT_MIN = 7 * 24 * 60;

const clean = (v, max) => String(v ?? '').trim().slice(0, max);

router.use(requireAuth);

// ---- Notifications ----

router.get(
  '/notifications',
  wrap(async (req, res) => {
    // Clients only see notices about their own tickets, messages and visits.
    const only = req.user.role === 'client' ? `AND ${require('../inapp').CLIENT_FILTER}` : '';
    const [items, unread] = await Promise.all([
      db.query(`SELECT * FROM notifications WHERE user_id = ? ${only} ORDER BY id DESC LIMIT 40`, [req.user.id]),
      db.one(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND is_read = 0 ${only}`, [req.user.id]),
    ]);
    res.json({ items, unread: Number(unread.n) || 0 });
  })
);

// Marks the given notification ids (or all of them) as read.
router.post(
  '/notifications/read',
  wrap(async (req, res) => {
    const ids = (Array.isArray(req.body.ids) ? req.body.ids : []).map(Number).filter(Boolean);
    if (ids.length) {
      await db.query(`UPDATE notifications SET is_read = 1 WHERE user_id = ? AND id IN (${db.inList(ids)})`, [req.user.id, ...ids]);
    } else {
      await db.query('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0', [req.user.id]);
    }
    realtime.toUsers([req.user.id], 'notification:read', { ids });
    res.json({ ok: true });
  })
);

// ---- Saved replies (staff) ----

const SAVED_SELECT = 'SELECT s.*, u.name AS created_by_name FROM saved_replies s LEFT JOIN users u ON u.id = s.created_by';

async function loadSaved(req, { edit = false } = {}) {
  const s = await db.one(`${SAVED_SELECT} WHERE s.id = ?`, [Number(req.params.id)]);
  const mine = s && Number(s.created_by) === req.user.id;
  if (!s || (!s.is_shared && !mine)) throw new HttpError(404, 'Saved reply not found');
  if (edit && !mine && req.user.role !== 'admin') throw new HttpError(403, 'Only the author or an admin can change this saved reply');
  return s;
}

function savedFields(b, existing = {}) {
  const title = clean(b.title ?? existing.title, 120);
  const body = clean(b.body ?? existing.body, 20000);
  if (!title) throw new HttpError(400, 'Give the saved reply a title');
  if (!body) throw new HttpError(400, 'Write the reply text');
  return { title, body, is_shared: b.is_shared === undefined ? existing.is_shared ?? 1 : !!b.is_shared };
}

router.get(
  '/saved-replies',
  requireStaff,
  wrap(async (req, res) => {
    const rows = await db.query(`${SAVED_SELECT} WHERE s.is_shared = 1 OR s.created_by = ? ORDER BY s.title`, [req.user.id]);
    res.json({ replies: rows });
  })
);

router.post(
  '/saved-replies',
  requireStaff,
  wrap(async (req, res) => {
    const f = savedFields(req.body);
    const ts = now();
    const r = await db.query('INSERT INTO saved_replies (title, body, is_shared, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [
      f.title,
      f.body,
      f.is_shared,
      req.user.id,
      ts,
      ts,
    ]);
    res.status(201).json({ reply: await db.one(`${SAVED_SELECT} WHERE s.id = ?`, [r.insertId]) });
  })
);

router.patch(
  '/saved-replies/:id',
  requireStaff,
  wrap(async (req, res) => {
    const s = await loadSaved(req, { edit: true });
    const f = savedFields(req.body, s);
    await db.query('UPDATE saved_replies SET title = ?, body = ?, is_shared = ?, updated_at = ? WHERE id = ?', [f.title, f.body, f.is_shared, now(), s.id]);
    res.json({ reply: await db.one(`${SAVED_SELECT} WHERE s.id = ?`, [s.id]) });
  })
);

router.delete(
  '/saved-replies/:id',
  requireStaff,
  wrap(async (req, res) => {
    const s = await loadSaved(req, { edit: true });
    await db.query('DELETE FROM saved_replies WHERE id = ?', [s.id]);
    res.json({ ok: true });
  })
);

// ---- Site visits ----

const VISIT_SELECT = `SELECT v.*, u.name AS technician_name, u.phone AS technician_phone, t.subject AS ticket_subject, t.company_id,
  c.name AS company_name, cu.name AS requester_name
  FROM site_visits v
  JOIN tickets t ON t.id = v.ticket_id
  JOIN companies c ON c.id = t.company_id
  LEFT JOIN users u ON u.id = v.technician_id
  LEFT JOIN users cu ON cu.id = t.created_by`;

// Clients see when and who, but not the technician's private notes or phone number.
const forViewer = (user, v) => (isStaff(user) ? v : { ...v, notes: null, technician_phone: null, created_by: null });

async function loadVisit(req) {
  const v = await db.one(`${VISIT_SELECT} WHERE v.id = ?`, [Number(req.params.id)]);
  if (!v || !canAccessTicket(req.user, v)) throw new HttpError(404, 'Visit not found');
  return v;
}

function parseWhen(value) {
  const d = new Date(value);
  if (!value || Number.isNaN(d.getTime())) throw new HttpError(400, 'Choose a valid date and time');
  return now(d);
}

async function validTechnician(id) {
  if (!id) return null;
  const u = await db.one(`SELECT id FROM users WHERE id = ? AND is_active = 1 AND role IN (${db.inList(STAFF_ROLES)})`, [Number(id), ...STAFF_ROLES]);
  if (!u) throw new HttpError(400, 'Choose a valid technician');
  return u.id;
}

router.get(
  '/visits',
  requireStaff,
  wrap(async (req, res) => {
    const where = [];
    const params = [];
    if (req.query.scope !== 'all') {
      where.push('v.technician_id = ?');
      params.push(req.user.id);
    }
    if (req.query.when === 'past') where.push("v.status IN ('completed', 'cancelled')");
    else where.push("v.status IN ('scheduled', 'in_progress')");
    const rows = await db.query(
      `${VISIT_SELECT} WHERE ${where.join(' AND ')} ORDER BY v.scheduled_at ${req.query.when === 'past' ? 'DESC' : 'ASC'} LIMIT 200`,
      params
    );
    res.json({ visits: rows });
  })
);

router.get(
  '/visits/:id',
  wrap(async (req, res) => {
    res.json({ visit: forViewer(req.user, await loadVisit(req)) });
  })
);

router.post(
  '/visits',
  requireStaff,
  wrap(async (req, res) => {
    const t = await svc.getTicket(Number(req.body.ticket_id));
    if (!t) throw new HttpError(404, 'Ticket not found');
    if (t.status === 'closed') throw new HttpError(400, 'This ticket is closed');
    const scheduledAt = parseWhen(req.body.scheduled_at);
    const technicianId = await validTechnician(req.body.technician_id);
    if (!technicianId) throw new HttpError(400, 'Choose a technician');
    const duration = Math.min(Math.max(Number(req.body.duration_min) || 60, 15), MAX_VISIT_MIN);
    const ts = now();
    const r = await db.query(
      `INSERT INTO site_visits (ticket_id, technician_id, scheduled_at, duration_min, location, notes, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'scheduled', ?, ?, ?)`,
      [t.id, technicianId, scheduledAt, duration, clean(req.body.location, 255) || null, clean(req.body.notes, 5000) || null, req.user.id, ts, ts]
    );
    const v = await db.one(`${VISIT_SELECT} WHERE v.id = ?`, [r.insertId]);
    // Clients see that a visit is booked; only the team sees which engineer is going.
    await svc.systemMessage(t, req.user, 'Site visit scheduled.');
    await svc.teamNote(t, req.user, `Site visit scheduled with ${v.technician_name}.`);
    await svc.touch(t.id);
    notify.visitChanged(v, t, req.user, 'scheduled');
    res.status(201).json({ visit: v });
  })
);

// Reschedule, reassign or edit the plan for a visit that has not finished.
router.patch(
  '/visits/:id',
  requireStaff,
  wrap(async (req, res) => {
    const v = await loadVisit(req);
    if (!['scheduled', 'in_progress'].includes(v.status)) throw new HttpError(400, 'This visit can no longer be changed');
    const b = req.body;
    const scheduledAt = b.scheduled_at !== undefined ? parseWhen(b.scheduled_at) : v.scheduled_at;
    const technicianId = b.technician_id !== undefined ? await validTechnician(b.technician_id) : v.technician_id;
    const duration = b.duration_min !== undefined ? Math.min(Math.max(Number(b.duration_min) || 60, 15), MAX_VISIT_MIN) : v.duration_min;
    const location = b.location !== undefined ? clean(b.location, 255) || null : v.location;
    const notes = b.notes !== undefined ? clean(b.notes, 5000) || null : v.notes;
    await db.query('UPDATE site_visits SET scheduled_at = ?, technician_id = ?, duration_min = ?, location = ?, notes = ?, updated_at = ? WHERE id = ?', [
      scheduledAt,
      technicianId,
      duration,
      location,
      notes,
      now(),
      v.id,
    ]);
    const updated = await db.one(`${VISIT_SELECT} WHERE v.id = ?`, [v.id]);
    if (scheduledAt !== v.scheduled_at || Number(technicianId) !== Number(v.technician_id)) {
      const t = await svc.getTicket(v.ticket_id);
      await svc.systemMessage(t, req.user, 'Site visit rescheduled.');
      await svc.teamNote(t, req.user, `Site visit rescheduled (technician: ${updated.technician_name || 'unassigned'}).`);
      await svc.touch(t.id);
      notify.visitChanged(updated, t, req.user, 'rescheduled');
    }
    res.json({ visit: updated });
  })
);

router.post(
  '/visits/:id/cancel',
  requireStaff,
  wrap(async (req, res) => {
    const v = await loadVisit(req);
    if (!['scheduled', 'in_progress'].includes(v.status)) throw new HttpError(400, 'This visit can no longer be cancelled');
    await db.query("UPDATE site_visits SET status = 'cancelled', updated_at = ? WHERE id = ?", [now(), v.id]);
    const t = await svc.getTicket(v.ticket_id);
    await svc.systemMessage(t, req.user, 'Site visit cancelled.');
    await svc.touch(t.id);
    const updated = await db.one(`${VISIT_SELECT} WHERE v.id = ?`, [v.id]);
    notify.visitChanged(updated, t, req.user, 'cancelled');
    res.json({ visit: updated });
  })
);

router.post(
  '/visits/:id/start',
  requireStaff,
  wrap(async (req, res) => {
    const v = await loadVisit(req);
    if (v.status !== 'scheduled') throw new HttpError(400, 'This visit has already started or finished');
    await db.query("UPDATE site_visits SET status = 'in_progress', started_at = ?, updated_at = ? WHERE id = ?", [now(), now(), v.id]);
    const t = await svc.getTicket(v.ticket_id);
    await svc.systemMessage(t, req.user, 'Our engineer arrived on site and started the visit.');
    await svc.teamNote(t, req.user, `${req.user.name} arrived on site and started the visit.`);
    await svc.touch(t.id);
    res.json({ visit: await db.one(`${VISIT_SELECT} WHERE v.id = ?`, [v.id]) });
  })
);

// Completes a visit with the work report, photos and the client's signature.
// The report is posted to the ticket conversation so the client sees it and is emailed.
router.post(
  '/visits/:id/complete',
  requireStaff,
  upload.array('files'),
  wrap(async (req, res) => {
    const files = [...(req.files || [])];
    try {
      const v = await loadVisit(req);
      if (!['scheduled', 'in_progress'].includes(v.status)) throw new HttpError(400, 'This visit has already been completed or cancelled');
      const report = clean(req.body.report, 20000);
      if (!report) throw new HttpError(400, 'Describe the work carried out');
      const signedBy = clean(req.body.signed_by, 190) || null;

      // The signature arrives as a PNG data URL from the signature pad.
      const sig = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body.signature || ''));
      if (sig) {
        const buf = Buffer.from(sig[1], 'base64');
        if (buf.length > 2 * 1024 * 1024) throw new HttpError(400, 'Signature image is too large');
        const filename = crypto.randomBytes(16).toString('hex');
        await fs.promises.writeFile(path.join(uploadsDir, filename), buf);
        files.push({ originalname: `signature-visit-${v.id}.png`, filename, mimetype: 'image/png', size: buf.length, path: path.join(uploadsDir, filename) });
      }

      const ts = now();
      await db.query("UPDATE site_visits SET status = 'completed', report = ?, signed_by = ?, started_at = COALESCE(started_at, ?), completed_at = ?, updated_at = ? WHERE id = ?", [
        report,
        signedBy,
        ts,
        ts,
        ts,
        v.id,
      ]);
      const t = await svc.getTicket(v.ticket_id);
      const lines = [
        'Site visit report',
        '',
        // Clients see this report, and never learn our engineers' names.
        'Engineer: DateHeight engineer',
        `Location: ${v.location || v.company_name}`,
        '',
        report,
      ];
      if (signedBy) lines.push('', `Signed off on site by: ${signedBy}${sig ? ' (signature attached)' : ''}`);
      await svc.postReply(t, req.user, { body: lines.join('\n'), files });
      await svc.teamNote(t, req.user, `Site visit completed by ${req.user.name}. The client can now sign the job completion certificate.`);
      res.json({ visit: await db.one(`${VISIT_SELECT} WHERE v.id = ?`, [v.id]) });
    } catch (err) {
      cleanup(files);
      throw err;
    }
  })
);

// ---- System (admins): backups and email status ----

router.get(
  '/system',
  requireAdmin,
  wrap(async (req, res) => {
    res.json({
      backups: await backup.list(),
      lastBackup: await backup.lastStatus(),
      backupHour: config.backup.hour,
      backupKeep: config.backup.keep,
      email: {
        outgoing: mailer.configured(),
        provider: config.mailProvider === 'graph' && config.graph.clientId ? 'microsoft365' : config.smtp.host ? 'smtp' : 'none',
        mailbox: config.mailProvider === 'graph' ? config.graph.mailbox || null : config.smtp.user || null,
        sendAsStaff: mailer.configured() && config.mailProvider === 'graph' && config.graph.sendAsStaff ? config.graph.senderDomains : null,
        inbound: { ...inbound.status, address: config.inbound.address || null },
      },
      outbox: await mailer.outboxStatus(),
      autoCloseDays: config.autoCloseDays,
      sessionIdleMinutes: config.sessionIdleMinutes,
      chatDigestMinutes: config.chatDigestMinutes,
    });
  })
);

router.post(
  '/system/outbox/retry',
  requireAdmin,
  wrap(async (req, res) => {
    await mailer.retryFailed(Array.isArray(req.body.ids) ? req.body.ids : []);
    res.json({ ok: true });
  })
);

router.post(
  '/system/backups',
  requireAdmin,
  wrap(async (req, res) => {
    const status = await backup.run('manual');
    if (!status.ok) throw new HttpError(500, `Backup failed: ${status.error}`);
    res.status(201).json(status);
  })
);

router.get(
  '/system/backups/:name',
  requireAdmin,
  wrap(async (req, res) => {
    const name = path.basename(req.params.name);
    if (!/^db-\d{8}-\d{4}\.jsonl\.gz$/.test(name)) throw new HttpError(404, 'Backup not found');
    const file = path.join(backup.backupDir, name);
    if (!fs.existsSync(file)) throw new HttpError(404, 'Backup not found');
    res.download(file, name);
  })
);

module.exports = router;
