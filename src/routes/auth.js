const router = require('express').Router();
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const config = require('../config');
const db = require('../db');
const notify = require('../notify');
const { checkPassword } = require('../password');
const { setSession, clearSession, requireAuth, publicUser, makeToken, sha256, isStaff } = require('../auth');
const { wrap, now, HttpError, STATUSES, STATUS_LABELS, PRIORITIES, CATEGORIES } = require('../util');

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please wait a few minutes and try again.' },
});


const USER_SELECT =
  'SELECT u.*, c.name AS company_name, c.is_active AS company_active FROM users u LEFT JOIN companies c ON c.id = u.company_id';

router.post(
  '/login',
  limiter,
  wrap(async (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const user = await db.one(`${USER_SELECT} WHERE u.email = ?`, [email]);
    const ok = user && user.password_hash && (await bcrypt.compare(password, user.password_hash));
    if (!ok) throw new HttpError(401, 'Invalid email or password');
    if (!user.is_active || (user.role === 'client' && user.company_active === 0)) {
      throw new HttpError(403, 'This account has been disabled. Please contact support.');
    }
    await db.query('UPDATE users SET last_login_at = ? WHERE id = ?', [now(), user.id]);
    setSession(res, user);
    res.json({ user: publicUser(user) });
  })
);

router.post('/logout', (req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

router.get(
  '/me',
  requireAuth,
  wrap(async (req, res) => {
    res.json({
      user: publicUser(req.user),
      app: {
        name: config.appName,
        company: config.companyName,
        statuses: STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] })),
        priorities: PRIORITIES,
        categories: CATEGORIES,
        upload: config.upload,
        slaMinutes: config.slaMinutes,
        autoCloseDays: config.autoCloseDays,
        replyByEmail: config.inbound.enabled,
      },
    });
  })
);

router.patch(
  '/me',
  requireAuth,
  wrap(async (req, res) => {
    const name = String(req.body.name ?? req.user.name).trim().slice(0, 190);
    if (!name) throw new HttpError(400, 'Name is required');
    const phone = String(req.body.phone ?? req.user.phone ?? '').trim().slice(0, 40) || null;
    const notifyEmail = req.body.notify_email === undefined ? !!req.user.notify_email : !!req.body.notify_email;
    await db.query('UPDATE users SET name = ?, phone = ?, notify_email = ? WHERE id = ?', [name, phone, notifyEmail, req.user.id]);
    res.json({ user: publicUser({ ...req.user, name, phone, notify_email: notifyEmail }) });
  })
);

router.post(
  '/password',
  requireAuth,
  limiter,
  wrap(async (req, res) => {
    const { current, password } = req.body;
    if (!req.user.password_hash || !(await bcrypt.compare(String(current || ''), req.user.password_hash))) {
      throw new HttpError(400, 'Current password is incorrect');
    }
    checkPassword(password, req.user);
    const hash = await bcrypt.hash(password, 11);
    await db.query('UPDATE users SET password_hash = ? WHERE id = ?', [hash, req.user.id]);
    setSession(res, { ...req.user, password_hash: hash });
    notify.passwordChanged(req.user);
    res.json({ ok: true });
  })
);

router.post(
  '/forgot',
  limiter,
  wrap(async (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const user = await db.one('SELECT * FROM users WHERE email = ? AND is_active = 1', [email]);
    if (user) {
      const { token, hash } = makeToken();
      await db.query('UPDATE users SET token_hash = ?, token_expires = ? WHERE id = ?', [
        hash,
        now(new Date(Date.now() + 3600e3)),
        user.id,
      ]);
      notify.passwordReset(user, token);
    }
    // Same response either way so the form can't be used to discover accounts.
    res.json({ ok: true });
  })
);

async function userForToken(token) {
  if (!token || typeof token !== 'string') return null;
  const user = await db.one('SELECT * FROM users WHERE token_hash = ? AND is_active = 1', [sha256(token)]);
  if (!user || !user.token_expires || user.token_expires < now()) return null;
  return user;
}

router.get(
  '/token',
  limiter,
  wrap(async (req, res) => {
    const user = await userForToken(req.query.token);
    if (!user) throw new HttpError(400, 'This link is invalid or has expired. Request a new one below.');
    res.json({ name: user.name, email: user.email, isNew: !user.password_hash });
  })
);

router.post(
  '/reset',
  limiter,
  wrap(async (req, res) => {
    const user = await userForToken(req.body.token);
    if (!user) throw new HttpError(400, 'This link is invalid or has expired. Request a new one below.');
    checkPassword(req.body.password, user);
    const hash = await bcrypt.hash(req.body.password, 11);
    await db.query(
      'UPDATE users SET password_hash = ?, token_hash = NULL, token_expires = NULL, last_login_at = ? WHERE id = ?',
      [hash, now(), user.id]
    );
    setSession(res, { ...user, password_hash: hash });
    if (user.password_hash) notify.passwordChanged(user);
    res.json({ ok: true, staff: isStaff(user) });
  })
);

module.exports = router;
