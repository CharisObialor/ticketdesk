const router = require('express').Router();
const bcrypt = require('bcryptjs');
const db = require('../db');
const notify = require('../notify');
const { checkPassword } = require('../password');
const { requireStaff, requireAdmin, publicUser, makeToken, ROLES, STAFF_ROLES } = require('../auth');
const { wrap, now, HttpError, OPEN_STATUSES } = require('../util');

const clean = (v, max) => String(v ?? '').trim().slice(0, max);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.get(
  '/staff',
  requireStaff,
  wrap(async (req, res) => {
    const rows = await db.query(`SELECT id, name, role FROM users WHERE role IN (${db.inList(STAFF_ROLES)}) AND is_active = 1 ORDER BY name`, STAFF_ROLES);
    res.json({ staff: rows });
  })
);

// ---- Companies ----

router.get(
  '/companies',
  requireStaff,
  wrap(async (req, res) => {
    const rows = await db.query(
      `SELECT c.*,
        (SELECT COUNT(*) FROM users u WHERE u.company_id = c.id) AS user_count,
        (SELECT COUNT(*) FROM tickets t WHERE t.company_id = c.id AND t.status IN (${db.inList(OPEN_STATUSES)})) AS open_tickets,
        (SELECT COUNT(*) FROM tickets t WHERE t.company_id = c.id) AS total_tickets
       FROM companies c ORDER BY c.name`,
      OPEN_STATUSES
    );
    res.json({ companies: rows });
  })
);

function companyFields(b, existing = {}) {
  const name = clean(b.name ?? existing.name, 190);
  if (!name) throw new HttpError(400, 'Company name is required');
  return {
    name,
    email_domain: clean(b.email_domain ?? existing.email_domain, 190).toLowerCase().replace(/^@/, '') || null,
    notes: clean(b.notes ?? existing.notes, 2000) || null,
    is_active: b.is_active === undefined ? existing.is_active ?? 1 : !!b.is_active,
  };
}

router.post(
  '/companies',
  requireAdmin,
  wrap(async (req, res) => {
    const f = companyFields(req.body);
    const r = await db.query('INSERT INTO companies (name, email_domain, notes, is_active, created_at) VALUES (?, ?, ?, ?, ?)', [
      f.name,
      f.email_domain,
      f.notes,
      f.is_active,
      now(),
    ]);
    res.status(201).json({ company: { id: r.insertId, ...f } });
  })
);

router.patch(
  '/companies/:id',
  requireAdmin,
  wrap(async (req, res) => {
    const existing = await db.one('SELECT * FROM companies WHERE id = ?', [Number(req.params.id)]);
    if (!existing) throw new HttpError(404, 'Company not found');
    const f = companyFields(req.body, existing);
    await db.query('UPDATE companies SET name = ?, email_domain = ?, notes = ?, is_active = ? WHERE id = ?', [
      f.name,
      f.email_domain,
      f.notes,
      f.is_active,
      existing.id,
    ]);
    res.json({ company: { ...existing, ...f } });
  })
);

// ---- Users ----

const USER_SELECT = 'SELECT u.*, c.name AS company_name FROM users u LEFT JOIN companies c ON c.id = u.company_id';

router.get(
  '/users',
  requireStaff,
  wrap(async (req, res) => {
    const params = [];
    let where = '';
    if (req.query.company_id) {
      where = 'WHERE u.company_id = ?';
      params.push(Number(req.query.company_id));
    }
    const rows = await db.query(`${USER_SELECT} ${where} ORDER BY u.role = 'client', u.name`, params);
    res.json({ users: rows.map(publicUser) });
  })
);

async function validateUser(b, existing = {}) {
  const role = b.role ?? existing.role ?? 'client';
  if (!ROLES.includes(role)) throw new HttpError(400, 'Invalid role');
  const name = clean(b.name ?? existing.name, 190);
  if (!name) throw new HttpError(400, 'Name is required');
  let companyId = b.company_id !== undefined ? Number(b.company_id) || null : existing.company_id ?? null;
  if (role === 'client') {
    if (!companyId || !(await db.one('SELECT id FROM companies WHERE id = ?', [companyId]))) {
      throw new HttpError(400, 'Client users must belong to a company');
    }
  } else {
    companyId = null;
  }
  return {
    name,
    role,
    company_id: companyId,
    phone: clean(b.phone ?? existing.phone, 40) || null,
    is_active: b.is_active === undefined ? existing.is_active ?? 1 : !!b.is_active,
    notify_email: b.notify_email === undefined ? existing.notify_email ?? 1 : !!b.notify_email,
  };
}

async function sendInvite(user) {
  const { token, hash } = makeToken();
  await db.query('UPDATE users SET token_hash = ?, token_expires = ? WHERE id = ?', [hash, now(new Date(Date.now() + 72 * 3600e3)), user.id]);
  notify.invite(user, token);
}

router.post(
  '/users',
  requireAdmin,
  wrap(async (req, res) => {
    const email = clean(req.body.email, 190).toLowerCase();
    if (!EMAIL_RE.test(email)) throw new HttpError(400, 'A valid email is required');
    if (await db.one('SELECT id FROM users WHERE email = ?', [email])) throw new HttpError(409, 'A user with that email already exists');
    const f = await validateUser(req.body);
    let hash = null;
    if (req.body.password) {
      checkPassword(String(req.body.password), { email, name: req.body.name });
      hash = await bcrypt.hash(String(req.body.password), 11);
    }
    const r = await db.query(
      `INSERT INTO users (company_id, name, email, password_hash, role, phone, is_active, notify_email, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [f.company_id, f.name, email, hash, f.role, f.phone, f.is_active, f.notify_email, now()]
    );
    const user = await db.one(`${USER_SELECT} WHERE u.id = ?`, [r.insertId]);
    if (req.body.send_invite !== false) await sendInvite(user);
    res.status(201).json({ user: publicUser(user) });
  })
);

router.patch(
  '/users/:id',
  requireAdmin,
  wrap(async (req, res) => {
    const existing = await db.one('SELECT * FROM users WHERE id = ?', [Number(req.params.id)]);
    if (!existing) throw new HttpError(404, 'User not found');
    const f = await validateUser(req.body, existing);
    if (existing.id === req.user.id && (f.role !== 'admin' || !f.is_active)) {
      throw new HttpError(400, "You can't remove your own admin access");
    }
    await db.query('UPDATE users SET name = ?, role = ?, company_id = ?, phone = ?, is_active = ?, notify_email = ? WHERE id = ?', [
      f.name,
      f.role,
      f.company_id,
      f.phone,
      f.is_active,
      f.notify_email,
      existing.id,
    ]);
    const user = await db.one(`${USER_SELECT} WHERE u.id = ?`, [existing.id]);
    res.json({ user: publicUser(user) });
  })
);

router.post(
  '/users/:id/invite',
  requireAdmin,
  wrap(async (req, res) => {
    const user = await db.one('SELECT * FROM users WHERE id = ? AND is_active = 1', [Number(req.params.id)]);
    if (!user) throw new HttpError(404, 'User not found or inactive');
    await sendInvite(user);
    res.json({ ok: true });
  })
);

module.exports = router;
