const path = require('path');
const router = require('express').Router();
const db = require('../db');
const notify = require('../notify');
const realtime = require('../realtime');
const privacy = require('../privacy');
const ticketsSvc = require('../services/tickets');
const { upload, cleanup, uploadsDir } = require('../uploads');
const { requireAuth, isStaff, canAccessTicket, STAFF_ROLES } = require('../auth');
const { wrap, now, HttpError } = require('../util');

router.use(requireAuth);

const clean = (v, max) => String(v ?? '').trim().slice(0, max);
const ids = (arr) => [...new Set((Array.isArray(arr) ? arr : []).map(Number).filter(Boolean))];
const isAdmin = (u) => u.role === 'admin';
const INBOX_LIMIT = 100;
const MESSAGE_LIMIT = 300;

const withFiles = (fn) =>
  wrap(async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      cleanup(req.files);
      throw err;
    }
  });

const getGroup = (id) =>
  db.one('SELECT g.*, c.name AS company_name FROM chat_groups g JOIN companies c ON c.id = g.company_id WHERE g.id = ?', [id]);

const getMembers = (groupId) =>
  db.query(
    `SELECT m.user_id AS id, u.name, u.email, u.role, m.joined_at, m.last_read_id
     FROM chat_members m JOIN users u ON u.id = m.user_id WHERE m.group_id = ? ORDER BY u.role = 'client', u.name`,
    [groupId]
  );

const latestMessageId = async (groupId) => Number((await db.one('SELECT MAX(id) AS id FROM chat_messages WHERE group_id = ?', [groupId])).id) || 0;
const memberIds = async (groupId) => (await db.query('SELECT user_id FROM chat_members WHERE group_id = ?', [groupId])).map((r) => Number(r.user_id));

// Moves a member's read marker to the latest message and tells the group, for "seen" indicators.
async function markGroupRead(groupId, userId) {
  const lastReadId = await latestMessageId(groupId);
  const prev = await db.one('SELECT last_read_id FROM chat_members WHERE group_id = ? AND user_id = ?', [groupId, userId]);
  if (!prev || Number(prev.last_read_id) >= lastReadId) return;
  await db.query('UPDATE chat_members SET last_read_id = ? WHERE group_id = ? AND user_id = ?', [lastReadId, groupId, userId]);
  realtime.toUsers(await memberIds(groupId), 'chat:read', { groupId, userId, lastReadId }, { admins: true });
}

// Admins can see every group for oversight; everyone else only sees groups they belong to.
async function loadGroup(req, { manage = false } = {}) {
  const g = await getGroup(Number(req.params.id));
  if (!g) throw new HttpError(404, 'Conversation not found');
  const members = await memberIds(g.id);
  const u = req.user;
  if (!isAdmin(u) && !members.includes(u.id)) throw new HttpError(404, 'Conversation not found');
  if (manage && !isAdmin(u) && Number(g.created_by) !== u.id) throw new HttpError(403, 'Only the group creator or an admin can do that');
  return { group: g, members };
}

// Clients of the group's company plus any active staff member can be added.
async function eligibleUsers(companyId) {
  return db.query(
    `SELECT id, name, email, role, company_id FROM users
     WHERE is_active = 1 AND (company_id = ? OR role IN (${db.inList(STAFF_ROLES)}))
     ORDER BY role = 'client' DESC, name`,
    [companyId, ...STAFF_ROLES]
  );
}

async function hasAdmin(userIds) {
  if (!userIds.length) return false;
  const row = await db.one(`SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND id IN (${db.inList(userIds)})`, userIds);
  return Number(row.n) > 0;
}

async function addMessage(group, user, { body, kind = 'message', files = [] }) {
  const ts = now();
  const r = await db.query('INSERT INTO chat_messages (group_id, user_id, body, kind, created_at) VALUES (?, ?, ?, ?, ?)', [
    group.id,
    user ? user.id : null,
    body,
    kind,
    ts,
  ]);
  const attachments = [];
  for (const f of files) {
    const a = await db.query(
      `INSERT INTO chat_attachments (group_id, message_id, user_id, original_name, stored_name, mime, size, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [group.id, r.insertId, user ? user.id : null, f.originalname, f.filename, f.mimetype, f.size, ts]
    );
    attachments.push({ id: a.insertId, message_id: r.insertId, original_name: f.originalname, mime: f.mimetype, size: f.size, created_at: ts });
  }
  await db.query('UPDATE chat_groups SET last_message_at = ? WHERE id = ?', [ts, group.id]);
  if (user) await db.query('UPDATE chat_members SET last_read_id = ? WHERE group_id = ? AND user_id = ?', [r.insertId, group.id, user.id]);
  const message = {
    id: r.insertId,
    group_id: group.id,
    user_id: user ? user.id : null,
    user_name: user ? user.name : null,
    user_role: user ? user.role : null,
    body,
    kind,
    created_at: ts,
    attachments,
  };
  realtime.toUsers(await memberIds(group.id), 'chat:message', { groupId: group.id, message }, { admins: true });
  return message;
}

const systemMessage = (group, actor, text) => addMessage(group, actor, { body: text, kind: 'system' });
const groupChanged = async (groupId, extraUserIds = []) =>
  realtime.toUsers([...(await memberIds(groupId)), ...extraUserIds], 'chat:group', { groupId }, { admins: true });

// ---- Inbox: group chats and ticket conversations in one list ----

router.get(
  '/',
  wrap(async (req, res) => {
    const u = req.user;
    const staff = isStaff(u);
    // Clients see the team, not the engineer, as the author of the latest message.
    const author = staff ? 'lu.name' : `CASE WHEN lu.role = 'technician' THEN '${privacy.TEAM}' ELSE lu.name END`;

    const groups = await db.query(
      `SELECT g.id, g.name, g.company_id, c.name AS company_name, g.created_by, g.last_message_at,
        CASE WHEN m.user_id IS NULL THEN 0 ELSE 1 END AS is_member,
        (SELECT COUNT(*) FROM chat_members x WHERE x.group_id = g.id) AS member_count,
        (SELECT cm.body FROM chat_messages cm WHERE cm.group_id = g.id ORDER BY cm.id DESC LIMIT 1) AS last_body,
        (SELECT cm.kind FROM chat_messages cm WHERE cm.group_id = g.id ORDER BY cm.id DESC LIMIT 1) AS last_kind,
        (SELECT ${author} FROM chat_messages cm LEFT JOIN users lu ON lu.id = cm.user_id WHERE cm.group_id = g.id ORDER BY cm.id DESC LIMIT 1) AS last_user,
        CASE WHEN m.user_id IS NULL THEN 0 ELSE (
          SELECT COUNT(*) FROM chat_messages cm WHERE cm.group_id = g.id AND cm.kind = 'message'
            AND (cm.user_id IS NULL OR cm.user_id <> ?) AND cm.id > m.last_read_id
        ) END AS unread
       FROM (${
         isAdmin(u)
           ? 'SELECT * FROM chat_groups ORDER BY last_message_at DESC LIMIT ?'
           : 'SELECT g.* FROM chat_groups g JOIN chat_members mm ON mm.group_id = g.id AND mm.user_id = ? ORDER BY g.last_message_at DESC LIMIT ?'
       }) g
       JOIN companies c ON c.id = g.company_id
       LEFT JOIN chat_members m ON m.group_id = g.id AND m.user_id = ?
       ORDER BY g.last_message_at DESC`,
      // The newest conversations are picked first, so previews and unread counts are only worked out for those.
      [u.id, ...(isAdmin(u) ? [] : [u.id]), INBOX_LIMIT, u.id]
    );

    // Unread counts only apply to tickets this user is following: ones they have opened, or that are theirs.
    const internal = staff ? '' : 'AND tm.is_internal = 0';
    const tickets = await db.query(
      `SELECT t.id, t.subject, t.status, t.priority, t.escalated, t.company_id, c.name AS company_name, t.last_activity_at,
        (SELECT tm.body FROM messages tm WHERE tm.ticket_id = t.id ${internal} ORDER BY tm.id DESC LIMIT 1) AS last_body,
        (SELECT tm.kind FROM messages tm WHERE tm.ticket_id = t.id ${internal} ORDER BY tm.id DESC LIMIT 1) AS last_kind,
        (SELECT ${staff ? 'lu.name' : `CASE WHEN lu.role = 'technician' OR tm.kind = 'work_update' THEN '${privacy.TEAM}' ELSE lu.name END`} FROM messages tm LEFT JOIN users lu ON lu.id = tm.user_id WHERE tm.ticket_id = t.id ${internal} ORDER BY tm.id DESC LIMIT 1) AS last_user,
        CASE WHEN r.ticket_id IS NULL AND COALESCE(${staff ? 't.assigned_to' : 't.created_by'}, 0) <> ? THEN 0 ELSE (
          SELECT COUNT(*) FROM messages tm WHERE tm.ticket_id = t.id AND tm.kind = 'message' ${internal}
            AND (tm.user_id IS NULL OR tm.user_id <> ?) AND tm.id > COALESCE(r.last_read_id, 0)
        ) END AS unread
       FROM (SELECT * FROM tickets ${staff ? '' : 'WHERE company_id = ?'} ORDER BY last_activity_at DESC LIMIT ?) t
       JOIN companies c ON c.id = t.company_id
       LEFT JOIN ticket_reads r ON r.ticket_id = t.id AND r.user_id = ?
       ORDER BY t.last_activity_at DESC`,
      [u.id, u.id, ...(staff ? [] : [u.company_id]), INBOX_LIMIT, u.id]
    );

    const items = [
      ...groups.map((g) => ({
        type: 'group',
        id: g.id,
        title: g.name,
        subtitle: `${g.company_name} · ${g.member_count} members`,
        company_name: g.company_name,
        last_at: g.last_message_at,
        last_body: g.last_body,
        last_kind: g.last_kind,
        last_user: g.last_user,
        unread: Number(g.unread) || 0,
        is_member: !!Number(g.is_member),
      })),
      ...tickets.map((t) => ({
        type: 'ticket',
        id: t.id,
        title: t.subject,
        subtitle: `#${t.id} · ${t.company_name}`,
        company_name: t.company_name,
        status: t.status,
        escalated: !!Number(t.escalated),
        last_at: t.last_activity_at,
        last_body: t.last_body,
        last_kind: t.last_kind,
        last_user: t.last_user,
        unread: Number(t.unread) || 0,
        is_member: true,
      })),
    ].sort((a, b) => (a.last_at < b.last_at ? 1 : -1));

    res.json({ items, unread: items.reduce((s, i) => s + i.unread, 0) });
  })
);

// Full-text search across the conversations this user can see (group chats and ticket threads).
router.get(
  '/search',
  wrap(async (req, res) => {
    const u = req.user;
    const staff = isStaff(u);
    const q = clean(req.query.q, 100);
    if (q.length < 2) return res.json({ results: [] });
    const like = `%${q}%`;
    const groupRows = await db.query(
      `SELECT cm.id, cm.group_id, cm.body, cm.created_at, u.name AS user_name, u.role AS user_role, g.name AS title, c.name AS company_name
       FROM chat_messages cm
       JOIN chat_groups g ON g.id = cm.group_id
       JOIN companies c ON c.id = g.company_id
       LEFT JOIN users u ON u.id = cm.user_id
       ${isAdmin(u) ? '' : 'JOIN chat_members mem ON mem.group_id = g.id AND mem.user_id = ?'}
       WHERE cm.kind = 'message' AND cm.body LIKE ?
       ORDER BY cm.id DESC LIMIT 25`,
      [...(isAdmin(u) ? [] : [u.id]), like]
    );
    const ticketRows = await db.query(
      `SELECT m.id, m.ticket_id, m.body, m.created_at, m.is_internal, u.name AS user_name, u.role AS user_role, t.subject AS title, c.name AS company_name
       FROM messages m
       JOIN tickets t ON t.id = m.ticket_id
       JOIN companies c ON c.id = t.company_id
       LEFT JOIN users u ON u.id = m.user_id
       WHERE m.kind = 'message' AND m.body LIKE ? ${staff ? '' : 'AND m.is_internal = 0 AND t.company_id = ?'}
       ORDER BY m.id DESC LIMIT 25`,
      [like, ...(staff ? [] : [u.company_id])]
    );
    // A short excerpt centred on the match.
    const snippet = (body) => {
      const i = body.toLowerCase().indexOf(q.toLowerCase());
      const start = Math.max(0, i - 50);
      return (start > 0 ? '...' : '') + body.slice(start, start + 160).replace(/\s+/g, ' ') + (body.length > start + 160 ? '...' : '');
    };
    const results = [
      ...groupRows.map((r) => ({ type: 'group', id: r.group_id, message_id: r.id, title: r.title, company_name: r.company_name, user_name: r.user_name, user_role: r.user_role, snippet: snippet(r.body), created_at: r.created_at })),
      ...ticketRows.map((r) => ({ type: 'ticket', id: r.ticket_id, message_id: r.id, title: r.title, company_name: r.company_name, user_name: r.user_name, user_role: r.user_role, snippet: snippet(r.body), created_at: r.created_at, internal: !!Number(r.is_internal) })),
    ].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    res.json({ results: results.slice(0, 30) });
  })
);

// People who can be added to a group for a company.
router.get(
  '/candidates',
  wrap(async (req, res) => {
    const u = req.user;
    const companyId = isStaff(u) ? Number(req.query.company_id) : u.company_id;
    if (!companyId) throw new HttpError(400, 'Choose a company');
    const users = await eligibleUsers(companyId);
    res.json({ users: users.filter((x) => x.id !== u.id) });
  })
);

// ---- Groups ----

router.post(
  '/groups',
  wrap(async (req, res) => {
    const u = req.user;
    const name = clean(req.body.name, 120);
    if (!name) throw new HttpError(400, 'Give the group a name');
    const companyId = isStaff(u) ? Number(req.body.company_id) : u.company_id;
    if (!companyId || !(await db.one('SELECT id FROM companies WHERE id = ? AND is_active = 1', [companyId]))) {
      throw new HttpError(400, 'Choose a company');
    }
    const eligible = new Set((await eligibleUsers(companyId)).map((x) => Number(x.id)));
    const members = ids([u.id, ...ids(req.body.member_ids)]);
    const invalid = members.filter((id) => id !== u.id && !eligible.has(id));
    if (invalid.length) throw new HttpError(400, 'Members must be from this company or the support team');
    if (members.length < 2) throw new HttpError(400, 'Add at least one other person');
    if (!(await hasAdmin(members))) throw new HttpError(400, 'Every group must include at least one admin');

    const ts = now();
    const r = await db.query('INSERT INTO chat_groups (company_id, name, created_by, created_at, last_message_at) VALUES (?, ?, ?, ?, ?)', [
      companyId,
      name,
      u.id,
      ts,
      ts,
    ]);
    for (const id of members) {
      await db.query('INSERT INTO chat_members (group_id, user_id, added_by, joined_at) VALUES (?, ?, ?, ?)', [r.insertId, id, u.id, ts]);
    }
    const group = await getGroup(r.insertId);
    await systemMessage(group, u, `${u.name} created the group "${name}".`);
    await groupChanged(group.id);
    notify.addedToGroup(group, u, members.filter((id) => id !== u.id));
    res.status(201).json({ group });
  })
);

router.get(
  '/groups/:id',
  wrap(async (req, res) => {
    const { group, members } = await loadGroup(req);
    const isMember = members.includes(req.user.id);
    const messages = (
      await db.query(
        `SELECT m.*, u.name AS user_name, u.role AS user_role FROM chat_messages m LEFT JOIN users u ON u.id = m.user_id
         WHERE m.group_id = ? ORDER BY m.id DESC LIMIT ?`,
        [group.id, MESSAGE_LIMIT]
      )
    ).reverse();
    const atts = messages.length
      ? await db.query('SELECT id, message_id, original_name, mime, size, created_at FROM chat_attachments WHERE group_id = ? AND message_id >= ?', [
          group.id,
          messages[0].id,
        ])
      : [];
    for (const m of messages) m.attachments = atts.filter((a) => a.message_id === m.id);
    if (isMember) await markGroupRead(group.id, req.user.id);
    res.json({
      group: { ...group, is_member: isMember, can_manage: isAdmin(req.user) || Number(group.created_by) === req.user.id },
      members: await getMembers(group.id),
      messages,
    });
  })
);

router.post(
  '/groups/:id/read',
  wrap(async (req, res) => {
    const { group } = await loadGroup(req);
    await markGroupRead(group.id, req.user.id);
    res.json({ ok: true });
  })
);

router.post(
  '/groups/:id/messages',
  upload.array('files'),
  withFiles(async (req, res) => {
    const u = req.user;
    const { group, members } = await loadGroup(req);
    const body = clean(req.body.body, 20000);
    if (!body && !req.files.length) throw new HttpError(400, 'Write a message or attach a file');
    // An admin overseeing a group joins it when they first post.
    if (!members.includes(u.id)) {
      await db.query('INSERT INTO chat_members (group_id, user_id, added_by, joined_at, last_read_id) VALUES (?, ?, ?, ?, ?)', [group.id, u.id, u.id, now(), await latestMessageId(group.id)]);
      await systemMessage(group, u, `${u.name} joined the group.`);
      await groupChanged(group.id);
    }
    const message = await addMessage(group, u, { body: body || '(attachment)', files: req.files });
    res.status(201).json({ message });
  })
);

// Authors can edit their own group messages; the change is shown as edited.
router.patch(
  '/groups/:id/messages/:messageId',
  wrap(async (req, res) => {
    const { group } = await loadGroup(req);
    const m = await db.one('SELECT * FROM chat_messages WHERE id = ? AND group_id = ?', [Number(req.params.messageId), group.id]);
    if (!m || m.kind !== 'message') throw new HttpError(404, 'Message not found');
    if (Number(m.user_id) !== req.user.id) throw new HttpError(403, 'You can only edit your own messages');
    const body = clean(req.body.body, 20000);
    if (!body) throw new HttpError(400, 'A message cannot be empty');
    await db.query('UPDATE chat_messages SET body = ?, edited_at = ? WHERE id = ?', [body, now(), m.id]);
    const message = await db.one(
      'SELECT m.*, u.name AS user_name, u.role AS user_role FROM chat_messages m LEFT JOIN users u ON u.id = m.user_id WHERE m.id = ?',
      [m.id]
    );
    message.attachments = await db.query('SELECT id, message_id, original_name, mime, size, created_at FROM chat_attachments WHERE message_id = ?', [m.id]);
    realtime.toUsers(await memberIds(group.id), 'chat:updated', { groupId: group.id, message }, { admins: true });
    res.json({ message });
  })
);

router.patch(
  '/groups/:id',
  wrap(async (req, res) => {
    const { group } = await loadGroup(req, { manage: true });
    const name = clean(req.body.name, 120);
    if (!name) throw new HttpError(400, 'Give the group a name');
    if (name !== group.name) {
      await db.query('UPDATE chat_groups SET name = ? WHERE id = ?', [name, group.id]);
      await systemMessage(group, req.user, `${req.user.name} renamed the group to "${name}".`);
      await groupChanged(group.id);
    }
    res.json({ group: await getGroup(group.id) });
  })
);

router.post(
  '/groups/:id/members',
  wrap(async (req, res) => {
    const u = req.user;
    const { group, members } = await loadGroup(req, { manage: true });
    const eligible = new Map((await eligibleUsers(group.company_id)).map((x) => [Number(x.id), x]));
    const adding = ids(req.body.user_ids).filter((id) => !members.includes(id));
    if (!adding.length) throw new HttpError(400, 'Choose people to add');
    if (adding.some((id) => !eligible.has(id))) throw new HttpError(400, 'Members must be from this company or the support team');
    const ts = now();
    for (const id of adding) {
      await db.query('INSERT INTO chat_members (group_id, user_id, added_by, joined_at, last_read_id) VALUES (?, ?, ?, ?, ?)', [group.id, id, u.id, ts, await latestMessageId(group.id)]);
    }
    await systemMessage(group, u, `${u.name} added ${adding.map((id) => eligible.get(id).name).join(', ')}.`);
    await groupChanged(group.id);
    notify.addedToGroup(group, u, adding);
    res.status(201).json({ members: await getMembers(group.id) });
  })
);

// Removes a member. Anyone may leave; only the creator or an admin may remove others.
router.delete(
  '/groups/:id/members/:userId',
  wrap(async (req, res) => {
    const u = req.user;
    const userId = Number(req.params.userId);
    const self = userId === u.id;
    const { group, members } = await loadGroup(req, { manage: !self });
    if (!members.includes(userId)) throw new HttpError(404, 'Not a member of this group');
    const remaining = members.filter((id) => id !== userId);
    if (remaining.length && !(await hasAdmin(remaining))) throw new HttpError(400, 'The group must keep at least one admin');
    const target = await db.one('SELECT id, name FROM users WHERE id = ?', [userId]);
    await db.query('DELETE FROM chat_members WHERE group_id = ? AND user_id = ?', [group.id, userId]);
    await systemMessage(group, u, self ? `${u.name} left the group.` : `${u.name} removed ${target ? target.name : 'a member'}.`);
    await groupChanged(group.id, [userId]);
    res.json({ ok: true });
  })
);

router.get(
  '/files/:id',
  wrap(async (req, res) => {
    const a = await db.one('SELECT * FROM chat_attachments WHERE id = ?', [Number(req.params.id)]);
    const member = a && (await db.one('SELECT user_id FROM chat_members WHERE group_id = ? AND user_id = ?', [a.group_id, req.user.id]));
    if (!a || (!member && !isAdmin(req.user))) throw new HttpError(404, 'File not found');
    const inline = /^(image\/(png|jpe?g|gif|webp)|application\/pdf)$/.test(a.mime) && req.query.download !== '1';
    res.attachment(a.original_name);
    if (inline) res.set('Content-Disposition', res.get('Content-Disposition').replace(/^attachment/, 'inline'));
    res.type(inline ? a.mime : 'application/octet-stream');
    res.set('Cache-Control', 'private, max-age=86400');
    res.sendFile(path.join(uploadsDir, path.basename(a.stored_name)));
  })
);

// ---- Ticket read receipts (drives unread counts in the inbox) ----

router.post(
  '/tickets/:id/read',
  wrap(async (req, res) => {
    const t = await db.one('SELECT id, company_id FROM tickets WHERE id = ?', [Number(req.params.id)]);
    if (!canAccessTicket(req.user, t)) throw new HttpError(404, 'Ticket not found');
    await ticketsSvc.markRead(t, req.user);
    res.json({ ok: true });
  })
);

module.exports = router;
