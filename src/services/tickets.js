const fs = require('fs');
const path = require('path');
const db = require('../db');
const realtime = require('../realtime');
const notify = require('../notify');
const transcript = require('../transcript');
const { transcriptsDir } = require('../uploads');
const { isStaff } = require('../auth');
const { now, STATUS_LABELS } = require('../util');

const TICKET_SELECT = `SELECT t.*, c.name AS company_name, cu.name AS creator_name, cu.email AS creator_email,
  au.name AS assignee_name, s.code AS site_code, s.location AS site_location
  FROM tickets t
  JOIN companies c ON c.id = t.company_id
  LEFT JOIN users cu ON cu.id = t.created_by
  LEFT JOIN users au ON au.id = t.assigned_to
  LEFT JOIN sites s ON s.id = t.site_id`;

const getTicket = (id) => db.one(`${TICKET_SELECT} WHERE t.id = ?`, [id]);

async function getMessages(ticketId, includeInternal) {
  const messages = await db.query(
    `SELECT m.*, u.name AS user_name, u.role AS user_role FROM messages m LEFT JOIN users u ON u.id = m.user_id
     WHERE m.ticket_id = ? ${includeInternal ? '' : 'AND m.is_internal = 0'} ORDER BY m.id`,
    [ticketId]
  );
  const atts = await db.query(
    'SELECT id, message_id, original_name, mime, size, label, created_at FROM attachments WHERE ticket_id = ? ORDER BY id',
    [ticketId]
  );
  const byMessage = new Map();
  for (const a of atts) {
    if (!byMessage.has(a.message_id)) byMessage.set(a.message_id, []);
    byMessage.get(a.message_id).push(a);
  }
  for (const m of messages) {
    m.attachments = byMessage.get(m.id) || [];
    m.cc = m.cc ? JSON.parse(m.cc) : null;
    // BCC is only visible to staff (includeInternal is true only for staff).
    m.bcc = includeInternal && m.bcc ? JSON.parse(m.bcc) : null;
  }
  return messages;
}

// `user` is a portal user, or { external: true, name, email } for someone replying by email from outside the portal
// (a person an admin CC'd). `cc`/`bcc` are the extra recipients an admin added to a reply.
// A work update (kind 'work_update') can carry the time spent, and its files can be labelled 'before' or 'after'.
async function addMessage(ticket, user, { body, internal = false, kind = 'message', files = [], cc = [], bcc = [], timeSpent = null }) {
  const ts = now();
  const external = !!(user && user.external);
  const userId = user && !external ? user.id : null;
  const r = await db.query(
    `INSERT INTO messages (ticket_id, user_id, body, is_internal, kind, created_at, cc, bcc, sender_name, sender_email, time_spent_min)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      ticket.id,
      userId,
      body,
      internal,
      kind,
      ts,
      cc.length ? JSON.stringify(cc) : null,
      bcc.length ? JSON.stringify(bcc) : null,
      external ? user.name : null,
      external ? user.email : null,
      timeSpent,
    ]
  );
  const attachments = [];
  for (const f of files) {
    const a = await db.query(
      `INSERT INTO attachments (ticket_id, message_id, user_id, original_name, stored_name, mime, size, label, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [ticket.id, r.insertId, userId, f.originalname, f.filename, f.mimetype, f.size, f.label || null, ts]
    );
    attachments.push({ id: a.insertId, message_id: r.insertId, original_name: f.originalname, mime: f.mimetype, size: f.size, label: f.label || null, created_at: ts });
  }
  const message = {
    id: r.insertId,
    ticket_id: ticket.id,
    user_id: userId,
    user_name: user && !external ? user.name : null,
    user_role: user && !external ? user.role : null,
    sender_name: external ? user.name : null,
    sender_email: external ? user.email : null,
    body,
    is_internal: internal ? 1 : 0,
    kind,
    cc: cc.length ? cc : null,
    bcc: bcc.length ? bcc : null,
    time_spent_min: timeSpent,
    created_at: ts,
    attachments,
  };
  // BCC recipients are never shown to clients.
  realtime.toTicket(ticket, 'message:new', { ticketId: ticket.id, message: { ...message, bcc: null } }, { internal });
  if (message.bcc) realtime.toTicket(ticket, 'message:updated', { ticketId: ticket.id, message }, { internal: true });
  return message;
}

const systemMessage = (ticket, actor, text) => addMessage(ticket, actor, { body: text, kind: 'system' });
// How the team works a ticket (assignment, priority, escalation) is for staff only; clients see status changes.
const teamNote = (ticket, actor, text) => addMessage(ticket, actor, { body: text, kind: 'system', internal: true });

// Updates ticket columns (names come from code, never from input), bumps activity and broadcasts.
async function touch(id, fields = {}) {
  const ts = now();
  const sets = { ...fields, updated_at: ts, last_activity_at: ts };
  const keys = Object.keys(sets);
  // The SLA clocks start the first time the ticket is assigned (reassigning does not restart them).
  const startClock = fields.assigned_to ? ', assigned_at = COALESCE(assigned_at, ?)' : '';
  await db.query(`UPDATE tickets SET ${keys.map((k) => `${k} = ?`).join(', ')}${startClock} WHERE id = ?`, [
    ...keys.map((k) => sets[k]),
    ...(startClock ? [ts] : []),
    id,
  ]);
  const t = await getTicket(id);
  realtime.toTicket(t, 'ticket:update', { ticket: t });
  return t;
}

// Raises the escalation level (one step, or straight to a rule's level) and alerts people. An escalation rule can
// also raise the priority and assign a ticket nobody has picked up.
const PRIORITY_RANK = { low: 0, normal: 1, high: 2, urgent: 3 };
async function escalate(ticket, actor, reason, { level = null, rule = null } = {}) {
  const fields = {
    escalated: 1,
    escalation_level: level || Number(ticket.escalation_level) + 1,
    escalated_at: now(),
  };
  const changes = [];
  if (rule && rule.set_priority && PRIORITY_RANK[rule.set_priority] > PRIORITY_RANK[ticket.priority]) {
    fields.priority = rule.set_priority;
    changes.push(`Priority raised to ${rule.set_priority}.`);
  }
  let assignee = null;
  if (rule && rule.assign_to && !ticket.assigned_to) {
    assignee = await db.one("SELECT id, name FROM users WHERE id = ? AND role IN ('admin', 'agent', 'technician') AND is_active = 1", [rule.assign_to]);
    if (assignee) {
      fields.assigned_to = assignee.id;
      changes.push(`Assigned to ${assignee.name}.`);
    }
  }
  const t = await touch(ticket.id, fields);
  await teamNote(t, actor, [`Escalated to level ${t.escalation_level}. ${reason}`, ...changes].join(' '));
  realtime.toTicket(t, 'ticket:escalated', { ticket: t }, { internal: true });
  notify.escalated(t, actor, reason, rule);
  if (assignee) notify.assigned(t, { id: 0, name: 'An escalation rule', role: 'system' });
  return t;
}

// Saves a full transcript (including internal notes) to storage for reference.
async function archiveTranscript(ticket, actor, reason) {
  const messages = await getMessages(ticket.id, true);
  const html = transcript.toHtml(ticket, messages, { includeInternal: true });
  const filename = `ticket-${ticket.id}-${now().replace(/[-: ]/g, '')}-${Date.now() % 100000}.html`;
  await fs.promises.writeFile(path.join(transcriptsDir, filename), html, 'utf8');
  const r = await db.query(
    'INSERT INTO transcripts (ticket_id, filename, size, message_count, reason, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [ticket.id, filename, Buffer.byteLength(html), messages.length, reason, actor ? actor.id : null, now()]
  );
  return { id: r.insertId, filename };
}

// Records the last message a user has seen on a ticket (drives unread counts and "seen" indicators).
async function markRead(ticket, user) {
  const row = await db.one('SELECT MAX(id) AS id FROM messages WHERE ticket_id = ?', [ticket.id]);
  const lastReadId = Number(row.id) || 0;
  const prev = await db.one('SELECT last_read_id FROM ticket_reads WHERE ticket_id = ? AND user_id = ?', [ticket.id, user.id]);
  if (prev && Number(prev.last_read_id) === lastReadId) return;
  await db.query('DELETE FROM ticket_reads WHERE ticket_id = ? AND user_id = ?', [ticket.id, user.id]);
  await db.query('INSERT INTO ticket_reads (ticket_id, user_id, last_read_id) VALUES (?, ?, ?)', [ticket.id, user.id, lastReadId]);
  realtime.toTicket(ticket, 'ticket:read', { ticketId: ticket.id, userId: user.id, name: user.name, role: user.role, lastReadId });
}

// Who has read how far, for "seen" indicators.
const getReads = (ticketId) =>
  db.query(
    `SELECT r.user_id, u.name, u.role, r.last_read_id FROM ticket_reads r JOIN users u ON u.id = r.user_id WHERE r.ticket_id = ?`,
    [ticketId]
  );

// Creates a ticket with its first message. Used by the portal and by inbound email.
async function createTicket({ actor, companyId, createdBy, subject, body, category = 'General', priority = 'normal', contacts = {}, siteId = null, files = [] }) {
  const staff = isStaff(actor);
  const ts = now();
  const c = (k) => contacts[k] || null;
  const r = await db.query(
    `INSERT INTO tickets (company_id, created_by, subject, category, priority, status, first_response_at, created_at, updated_at, last_activity_at,
       om_name, om_phone, fse_name, fse_phone, site_id)
     VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [companyId, createdBy, subject, category, priority, staff ? ts : null, ts, ts, ts, c('om_name'), c('om_phone'), c('fse_name'), c('fse_phone'), siteId]
  );
  const t = await getTicket(r.insertId);
  await addMessage(t, actor, { body, files });
  realtime.toTicket(t, 'ticket:new', { ticket: t });
  notify.ticketCreated(t, actor, body, files.length, staff);
  return t;
}

// Adds a reply and applies the usual side effects: first response, auto-assign, reopen and notifications.
// Used by the portal and by inbound email.
async function postReply(t, user, { body, internal = false, files = [], cc = [], bcc = [], kind = 'message', timeSpent = null }) {
  const staff = !user.external && isStaff(user);
  const message = await addMessage(t, user, { body, internal, files, cc, bcc, kind, timeSpent });
  if (!user.external) await markRead(t, user);

  const fields = {};
  let newStatus = null;
  if (!internal) {
    if (staff) {
      if (!t.first_response_at) fields.first_response_at = now();
      if (!t.assigned_to) fields.assigned_to = user.id;
      if (t.status === 'open') newStatus = 'in_progress';
    } else if (['awaiting_client', 'resolved'].includes(t.status)) {
      newStatus = 'open';
    }
  }
  if (newStatus) {
    fields.status = newStatus;
    fields.resolved_at = null;
  }
  const updated = await touch(t.id, fields);
  if (fields.assigned_to) await teamNote(updated, user, `Picked up by ${user.name}.`);
  if (newStatus) await systemMessage(updated, user, `Status changed from ${STATUS_LABELS[t.status]} to ${STATUS_LABELS[newStatus]}.`);
  notify.messagePosted(updated, user, message, files.length, staff, { files });
  return { message, ticket: updated };
}

module.exports = {
  teamNote,
  TICKET_SELECT,
  getTicket,
  getMessages,
  addMessage,
  systemMessage,
  touch,
  escalate,
  archiveTranscript,
  markRead,
  getReads,
  createTicket,
  postReply,
};
