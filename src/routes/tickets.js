const router = require('express').Router();
const db = require('../db');
const notify = require('../notify');
const realtime = require('../realtime');
const transcript = require('../transcript');
const signoff = require('../signoff');
const svc = require('../services/tickets');
const { upload, cleanup } = require('../uploads');
const { requireAuth, requireStaff, requireAdmin, isStaff, canAccessTicket, STAFF_ROLES } = require('../auth');
const mailer = require('../mailer');
const { signatureFor, avatarUrl } = require('../email-template');
const { wrap, now, parseTs, HttpError, STATUSES, OPEN_STATUSES, PRIORITIES, CATEGORIES, STATUS_LABELS } = require('../util');
const config = require('../config');

router.use(requireAuth);

const PAGE_SIZE = 50;
const EMAIL_RE = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;
function emailList(v) {
  const list = String(v || '')
    .split(/[,;\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const bad = list.filter((e) => !EMAIL_RE.test(e));
  if (bad.length) throw new HttpError(400, `Not a valid email address: ${bad.join(', ')}`);
  return [...new Set(list)];
}
const clean = (v, max) => String(v ?? '').trim().slice(0, max);
const cap = (s) => s[0].toUpperCase() + s.slice(1);

// Wraps a multer route so uploaded files are removed if the handler fails.
const withFiles = (fn) =>
  wrap(async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      cleanup(req.files);
      throw err;
    }
  });

async function loadTicket(req) {
  const t = await svc.getTicket(Number(req.params.id));
  if (!canAccessTicket(req.user, t)) throw new HttpError(404, 'Ticket not found');
  return t;
}

router.get(
  '/',
  wrap(async (req, res) => {
    const u = req.user;
    const staff = isStaff(u);
    const where = [];
    const params = [];
    const openIn = `t.status IN (${db.inList(OPEN_STATUSES)})`;
    if (!staff) {
      where.push('t.company_id = ?');
      params.push(u.company_id);
    }
    switch (req.query.view || 'open') {
      case 'open':
        where.push(openIn);
        params.push(...OPEN_STATUSES);
        break;
      case 'mine':
        where.push(staff ? 't.assigned_to = ?' : 't.created_by = ?', openIn);
        params.push(u.id, ...OPEN_STATUSES);
        break;
      case 'unassigned':
        where.push('t.assigned_to IS NULL', openIn);
        params.push(...OPEN_STATUSES);
        break;
      case 'escalated':
        where.push('t.escalated = 1', openIn);
        params.push(...OPEN_STATUSES);
        break;
      case 'resolved':
        where.push("t.status IN ('resolved', 'closed')");
        break;
    }
    if (PRIORITIES.includes(req.query.priority)) {
      where.push('t.priority = ?');
      params.push(req.query.priority);
    }
    if (STATUSES.includes(req.query.status)) {
      where.push('t.status = ?');
      params.push(req.query.status);
    }
    if (staff && req.query.company_id) {
      where.push('t.company_id = ?');
      params.push(Number(req.query.company_id));
    }
    const q = clean(req.query.q, 100);
    if (q) {
      if (/^#?\d+$/.test(q)) {
        where.push('t.id = ?');
        params.push(Number(q.replace('#', '')));
      } else {
        // Also matches text inside the conversation (internal notes only for staff).
        where.push(
          `(t.subject LIKE ? OR c.name LIKE ? OR cu.name LIKE ? OR EXISTS (
             SELECT 1 FROM messages sm WHERE sm.ticket_id = t.id AND sm.kind = 'message' ${staff ? '' : 'AND sm.is_internal = 0'} AND sm.body LIKE ?))`
        );
        params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
      }
    }
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const rows = await db.query(
      `${svc.TICKET_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY t.last_activity_at DESC LIMIT ? OFFSET ?`,
      [...params, PAGE_SIZE + 1, (page - 1) * PAGE_SIZE]
    );
    res.json({ tickets: rows.slice(0, PAGE_SIZE), hasMore: rows.length > PAGE_SIZE, page });
  })
);

// Badge counts for the sidebar.
router.get(
  '/counts',
  wrap(async (req, res) => {
    const u = req.user;
    const staff = isStaff(u);
    const row = await db.one(
      `SELECT COUNT(*) AS open,
        SUM(CASE WHEN ${staff ? 'assigned_to' : 'created_by'} = ? THEN 1 ELSE 0 END) AS mine,
        SUM(CASE WHEN assigned_to IS NULL THEN 1 ELSE 0 END) AS unassigned,
        SUM(CASE WHEN escalated = 1 THEN 1 ELSE 0 END) AS escalated
       FROM tickets WHERE status IN (${db.inList(OPEN_STATUSES)}) ${staff ? '' : 'AND company_id = ?'}`,
      [u.id, ...OPEN_STATUSES, ...(staff ? [] : [u.company_id])]
    );
    res.json(Object.fromEntries(Object.entries(row).map(([k, v]) => [k, Number(v) || 0])));
  })
);

router.post(
  '/',
  upload.array('files'),
  withFiles(async (req, res) => {
    const u = req.user;
    const staff = isStaff(u);
    const subject = clean(req.body.subject, 255).replace(/[\r\n\t]+/g, ' '); // subjects go into email headers
    const body = clean(req.body.body, 50000);
    if (!subject || !body) throw new HttpError(400, 'Subject and description are required');
    const priority = PRIORITIES.includes(req.body.priority) ? req.body.priority : 'normal';
    const category = CATEGORIES.includes(req.body.category) ? req.body.category : 'General';

    let companyId = u.company_id;
    let createdBy = u.id;
    if (staff) {
      companyId = Number(req.body.company_id);
      if (!(await db.one('SELECT id FROM companies WHERE id = ?', [companyId]))) throw new HttpError(400, 'Choose a company');
      if (req.body.requester_id) {
        const requester = await db.one('SELECT id FROM users WHERE id = ? AND company_id = ?', [Number(req.body.requester_id), companyId]);
        if (!requester) throw new HttpError(400, 'Requester does not belong to that company');
        createdBy = requester.id;
      }
    }
    if (!companyId) throw new HttpError(400, 'Your account is not linked to a company. Please contact support.');

    const t = await svc.createTicket({ actor: u, companyId, createdBy, subject, body, category, priority, files: req.files });
    res.status(201).json({ ticket: t });
  })
);

router.get(
  '/:id',
  wrap(async (req, res) => {
    const t = await loadTicket(req);
    const staff = isStaff(req.user);
    await svc.markRead(t, req.user);
    const [messages, transcripts, reads, rating, visits] = await Promise.all([
      svc.getMessages(t.id, staff),
      staff
        ? db.query(
            `SELECT tr.id, tr.filename, tr.size, tr.message_count, tr.reason, tr.created_at, u.name AS created_by_name
             FROM transcripts tr LEFT JOIN users u ON u.id = tr.created_by WHERE tr.ticket_id = ? ORDER BY tr.id DESC`,
            [t.id]
          )
        : [],
      svc.getReads(t.id),
      db.one('SELECT r.*, u.name AS user_name FROM ticket_ratings r LEFT JOIN users u ON u.id = r.user_id WHERE r.ticket_id = ?', [t.id]),
      db.query(
        `SELECT v.*, u.name AS technician_name FROM site_visits v LEFT JOIN users u ON u.id = v.technician_id
         WHERE v.ticket_id = ? ORDER BY v.scheduled_at DESC`,
        [t.id]
      ),
    ]);
    // Visit notes are instructions for the technician (access codes, contacts), so clients do not get them.
    const visibleVisits = staff ? visits : visits.map((v) => ({ ...v, notes: null, created_by: null }));
    res.json({ ticket: t, messages, transcripts, reads, rating, visits: visibleVisits, signoff: staff ? await signoff.state(t) : { active: signoff.pending(t) } });
  })
);

router.post(
  '/:id/messages',
  upload.array('files'),
  withFiles(async (req, res) => {
    const u = req.user;
    const staff = isStaff(u);
    const t = await loadTicket(req);
    const body = clean(req.body.body, 50000);
    if (!body && !req.files.length) throw new HttpError(400, 'Write a message or attach a file');
    if (!staff && t.status === 'closed') throw new HttpError(400, 'This ticket is closed. Please open a new ticket.');
    const internal = staff && ['1', 'true'].includes(String(req.body.internal));
    // Admins can copy other people into a reply; it is then emailed from their own mailbox with the files attached.
    const cc = !internal && u.role === 'admin' ? emailList(req.body.cc) : [];
    const bcc = !internal && u.role === 'admin' ? emailList(req.body.bcc) : [];
    if (cc.length + bcc.length > 50) throw new HttpError(400, 'Too many CC/BCC recipients (50 at most)');
    const result = await svc.postReply(t, u, { body: body || '(attachment)', internal, files: req.files, cc, bcc });
    res.status(201).json(result);
  })
);

// Authors can correct their own messages. Edits are marked as edited and do not send new emails.
router.patch(
  '/:id/messages/:messageId',
  wrap(async (req, res) => {
    const u = req.user;
    const t = await loadTicket(req);
    const m = await db.one('SELECT * FROM messages WHERE id = ? AND ticket_id = ?', [Number(req.params.messageId), t.id]);
    if (!m || m.kind !== 'message') throw new HttpError(404, 'Message not found');
    if (Number(m.user_id) !== u.id) throw new HttpError(403, 'You can only edit your own messages');
    if (t.status === 'closed') throw new HttpError(400, 'Messages on closed tickets cannot be edited');
    const body = clean(req.body.body, 50000);
    if (!body) throw new HttpError(400, 'A message cannot be empty');
    const ts = now();
    await db.query('UPDATE messages SET body = ?, edited_at = ? WHERE id = ?', [body, ts, m.id]);
    const [message] = (await svc.getMessages(t.id, true)).filter((x) => x.id === m.id);
    realtime.toTicket(t, 'message:updated', { ticketId: t.id, message }, { internal: !!Number(m.is_internal) });
    res.json({ message });
  })
);

// Satisfaction rating, given by the client once the ticket is resolved or closed. It can be changed later.
router.post(
  '/:id/rating',
  wrap(async (req, res) => {
    const u = req.user;
    const t = await loadTicket(req);
    if (isStaff(u)) throw new HttpError(403, 'Only clients can rate support');
    if (!['resolved', 'closed'].includes(t.status)) throw new HttpError(400, 'You can rate a ticket once it has been resolved');
    const rating = Number(req.body.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new HttpError(400, 'Choose a rating from 1 to 5');
    const comment = clean(req.body.comment, 2000) || null;
    const existing = await db.one('SELECT ticket_id FROM ticket_ratings WHERE ticket_id = ?', [t.id]);
    const ts = now();
    if (existing) {
      await db.query('UPDATE ticket_ratings SET user_id = ?, rating = ?, comment = ?, updated_at = ? WHERE ticket_id = ?', [u.id, rating, comment, ts, t.id]);
    } else {
      await db.query('INSERT INTO ticket_ratings (ticket_id, user_id, rating, comment, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [t.id, u.id, rating, comment, ts, ts]);
      await svc.systemMessage(t, u, `${u.name} rated this ticket ${rating} out of 5.`);
    }
    notify.ratingReceived(t, u, rating, comment);
    realtime.toTicket(t, 'ticket:update', { ticket: await svc.getTicket(t.id) });
    res.json({ rating: { ticket_id: t.id, user_id: u.id, user_name: u.name, rating, comment, created_at: ts, updated_at: ts } });
  })
);

router.patch(
  '/:id',
  wrap(async (req, res) => {
    const u = req.user;
    const staff = isStaff(u);
    const t = await loadTicket(req);
    const b = req.body || {};
    const fields = {};
    const notes = [];
    let statusTo = null;
    let assignee = null;

    if (b.status !== undefined && b.status !== t.status) {
      if (!STATUSES.includes(b.status)) throw new HttpError(400, 'Invalid status');
      const clientAllowed =
        (b.status === 'resolved' && OPEN_STATUSES.includes(t.status)) || (b.status === 'open' && t.status === 'resolved');
      if (!staff && !clientAllowed) throw new HttpError(403, 'You cannot make that change');
      // Closing goes through sign-off: mark the ticket resolved and other admins approve it.
      if (b.status === 'closed' && (await signoff.requiredFor(u.id)) > 0) {
        throw new HttpError(409, signoff.pending(t)
          ? 'This ticket is waiting for sign-off. It closes once the other admins approve it.'
          : 'Mark the ticket as Resolved first. It closes once two other admins sign it off.');
      }
      fields.status = b.status;
      fields.resolved_at = ['resolved', 'closed'].includes(b.status) ? t.resolved_at || now() : null;
      statusTo = b.status;
      notes.push(`Status changed from ${STATUS_LABELS[t.status]} to ${STATUS_LABELS[b.status]}.`);
    }
    if (staff && b.priority !== undefined && b.priority !== t.priority) {
      if (!PRIORITIES.includes(b.priority)) throw new HttpError(400, 'Invalid priority');
      fields.priority = b.priority;
      notes.push(`Priority changed from ${cap(t.priority)} to ${cap(b.priority)}.`);
    }
    if (staff && b.category !== undefined && b.category !== t.category) {
      if (!CATEGORIES.includes(b.category)) throw new HttpError(400, 'Invalid category');
      fields.category = b.category;
      notes.push(`Category changed to ${b.category}.`);
    }
    if (staff && b.assigned_to !== undefined) {
      const id = b.assigned_to ? Number(b.assigned_to) : null;
      if (id !== (t.assigned_to ? Number(t.assigned_to) : null)) {
        if (id) {
          assignee = await db.one(`SELECT id, name FROM users WHERE id = ? AND role IN (${db.inList(STAFF_ROLES)}) AND is_active = 1`, [id, ...STAFF_ROLES]);
          if (!assignee) throw new HttpError(400, 'Invalid assignee');
        }
        fields.assigned_to = id;
        notes.push(assignee ? `Assigned to ${assignee.name}.` : 'Ticket unassigned.');
      }
    }

    let updated = Object.keys(fields).length ? await svc.touch(t.id, fields) : t;
    for (const n of notes) await svc.systemMessage(updated, u, n);

    if (b.escalate === true) {
      if (!staff && t.escalated) throw new HttpError(400, 'This ticket is already escalated');
      const reason = clean(b.reason, 500) || (staff ? `Escalated by ${u.name}.` : `Escalation requested by ${u.name} (${t.company_name}).`);
      updated = await svc.escalate(updated, u, reason);
    } else if (b.escalate === false && staff && t.escalated) {
      updated = await svc.touch(t.id, { escalated: 0 });
      await svc.systemMessage(updated, u, 'Escalation cleared.');
    }

    // A new resolution asks the other admins to sign off before the ticket can close.
    if (statusTo === 'resolved') updated = await signoff.start(updated, u);

    if (statusTo) {
      notify.statusChanged(updated, u, t.status, statusTo, staff);
      if (['resolved', 'closed'].includes(statusTo)) {
        svc.archiveTranscript(updated, u, statusTo).catch((err) => console.error('[transcript] archive failed', err));
      }
    }
    if (assignee) notify.assigned(updated, u);
    res.json({ ticket: updated });
  })
);

const EXPORTS = {
  html: ['text/html', transcript.toHtml],
  txt: ['text/plain', transcript.toText],
  json: ['application/json', transcript.toJson],
};

router.get(
  '/:id/export',
  wrap(async (req, res) => {
    const t = await loadTicket(req);
    const [type, build] = EXPORTS[req.query.format] || EXPORTS.html;
    const ext = EXPORTS[req.query.format] ? req.query.format : 'html';
    const includeInternal = isStaff(req.user) && req.query.internal !== '0';
    const messages = await svc.getMessages(t.id, includeInternal);
    res.attachment(`ticket-${t.id}-transcript.${ext}`);
    res.type(type).send(build(t, messages, { includeInternal }));
  })
);

// Admins can send a ticket on to anyone (a vendor, a manager, a colleague without an account): its details, the
// conversation so far and the full transcript attached. Internal notes are never included.
router.post(
  '/:id/email',
  requireAdmin,
  wrap(async (req, res) => {
    const t = await loadTicket(req);
    const list = (v) => [...new Set((Array.isArray(v) ? v : String(v || '').split(/[,;\s]+/)).map((s) => String(s).trim().toLowerCase()).filter(Boolean))];
    const to = list(req.body.to);
    const cc = list(req.body.cc);
    const bad = [...to, ...cc].filter((e) => !EMAIL_RE.test(e));
    if (bad.length) throw new HttpError(400, `Not a valid email address: ${bad.join(', ')}`);
    if (!to.length) throw new HttpError(400, 'Add at least one recipient');
    if (to.length + cc.length > 20) throw new HttpError(400, 'Send to 20 people at most');
    const note = clean(req.body.note, 5000);

    const messages = await svc.getMessages(t.id, false);
    const when = (ts) => parseTs(ts).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: config.timezone });
    const conversation = messages
      .filter((m) => m.kind === 'message')
      .slice(-10)
      .map((m) => `${m.user_name || m.sender_name || 'Unknown'}, ${when(m.created_at)}:\n${m.body}`)
      .join('\n\n');
    const u = req.user;
    const { html, text } = mailer.render({
      heading: `Ticket #${t.id}: ${t.subject}`,
      icon: 'ticket',
      status: t.status,
      greeting: 'Hello,',
      intro: `${u.name} has shared a support ticket with you.`,
      paragraphs: note ? [note] : [],
      details: [
        ['Company', t.company_name],
        ['Raised by', t.creator_name || '-'],
        ['Status', STATUS_LABELS[t.status]],
        ['Priority', cap(t.priority)],
        ['Category', t.category],
        ['Handled by', t.assignee_name || 'Not yet assigned'],
        ['Opened', when(t.created_at)],
      ],
      quote: conversation || null,
      quoteLabel: messages.length > 10 ? 'Latest messages (the full conversation is attached)' : 'Conversation',
      signature: signatureFor(u),
      signatureAvatar: avatarUrl(u),
      footer: 'shared',
    });
    mailer.send({
      to: to.join(', '),
      cc,
      subject: `Ticket #${t.id}: ${t.subject}`,
      html,
      text,
      sender: u,
      replyTo: u.email,
      attachments: [{ filename: `ticket-${t.id}-conversation.html`, content: transcript.toHtml(t, messages, { includeInternal: false }), contentType: 'text/html' }],
    });
    // A note for the team (never shown to the client) recording who it went to.
    await svc.addMessage(t, u, { body: `${u.name} emailed this ticket to ${[...to, ...cc].join(', ')}.${note ? ` Note: ${note}` : ''}`, internal: true, kind: 'system' });
    res.json({ ok: true, sentTo: [...to, ...cc] });
  })
);

// An admin approves a resolved ticket, or sends it back to be worked on with a reason.
router.post(
  '/:id/signoff',
  requireAdmin,
  wrap(async (req, res) => {
    const t = await loadTicket(req);
    const decision = req.body.decision === 'approve' ? 'approved' : req.body.decision === 'reject' ? 'rejected' : null;
    const result = await signoff.decide(t, req.user, decision, clean(req.body.comment, 2000));
    res.json({ ticket: result.ticket, closed: result.closed, signoff: await signoff.state(result.ticket) });
  })
);

router.post(
  '/:id/archive',
  requireStaff,
  wrap(async (req, res) => {
    const t = await loadTicket(req);
    const saved = await svc.archiveTranscript(t, req.user, 'manual');
    res.status(201).json(saved);
  })
);

module.exports = router;
