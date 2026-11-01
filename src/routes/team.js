// Admin chats: direct messages and small groups between admins, under Messages. Admins only, and no emails or
// bell notifications: new messages arrive live and show as unread in Messages.
const router = require('express').Router();
const db = require('../db');
const realtime = require('../realtime');
const { requireAdmin } = require('../auth');
const { wrap, now, HttpError } = require('../util');

router.use('/team', requireAdmin);

const clean = (v, max) => String(v ?? '').trim().slice(0, max);
const MESSAGE_LIMIT = 300;
const MAX_MEMBERS = 30;
const avatarUrl = (a) => (a ? `/avatars/${a}.png` : null);

const memberIds = async (chatId) => (await db.query('SELECT user_id FROM team_chat_members WHERE chat_id = ?', [chatId])).map((r) => Number(r.user_id));

// The chat, if the signed-in admin is in it.
async function loadChat(req) {
  const chat = await db.one('SELECT * FROM team_chats WHERE id = ?', [Number(req.params.id)]);
  if (!chat) throw new HttpError(404, 'Conversation not found');
  const members = await memberIds(chat.id);
  if (!members.includes(req.user.id)) throw new HttpError(404, 'Conversation not found');
  return { chat, members };
}

// Active admins other than the signed-in one, for starting a chat.
async function admins(exceptId) {
  return db.query("SELECT id, name, avatar, job_title FROM users WHERE role = 'admin' AND is_active = 1 AND id <> ? ORDER BY name", [exceptId]);
}

async function validAdmins(ids, exceptId) {
  const list = [...new Set((Array.isArray(ids) ? ids : []).map(Number).filter((n) => Number.isInteger(n) && n > 0 && n !== exceptId))];
  if (!list.length) return [];
  const found = await db.query(`SELECT id, name FROM users WHERE role = 'admin' AND is_active = 1 AND id IN (${db.inList(list)})`, list);
  if (found.length !== list.length) throw new HttpError(400, 'Admin chats are only with active admins');
  return found;
}

const messageSelect = `SELECT m.id, m.chat_id, m.user_id, m.body, m.kind, m.created_at, m.edited_at, u.name AS user_name, u.avatar AS user_avatar
  FROM team_messages m LEFT JOIN users u ON u.id = m.user_id`;
const shape = (m) => ({ ...m, user_avatar_url: avatarUrl(m.user_avatar), user_avatar: undefined });

async function postSystem(chatId, actor, body) {
  const ts = now();
  const r = await db.query("INSERT INTO team_messages (chat_id, user_id, body, kind, created_at) VALUES (?, ?, ?, 'system', ?)", [chatId, actor.id, body, ts]);
  await db.query('UPDATE team_chats SET last_message_at = ? WHERE id = ?', [ts, chatId]);
  const message = shape(await db.one(`${messageSelect} WHERE m.id = ?`, [r.insertId]));
  realtime.toUsers(await memberIds(chatId), 'team:message', { chatId, message });
}

router.get(
  '/team/admins',
  wrap(async (req, res) => {
    res.json({ admins: (await admins(req.user.id)).map((a) => ({ id: a.id, name: a.name, job_title: a.job_title, avatar_url: avatarUrl(a.avatar) })) });
  })
);

// Start a chat: one other admin and no name makes (or reopens) a direct chat; otherwise a named group.
router.post(
  '/team/chats',
  wrap(async (req, res) => {
    const u = req.user;
    const others = await validAdmins(req.body.user_ids, u.id);
    if (!others.length) throw new HttpError(400, 'Choose at least one admin');
    if (others.length + 1 > MAX_MEMBERS) throw new HttpError(400, `At most ${MAX_MEMBERS} people in a chat`);
    const name = clean(req.body.name, 120).replace(/\s+/g, ' ');
    const ts = now();
    if (others.length === 1 && !name) {
      const key = [u.id, others[0].id].sort((a, b) => a - b).join(':');
      const existing = await db.one('SELECT id FROM team_chats WHERE direct_key = ?', [key]);
      if (existing) return res.json({ chat: { id: existing.id }, existing: true });
      const r = await db.query('INSERT INTO team_chats (name, is_direct, direct_key, created_by, created_at, last_message_at) VALUES (NULL, 1, ?, ?, ?, ?)', [key, u.id, ts, ts]);
      for (const id of [u.id, others[0].id]) await db.query('INSERT INTO team_chat_members (chat_id, user_id, last_read_id, joined_at) VALUES (?, ?, 0, ?)', [r.insertId, id, ts]);
      return res.status(201).json({ chat: { id: r.insertId } });
    }
    const groupName = name || [u.name, ...others.map((o) => o.name)].map((n) => n.split(' ')[0]).join(', ').slice(0, 120);
    const r = await db.query('INSERT INTO team_chats (name, is_direct, direct_key, created_by, created_at, last_message_at) VALUES (?, 0, NULL, ?, ?, ?)', [groupName, u.id, ts, ts]);
    for (const id of [u.id, ...others.map((o) => o.id)]) await db.query('INSERT INTO team_chat_members (chat_id, user_id, last_read_id, joined_at) VALUES (?, ?, 0, ?)', [r.insertId, id, ts]);
    await postSystem(r.insertId, u, `${u.name} started the chat.`);
    res.status(201).json({ chat: { id: r.insertId } });
  })
);

router.get(
  '/team/chats/:id',
  wrap(async (req, res) => {
    const { chat } = await loadChat(req);
    const members = await db.query(
      `SELECT m.user_id AS id, u.name, u.avatar, u.job_title, m.last_read_id FROM team_chat_members m JOIN users u ON u.id = m.user_id WHERE m.chat_id = ? ORDER BY u.name`,
      [chat.id]
    );
    const messages = await db.query(`SELECT * FROM (${messageSelect} WHERE m.chat_id = ? ORDER BY m.id DESC LIMIT ${MESSAGE_LIMIT}) x ORDER BY id`, [chat.id]);
    const other = chat.is_direct ? members.find((m) => Number(m.id) !== req.user.id) : null;
    res.json({
      chat: { id: chat.id, name: chat.is_direct ? (other ? other.name : 'Direct message') : chat.name, is_direct: !!Number(chat.is_direct), created_by: chat.created_by },
      members: members.map((m) => ({ id: Number(m.id), name: m.name, job_title: m.job_title, avatar_url: avatarUrl(m.avatar), last_read_id: Number(m.last_read_id) })),
      messages: messages.map(shape),
    });
  })
);

router.post(
  '/team/chats/:id/messages',
  wrap(async (req, res) => {
    const { chat, members } = await loadChat(req);
    const body = clean(req.body.body, 10000);
    if (!body) throw new HttpError(400, 'Write a message');
    const ts = now();
    const r = await db.query("INSERT INTO team_messages (chat_id, user_id, body, kind, created_at) VALUES (?, ?, ?, 'message', ?)", [chat.id, req.user.id, body, ts]);
    await db.query('UPDATE team_chats SET last_message_at = ? WHERE id = ?', [ts, chat.id]);
    await db.query('UPDATE team_chat_members SET last_read_id = ? WHERE chat_id = ? AND user_id = ?', [r.insertId, chat.id, req.user.id]);
    const message = shape(await db.one(`${messageSelect} WHERE m.id = ?`, [r.insertId]));
    realtime.toUsers(members, 'team:message', { chatId: chat.id, message });
    res.status(201).json({ message });
  })
);

// Authors can correct their own messages.
router.patch(
  '/team/chats/:id/messages/:messageId',
  wrap(async (req, res) => {
    const { chat, members } = await loadChat(req);
    const m = await db.one("SELECT * FROM team_messages WHERE id = ? AND chat_id = ? AND kind = 'message'", [Number(req.params.messageId), chat.id]);
    if (!m) throw new HttpError(404, 'Message not found');
    if (Number(m.user_id) !== req.user.id) throw new HttpError(403, 'You can only edit your own messages');
    const body = clean(req.body.body, 10000);
    if (!body) throw new HttpError(400, 'A message cannot be empty');
    await db.query('UPDATE team_messages SET body = ?, edited_at = ? WHERE id = ?', [body, now(), m.id]);
    const message = shape(await db.one(`${messageSelect} WHERE m.id = ?`, [m.id]));
    realtime.toUsers(members, 'team:updated', { chatId: chat.id, message });
    res.json({ message });
  })
);

router.post(
  '/team/chats/:id/read',
  wrap(async (req, res) => {
    const { chat, members } = await loadChat(req);
    const last = Number((await db.one('SELECT MAX(id) AS id FROM team_messages WHERE chat_id = ?', [chat.id])).id) || 0;
    await db.query('UPDATE team_chat_members SET last_read_id = ? WHERE chat_id = ? AND user_id = ? AND last_read_id < ?', [last, chat.id, req.user.id, last]);
    realtime.toUsers(members, 'team:read', { chatId: chat.id, userId: req.user.id, lastReadId: last });
    res.json({ ok: true });
  })
);

// Groups only: add admins, or leave.
router.post(
  '/team/chats/:id/members',
  wrap(async (req, res) => {
    const { chat, members } = await loadChat(req);
    if (Number(chat.is_direct)) throw new HttpError(400, 'Start a group to add more people');
    const add = (await validAdmins(req.body.user_ids, req.user.id)).filter((a) => !members.includes(Number(a.id)));
    if (!add.length) throw new HttpError(400, 'Choose admins who are not in the chat yet');
    if (members.length + add.length > MAX_MEMBERS) throw new HttpError(400, `At most ${MAX_MEMBERS} people in a chat`);
    const ts = now();
    for (const a of add) await db.query('INSERT INTO team_chat_members (chat_id, user_id, last_read_id, joined_at) VALUES (?, ?, 0, ?)', [chat.id, a.id, ts]);
    await postSystem(chat.id, req.user, `${req.user.name} added ${add.map((a) => a.name).join(', ')}.`);
    res.json({ ok: true });
  })
);

router.post(
  '/team/chats/:id/leave',
  wrap(async (req, res) => {
    const { chat } = await loadChat(req);
    if (Number(chat.is_direct)) throw new HttpError(400, 'You cannot leave a direct chat');
    await postSystem(chat.id, req.user, `${req.user.name} left the chat.`);
    await db.query('DELETE FROM team_chat_members WHERE chat_id = ? AND user_id = ?', [chat.id, req.user.id]);
    res.json({ ok: true });
  })
);

// Inbox rows for the Messages list (used by the chats inbox).
async function inboxItems(user) {
  if (user.role !== 'admin') return [];
  const rows = await db.query(
    `SELECT c.id, c.name, c.is_direct, c.last_message_at,
      (SELECT COUNT(*) FROM team_chat_members x WHERE x.chat_id = c.id) AS member_count,
      (SELECT u.name FROM team_chat_members x JOIN users u ON u.id = x.user_id WHERE x.chat_id = c.id AND x.user_id <> ? LIMIT 1) AS other_name,
      (SELECT tm.body FROM team_messages tm WHERE tm.chat_id = c.id ORDER BY tm.id DESC LIMIT 1) AS last_body,
      (SELECT tm.kind FROM team_messages tm WHERE tm.chat_id = c.id ORDER BY tm.id DESC LIMIT 1) AS last_kind,
      (SELECT lu.name FROM team_messages tm LEFT JOIN users lu ON lu.id = tm.user_id WHERE tm.chat_id = c.id ORDER BY tm.id DESC LIMIT 1) AS last_user,
      (SELECT COUNT(*) FROM team_messages tm WHERE tm.chat_id = c.id AND tm.kind = 'message' AND tm.user_id <> ? AND tm.id > m.last_read_id) AS unread
     FROM team_chats c JOIN team_chat_members m ON m.chat_id = c.id AND m.user_id = ?
     ORDER BY c.last_message_at DESC LIMIT 100`,
    [user.id, user.id, user.id]
  );
  return rows.map((c) => ({
    type: 'team',
    id: c.id,
    title: Number(c.is_direct) ? c.other_name || 'Direct message' : c.name,
    subtitle: Number(c.is_direct) ? 'Admin chat' : `Admin group · ${c.member_count} members`,
    company_name: null,
    last_at: c.last_message_at,
    last_body: c.last_body,
    last_kind: c.last_kind,
    last_user: c.last_user,
    unread: Number(c.unread) || 0,
    is_member: true,
  }));
}

module.exports = router;
module.exports.inboxItems = inboxItems;
