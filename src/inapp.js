const db = require('./db');
const realtime = require('./realtime');
const { now } = require('./util');

const KEEP_PER_USER = 200;

// Notices that only make sense for staff. Clients never get these, even if their account used to be staff.
const STAFF_ONLY_KINDS = ['action', 'signoff', 'assigned', 'escalated'];
const CLIENT_LINK = /^\/(tickets|messages|profile)(\/|$|\?)/;
const forClients = (n) => !STAFF_ONLY_KINDS.includes(n.kind) && (!n.link || CLIENT_LINK.test(n.link));
// SQL form of the same rule, for listing and counting a client's notices.
const CLIENT_FILTER = `kind NOT IN ('${STAFF_ONLY_KINDS.join("','")}') AND (link IS NULL OR link LIKE '/tickets%' OR link LIKE '/messages%' OR link LIKE '/profile%')`;

// Stores an in-app notification (the bell) and pushes it to the user's open tabs.
async function create(userId, { kind, title, body, link }) {
  const ts = now();
  if (!forClients({ kind, link })) {
    const u = await db.one('SELECT role FROM users WHERE id = ?', [userId]);
    if (!u || u.role === 'client') return null;
  }
  const r = await db.query('INSERT INTO notifications (user_id, kind, title, body, link, is_read, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)', [
    userId,
    kind,
    String(title).slice(0, 255),
    body ? String(body).slice(0, 1000) : null,
    link || null,
    ts,
  ]);
  const notification = { id: r.insertId, user_id: userId, kind, title, body: body || null, link: link || null, is_read: 0, created_at: ts };
  realtime.toUsers([userId], 'notification:new', { notification });
  require('./push')
    .sendToUser(userId, { title: notification.title, body: notification.body, link: notification.link || '/', tag: `n${notification.id}` })
    .catch((err) => console.error('[push] failed', err.message));
  // Trim old rows now and then so the table stays small.
  if (r.insertId % 50 === 0) {
    db.query(
      `DELETE FROM notifications WHERE user_id = ? AND id < (
         SELECT id FROM (SELECT id FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 1 OFFSET ${KEEP_PER_USER}) x)`,
      [userId, userId]
    ).catch(() => {});
  }
  return notification;
}

// When someone stops being staff, their staff notices and Actions reminders go.
async function clearStaffOnly(userId) {
  await db.query(`DELETE FROM notifications WHERE user_id = ? AND NOT (${CLIENT_FILTER})`, [userId]);
  await db.query('DELETE FROM action_states WHERE user_id = ?', [userId]);
}

module.exports = { create, clearStaffOnly, CLIENT_FILTER };
