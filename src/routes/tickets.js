const router = require('express').Router();
const db = require('../db');
const notify = require('../notify');
const realtime = require('../realtime');
const transcript = require('../transcript');
const signoff = require('../signoff');
const sla = require('../sla');
const { scrub } = require('../privacy');
const svc = require('../services/tickets');
const { upload, workUpload, cleanup } = require('../uploads');
const { requireAuth, requireStaff, requireAdmin, isStaff, canAccessTicket, STAFF_ROLES } = require('../auth');
const mailer = require('../mailer');
const { signatureFor, avatarUrl } = require('../email-template');
const { wrap, now, parseTs, HttpError, STATUSES, OPEN_STATUSES, PRIORITIES, STATUS_LABELS } = require('../util');
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
    if (Number(req.query.site_id)) {
      where.push('t.site_id = ?');
      params.push(Number(req.query.site_id));
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

// The client's site contacts: Operations Manager (OM) and Field Service Engineer (FSE). Only companies with
// site_contacts on (Pan African Towers) use them, and every ticket for them must give both.
const SITE_CONTACTS = [
  ['om', 'Operations Manager (OM)'],
  ['fse', 'Field Service Engineer (FSE)'],
];
// With `existing` (a ticket), only the fields sent are changed and the rest keep their saved values.
function siteContacts(b, { required = false, existing = null } = {}) {
  const out = {};
  for (const [k, label] of SITE_CONTACTS) {
    if (existing && b[`${k}_name`] === undefined && b[`${k}_phone`] === undefined) continue;
    const pick = (f) => (b[f] === undefined && existing ? existing[f] : b[f]);
    const name = clean(pick(`${k}_name`), 120).replace(/\s+/g, ' ');
    const phone = clean(pick(`${k}_phone`), 40);
    if (required && !name) throw new HttpError(400, `Enter the name of the ${label}`);
    if (required && !phone) throw new HttpError(400, `Enter the phone number of the ${label}`);
    if (phone && phone.replace(/\D/g, '').length < 7) throw new HttpError(400, `Enter a valid phone number for the ${label}`);
    out[`${k}_name`] = name || null;
    out[`${k}_phone`] = phone || null;
  }
  return out;
}

// The ticket's site: one of the company's active sites. Clients must choose one when their company has sites.
async function siteFor(companyId, value, { required = false } = {}) {
  const id = Number(value) || null;
  if (!id) {
    if (required && (await db.one('SELECT id FROM sites WHERE company_id = ? AND is_active = 1 LIMIT 1', [companyId]))) {
      throw new HttpError(400, 'Choose the site ID');
    }
    return null;
  }
  const site = await db.one('SELECT id, code FROM sites WHERE id = ? AND company_id = ? AND is_active = 1', [id, companyId]);
  if (!site) throw new HttpError(400, 'Choose a site from the list');
  return site;
}

router.post(
  '/',
  upload.array('files'),
  withFiles(async (req, res) => {
    const u = req.user;
    const staff = isStaff(u);
    const subject = clean(req.body.subject, 255).replace(/[\r\n\t]+/g, ' '); // subjects go into email headers
    const body = clean(req.body.body, 50000);
    if (!subject || !body) throw new HttpError(400, 'Subject and description are required');

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
    // Companies with an SLA contract have their own fault categories, each with a set priority.
    const names = sla.categoryNames(companyId);
    const category = names.find((n) => n.toLowerCase() === String(req.body.category || '').toLowerCase()) || (names.includes('General') ? 'General' : 'Other');
    const fault = sla.categoryOf(companyId, category);
    const priority = PRIORITIES.includes(req.body.priority) ? req.body.priority : fault ? fault.priority : 'normal';

    const usesContacts = Number((await db.one('SELECT site_contacts FROM companies WHERE id = ?', [companyId]))?.site_contacts) === 1;
    const contacts = usesContacts ? siteContacts(req.body, { required: true }) : {};
    // Some faults need photos from the client (set per fault category in the company SLA).
    const photos = (req.files || []).filter((f) => /^image\//.test(f.mimetype)).length;
    if (!staff && fault && fault.photos_min && photos < fault.photos_min) {
      throw new HttpError(400, `Attach at least ${fault.photos_min} photo${fault.photos_min === 1 ? '' : 's'} of the ${fault.name} fault`);
    }
    const site = await siteFor(companyId, req.body.site_id, { required: !staff });

    const t = await svc.createTicket({ actor: u, companyId, createdBy, subject, body, category, priority, contacts, siteId: site && site.id, files: req.files });
    res.status(201).json({ ticket: t });
  })
);

router.get(
  '/:id',
  wrap(async (req, res) => {
    const t = await loadTicket(req);
    const staff = isStaff(req.user);
    await svc.markRead(t, req.user);
    const [messages, transcripts, reads, rating, adminRatings, visits] = await Promise.all([
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
      ['resolved', 'closed'].includes(t.status) ? adminRatingsFor(t) : [],
      db.query(
        `SELECT v.*, u.name AS technician_name FROM site_visits v LEFT JOIN users u ON u.id = v.technician_id
         WHERE v.ticket_id = ? ORDER BY v.scheduled_at DESC`,
        [t.id]
      ),
    ]);
    // Visit notes are instructions for the technician (access codes, contacts), so clients do not get them.
    const visibleVisits = staff ? visits : visits.map((v) => ({ ...v, notes: null, created_by: null }));
    const timeSpent = messages.reduce((n, m) => n + (Number(m.time_spent_min) || 0), 0);
    res.json({ ticket: t, messages, transcripts, reads, rating, adminRatings, visits: visibleVisits, timeSpent, signoff: staff ? await signoff.state(t) : { active: false } });
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

// Work update from the engineer handling the ticket: what was done, how long it took, and photos from before and
// after the work. The client sees it on the ticket and gets an email.
const MAX_WORK_MINUTES = 120 * 1440;
router.post(
  '/:id/work-updates',
  workUpload.array('files'),
  withFiles(async (req, res) => {
    const u = req.user;
    if (!isStaff(u)) throw new HttpError(403, 'Only the support team can post work updates');
    const t = await loadTicket(req);
    if (t.assigned_to && Number(t.assigned_to) !== u.id && u.role !== 'admin') {
      throw new HttpError(403, `This ticket is assigned to ${t.assignee_name}. Only they or an admin can post work updates.`);
    }
    if (t.status === 'closed') throw new HttpError(400, 'This ticket is closed');
    const body = clean(req.body.body, 20000);
    if (!body) throw new HttpError(400, 'Describe the work that was carried out');
    let timeSpent = null;
    if (req.body.time_spent_min !== undefined && req.body.time_spent_min !== '') {
      timeSpent = Math.round(Number(req.body.time_spent_min));
      if (!Number.isFinite(timeSpent) || timeSpent < 1 || timeSpent > MAX_WORK_MINUTES) throw new HttpError(400, 'Time spent must be between 1 minute and 120 days');
    }
    // labels[i] says whether files[i] is a "before" or "after" photo (anything else is a plain attachment).
    let labels = [];
    try {
      labels = JSON.parse(req.body.labels || '[]');
    } catch {
      labels = [];
    }
    const files = req.files.map((f, i) => ({ ...f, label: ['before', 'after'].includes(labels[i]) && /^image\//.test(f.mimetype) ? labels[i] : null }));
    const result = await svc.postReply(t, u, { body, files, kind: 'work_update', timeSpent });
    res.status(201).json(result);
  })
);

// Job message sent to an engineer by WhatsApp or text. The portal drafts it; it is sent from the admin's phone,
// and the ticket records who it went to and on what number. A number typed in is saved on the engineer's profile.
const CHANNELS = { whatsapp: 'WhatsApp', sms: 'text message', copy: 'copied message' };
router.post(
  '/:id/dispatch',
  wrap(async (req, res) => {
    const u = req.user;
    if (!isStaff(u)) throw new HttpError(403, 'Only the support team can message engineers');
    const t = await loadTicket(req);
    const channel = CHANNELS[req.body.channel] ? req.body.channel : 'copy';
    // Engineers come from the technicians contact list (they have no portal accounts).
    const engineer = await db.one('SELECT id, name, phone FROM technicians WHERE id = ? AND is_active = 1', [Number(req.body.technician_id)]);
    if (!engineer) throw new HttpError(400, 'Choose a technician from the list');
    const phone = clean(req.body.phone, 40).replace(/[^\d+ ()-]/g, '');
    if (phone && phone.replace(/\D/g, '').length < 7) throw new HttpError(400, 'Enter a valid phone number');
    // A new number typed here is saved to the technician's contact when they had none; only admins can replace one.
    if (phone && phone !== engineer.phone && (!engineer.phone || u.role === 'admin')) await db.query('UPDATE technicians SET phone = ?, updated_at = ? WHERE id = ?', [phone, now(), engineer.id]);
    const number = phone || engineer.phone;
    await svc.teamNote(t, u, `Job message for ${engineer.name}${number ? ` (${number})` : ''} sent by ${CHANNELS[channel]}.`);
    res.json({ phone: number || null });
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

// The admins a client can rate on a ticket: whoever it is assigned to, and anyone who replied to the client.
// Only admins: other staff are not rated by name (technicians are never named to clients).
const ticketAdmins = (t) =>
  db.query(
    `SELECT u.id, u.name, u.avatar, u.job_title FROM users u
     WHERE u.role = 'admin' AND (u.id = ? OR u.id IN (SELECT m.user_id FROM messages m WHERE m.ticket_id = ? AND m.is_internal = 0 AND m.kind IN ('message', 'work_update')))
     ORDER BY u.name`,
    [t.assigned_to || 0, t.id]
  );

// Each admin who handled the ticket, with the rating they got (staff see who gave it).
async function adminRatingsFor(t) {
  const [admins, given] = await Promise.all([
    ticketAdmins(t),
    db.query('SELECT r.admin_id, r.rating, r.comment, r.updated_at, u.name AS user_name FROM admin_ratings r LEFT JOIN users u ON u.id = r.user_id WHERE r.ticket_id = ?', [t.id]),
  ]);
  const byAdmin = new Map(given.map((g) => [Number(g.admin_id), g]));
  // An admin who was rated stays listed even if they are no longer on the ticket.
  const rated = given.filter((g) => !admins.some((a) => Number(a.id) === Number(g.admin_id))).map((g) => Number(g.admin_id));
  const extra = rated.length ? await db.query(`SELECT id, name, avatar, job_title FROM users WHERE id IN (${db.inList(rated)})`, rated) : [];
  return [...admins, ...extra].map((a) => {
    const g = byAdmin.get(Number(a.id));
    return {
      admin_id: Number(a.id),
      name: a.name,
      avatar_url: a.avatar ? `/avatars/${a.avatar}.png` : null,
      job_title: a.job_title || null,
      rating: g ? Number(g.rating) : null,
      comment: g ? g.comment : null,
      user_name: g ? g.user_name : null,
      updated_at: g ? g.updated_at : null,
    };
  });
}

// Clients rate each admin who handled their ticket, once it is resolved. Ratings can be changed later.
router.post(
  '/:id/admin-ratings',
  wrap(async (req, res) => {
    const u = req.user;
    const t = await loadTicket(req);
    if (isStaff(u)) throw new HttpError(403, 'Only clients can rate the team');
    if (!['resolved', 'closed'].includes(t.status)) throw new HttpError(400, 'You can rate the team once the ticket has been resolved');
    const list = Array.isArray(req.body.ratings) ? req.body.ratings.slice(0, 20) : [];
    if (!list.length) throw new HttpError(400, 'Rate at least one person');
    const allowed = new Map((await ticketAdmins(t)).map((a) => [Number(a.id), a]));
    const ts = now();
    const saved = [];
    for (const item of list) {
      const adminId = Number(item && item.admin_id);
      const admin = allowed.get(adminId);
      if (!admin) throw new HttpError(400, 'You can only rate people who handled this ticket');
      const rating = Number(item.rating);
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new HttpError(400, `Choose a rating from 1 to 5 for ${admin.name}`);
      const comment = clean(item.comment, 1000) || null;
      const prev = await db.one('SELECT rating FROM admin_ratings WHERE ticket_id = ? AND admin_id = ?', [t.id, adminId]);
      if (prev) await db.query('UPDATE admin_ratings SET user_id = ?, rating = ?, comment = ?, updated_at = ? WHERE ticket_id = ? AND admin_id = ?', [u.id, rating, comment, ts, t.id, adminId]);
      else await db.query('INSERT INTO admin_ratings (ticket_id, admin_id, user_id, rating, comment, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [t.id, adminId, u.id, rating, comment, ts, ts]);
      if (!prev || Number(prev.rating) !== rating) notify.adminRated(t, u, admin, rating, comment);
      saved.push(adminId);
    }
    await svc.teamNote(t, u, `${u.name} rated ${saved.map((id) => allowed.get(id).name).join(', ')}.`);
    res.json({ adminRatings: await adminRatingsFor(t) });
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
    const teamNotes = [];
    let statusTo = null;
    let assignee = null;

    // Marking resolved goes through sign-off: the ticket keeps its status (and the client hears nothing) until the
    // other admins approve. A lone admin, with nobody to sign off, resolves straight away.
    let askSignoff = false;
    if (b.status === 'resolved' && staff && b.status !== t.status) {
      if (signoff.pending(t)) throw new HttpError(409, 'This ticket is already waiting for sign-off.');
      if ((await signoff.requiredFor(u.id)) > 0) askSignoff = true;
    }
    if (b.status !== undefined && b.status !== t.status && !askSignoff) {
      if (!STATUSES.includes(b.status)) throw new HttpError(400, 'Invalid status');
      // Clients can reopen a resolved ticket, but only our team marks a ticket resolved.
      const clientAllowed = b.status === 'open' && t.status === 'resolved';
      if (!staff && !clientAllowed) throw new HttpError(403, 'You cannot make that change');
      // A ticket is closed once it has been resolved (after sign-off), not straight from open.
      if (b.status === 'closed' && t.status !== 'resolved' && (await signoff.requiredFor(u.id)) > 0) {
        throw new HttpError(409, signoff.pending(t)
          ? 'This ticket is waiting for sign-off. It is resolved once the other admins approve it, and can be closed after that.'
          : 'Mark the ticket as Resolved first. It is resolved once the other admins sign it off, and can be closed after that.');
      }
      fields.status = b.status;
      fields.resolved_at = ['resolved', 'closed'].includes(b.status) ? t.resolved_at || now() : null;
      statusTo = b.status;
      notes.push(`Status changed from ${STATUS_LABELS[t.status]} to ${STATUS_LABELS[b.status]}.`);
    }
    if (staff && b.priority !== undefined && b.priority !== t.priority) {
      if (!PRIORITIES.includes(b.priority)) throw new HttpError(400, 'Invalid priority');
      fields.priority = b.priority;
      teamNotes.push(`Priority changed from ${cap(t.priority)} to ${cap(b.priority)}.`);
    }
    if (staff && b.category !== undefined && b.category !== t.category) {
      if (!sla.categoryNames(t.company_id).includes(b.category)) throw new HttpError(400, 'Invalid category');
      fields.category = b.category;
      teamNotes.push(`Category changed to ${b.category}.`);
    }
    if (b.site_id !== undefined && (Number(b.site_id) || null) !== (t.site_id ? Number(t.site_id) : null)) {
      const site = await siteFor(t.company_id, b.site_id);
      fields.site_id = site ? site.id : null;
      notes.push(site ? `Site changed to ${site.code}.` : 'Site removed.');
    }
    // Companies that require the OM and FSE (Pan African Towers) cannot have them cleared later.
    const contactsRequired = Number((await db.one('SELECT site_contacts FROM companies WHERE id = ?', [t.company_id]))?.site_contacts) === 1;
    const contacts = siteContacts(b, { existing: t });
    if (contactsRequired && Object.keys(contacts).some((k) => !contacts[k])) throw new HttpError(400, 'The name and phone number of the OM and the FSE are required');
    if (Object.keys(contacts).some((k) => (contacts[k] || null) !== (t[k] || null))) {
      Object.assign(fields, contacts);
      notes.push('Site contacts updated.');
    }
    if (staff && b.assigned_to !== undefined) {
      const id = b.assigned_to ? Number(b.assigned_to) : null;
      if (id !== (t.assigned_to ? Number(t.assigned_to) : null)) {
        if (id) {
          assignee = await db.one(`SELECT id, name FROM users WHERE id = ? AND role IN (${db.inList(STAFF_ROLES)}) AND is_active = 1`, [id, ...STAFF_ROLES]);
          if (!assignee) throw new HttpError(400, 'Invalid assignee');
        }
        fields.assigned_to = id;
        teamNotes.push(assignee ? `Assigned to ${assignee.name}.` : 'Ticket unassigned.');
      }
    }

    let updated = Object.keys(fields).length ? await svc.touch(t.id, fields) : t;
    for (const n of notes) await svc.systemMessage(updated, u, n);
    for (const n of teamNotes) await svc.teamNote(updated, u, n);

    if (b.escalate === true) {
      if (!staff && t.escalated) throw new HttpError(400, 'This ticket is already escalated');
      // Clients can ask for escalation only once the agreed time to resolve has passed without a resolution.
      if (!staff) {
        if (!OPEN_STATUSES.includes(t.status)) throw new HttpError(400, 'Only open tickets can be escalated');
        const due = sla.resolutionDue(t);
        if (!due) throw new HttpError(400, 'You can request escalation once the ticket has been assigned and its agreed time to resolve has passed.');
        if (Date.now() < due.getTime()) {
          const when = due.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: config.timezone });
          throw new HttpError(400, `You can request escalation if the ticket is not resolved by ${when}, the agreed time to resolve.`);
        }
      }
      const reason = clean(b.reason, 500) || (staff ? `Escalated by ${u.name}.` : `Escalation requested by ${u.name} (${t.company_name}).`);
      updated = await svc.escalate(updated, u, reason);
    } else if (b.escalate === false && staff && t.escalated) {
      updated = await svc.touch(t.id, { escalated: 0 });
      await svc.teamNote(updated, u, 'Escalation cleared.');
    }

    // Ask the other admins to sign off the resolution.
    if (askSignoff) updated = await signoff.start(updated, u);

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
    // A client's copy leaves out our engineers' names, like everything else they see.
    const client = !isStaff(req.user);
    res.type(type).send(build(client ? scrub(t) : t, client ? scrub(messages) : messages, { includeInternal }));
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
      greeting: 'Dear colleague,',
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
    res.json({ ticket: result.ticket, resolved: result.resolved, closed: result.closed, signoff: await signoff.state(result.ticket) });
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
