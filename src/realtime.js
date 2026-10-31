const { Server } = require('socket.io');
const config = require('./config');
const db = require('./db');
const auth = require('./auth');
const privacy = require('./privacy');
const { now } = require('./util');

let io;
const online = new Map(); // userId -> { user, sockets }
let presenceTimer;

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function init(server) {
  // The website's own address may connect too, when it is on a different address from the API.
  const appOrigin = new URL(config.appUrl).origin;
  io = new Server(server, {
    serveClient: true,
    cors: { origin: appOrigin, credentials: true },
    // Reject cross-site connections; same-origin browsers always send a matching Origin.
    allowRequest: (req, cb) => {
      const origin = req.headers.origin;
      let ok = !origin;
      try {
        ok = ok || new URL(origin).host === req.headers.host || new URL(origin).origin === appOrigin;
      } catch {
        ok = false;
      }
      cb(null, ok);
    },
  });

  io.use(async (socket, next) => {
    try {
      const user = await auth.userFromToken(parseCookies(socket.request.headers.cookie)[auth.COOKIE]);
      if (!user) return next(new Error('unauthorized'));
      socket.user = user;
      socket.pv = auth.passwordVersion(user);
      next();
    } catch (err) {
      next(err);
    }
  });

  io.on('connection', (socket) => {
    const u = socket.user;
    socket.join(`user:${u.id}`);
    if (auth.isStaff(u)) socket.join('staff');
    else socket.join('clients');
    if (u.role === 'admin') socket.join('admins');
    else if (u.company_id) socket.join(`company:${u.company_id}`);
    track(u, 1);

    socket.on('typing', async ({ ticketId, typing } = {}) => {
      const t = await db.one('SELECT id, company_id FROM tickets WHERE id = ?', [Number(ticketId)]).catch(() => null);
      if (!auth.canAccessTicket(u, t)) return;
      const event = { ticketId: t.id, userId: u.id, name: u.name, typing: !!typing };
      socket.to('staff').emit('typing', event);
      socket
        .to(`company:${t.company_id}`)
        .except('staff')
        .emit('typing', privacy.hidden(u.role) ? { ...event, userId: null, name: privacy.TEAM } : event);
    });

    socket.on('chat:typing', async ({ groupId, typing } = {}) => {
      const id = Number(groupId);
      const member = await db.one('SELECT user_id FROM chat_members WHERE group_id = ? AND user_id = ?', [id, u.id]).catch(() => null);
      if (!member) return;
      const rows = await db.query('SELECT user_id FROM chat_members WHERE group_id = ?', [id]).catch(() => []);
      const rooms = rows.map((r) => `user:${r.user_id}`);
      const event = { groupId: id, userId: u.id, name: u.name, typing: !!typing };
      socket.to(rooms).except('clients').emit('chat:typing', event);
      socket.to(rooms).except('staff').emit('chat:typing', privacy.hidden(u.role) ? { ...event, userId: null, name: privacy.TEAM } : event);
    });

    socket.on('disconnect', () => track(u, -1));
  });

  setInterval(() => revalidate().catch((err) => console.error('[realtime] revalidate failed', err)), 60000).unref();
  return io;
}

// Open connections were authorised when they connected. Every minute, close any whose account has since been
// disabled, had its password changed, changed role or company, or whose company was disabled; the browser
// then reconnects (or is sent to sign in) with its current session.
async function revalidate() {
  const sockets = [...io.sockets.sockets.values()];
  const ids = [...new Set(sockets.map((s) => s.user.id))];
  if (!ids.length) return;
  const rows = await db.query(
    `SELECT u.*, c.is_active AS company_active FROM users u LEFT JOIN companies c ON c.id = u.company_id WHERE u.id IN (${db.inList(ids)})`,
    ids
  );
  const byId = new Map(rows.map((r) => [Number(r.id), r]));
  for (const s of sockets) {
    const cur = byId.get(s.user.id);
    const stale =
      !cur ||
      !cur.is_active ||
      auth.passwordVersion(cur) !== s.pv ||
      cur.role !== s.user.role ||
      Number(cur.company_id || 0) !== Number(s.user.company_id || 0) ||
      (cur.role === 'client' && Number(cur.company_active) === 0);
    if (stale) s.disconnect(true);
  }
}

function track(user, delta) {
  const entry = online.get(user.id) || { user, sockets: 0 };
  entry.sockets += delta;
  if (entry.sockets > 0) online.set(user.id, entry);
  else {
    online.delete(user.id);
    db.query('UPDATE users SET last_seen_at = ? WHERE id = ?', [now(), user.id]).catch(() => {});
  }
  // Batch presence broadcasts so a burst of reconnects sends a single update.
  clearTimeout(presenceTimer);
  presenceTimer = setTimeout(() => io && io.to('staff').emit('presence', presence()), 500);
}

function presence() {
  const users = [...online.values()].map(({ user: u }) => ({
    id: u.id,
    name: u.name,
    role: u.role,
    company_name: u.company_name || null,
  }));
  const staff = users.filter((u) => auth.isStaff(u)).length;
  return { total: users.length, staff, clients: users.length - staff, users };
}

// Public events go to staff and the ticket's company; internal ones to staff only.
// Clients get a copy without our engineers' names and numbers.
function toTicket(ticket, event, payload, { internal = false } = {}) {
  if (!io || !ticket) return;
  io.to('staff').emit(event, payload);
  if (!internal) io.to(`company:${ticket.company_id}`).except('staff').emit(event, privacy.scrub(payload));
}

// Sends to specific users (every open tab) and, optionally, to all admins for oversight.
function toUsers(userIds, event, payload, { admins = false } = {}) {
  if (!io) return;
  const rooms = [...new Set(userIds.map((id) => `user:${id}`))];
  if (admins) rooms.push('admins');
  if (!rooms.length) return;
  io.to(rooms).except('clients').emit(event, payload);
  io.to(rooms).except('staff').emit(event, privacy.scrub(payload));
}

module.exports = { init, presence, toTicket, toUsers };
