const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('./config');
const db = require('./db');
const { HttpError, wrap } = require('./util');

const COOKIE = 'td_session';
// CSRF token (double-submit): a cookie the portal's own pages can read and send back in the X-CSRF-Token header.
// It is an HMAC of the sign-in (user, sign-in time, password version), so other sites can neither read nor forge it,
// it stays the same while the session cookie is renewed, and it changes with every new sign-in.
const CSRF_COOKIE = 'td_csrf';
const CSRF_HEADER = 'x-csrf-token';
// Technicians have the same access as agents; the separate role lets admins tell them apart.
const STAFF_ROLES = ['admin', 'agent', 'technician'];
const ROLES = [...STAFF_ROLES, 'client'];

const isStaff = (u) => !!u && STAFF_ROLES.includes(u.role);
// Preset cartoon avatars people can choose from (images in client/public/avatars).
const AVATARS = [...Array.from({ length: 30 }, (_, i) => `m${i + 1}`), ...Array.from({ length: 30 }, (_, i) => `f${i + 1}`)];
const avatarPath = (key) => (AVATARS.includes(key) ? `/avatars/${key}.png` : null);
const isOwner = (u) => !!u && u.role === 'admin' && String(u.email).toLowerCase() === config.ownerEmail;
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
// Fingerprint of the password hash: changing the password invalidates existing sessions.
const passwordVersion = (u) => sha256(u.password_hash || '').slice(0, 12);

// Built once: passing the plain secret makes the JWT library rebuild this key on every request.
const SIGNING_KEY = crypto.createSecretKey(Buffer.from(config.jwtSecret));

const nowSec = () => Math.floor(Date.now() / 1000);

// The key in every page address (/<key>/dashboard): unique to the sign-in, unguessable without the server secret.
const urlKeyFor = (payload) => crypto.createHmac('sha256', config.jwtSecret).update(`url:${payload.uid}.${payload.iat0}`).digest('hex').slice(0, 32);

const csrfFor = (payload) => crypto.createHmac('sha256', config.jwtSecret).update(`csrf:${payload.uid}.${payload.iat0}.${payload.pv}`).digest('base64url');
const cookieOptions = () => ({ sameSite: 'lax', secure: config.appUrl.startsWith('https://'), path: '/', domain: config.cookieDomain });
function setCsrfCookie(res, payload) {
  res.cookie(CSRF_COOKIE, csrfFor(payload), { ...cookieOptions(), httpOnly: false, maxAge: config.sessionDays * 864e5 });
}
const IDLE_MESSAGE = 'You were signed out after a period of inactivity. Please sign in again.';

// The token records when the person was last active (`act`). It is refreshed by /auth/heartbeat, which the
// browser only calls on real activity (typing, clicking, scrolling), so background polling never keeps an
// unattended session alive. Sessions also end after SESSION_DAYS regardless.
function setSession(res, user, { createdAt } = {}) {
  const claims = { uid: user.id, pv: passwordVersion(user), act: nowSec(), iat0: createdAt || nowSec() };
  const token = jwt.sign(claims, SIGNING_KEY, {
    expiresIn: `${config.sessionDays}d`,
  });
  setCsrfCookie(res, claims);
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.appUrl.startsWith('https://'),
    maxAge: config.sessionDays * 864e5,
    path: '/',
    domain: config.cookieDomain,
  });
}

function clearSession(res) {
  res.clearCookie(COOKIE, { path: '/', domain: config.cookieDomain });
  res.clearCookie(CSRF_COOKIE, { path: '/', domain: config.cookieDomain });
}

// Returns the token payload, { idle: true } when it ran out through inactivity, or null when invalid.
function readToken(token) {
  if (!token) return null;
  let payload;
  try {
    payload = jwt.verify(token, SIGNING_KEY, { algorithms: ['HS256'] });
  } catch {
    return null;
  }
  if (config.sessionIdleMinutes > 0 && payload.act && nowSec() - payload.act > config.sessionIdleMinutes * 60) return { idle: true };
  return payload;
}

async function userFromToken(token) {
  const payload = readToken(token);
  if (!payload || payload.idle) return null;
  const user = await db.one(
    `SELECT u.*, c.name AS company_name, c.is_active AS company_active, c.logo AS company_logo, c.site_contacts AS company_site_contacts
     FROM users u LEFT JOIN companies c ON c.id = u.company_id WHERE u.id = ?`,
    [payload.uid]
  );
  if (!user || !user.is_active || passwordVersion(user) !== payload.pv) return null;
  if (user.role === 'client' && Number(user.company_active) === 0) return null;
  return user;
}

const authenticate = wrap(async (req, res, next) => {
  const payload = readToken(req.cookies[COOKIE]);
  if (payload && payload.idle) {
    req.sessionIdle = true;
    clearSession(res);
  }
  req.session = payload && !payload.idle ? payload : null;
  req.user = req.session ? await userFromToken(req.cookies[COOKIE]) : null;
  // Sessions from before CSRF tokens (or a cleared cookie) get their token on the next request.
  if (req.user && req.cookies[CSRF_COOKIE] !== csrfFor(req.session)) setCsrfCookie(res, req.session);
  next();
});

// Sign-in, password reset and unsubscribe links work without a session, so they carry no token. The Origin check
// in routes/index.js still guards them.
const CSRF_EXEMPT = /^\/auth\/(login|forgot|reset|unsubscribe)(\/|$)/;
const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

// Every change made with a signed-in session must carry the matching X-CSRF-Token header.
function csrfCheck(req, res, next) {
  if (SAFE.has(req.method) || !req.session || CSRF_EXEMPT.test(req.path)) return next();
  const sent = Buffer.from(String(req.get(CSRF_HEADER) || ''));
  const expected = Buffer.from(csrfFor(req.session));
  if (sent.length === expected.length && crypto.timingSafeEqual(sent, expected)) return next();
  next(new HttpError(403, 'Security check failed. Please refresh the page and try again.'));
}

const signInError = (req) => new HttpError(401, req.sessionIdle ? IDLE_MESSAGE : 'Please sign in');

function requireAuth(req, res, next) {
  next(req.user ? undefined : signInError(req));
}
function requireStaff(req, res, next) {
  next(!req.user ? signInError(req) : isStaff(req.user) ? undefined : new HttpError(403, 'Staff only'));
}
function requireAdmin(req, res, next) {
  next(!req.user ? signInError(req) : req.user.role === 'admin' ? undefined : new HttpError(403, 'Admins only'));
}

function canAccessTicket(user, ticket) {
  return !!ticket && (isStaff(user) || Number(ticket.company_id) === Number(user.company_id));
}

function publicUser(u) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    phone: u.phone,
    company_id: u.company_id,
    company_name: u.company_name || null,
    company_logo_url: u.company_logo ? `/api/companies/${u.company_id}/logo?v=${u.company_logo}` : null,
    job_title: u.job_title || null,
    notify_email: !!u.notify_email,
    notify_prefs: (() => {
      try {
        return u.notify_prefs ? JSON.parse(u.notify_prefs) : {};
      } catch {
        return {};
      }
    })(),
    signature: u.signature || null,
    sla_reminders: u.role === 'admin' ? require('./sla').reminderPrefs(u.sla_reminders) : undefined,
    avatar: AVATARS.includes(u.avatar) ? u.avatar : null,
    avatar_url: avatarPath(u.avatar),
    is_owner: isOwner(u),
    tour_done: !!u.tour_done_at,
    is_active: !!u.is_active,
    has_password: !!u.password_hash,
    last_login_at: u.last_login_at,
    last_seen_at: u.last_seen_at,
    created_at: u.created_at,
  };
}

// One-time token for invites and password resets; only the hash is stored.
function makeToken() {
  const token = crypto.randomBytes(32).toString('hex');
  return { token, hash: sha256(token) };
}

module.exports = {
  AVATARS,
  avatarPath,
  isOwner,
  passwordVersion,
  COOKIE,
  ROLES,
  STAFF_ROLES,
  isStaff,
  sha256,
  setSession,
  csrfCheck,
  urlKeyFor,
  clearSession,
  userFromToken,
  authenticate,
  requireAuth,
  requireStaff,
  requireAdmin,
  canAccessTicket,
  publicUser,
  makeToken,
};
