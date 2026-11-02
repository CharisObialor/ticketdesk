const router = require('express').Router();
const bcrypt = require('bcryptjs');
const hasher = require('../hasher');
const rateLimit = require('express-rate-limit');
const config = require('../config');
const db = require('../db');
const notify = require('../notify');
const { checkPassword } = require('../password');
const { setSession, clearSession, requireAuth, publicUser, makeToken, sha256, isStaff, urlKeyFor } = require('../auth');
const { escapeHtml } = require('../util');
const crypto = require('crypto');
const { wrap, now, parseTs, HttpError, STATUSES, STATUS_LABELS, PRIORITIES, CATEGORIES } = require('../util');

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
  'SELECT u.*, c.name AS company_name, c.is_active AS company_active, c.logo AS company_logo, c.site_contacts AS company_site_contacts FROM users u LEFT JOIN companies c ON c.id = u.company_id';

// The signed-in person and what the portal needs to know about its setup (from /auth/me and sign-in).
function sessionInfo(user, session) {
  return {
    // The key for page addresses (/<key>/...), for this sign-in.
    urlKey: urlKeyFor(session),
    user: publicUser(user),
    app: {
      name: config.appName,
      company: config.companyName,
      statuses: STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] })),
      priorities: PRIORITIES,
      categories: user.role === 'client' ? require('../sla').categoryNames(user.company_id) : CATEGORIES,
      upload: config.upload,
      mailUpload: config.mailUpload,
      workUpload: config.workUpload,
      messageUpload: config.messageUpload,
      // Response and resolution targets, per company where a company has its own.
      sla: require('../sla').forUser(user),
      // Clients of companies that ask for the site's OM and FSE on each new ticket.
      siteContacts: user.role === 'client' && !!Number(user.company_site_contacts),
      autoCloseDays: config.autoCloseDays,
      chat: config.chat,
      replyByEmail: config.inbound.enabled,
      sessionIdleMinutes: config.sessionIdleMinutes,
      // The admin's own Microsoft 365 mailbox for the Mail page and CC/BCC on replies (null when not available).
      mailbox: require('./mail').mailboxFor(user),
      ai: user.role === 'admin' && require('../ai').enabled(),
    },
  };
}

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
    user.last_login_at = now();
    await db.query('UPDATE users SET last_login_at = ? WHERE id = ?', [user.last_login_at, user.id]);
    // The same details as /auth/me, so the portal can open without asking again.
    res.json(sessionInfo(user, setSession(res, user)));
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
// The link carries its own signed token. Opening it only shows a confirmation page, because email security scanners
// open links automatically; the change happens on POST: the page's button, or a mail app's one-click unsubscribe.
function unsubscribeLink(req) {
  const { checkUnsubscribe } = require('../replyto');
  const u = Number(req.query.u);
  const t = String(req.query.t || '');
  if (!checkUnsubscribe(u, t)) throw new HttpError(400, 'This link is not valid.');
  return { u, t };
}
const unsubscribePage = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;background:#f3f4f6;font-family:Inter,'Segoe UI',Roboto,Arial,sans-serif"><div style="max-width:440px;margin:60px auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:32px;text-align:center">
<h1 style="margin:0 0 12px;font-size:22px;color:#111827">${escapeHtml(title)}</h1>${body}</div></body></html>`;

router.post(
  '/unsubscribe',
  wrap(async (req, res) => {
    const { u } = unsubscribeLink(req);
    await db.query('UPDATE users SET notify_email = 0 WHERE id = ?', [u]);
    // Mail apps' one-click unsubscribe expects a plain reply; the confirmation page's button gets a page.
    if (!req.accepts('html')) return res.json({ ok: true });
    res.type('html').send(
      unsubscribePage(
        'You are unsubscribed',
        `<p style="margin:0 0 20px;font-size:15px;line-height:24px;color:#374151">You will no longer receive notification emails from ${escapeHtml(config.appName)}. Account and security emails are still sent.</p>
<p style="margin:0;font-size:14px;color:#6b7280">Changed your mind? Turn notifications back on from your profile in the <a href="${escapeHtml(config.appUrl)}/profile" style="color:#336cb5">support portal</a>.</p>`
      )
    );
  })
);
router.get(
  '/unsubscribe',
  wrap(async (req, res) => {
    const { u, t } = unsubscribeLink(req);
    const action = `/api/auth/unsubscribe?u=${encodeURIComponent(u)}&t=${encodeURIComponent(t)}`;
    res.type('html').send(
      unsubscribePage(
        'Stop notification emails?',
        `<p style="margin:0 0 20px;font-size:15px;line-height:24px;color:#374151">You will stop receiving notification emails from ${escapeHtml(config.appName)}. Account and security emails are still sent.</p>
<form method="post" action="${escapeHtml(action)}" style="margin:0"><button type="submit" style="background:#336cb5;color:#fff;border:0;border-radius:8px;padding:10px 20px;font-size:15px;cursor:pointer">Unsubscribe</button></form>`
      )
    );
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
    res.json(sessionInfo(req.user, req.session));
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
    // Which notifications they want, by email and in the bell: { category: { email, inapp } }.
    const CATEGORIES_ALLOWED = ['created', 'replies', 'status', 'visits', 'chats', 'assignments', 'escalations', 'ratings', 'signoffs'];
    let notifyPrefs = req.user.notify_prefs || null;
    if (req.body.notify_prefs && typeof req.body.notify_prefs === 'object') {
      const out = {};
      for (const c of CATEGORIES_ALLOWED) {
        const v = req.body.notify_prefs[c];
        if (v && typeof v === 'object') out[c] = { email: v.email !== false, inapp: v.inapp !== false };
      }
      notifyPrefs = JSON.stringify(out);
    }
    // Admins choose how often they hear about SLA deadlines.
    const slaReminders =
      req.user.role === 'admin' && req.body.sla_reminders !== undefined
        ? JSON.stringify(require('../sla').reminderPrefs(req.body.sla_reminders))
        : req.user.sla_reminders || null;
    await db.query('UPDATE users SET name = ?, phone = ?, job_title = ?, notify_email = ?, signature = ?, sla_reminders = ?, notify_prefs = ? WHERE id = ?', [
      name,
      phone,
      jobTitle,
      notifyEmail,
      signature,
      slaReminders,
      notifyPrefs,
      req.user.id,
    ]);
    res.json({ user: publicUser({ ...req.user, name, phone, job_title: jobTitle, notify_email: notifyEmail, signature, sla_reminders: slaReminders, notify_prefs: notifyPrefs }) });
  })
);

// One-time code for changing the password: 6 digits, emailed, valid for 10 minutes and 5 tries, one per minute.
const OTP_MINUTES = 10;
const OTP_TRIES = 5;
router.post(
  '/password/code',
  requireAuth,
  limiter,
  wrap(async (req, res) => {
    const u = await db.one('SELECT otp_sent_at FROM users WHERE id = ?', [req.user.id]);
    if (u && u.otp_sent_at && Date.now() - parseTs(u.otp_sent_at).getTime() < 60e3) {
      throw new HttpError(429, 'A code was sent less than a minute ago. Check your email, or try again shortly.');
    }
    const code = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
    await db.query('UPDATE users SET otp_hash = ?, otp_expires = ?, otp_attempts = 0, otp_sent_at = ? WHERE id = ?', [
      sha256(code),
      now(new Date(Date.now() + OTP_MINUTES * 60e3)),
      now(),
      req.user.id,
    ]);
    notify.passwordCode(req.user, code, OTP_MINUTES);
    res.json({ ok: true, minutes: OTP_MINUTES, email: req.user.email });
  })
);

router.post(
  '/password',
  requireAuth,
  limiter,
  wrap(async (req, res) => {
    // Confirmed with the one-time code emailed to the account (see /password/code), not the old password.
    const { code, password } = req.body;
    const u = await db.one('SELECT otp_hash, otp_expires, otp_attempts FROM users WHERE id = ?', [req.user.id]);
    if (!u || !u.otp_hash || !u.otp_expires || parseTs(u.otp_expires).getTime() < Date.now()) {
      throw new HttpError(400, 'The code has expired. Request a new one.');
    }
    if (Number(u.otp_attempts) >= OTP_TRIES) throw new HttpError(400, 'Too many wrong codes. Request a new one.');
    const sent = Buffer.from(sha256(String(code || '').replace(/\s+/g, '')));
    const expected = Buffer.from(u.otp_hash);
    if (sent.length !== expected.length || !crypto.timingSafeEqual(sent, expected)) {
      await db.query('UPDATE users SET otp_attempts = otp_attempts + 1 WHERE id = ?', [req.user.id]);
      throw new HttpError(400, 'That code is not right. Check the email and try again.');
    }
    checkPassword(password, req.user);
    const hash = await hasher.hash(password, 11);
    await db.query('UPDATE users SET password_hash = ?, otp_hash = NULL, otp_expires = NULL, otp_attempts = 0 WHERE id = ?', [hash, req.user.id]);
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
