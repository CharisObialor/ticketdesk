const router = require('express').Router();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const config = require('../config');
const hasher = require('../hasher');
const db = require('../db');
const notify = require('../notify');
const sla = require('../sla');
const { checkPassword } = require('../password');
const { requireAuth, requireStaff, requireAdmin, publicUser, makeToken, isOwner, ROLES, STAFF_ROLES } = require('../auth');

const OWNER_ONLY = 'Only the account owner can create or change admin accounts.';
const { wrap, now, HttpError, OPEN_STATUSES } = require('../util');

const clean = (v, max) => String(v ?? '').trim().slice(0, max);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.get(
  '/staff',
  requireStaff,
  wrap(async (req, res) => {
    const rows = await db.query(`SELECT id, name, email, role, phone FROM users WHERE role IN (${db.inList(STAFF_ROLES)}) AND is_active = 1 ORDER BY name`, STAFF_ROLES);
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
    res.json({
      companies: rows.map(({ sla: _own, statement_recipients: recipients, ...c }) => ({
        ...withLogoUrl(c),
        sla: sla.own(c.id),
        statement_recipients: require('../statement').parseIds(recipients),
        contacts: byCompany.get(c.id) || [],
      })),
    });
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
    site_contacts: b.site_contacts === undefined ? Number(existing.site_contacts) || 0 : b.site_contacts ? 1 : 0,
    is_active: b.is_active === undefined ? existing.is_active ?? 1 : !!b.is_active,
  };
}

router.post(
  '/companies',
  requireAdmin,
  wrap(async (req, res) => {
    const f = companyFields(req.body);
    const r = await db.query('INSERT INTO companies (name, email_domain, notes, rc_number, site_contacts, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
      f.name,
      f.email_domain,
      f.notes,
      f.rc_number,
      f.site_contacts,
      f.is_active,
      now(),
    ]);
    const own = req.body.sla !== undefined ? await sla.setCompany(r.insertId, req.body.sla) : null;
    res.status(201).json({ company: { id: r.insertId, ...f, sla: own } });
  })
);

router.patch(
  '/companies/:id',
  requireAdmin,
  wrap(async (req, res) => {
    const existing = await db.one('SELECT * FROM companies WHERE id = ?', [Number(req.params.id)]);
    if (!existing) throw new HttpError(404, 'Company not found');
    const f = companyFields(req.body, existing);
    await db.query('UPDATE companies SET name = ?, email_domain = ?, notes = ?, rc_number = ?, site_contacts = ?, is_active = ? WHERE id = ?', [
      f.name,
      f.email_domain,
      f.notes,
      f.rc_number,
      f.site_contacts,
      f.is_active,
      existing.id,
    ]);
    const own = req.body.sla !== undefined ? await sla.setCompany(existing.id, req.body.sla) : sla.own(existing.id);
    const statement = require('../statement');
    let recipients = statement.parseIds(existing.statement_recipients);
    if (req.body.statement_recipients !== undefined) {
      recipients = await statement.cleanRecipients(existing.id, req.body.statement_recipients);
      await db.query('UPDATE companies SET statement_recipients = ? WHERE id = ?', [JSON.stringify(recipients), existing.id]);
    }
    res.json({ company: withLogoUrl({ ...existing, ...f, sla: own, statement_recipients: recipients }) });
  })
);

// ---- Company sites ----
// Each client company's sites (for example towers or substations): a site ID, where it is, and any details.

function siteFields(b, existing = {}) {
  // Spaces around slashes are typing slips (PAT/OYO/ 111 is PAT/OYO/111).
  const code = clean(b.code ?? existing.code, 60).replace(/\s+/g, ' ').replace(/\s*\/\s*/g, '/');
  if (!code) throw new HttpError(400, 'Site ID is required');
  return {
    code,
    location: clean(b.location ?? existing.location, 255).replace(/\s+/g, ' ') || null,
    details: clean(b.details ?? existing.details, 2000) || null,
    is_active: b.is_active === undefined ? existing.is_active ?? 1 : b.is_active ? 1 : 0,
  };
}

const siteCodeTaken = (companyId, code, exceptId = 0) =>
  db.one('SELECT id FROM sites WHERE company_id = ? AND LOWER(code) = ? AND id <> ?', [companyId, code.toLowerCase(), exceptId]);

const MAX_SITES_PER_ADD = 2000;

// Staff see any company's sites; a client sees only their own company's active sites (for the new ticket form).
router.get(
  '/sites',
  requireAuth,
  wrap(async (req, res) => {
    const staffUser = STAFF_ROLES.includes(req.user.role);
    const companyId = staffUser ? Number(req.query.company_id) : req.user.company_id;
    if (!companyId) return res.json({ sites: [] });
    const all = staffUser && req.query.all === '1';
    const rows = await db.query(
      `SELECT s.id, s.company_id, s.code, s.location, s.details, s.is_active FROM sites s
       WHERE s.company_id = ?${all ? '' : ' AND s.is_active = 1'} ORDER BY s.code`,
      [companyId]
    );
    // How many tickets use each site (shown to admins when removing one), counted in one pass.
    const counts = new Map();
    if (all) {
      const used = await db.query('SELECT site_id, COUNT(*) AS n FROM tickets WHERE site_id IN (SELECT id FROM sites WHERE company_id = ?) GROUP BY site_id', [companyId]);
      for (const u of used) counts.set(Number(u.site_id), Number(u.n));
    }
    res.json({ sites: rows.map((s) => ({ ...s, is_active: !!Number(s.is_active), ticket_count: counts.get(Number(s.id)) || 0 })) });
  })
);

// Adds one site, or many at once ({ sites: [...] }, for example pasted from a spreadsheet).
router.post(
  '/companies/:id/sites',
  requireAdmin,
  wrap(async (req, res) => {
    const company = await db.one('SELECT id FROM companies WHERE id = ?', [Number(req.params.id)]);
    if (!company) throw new HttpError(404, 'Company not found');
    const list = Array.isArray(req.body.sites) ? req.body.sites : [req.body];
    if (!list.length) throw new HttpError(400, 'Add at least one site');
    if (list.length > MAX_SITES_PER_ADD) throw new HttpError(400, `Add at most ${MAX_SITES_PER_ADD} sites at a time`);
    const ts = now();
    let added = 0;
    const skipped = [];
    for (const item of list) {
      const f = siteFields(item || {});
      if (await siteCodeTaken(company.id, f.code)) {
        if (list.length === 1) throw new HttpError(409, `Site ID ${f.code} is already on the list`);
        skipped.push(f.code);
        continue;
      }
      await db.query('INSERT INTO sites (company_id, code, location, details, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
        company.id,
        f.code,
        f.location,
        f.details,
        f.is_active,
        ts,
        ts,
      ]);
      added++;
    }
    res.status(201).json({ added, skipped });
  })
);

router.patch(
  '/sites/:id',
  requireAdmin,
  wrap(async (req, res) => {
    const existing = await db.one('SELECT * FROM sites WHERE id = ?', [Number(req.params.id)]);
    if (!existing) throw new HttpError(404, 'Site not found');
    const f = siteFields(req.body, existing);
    if (await siteCodeTaken(existing.company_id, f.code, existing.id)) throw new HttpError(409, `Site ID ${f.code} is already on the list`);
    await db.query('UPDATE sites SET code = ?, location = ?, details = ?, is_active = ?, updated_at = ? WHERE id = ?', [
      f.code,
      f.location,
      f.details,
      f.is_active,
      now(),
      existing.id,
    ]);
    res.json({ site: { ...existing, ...f, is_active: !!f.is_active } });
  })
);

// Sites that tickets refer to are kept (marked inactive) so those tickets still show the site.
router.delete(
  '/sites/:id',
  requireAdmin,
  wrap(async (req, res) => {
    const existing = await db.one('SELECT id FROM sites WHERE id = ?', [Number(req.params.id)]);
    if (!existing) throw new HttpError(404, 'Site not found');
    const used = await db.one('SELECT id FROM tickets WHERE site_id = ? LIMIT 1', [existing.id]);
    if (used) await db.query('UPDATE sites SET is_active = 0, updated_at = ? WHERE id = ?', [now(), existing.id]);
    else await db.query('DELETE FROM sites WHERE id = ?', [existing.id]);
    res.json({ ok: true, archived: !!used });
  })
);

// ---- Technicians ----
// Field technicians' names and numbers for job messages. They are a contact list, not portal accounts.

const cleanPhone = (v) => clean(v, 40).replace(/[^\d+ ()-]/g, '').trim();

function technicianFields(b, existing = {}) {
  const name = clean(b.name ?? existing.name, 120).replace(/\s+/g, ' ');
  if (!name) throw new HttpError(400, 'Name is required');
  const phone = b.phone !== undefined ? cleanPhone(b.phone) : existing.phone || '';
  if (phone && phone.replace(/\D/g, '').length < 7) throw new HttpError(400, `Enter a valid phone number for ${name}`);
  return {
    name,
    phone: phone || null,
    area: clean(b.area ?? existing.area, 190).replace(/\s+/g, ' ') || null,
    notes: clean(b.notes ?? existing.notes, 2000) || null,
    is_active: b.is_active === undefined ? existing.is_active ?? 1 : b.is_active ? 1 : 0,
  };
}

const MAX_TECHNICIANS_PER_ADD = 1000;

router.get(
  '/technicians',
  requireStaff,
  wrap(async (req, res) => {
    const rows = await db.query('SELECT id, name, phone, area, notes, is_active FROM technicians ORDER BY is_active DESC, name');
    res.json({ technicians: rows.map((t) => ({ ...t, is_active: !!Number(t.is_active) })) });
  })
);

// Adds one technician, or many at once ({ technicians: [...] }, for example pasted from a spreadsheet).
router.post(
  '/technicians',
  requireAdmin,
  wrap(async (req, res) => {
    const list = Array.isArray(req.body.technicians) ? req.body.technicians : [req.body];
    if (!list.length) throw new HttpError(400, 'Add at least one technician');
    if (list.length > MAX_TECHNICIANS_PER_ADD) throw new HttpError(400, `Add at most ${MAX_TECHNICIANS_PER_ADD} at a time`);
    const rows = list.map((item) => technicianFields(item || {}));
    const ts = now();
    let added = 0;
    const skipped = [];
    for (const f of rows) {
      // The same name and number already on the list is a duplicate.
      const same = await db.one('SELECT id FROM technicians WHERE LOWER(name) = ? AND COALESCE(phone, \'\') = ?', [f.name.toLowerCase(), f.phone || '']);
      if (same) {
        if (rows.length === 1) throw new HttpError(409, `${f.name} is already on the list`);
        skipped.push(f.name);
        continue;
      }
      await db.query('INSERT INTO technicians (name, phone, area, notes, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
        f.name,
        f.phone,
        f.area,
        f.notes,
        f.is_active,
        ts,
        ts,
      ]);
      added++;
    }
    res.status(201).json({ added, skipped });
  })
);

router.patch(
  '/technicians/:id',
  requireAdmin,
  wrap(async (req, res) => {
    const existing = await db.one('SELECT * FROM technicians WHERE id = ?', [Number(req.params.id)]);
    if (!existing) throw new HttpError(404, 'Technician not found');
    const f = technicianFields(req.body, existing);
    await db.query('UPDATE technicians SET name = ?, phone = ?, area = ?, notes = ?, is_active = ?, updated_at = ? WHERE id = ?', [
      f.name,
      f.phone,
      f.area,
      f.notes,
      f.is_active,
      now(),
      existing.id,
    ]);
    res.json({ technician: { id: existing.id, ...f, is_active: !!f.is_active } });
  })
);

router.delete(
  '/technicians/:id',
  requireAdmin,
  wrap(async (req, res) => {
    const r = await db.query('DELETE FROM technicians WHERE id = ?', [Number(req.params.id)]);
    if (!r.affectedRows) throw new HttpError(404, 'Technician not found');
    res.json({ ok: true });
  })
);

// Sends last month's statement to the company's chosen contacts now (it also goes automatically on the 1st).
router.post(
  '/companies/:id/statement',
  requireAdmin,
  wrap(async (req, res) => {
    const company = await db.one('SELECT * FROM companies WHERE id = ?', [Number(req.params.id)]);
    if (!company) throw new HttpError(404, 'Company not found');
    const sent = await require('../statement').sendFor(company);
    if (!sent) throw new HttpError(400, 'Choose who receives the statement first');
    res.json({ sent });
  })
);

// ---- SLA targets ----

// The default response and resolution times for each priority; companies without their own targets use these.
router.get(
  '/sla',
  requireStaff,
  wrap(async (req, res) => {
    res.json({ defaults: sla.forCompany(null), builtIn: sla.BUILT_IN });
  })
);

router.put(
  '/sla',
  requireAdmin,
  wrap(async (req, res) => {
    res.json({ defaults: await sla.setDefaults(req.body) });
  })
);

// ---- Escalation rules ----

router.get(
  '/escalation',
  requireStaff,
  wrap(async (req, res) => {
    const escalation = require('../escalation');
    res.json({ rules: escalation.rules(), defaults: escalation.DEFAULT_RULES });
  })
);

router.put(
  '/escalation',
  requireAdmin,
  wrap(async (req, res) => {
    res.json({ rules: await require('../escalation').save(req.body.rules) });
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
    if (existing.role !== 'client' && f.role === 'client') await require('../inapp').clearStaffOnly(existing.id);
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

// ---- Permanent deletion (the account owner only) ----

const OWNER_DELETE = 'Only the account owner can permanently delete.';
function requireOwner(req, res, next) {
  next(req.user && isOwner(req.user) ? undefined : new HttpError(403, OWNER_DELETE));
}
const deletion = (what, id, by) => console.log(`[delete] ${what} ${id} permanently deleted by ${by.email}`);

router.delete(
  '/tickets/:id',
  requireOwner,
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const done = await require('../purge').deleteTicket(id);
    if (!done) throw new HttpError(404, 'Ticket not found');
    deletion('ticket', `#${id}`, req.user);
    res.json({ ok: true });
  })
);

router.delete(
  '/users/:id',
  requireOwner,
  wrap(async (req, res) => {
    const user = await db.one('SELECT id, email FROM users WHERE id = ?', [Number(req.params.id)]);
    if (!user) throw new HttpError(404, 'User not found');
    if (user.id === req.user.id) throw new HttpError(400, 'You cannot delete your own account');
    await require('../purge').deleteUser(user.id);
    deletion('user', user.email, req.user);
    res.json({ ok: true });
  })
);

router.get(
  '/companies/:id/usage',
  requireOwner,
  wrap(async (req, res) => {
    const company = await db.one('SELECT id FROM companies WHERE id = ?', [Number(req.params.id)]);
    if (!company) throw new HttpError(404, 'Company not found');
    res.json({ usage: await require('../purge').companyUsage(company.id) });
  })
);

router.delete(
  '/companies/:id',
  requireOwner,
  wrap(async (req, res) => {
    const done = await require('../purge').deleteCompany(Number(req.params.id));
    if (!done) throw new HttpError(404, 'Company not found');
    deletion('company', `${done.name} (${done.tickets} tickets, ${done.users} users)`, req.user);
    res.json({ ok: true, ...done });
  })
);

// Clears every ticket on the platform (with its conversations, files, visits, ratings and to-dos) after taking a
// backup. The person types the confirmation phrase; without a good backup nothing is deleted.
const CLEAR_PHRASE = 'CLEAR ALL TICKETS';
router.post(
  '/system/clear-tickets',
  requireOwner,
  wrap(async (req, res) => {
    if (String(req.body.confirm || '').trim() !== CLEAR_PHRASE) throw new HttpError(400, `Type ${CLEAR_PHRASE} to confirm`);
    const saved = await require('../backup').run('before clearing all tickets');
    if (!saved.ok) throw new HttpError(500, `Nothing was deleted: the backup failed (${saved.error})`);
    const done = await require('../purge').clearAllTickets();
    deletion('all tickets', `(${done.tickets} tickets, ${done.files} files; backup ${saved.name})`, req.user);
    res.json({ ok: true, ...done, backup: saved.name });
  })
);

module.exports = router;
