const router = require('express').Router();
const bcrypt = require('bcryptjs');
const hasher = require('../hasher');
const rateLimit = require('express-rate-limit');
const config = require('../config');
const db = require('../db');
const notify = require('../notify');
const { checkPassword } = require('../password');
const { setSession, clearSession, requireAuth, publicUser, makeToken, sha256, isStaff } = require('../auth');
const { escapeHtml } = require('../util');
const { wrap, now, HttpError, STATUSES, STATUS_LABELS, PRIORITIES, CATEGORIES } = require('../util');

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please wait a few minutes and try again.' },
});


// Hash of a random value, compared against when the email is unknown.
const DUMMY_HASH = bcrypt.hashSync(require('crypto').randomBytes(16).toString('hex'), 11);

const USER_SELECT =
  'SELECT u.*, c.name AS company_name, c.is_active AS company_active, c.logo AS company_logo FROM users u LEFT JOIN companies c ON c.id = u.company_id';

router.post(
  '/login',
  limiter,
  wrap(async (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const user = await db.one(`${USER_SELECT} WHERE u.email = ?`, [email]);
    // Always run bcrypt so response time does not reveal whether the email has an account.
    const ok = await hasher.compare(password, (user && user.password_hash) || DUMMY_HASH);
    if (!user || !user.password_hash) throw new HttpError(401, 'Invalid email or password');
    if (!ok) throw new HttpError(401, 'Invalid email or password');
    if (!user.is_active || (user.role === 'client' && user.company_active === 0)) {
      throw new HttpError(403, 'This account has been disabled. Please contact support.');
    }
    await db.query('UPDATE users SET last_login_at = ? WHERE id = ?', [now(), user.id]);
    setSession(res, user);
    res.json({ user: publicUser(user) });
  })
);

// Called by the browser (at most once a minute) while the person is actually using the portal,
// to move the inactivity timer forward. Keeps the original sign-in time for the absolute limit.
router.post(
  '/heartbeat',
  requireAuth,
  wrap(async (req, res) => {
    setSession(res, req.user, { createdAt: req.session.iat0 });
    res.json({ ok: true, idleMinutes: config.sessionIdleMinutes });
  })
);

// Choose one of the preset avatars, or clear it to show initials.
router.put(
  '/avatar',
  requireAuth,
  wrap(async (req, res) => {
    const { AVATARS } = require('../auth');
    const key = req.body.avatar === null || req.body.avatar === '' ? null : String(req.body.avatar);
    if (key !== null && !AVATARS.includes(key)) throw new HttpError(400, 'Choose one of the avatars');
    await db.query('UPDATE users SET avatar = ? WHERE id = ?', [key, req.user.id]);
    res.json({ user: publicUser({ ...req.user, avatar: key }) });
  })
);

// Marks the first-login tour as finished (or skipped) so it does not open again on its own.
router.post(
  '/tour',
  requireAuth,
  wrap(async (req, res) => {
    const at = now();
    await db.query('UPDATE users SET tour_done_at = ? WHERE id = ?', [at, req.user.id]);
    res.json({ user: publicUser({ ...req.user, tour_done_at: at }) });
  })
);

// Everyone's chosen avatar, for showing next to names across the portal.
router.get(
  '/avatars',
  requireAuth,
  wrap(async (req, res) => {
    const { avatarPath } = require('../auth');
    const rows = await db.query('SELECT id, avatar FROM users WHERE avatar IS NOT NULL AND is_active = 1');
    res.json({ avatars: Object.fromEntries(rows.filter((r) => avatarPath(r.avatar)).map((r) => [r.id, avatarPath(r.avatar)])) });
  })
);

// One-click unsubscribe from notification emails (link in every notification and the List-Unsubscribe header).
// POST is what mail providers send for one-click; GET shows a confirmation for people who click the link.
async function unsubscribe(req) {
  const { checkUnsubscribe } = require('../replyto');
  const u = Number(req.query.u);
  if (!checkUnsubscribe(u, String(req.query.t || ''))) throw new HttpError(400, 'This link is not valid.');
  await db.query('UPDATE users SET notify_email = 0 WHERE id = ?', [u]);
}
router.post(
  '/unsubscribe',
  wrap(async (req, res) => {
    await unsubscribe(req);
    res.json({ ok: true });
  })
);
router.get(
  '/unsubscribe',
  wrap(async (req, res) => {
    await unsubscribe(req);
    res.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribed</title></head>
<body style="margin:0;background:#f3f4f6;font-family:Inter,'Segoe UI',Roboto,Arial,sans-serif"><div style="max-width:440px;margin:60px auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:32px;text-align:center">
<h1 style="margin:0 0 12px;font-size:22px;color:#111827">You are unsubscribed</h1>
<p style="margin:0 0 20px;font-size:15px;line-height:24px;color:#374151">You will no longer receive notification emails from ${escapeHtml(config.appName)}. Account and security emails are still sent.</p>
<p style="margin:0;font-size:14px;color:#6b7280">Changed your mind? Turn notifications back on from your profile in the <a href="${escapeHtml(config.appUrl)}/profile" style="color:#336cb5">support portal</a>.</p>
</div></body></html>`);
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
        mailUpload: config.mailUpload,
        slaMinutes: config.slaMinutes,
        autoCloseDays: config.autoCloseDays,
        replyByEmail: config.inbound.enabled,
        sessionIdleMinutes: config.sessionIdleMinutes,
        // The admin's own Microsoft 365 mailbox for the Mail page and CC/BCC on replies (null when not available).
        mailbox: require('./mail').mailboxFor(req.user),
        ai: req.user.role === 'admin' && require('../ai').enabled(),
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
    const jobTitle = String(req.body.job_title ?? req.user.job_title ?? '').trim().slice(0, 120) || null;
    const notifyEmail = req.body.notify_email === undefined ? !!req.user.notify_email : !!req.body.notify_email;
    // Email signature (admins send from their own mailbox). Empty means "use the default".
    const signature =
      req.user.role === 'admin' && req.body.signature !== undefined
        ? String(req.body.signature || '').replace(/\r\n/g, '\n').trim().slice(0, 1000) || null
        : req.user.signature || null;
    await db.query('UPDATE users SET name = ?, phone = ?, job_title = ?, notify_email = ?, signature = ? WHERE id = ?', [name, phone, jobTitle, notifyEmail, signature, req.user.id]);
    res.json({ user: publicUser({ ...req.user, name, phone, job_title: jobTitle, notify_email: notifyEmail, signature }) });
  })
);

router.post(
  '/password',
  requireAuth,
  limiter,
  wrap(async (req, res) => {
    const { current, password } = req.body;
    if (!req.user.password_hash || !(await hasher.compare(String(current || ''), req.user.password_hash))) {
      throw new HttpError(400, 'Current password is incorrect');
    }
    checkPassword(password, req.user);
    const hash = await hasher.hash(password, 11);
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
    const hash = await hasher.hash(req.body.password, 11);
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
