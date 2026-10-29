const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('./config');
const db = require('./db');
const { HttpError, wrap } = require('./util');

const COOKIE = 'td_session';
// Technicians have the same access as agents; the separate role lets admins tell them apart.
const STAFF_ROLES = ['admin', 'agent', 'technician'];
const ROLES = [...STAFF_ROLES, 'client'];

const isStaff = (u) => !!u && STAFF_ROLES.includes(u.role);
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
// Fingerprint of the password hash: changing the password invalidates existing sessions.
const passwordVersion = (u) => sha256(u.password_hash || '').slice(0, 12);

function setSession(res, user) {
  const token = jwt.sign({ uid: user.id, pv: passwordVersion(user) }, config.jwtSecret, {
    expiresIn: `${config.sessionDays}d`,
  });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.appUrl.startsWith('https://'),
    maxAge: config.sessionDays * 864e5,
    path: '/',
  });
}

function clearSession(res) {
  res.clearCookie(COOKIE, { path: '/' });
}

async function userFromToken(token) {
  if (!token) return null;
  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret);
  } catch {
    return null;
  }
  const user = await db.one(
    `SELECT u.*, c.name AS company_name, c.is_active AS company_active
     FROM users u LEFT JOIN companies c ON c.id = u.company_id WHERE u.id = ?`,
    [payload.uid]
  );
  if (!user || !user.is_active || passwordVersion(user) !== payload.pv) return null;
  if (user.role === 'client' && Number(user.company_active) === 0) return null;
  return user;
}

const authenticate = wrap(async (req, res, next) => {
  req.user = await userFromToken(req.cookies[COOKIE]);
  next();
});

function requireAuth(req, res, next) {
  next(req.user ? undefined : new HttpError(401, 'Please sign in'));
}
function requireStaff(req, res, next) {
  next(!req.user ? new HttpError(401, 'Please sign in') : isStaff(req.user) ? undefined : new HttpError(403, 'Staff only'));
}
function requireAdmin(req, res, next) {
  next(!req.user ? new HttpError(401, 'Please sign in') : req.user.role === 'admin' ? undefined : new HttpError(403, 'Admins only'));
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
    notify_email: !!u.notify_email,
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
  COOKIE,
  ROLES,
  STAFF_ROLES,
  isStaff,
  sha256,
  setSession,
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
