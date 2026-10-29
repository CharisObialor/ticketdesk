const db = require('./db');
const realtime = require('./realtime');
const { now } = require('./util');

const KEEP_PER_USER = 200;

// Stores an in-app notification (the bell) and pushes it to the user's open tabs.
async function create(userId, { kind, title, body, link }) {
  const ts = now();
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

module.exports = { create };
