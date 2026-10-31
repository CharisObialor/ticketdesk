const router = require('express').Router();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const config = require('../config');
const hasher = require('../hasher');
const db = require('../db');
const notify = require('../notify');
const { checkPassword } = require('../password');
const { requireStaff, requireAdmin, publicUser, makeToken, isOwner, ROLES, STAFF_ROLES } = require('../auth');

const OWNER_ONLY = 'Only the account owner can create or change admin accounts.';
const { wrap, now, HttpError, OPEN_STATUSES } = require('../util');

const clean = (v, max) => String(v ?? '').trim().slice(0, max);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.get(
  '/staff',
  requireStaff,
  wrap(async (req, res) => {
    const rows = await db.query(`SELECT id, name, email, role FROM users WHERE role IN (${db.inList(STAFF_ROLES)}) AND is_active = 1 ORDER BY name`, STAFF_ROLES);
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
    // Everyone registered under each company, for the contact list on the Companies page.
    const people = await db.query(
      'SELECT id, company_id, name, email, job_title, phone, is_active FROM users WHERE company_id IS NOT NULL ORDER BY is_active DESC, name'
    );
    const byCompany = new Map();
    for (const p of people) {
      if (!byCompany.has(p.company_id)) byCompany.set(p.company_id, []);
      byCompany.get(p.company_id).push({ ...p, is_active: !!p.is_active });
    }
    res.json({ companies: rows.map((c) => ({ ...withLogoUrl(c), contacts: byCompany.get(c.id) || [] })) });
  })
);

const logoUrl = (c) => (c.logo ? `/api/companies/${c.id}/logo?v=${c.logo}` : null);
const withLogoUrl = (c) => ({ ...c, logo_url: logoUrl(c) });

// RC numbers from the Corporate Affairs Commission, e.g. RC 1234567 (BN for business names, IT for trustees).
function rcNumber(v) {
  const s = clean(v, 40).toUpperCase().replace(/\s+/g, ' ');
  if (!s) return null;
  if (!/^[A-Z0-9 \-/]+$/.test(s)) throw new HttpError(400, 'RC number can only contain letters, numbers, spaces, hyphens and slashes');
  return s;
}

function companyFields(b, existing = {}) {
  const name = clean(b.name ?? existing.name, 190);
  if (!name) throw new HttpError(400, 'Company name is required');
  return {
    name,
    email_domain: clean(b.email_domain ?? existing.email_domain, 190).toLowerCase().replace(/^@/, '') || null,
    notes: clean(b.notes ?? existing.notes, 2000) || null,
    rc_number: b.rc_number !== undefined ? rcNumber(b.rc_number) : existing.rc_number ?? null,
    is_active: b.is_active === undefined ? existing.is_active ?? 1 : !!b.is_active,
  };
}

router.post(
  '/companies',
  requireAdmin,
  wrap(async (req, res) => {
    const f = companyFields(req.body);
    const r = await db.query('INSERT INTO companies (name, email_domain, notes, rc_number, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
      f.name,
      f.email_domain,
      f.notes,
      f.rc_number,
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
    await db.query('UPDATE companies SET name = ?, email_domain = ?, notes = ?, rc_number = ?, is_active = ? WHERE id = ?', [
      f.name,
      f.email_domain,
      f.notes,
      f.rc_number,
      f.is_active,
      existing.id,
    ]);
    res.json({ company: withLogoUrl({ ...existing, ...f }) });
  })
);

// ---- Company logos ----

const logosDir = path.join(config.storageDir, 'logos');
fs.mkdirSync(logosDir, { recursive: true });
const LOGO_TYPES = [
  { ext: 'png', type: 'image/png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: 'jpg', type: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'webp', type: 'image/webp', test: (b) => b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' },
];
const logoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1 } });
const removeLogo = (name) => name && fs.unlink(path.join(logosDir, path.basename(name)), () => {});

router.post(
  '/companies/:id/logo',
  requireAdmin,
  logoUpload.single('logo'),
  wrap(async (req, res) => {
    const company = await db.one('SELECT * FROM companies WHERE id = ?', [Number(req.params.id)]);
    if (!company) throw new HttpError(404, 'Company not found');
    // The type is read from the file itself, never trusted from the name. SVG is refused because it can carry scripts.
    const kind = req.file && LOGO_TYPES.find((t) => t.test(req.file.buffer));
    if (!kind) throw new HttpError(400, 'Upload a PNG, JPG or WebP image');
    const name = `${company.id}-${crypto.randomBytes(6).toString('hex')}.${kind.ext}`;
    await fs.promises.writeFile(path.join(logosDir, name), req.file.buffer);
    await db.query('UPDATE companies SET logo = ? WHERE id = ?', [name, company.id]);
    removeLogo(company.logo);
    res.json({ company: withLogoUrl({ ...company, logo: name }) });
  })
);

router.delete(
  '/companies/:id/logo',
  requireAdmin,
  wrap(async (req, res) => {
    const company = await db.one('SELECT * FROM companies WHERE id = ?', [Number(req.params.id)]);
    if (!company) throw new HttpError(404, 'Company not found');
    await db.query('UPDATE companies SET logo = NULL WHERE id = ?', [company.id]);
    removeLogo(company.logo);
    res.json({ company: withLogoUrl({ ...company, logo: null }) });
  })
);

// Staff see every logo; clients only their own company's.
router.get(
  '/companies/:id/logo',
  wrap(async (req, res) => {
    if (!req.user) throw new HttpError(401, 'Sign in required');
    const id = Number(req.params.id);
    if (!STAFF_ROLES.includes(req.user.role) && req.user.company_id !== id) throw new HttpError(404, 'Not found');
    const company = await db.one('SELECT logo FROM companies WHERE id = ?', [id]);
    if (!company?.logo) throw new HttpError(404, 'No logo');
    const kind = LOGO_TYPES.find((t) => company.logo.endsWith(`.${t.ext}`));
    res.set('Cache-Control', 'private, max-age=604800, immutable');
    res.type(kind?.type || 'application/octet-stream');
    res.sendFile(path.join(logosDir, path.basename(company.logo)));
  })
);

// ---- Users ----

const USER_SELECT = 'SELECT u.*, c.name AS company_name, c.logo AS company_logo FROM users u LEFT JOIN companies c ON c.id = u.company_id';

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
    job_title: clean(b.job_title ?? existing.job_title, 120) || null,
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
    if (f.role === 'admin' && !isOwner(req.user)) throw new HttpError(403, OWNER_ONLY);
    let hash = null;
    if (req.body.password) {
      checkPassword(String(req.body.password), { email, name: req.body.name });
      hash = await hasher.hash(String(req.body.password), 11);
    }
    const r = await db.query(
      `INSERT INTO users (company_id, name, email, password_hash, role, phone, job_title, is_active, notify_email, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [f.company_id, f.name, email, hash, f.role, f.phone, f.job_title, f.is_active, f.notify_email, now()]
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
    // Admin accounts (and promotions to admin) are managed by the owner only.
    if ((existing.role === 'admin' || f.role === 'admin') && !isOwner(req.user)) throw new HttpError(403, OWNER_ONLY);
    if (existing.id === req.user.id && (f.role !== 'admin' || !f.is_active)) {
      throw new HttpError(400, "You can't remove your own admin access");
    }
    await db.query('UPDATE users SET name = ?, role = ?, company_id = ?, phone = ?, job_title = ?, is_active = ?, notify_email = ? WHERE id = ?', [
      f.name,
      f.role,
      f.company_id,
      f.phone,
      f.job_title,
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
    if (user.role === 'admin' && !isOwner(req.user)) throw new HttpError(403, OWNER_ONLY);
    await sendInvite(user);
    res.json({ ok: true });
  })
);

module.exports = router;
