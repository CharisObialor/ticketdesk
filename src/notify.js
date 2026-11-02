const config = require('./config');

// "45 minutes", "1 hour 30 minutes", "2 days" (matches the portal's wording).
function visitDuration(min) {
  if (min >= 1440 && min % 1440 === 0) return min === 10080 ? '1 week' : `${min / 1440} day${min === 1440 ? '' : 's'}`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return [h && `${h} hour${h === 1 ? '' : 's'}`, m && `${m} minute${m === 1 ? '' : 's'}`].filter(Boolean).join(' ') || '0 minutes';
}
const db = require('./db');
const mailer = require('./mailer');
const inapp = require('./inapp');
const path = require('path');
const { replyAddress, ticketReplyAddress, unsubscribeUrl } = require('./replyto');
const { signatureFor, avatarUrl } = require('./email-template');
const { uploadsDir } = require('./uploads');
const { STATUS_LABELS } = require('./util');
const { STAFF_ROLES } = require('./auth');
const privacy = require('./privacy');

const ticketPath = (id) => `/tickets/${id}`;
const ticketUrl = (id) => `${config.appUrl}${ticketPath(id)}`;
const loginUrl = (token) => `${config.appUrl}/login?token=${token}`;
const excerpt = (s, n = 1200) => (s && s.length > n ? s.slice(0, n) + '...' : s || '');
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || 'there';
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// One subject per ticket (follow-ups prefixed "Re:") so every email about a ticket lands in the same thread.
const subjectFor = (t, followUp = true) => `${followUp ? 'Re: ' : ''}[Ticket #${t.id}] ${t.subject}`;

const visitTime = (ts) =>
  new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: config.timezone,
    timeZoneName: 'short',
  }).format(new Date(String(ts).replace(' ', 'T') + 'Z'));

function details(t, { internal = false } = {}) {
  const rows = [
    ['Ticket', `#${t.id}`],
    ['Subject', t.subject],
    ['Status', STATUS_LABELS[t.status] || t.status],
    ['Priority', cap(t.priority)],
    ['Category', t.category],
  ];
  if (internal) rows.splice(2, 0, ['Company', t.company_name || '-'], ['Requester', t.creator_name || '-']);
  if (t.site_code) rows.push(['Site', [t.site_code, t.site_location].filter(Boolean).join(', ')]);
  const contact = (name, phone) => [name, phone].filter(Boolean).join(', ');
  if (t.om_name || t.om_phone) rows.push(['OM', contact(t.om_name, t.om_phone)]);
  if (t.fse_name || t.fse_phone) rows.push(['FSE', contact(t.fse_name, t.fse_phone)]);
  // Clients are never told which engineer has their ticket.
  rows.push(['Assigned to', internal ? t.assignee_name || 'Unassigned' : 'Our support team']);
  return rows;
}

// Recipients include everyone relevant; `notify_email` decides whether they also get an email.
const USER_COLS = 'id, name, email, role, notify_email, notify_prefs, last_seen_at';

// Admins with the portal open see updates in the bell, so they are not emailed. An admin who left less than
// ADMIN_AWAY_MINUTES ago gets the email only if they are still away by then; after that, straight away.
function adminEmailTiming(r) {
  if (r.role !== 'admin') return { send: true };
  if (require('./realtime').isOnline(r.id)) return { send: false };
  const away = config.adminAwayMinutes * 60000;
  const seen = r.last_seen_at ? new Date(`${String(r.last_seen_at).replace(' ', 'T')}Z`).getTime() : 0;
  if (seen && Date.now() - seen < away) return { send: true, holdUntil: new Date(seen + away), awayUserId: r.id };
  return { send: true };
}

// What people can switch off, by email and in the bell. Account, security and one-time code emails always go.
const KIND_CATEGORY = {
  ticket_created: 'created',
  reply: 'replies',
  work_update: 'replies',
  status: 'status',
  escalation_request: 'status',
  visit: 'visits',
  group: 'chats',
  assigned: 'assignments',
  escalated: 'escalations',
  rating: 'ratings',
  signoff: 'signoffs',
};
function wants(user, kind, channel) {
  const cat = KIND_CATEGORY[kind];
  if (!cat || !user.notify_prefs) return true;
  try {
    const p = JSON.parse(user.notify_prefs);
    return !(p[cat] && p[cat][channel] === false);
  } catch {
    return true;
  }
}

async function staff({ adminsOnly = false } = {}) {
  const roles = adminsOnly ? ['admin'] : STAFF_ROLES;
  return db.query(`SELECT ${USER_COLS} FROM users WHERE role IN (${db.inList(roles)}) AND is_active = 1`, roles);
}

async function activeUser(id) {
  if (!id) return null;
  return db.one(`SELECT ${USER_COLS} FROM users WHERE id = ? AND is_active = 1`, [id]);
}

// Staff who should hear about client activity: the assignee if any, otherwise every staff member.
async function ticketWatchers(t) {
  const assignee = await activeUser(t.assigned_to);
  return assignee ? [assignee] : staff();
}

/**
 * Notifies each recipient once (skipping the actor unless includeActor): an in-app notification always,
 * and an email when they have email notifications on. Ticket emails carry a personal reply-to address.
 */
// Icon shown at the top of each kind of email.
const KIND_ICON = { ticket_created: 'ticket', reply: 'reply', escalated: 'alert', assigned: 'ticket', rating: 'star', visit: 'calendar', group: 'group' };
const statusIcon = (status) => (['resolved', 'closed'].includes(status) ? 'check' : status === 'awaiting_client' ? 'clock' : 'ticket');

function sendEach(recipients, actor, build, { ticket, ticketId, includeActor = false, kind = 'ticket', link, email = true } = {}) {
  const seen = new Set();
  for (const r of recipients) {
    if (!r || seen.has(r.id) || (!includeActor && actor && r.id === actor.id)) continue;
    seen.add(r.id);
    let { subject, inAppTitle, ...content } = build(r);
    // A technician's name never reaches a client, whatever the message says.
    if (r.role === 'client' && actor && privacy.hidden(actor.role) && actor.name) {
      const hide = (v) =>
        typeof v === 'string' ? v.split(actor.name).join(privacy.TEAM) : Array.isArray(v) ? v.map(hide) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, hide(x)])) : v;
      ({ subject, inAppTitle, ...content } = hide({ subject, inAppTitle, ...content }));
    }
    if (wants(r, kind, 'inapp')) {
      inapp
        .create(r.id, { kind, title: inAppTitle || content.heading, body: content.intro, link: link || (ticketId ? ticketPath(ticketId) : null) })
        .catch((err) => console.error('[notify] in-app failed', err.message));
    }
    if (!email || !Number(r.notify_email) || !wants(r, kind, 'email')) continue;
    const timing = adminEmailTiming(r);
    if (!timing.send) continue;
    const reply = ticketId ? replyAddress(ticketId, r.id) : null;
    // Emails an admin triggers go out from their own mailbox (Microsoft 365); replies still come back to the ticket.
    // Agents and technicians send through the system mailbox.
    const sender = actor && actor.role === 'admin' ? { name: actor.name, email: actor.email } : undefined;
    const design = {
      icon: content.icon || (kind === 'status' && ticket ? statusIcon(ticket.status) : KIND_ICON[kind]),
      status: ticket ? ticket.status : undefined,
      // Clients see where their ticket is in the process.
      showProgress: !!ticket && r.role === 'client',
      signature: sender ? signatureFor(actor) : undefined,
      signatureAvatar: sender ? avatarUrl(actor) : undefined,
      quoteAvatar: avatarUrl(actor),
    };
    mailer.send({
      to: r.email,
      subject,
      ticketId,
      holdUntil: timing.holdUntil,
      awayUserId: timing.awayUserId,
      sender,
      // Nobody triggered it (auto-close, a rule, a sign-off finishing): it comes from the system mailbox.
      system: !actor || actor.role === 'system',
      replyTo: reply || undefined,
      unsubscribeUrl: unsubscribeUrl(r.id),
      ...mailer.render({ ...design, ...content, replyable: !!reply, unsubscribeUrl: unsubscribeUrl(r.id) }),
    });
  }
}

// What the requester is told when their ticket moves to each status.
const CLIENT_STATUS_COPY = {
  open: {
    heading: 'Your ticket has been reopened',
    body: 'Your ticket is open again and our support team will follow up shortly.',
  },
  in_progress: {
    heading: 'We are working on your ticket',
    body: 'A member of our support team is now working on your request. We will keep you updated on progress.',
  },
  awaiting_client: {
    heading: 'We need more information from you',
    body: 'Our support team is waiting for your response before we can continue. Please review the latest message on the ticket and reply.',
  },
  resolved: {
    heading: 'Your ticket has been resolved',
    body: 'We believe your request has been resolved. If the issue persists or you have further questions, reply to reopen the ticket.',
  },
  closed: {
    heading: 'Your ticket has been closed',
    body: 'This ticket is now closed and can no longer receive replies. If you need further help, please raise a new ticket in the portal.',
  },
};

const ratingLinks = (t) => [1, 2, 3, 4, 5].map((value) => ({ value, url: `${ticketUrl(t.id)}?rate=${value}` }));

module.exports = {
  // New ticket: acknowledge the requester and alert the support team.
  async ticketCreated(t, actor, body, fileCount, actorIsStaff) {
    const attachments = fileCount ? ` It includes ${plural(fileCount, 'attachment')}.` : '';

    // Staff who raise a ticket without naming a client contact are recorded as the requester; they need no confirmation.
    const requester = actorIsStaff && Number(t.created_by) === actor.id ? null : await activeUser(t.created_by);
    sendEach(
      [requester],
      actor,
      (r) => ({
        subject: subjectFor(t, false),
        heading: actorIsStaff ? 'A support ticket has been opened for you' : 'We have received your request',
        inAppTitle: actorIsStaff ? `Ticket #${t.id} opened for you` : `Ticket #${t.id} received`,
        greeting: `Dear ${firstName(r.name)},`,
        intro: actorIsStaff
          ? `${actor.name} from our support team has opened ticket #${t.id} on your behalf.`
          : `Thank you for contacting support. Your request has been logged as ticket #${t.id} and our team will respond as soon as possible.`,
        paragraphs: ['You will receive an email whenever there is an update. You can reply to these emails or use the portal to add information at any time.'],
        details: details(t),
        quote: excerpt(body),
        quoteLabel: 'Your request',
        ctaUrl: ticketUrl(t.id),
        ctaLabel: 'View ticket',
      }),
      { ticket: t, ticketId: t.id, includeActor: true, kind: 'ticket_created' }
    );

    sendEach(await staff(), actor, (r) => ({
      subject: subjectFor(t, false),
      heading: `New ticket from ${t.company_name}`,
      inAppTitle: `New ticket #${t.id}: ${t.subject}`,
      greeting: `Dear ${firstName(r.name)},`,
      intro: actorIsStaff
        ? `${actor.name} opened a ticket on behalf of ${t.creator_name || t.company_name}.${attachments}`
        : `${actor.name} opened a new ticket.${attachments} It is waiting to be picked up.`,
      details: details(t, { internal: true }),
      quote: excerpt(body),
      quoteLabel: 'Description',
      ctaUrl: ticketUrl(t.id),
      ctaLabel: 'View ticket',
    }), { ticket: t, ticketId: t.id, kind: 'ticket_created' });
  },

  // Public reply: staff replies go to the requester; client replies go to the assignee (or all staff).
  async messagePosted(t, actor, message, fileCount, actorIsStaff, { files = [] } = {}) {
    if (message.is_internal) return; // internal notes never notify the client

    // An admin reply with CC/BCC is a real email: one message from the admin's mailbox to the client and the
    // extra recipients, with the files attached. Anyone replying to it (CC'd people included) lands on the ticket.
    if (actorIsStaff && (message.cc || message.bcc)) {
      const requester = await activeUser(t.created_by);
      const to = requester && requester.id !== actor.id ? requester.email : (message.cc || [])[0];
      const cc = (message.cc || []).filter((e) => e !== to);
      if (requester && requester.id !== actor.id) {
        inapp
          .create(requester.id, { kind: 'reply', title: `${actor.name} replied on #${t.id}`, body: excerpt(message.body, 200), link: ticketPath(t.id) })
          .catch(() => {});
      }
      const { html, text } = mailer.render({
        heading: `Ticket #${t.id}: ${t.subject}`,
        greeting: requester && to === requester.email ? `Dear ${firstName(requester.name)},` : 'Good day,',
        paragraphs: String(message.body).split(/\n{2,}/),
        details: [
          ['Ticket', `#${t.id}`],
          ['Company', t.company_name],
          ['Status', STATUS_LABELS[t.status] || t.status],
        ],
        ctaUrl: requester && to === requester.email ? ticketUrl(t.id) : undefined,
        ctaLabel: 'View ticket',
        icon: 'reply',
        status: t.status,
        signature: signatureFor(actor),
        signatureAvatar: avatarUrl(actor),
        replyable: !!ticketReplyAddress(t.id),
      });
      mailer.send({
        to,
        cc,
        bcc: message.bcc || [],
        subject: subjectFor(t),
        ticketId: t.id,
        sender: { name: actor.name, email: actor.email },
        replyTo: ticketReplyAddress(t.id) || undefined,
        attachments: files.map((f) => ({ filename: f.originalname, path: path.join(uploadsDir, path.basename(f.filename)), contentType: f.mimetype })),
        html,
        text,
      });
      return;
    }

    const recipients = actorIsStaff ? [await activeUser(t.created_by)] : await ticketWatchers(t);
    const attachments = fileCount ? ` with ${plural(fileCount, 'attachment')}` : '';
    // A work update from the engineer: what was done, the time it took, and before/after photos.
    if (message.kind === 'work_update') {
      const count = (label) => (message.attachments || []).filter((a) => a.label === label).length;
      const photos = [count('before') && `${plural(count('before'), 'before photo')}`, count('after') && `${plural(count('after'), 'after photo')}`].filter(Boolean);
      sendEach(recipients, actor, (r) => ({
        subject: subjectFor(t),
        heading: 'Work update on your ticket',
        inAppTitle: `${privacy.nameFor(r, actor, { workUpdate: true })} posted a work update on #${t.id}`,
        greeting: `Dear ${firstName(r.name)},`,
        intro: r.role === 'client' ? `Our engineer has posted an update on the work carried out for ticket #${t.id}.` : `${actor.name} has posted an update on the work carried out for ticket #${t.id}.`,
        details: [
          ...details(t, { internal: false }),
          ...(message.time_spent_min ? [['Time spent', visitDuration(message.time_spent_min)]] : []),
          ...(photos.length ? [['Photos', photos.join(', ')]] : []),
        ],
        quote: excerpt(message.body),
        quoteLabel: 'Work carried out',
        quoteFrom: privacy.nameFor(r, actor, { workUpdate: true }),
        ctaUrl: ticketUrl(t.id),
        ctaLabel: 'View the update and photos',
      }), { ticket: t, ticketId: t.id, kind: 'reply' });
      return;
    }
    sendEach(recipients, actor, (r) => ({
      subject: subjectFor(t),
      heading: actorIsStaff ? 'New reply from our support team' : `New reply from ${t.company_name}`,
      inAppTitle: `${actor.name} replied on #${t.id}`,
      greeting: `Dear ${firstName(r.name)},`,
      intro: `${actor.name} replied to ticket #${t.id}${attachments}.`,
      details: details(t, { internal: !actorIsStaff }),
      quote: excerpt(message.body),
      quoteLabel: 'Message',
      quoteFrom: actor.name,
      ctaUrl: ticketUrl(t.id),
      ctaLabel: actorIsStaff ? 'View and reply' : 'Reply in portal',
    }), { ticket: t, ticketId: t.id, kind: 'reply' });
  },

  async statusChanged(t, actor, from, to, actorIsStaff, { auto = false } = {}) {
    if (actorIsStaff || auto) {
      const copy = CLIENT_STATUS_COPY[to];
      if (!copy) return;
      sendEach([await activeUser(t.created_by)], actor, (r) => ({
        subject: subjectFor(t),
        heading: copy.heading,
        inAppTitle: `Ticket #${t.id}: ${STATUS_LABELS[to]}`,
        greeting: `Dear ${firstName(r.name)},`,
        intro: auto && to === 'closed' ? `Ticket #${t.id} was closed automatically because it has been resolved for ${config.autoCloseDays} days with no further replies.` : copy.body,
        paragraphs:
          to === 'resolved' && Number(t.signoff_required) > 0
            ? ['Our team will review the resolution before the ticket is closed. If the problem comes back, just reply.']
            : to === 'resolved' && config.autoCloseDays > 0
              ? [`If we do not hear from you, the ticket will close automatically in ${plural(config.autoCloseDays, 'day')}.`]
              : [],
        details: details(t),
        ratingLinks: to === 'resolved' ? ratingLinks(t) : undefined,
        ctaUrl: ticketUrl(t.id),
        ctaLabel: 'View ticket',
      }), { ticket: t, ticketId: t.id, kind: 'status' });
      return;
    }
    const reopened = to === 'open';
    sendEach(await ticketWatchers(t), actor, (r) => ({
      subject: subjectFor(t),
      heading: reopened ? 'Ticket reopened by client' : `Ticket marked ${STATUS_LABELS[to]} by client`,
      greeting: `Dear ${firstName(r.name)},`,
      intro: `${actor ? actor.name : 'The client'} changed the status of ticket #${t.id} from ${STATUS_LABELS[from]} to ${STATUS_LABELS[to]}.`,
      paragraphs: reopened ? ['The client indicated the issue is not yet resolved. Please follow up.'] : [],
      details: details(t, { internal: true }),
      ctaUrl: ticketUrl(t.id),
      ctaLabel: 'View ticket',
    }), { ticket: t, ticketId: t.id, kind: 'status' });
  },

  // Sign-off: the other admins are asked to approve a resolved ticket before it can close.
  async signoffRequested(t, actor, required) {
    const admins = (await staff({ adminsOnly: true })).filter((a) => !actor || a.id !== actor.id);
    const lastReply = await db.one(
      "SELECT m.body, u.name FROM messages m LEFT JOIN users u ON u.id = m.user_id WHERE m.ticket_id = ? AND m.kind = 'message' AND m.is_internal = 0 ORDER BY m.id DESC LIMIT 1",
      [t.id]
    );
    sendEach(admins, actor, (r) => ({
      subject: `[Ticket #${t.id}] Sign-off needed: ${t.subject}`,
      heading: 'Sign-off needed',
      inAppTitle: `Sign-off needed for #${t.id}`,
      icon: 'check',
      status: 'resolved',
      greeting: `Dear ${firstName(r.name)},`,
      intro: `${actor ? actor.name : 'Someone'} marked ticket #${t.id} as resolved. It needs sign-off from ${required === 1 ? 'one admin' : `${required} admins`} before it is resolved and the client is told.`,
      paragraphs: ['Please check the resolution, then approve it or send it back with a reason.'],
      details: details(t, { internal: true }),
      quote: lastReply ? excerpt(lastReply.body) : null,
      quoteLabel: 'Latest message',
      quoteFrom: lastReply ? lastReply.name : null,
      ctaUrl: ticketUrl(t.id),
      ctaLabel: 'Review and sign off',
    }), { ticket: t, ticketId: t.id, kind: 'signoff' });
  },

  async signoffRejected(t, actor, reason) {
    const recipients = [await activeUser(t.signoff_requested_by), await activeUser(t.assigned_to)];
    sendEach(recipients, actor, (r) => ({
      subject: `[Ticket #${t.id}] Sent back: ${t.subject}`,
      heading: 'Resolution sent back',
      inAppTitle: `#${t.id} sent back by ${actor.name}`,
      icon: 'alert',
      greeting: `Dear ${firstName(r.name)},`,
      intro: `${actor.name} did not sign off ticket #${t.id}, so it stays open. The client was not told it had been resolved.`,
      quote: reason,
      quoteLabel: 'Reason',
      quoteFrom: actor.name,
      details: details(t, { internal: true }),
      ctaUrl: ticketUrl(t.id),
      ctaLabel: 'View ticket',
    }), { ticket: t, ticketId: t.id, kind: 'signoff' });
  },

  async signoffCompleted(t, approvers, outcome = 'resolved') {
    const recipients = [await activeUser(t.signoff_requested_by), await activeUser(t.assigned_to)];
    sendEach(recipients, null, (r) => ({
      subject: `[Ticket #${t.id}] Signed off and ${outcome}: ${t.subject}`,
      heading: `Ticket signed off and ${outcome}`,
      inAppTitle: `#${t.id} signed off and ${outcome}`,
      icon: 'check',
      status: outcome,
      greeting: `Dear ${firstName(r.name)},`,
      intro:
        outcome === 'resolved'
          ? `${approvers.join(' and ')} signed off ticket #${t.id}, so it is now resolved and the client has been told.`
          : `${approvers.join(' and ')} signed off ticket #${t.id}, so it is now closed.`,
      details: details(t, { internal: true }),
      ctaUrl: ticketUrl(t.id),
      ctaLabel: 'View ticket',
    }), { ticket: t, ticketId: t.id, kind: 'signoff' });
  },

  // Escalation: admins and the assignee are alerted (or whoever an escalation rule names); a client who requested
  // it gets an acknowledgement.
  async escalated(t, actor, reason, rule = null) {
    const recipients = rule
      ? [
          ...(rule.notify_admins ? await staff({ adminsOnly: true }) : []),
          ...(rule.notify_assignee ? [await activeUser(t.assigned_to)] : []),
          ...(await Promise.all((rule.notify_users || []).map((id) => activeUser(id)))),
        ].filter((u) => u && u.role !== 'client')
      : [...(await staff({ adminsOnly: true })), await activeUser(t.assigned_to)];
    sendEach(recipients, actor, (r) => ({
      subject: subjectFor(t),
      heading: `Ticket escalated to level ${t.escalation_level}`,
      inAppTitle: `Ticket #${t.id} escalated`,
      greeting: `Dear ${firstName(r.name)},`,
      intro: `Ticket #${t.id} has been escalated and needs attention.`,
      quote: reason,
      quoteLabel: 'Reason',
      details: details(t, { internal: true }),
      ctaUrl: ticketUrl(t.id),
      ctaLabel: 'Review ticket',
    }), { ticket: t, ticketId: t.id, kind: 'escalated' });

    if (actor && actor.role === 'client') {
      sendEach([await activeUser(actor.id)], actor, (r) => ({
        subject: subjectFor(t),
        heading: 'Your escalation request has been received',
        greeting: `Dear ${firstName(r.name)},`,
        intro: `Ticket #${t.id} has been escalated to our support management team, who will review it as a priority.`,
        details: details(t),
        ctaUrl: ticketUrl(t.id),
        ctaLabel: 'View ticket',
        icon: 'alert',
      }), { ticket: t, ticketId: t.id, includeActor: true, kind: 'escalation_request' });
    }
  },

  async assigned(t, actor) {
    sendEach([await activeUser(t.assigned_to)], actor, (r) => ({
      subject: subjectFor(t),
      heading: 'A ticket has been assigned to you',
      inAppTitle: `Ticket #${t.id} assigned to you`,
      greeting: `Dear ${firstName(r.name)},`,
      intro: `${actor.name} assigned ticket #${t.id} to you.`,
      details: details(t, { internal: true }),
      ctaUrl: ticketUrl(t.id),
      ctaLabel: 'Open ticket',
    }), { ticket: t, ticketId: t.id, kind: 'assigned' });
  },

  // A client rated a ticket: the assignee always hears; admins too when the rating is low.
  async ratingReceived(t, actor, rating, comment) {
    const recipients = [await activeUser(t.assigned_to), ...(rating <= 2 ? await staff({ adminsOnly: true }) : [])];
    sendEach(recipients, actor, () => ({
      subject: subjectFor(t),
      heading: `Ticket #${t.id} rated ${rating} out of 5`,
      intro: comment ? `${actor.name}: "${excerpt(comment, 200)}"` : `${actor.name} rated the support on this ticket.`,
    }), { ticket: t, ticketId: t.id, kind: 'rating', email: false });
  },

  // A client rated an admin's handling of a job: that admin is told, and every admin hears about a low score.
  async adminRated(t, actor, admin, rating, comment) {
    const recipients = [await activeUser(admin.id), ...(rating <= 2 ? await staff({ adminsOnly: true }) : [])];
    sendEach(recipients, actor, (r) => ({
      subject: subjectFor(t),
      heading: r.id === admin.id ? `You were rated ${rating} out of 5 on ticket #${t.id}` : `${admin.name} was rated ${rating} out of 5 on ticket #${t.id}`,
      intro: comment ? `${actor.name}: "${excerpt(comment, 200)}"` : `${actor.name} rated how the job was handled.`,
    }), { ticket: t, ticketId: t.id, kind: 'rating', email: false });
  },

  // Site visits: the technician and the requester are told when a visit is booked, moved or cancelled.
  async visitChanged(visit, t, actor, change) {
    const when = visitTime(visit.scheduled_at);
    const rows = [
      ['Ticket', `#${t.id} ${t.subject}`],
      ['Date and time', when],
      ['Expected duration', visitDuration(visit.duration_min)],
      ['Location', visit.location || t.company_name],
      ['Technician', visit.technician_name || 'To be confirmed'],
    ];
    // The requester is told a visit is booked, not who is coming.
    const clientRows = rows.map(([k, v]) => (k === 'Technician' ? ['Engineer', visit.technician_id ? 'A DateHeight engineer' : 'To be confirmed'] : [k, v]));
    const verb = { scheduled: 'scheduled', rescheduled: 'rescheduled', cancelled: 'cancelled' }[change];
    sendEach([await activeUser(visit.technician_id)], actor, (r) => ({
      subject: subjectFor(t),
      heading: change === 'cancelled' ? 'Site visit cancelled' : change === 'rescheduled' ? 'Site visit rescheduled' : 'You have a new site visit',
      inAppTitle: `Site visit ${verb}: ${when}`,
      greeting: `Dear ${firstName(r.name)},`,
      intro: `${actor.name} ${verb} a site visit for ${t.company_name} (ticket #${t.id}).`,
      details: rows,
      quote: visit.notes || undefined,
      quoteLabel: 'Notes',
      ctaUrl: `${config.appUrl}/visits/${visit.id}`,
      ctaLabel: 'Open visit',
    }), { ticket: t, ticketId: t.id, kind: 'visit', link: `/visits/${visit.id}` });

    sendEach([await activeUser(t.created_by)], actor, (r) => ({
      subject: subjectFor(t),
      heading: change === 'cancelled' ? 'Your site visit has been cancelled' : change === 'rescheduled' ? 'Your site visit has been rescheduled' : 'A site visit has been scheduled',
      inAppTitle: `Site visit ${verb} for #${t.id}`,
      greeting: `Dear ${firstName(r.name)},`,
      intro:
        change === 'cancelled'
          ? `The site visit for ticket #${t.id} planned for ${when} has been cancelled. Our team will be in touch if a new visit is needed.`
          : `A technician will visit on ${when} to work on ticket #${t.id}.`,
      details: change === 'cancelled' ? clientRows.slice(0, 2) : clientRows,
      paragraphs: change === 'cancelled' ? [] : ['Please make sure someone is available to give access. Reply to this email if the time does not suit you.'],
      ctaUrl: ticketUrl(t.id),
      ctaLabel: 'View ticket',
    }), { ticket: t, ticketId: t.id, kind: 'visit' });
  },

  // Someone was added to a group conversation.
  async addedToGroup(group, actor, userIds) {
    if (!userIds.length) return;
    const recipients = await db.query(`SELECT ${USER_COLS} FROM users WHERE id IN (${db.inList(userIds)}) AND is_active = 1`, userIds);
    sendEach(recipients, actor, (r) => ({
      subject: `You were added to "${group.name}"`,
      heading: 'You have been added to a group conversation',
      inAppTitle: `${actor.name} added you to "${group.name}"`,
      greeting: `Dear ${firstName(r.name)},`,
      intro: `${actor.name} added you to the group "${group.name}" for ${group.company_name}.`,
      paragraphs: ['Group conversations let your team and our support staff discuss issues together. Open the portal to read the conversation and reply.'],
      ctaUrl: `${config.appUrl}/messages/group/${group.id}`,
      ctaLabel: 'Open conversation',
    }), { kind: 'group', link: `/messages/group/${group.id}` });
  },

  // Unread group messages summary. `groups` is [{ id, name, company_name, count, messages: [{ user_name, body }] }].
  chatDigest(user, groups) {
    if (!wants(user, 'group', 'email')) return;
    const total = groups.reduce((s, g) => s + g.count, 0);
    const lines = groups.flatMap((g) => [
      `${g.name} (${g.company_name}): ${plural(g.count, 'unread message')}`,
      ...g.messages.map((m) => `  ${m.user_name || 'Someone'}: ${excerpt(m.body, 160)}`),
    ]);
    const { html, text } = mailer.render({
      icon: 'mail',
      heading: `You have ${plural(total, 'unread message')}`,
      greeting: `Dear ${firstName(user.name)},`,
      intro: `There ${total === 1 ? 'is' : 'are'} ${plural(total, 'new message')} in your group conversations that you have not read yet.`,
      quote: lines.join('\n'),
      quoteLabel: 'Latest messages',
      ctaUrl: groups.length === 1 ? `${config.appUrl}/messages/group/${groups[0].id}` : `${config.appUrl}/messages`,
      ctaLabel: 'Read messages',
    });
    mailer.send({ system: true, to: user.email, unsubscribeUrl: unsubscribeUrl(user.id), subject: `${plural(total, 'unread message')} in ${groups.length === 1 ? `"${groups[0].name}"` : `${groups.length} conversations`}`, html, text });
  },

  // Admin actions: urgent items as soon as they appear, and the weekday morning summary.
  actionsEmail(user, items, { daily = false } = {}) {
    const label = { urgent: 'Urgent', high: 'High', normal: 'Normal' };
    const lines = items.slice(0, 25).map((i) => `${label[i.severity]}: ${i.title}\n   ${i.suggestion}`);
    if (items.length > 25) lines.push(`...and ${items.length - 25} more`);
    const urgent = items.filter((i) => i.severity === 'urgent').length;
    const { html, text } = mailer.render({
      icon: 'list',
      heading: daily ? `Your actions for today (${items.length})` : urgent === 1 ? 'An urgent item needs your attention' : `${items.length} urgent items need your attention`,
      greeting: `Good ${daily ? 'morning' : 'day'} ${firstName(user.name)},`,
      intro: daily
        ? `Here is what is waiting in the support portal${urgent ? `, including ${plural(urgent, 'urgent item')}` : ''}.`
        : 'The following needs action now:',
      quote: lines.join('\n\n'),
      ctaUrl: `${config.appUrl}/actions`,
      ctaLabel: 'Open actions',
      note: 'You can snooze or dismiss items on the Actions page. Email notifications can be turned off on your profile page.',
    });
    const subject = daily
      ? `${items.length} support action${items.length === 1 ? '' : 's'} waiting${urgent ? ` (${urgent} urgent)` : ''}`
      : `Urgent: ${items[0].title}`.slice(0, 200);
    mailer.send({ system: true, to: user.email, subject, html, text, unsubscribeUrl: unsubscribeUrl(user.id) });
  },

  // Account emails are always sent, whatever the notification preference.
  // Account created for someone. Without a password yet, the login link first lets them choose one.
  invite(user, token) {
    const hasPassword = !!user.password_hash;
    const { html, text } = mailer.render({
      icon: 'user',
      heading: 'Your account has been created',
      greeting: `Dear ${firstName(user.name)},`,
      intro: `An account has been created for you on the DateHeight support platform. You can use it to raise support requests, follow their progress and chat with our support team.`,
      details: [
        ['Sign-in email', user.email],
        ...(user.company_name ? [['Company', user.company_name]] : []),
      ],
      paragraphs: [
        hasPassword
          ? 'Click the button below to log in using the password given to you by our team.'
          : 'Click the button below to log in. You will be asked to choose a password the first time. This link expires in 72 hours.',
      ],
      ctaUrl: hasPassword ? `${config.appUrl}/login` : loginUrl(token),
      ctaLabel: 'Click here to log in',
      note: 'If you were not expecting this email, you can ignore it.',
      footer: 'account',
    });
    mailer.send({ system: true, to: user.email, subject: `Your ${config.appName} account has been created`, html, text });
  },

  passwordReset(user, token) {
    const { html, text } = mailer.render({
      icon: 'lock',
      heading: 'Reset your password',
      greeting: `Dear ${firstName(user.name)},`,
      intro: 'We received a request to reset the password for your support portal account. Use the button below to choose a new password. This link expires in 1 hour.',
      ctaUrl: loginUrl(token),
      ctaLabel: 'Reset password',
      note: 'If you did not request a password reset, you can ignore this email. Your password will not change.',
      footer: 'account',
    });
    mailer.send({ system: true, to: user.email, subject: `Reset your ${config.appName} password`, html, text, urgent: true });
  },

  // Monthly statement for a client company: last month's figures, with a link to the Performance page.
  statement(company, people, stats, monthLabel) {
    const k = stats.kpis;
    const time = (m) => (m === null ? '-' : m >= 1440 ? `${Math.round((m / 1440) * 10) / 10} days` : m >= 60 ? `${Math.round((m / 60) * 10) / 10} hours` : `${m} minutes`);
    const pct = (p) => (p === null ? '-' : `${p}%`);
    const rows = [
      ['Tickets raised', String(k.raised)],
      ['Tickets resolved', String(k.resolved)],
      ['Still open', String(k.openNow)],
      ['First reply on time', pct(k.responsePct)],
      ['Resolved on time', pct(k.resolutionPct)],
      ['Average first reply', time(k.avgFirstResponseMin)],
      ['Average time to resolve', time(k.avgResolutionMin)],
      ['Site visits', `${k.visitsCompleted} completed of ${k.visits}`],
      ...(k.ratings ? [['Your rating of our support', `${k.avgRating} out of 5 (${k.ratings})`]] : []),
    ];
    const top = stats.byCategory.slice(0, 3).map((c) => `${c.name} (${c.total})`).join(', ');
    for (const p of people) {
      const { html, text } = mailer.render({
        icon: 'ticket',
        heading: `${company.name}: support statement for ${monthLabel}`,
        greeting: `Dear ${firstName(p.name)},`,
        intro: `Here is a summary of the support we provided ${company.name} in ${monthLabel}.`,
        details: rows,
        paragraphs: top ? [`Most common issues: ${top}.`] : [],
        ctaUrl: `${config.appUrl}/performance`,
        ctaLabel: 'See the full figures',
        note: 'You can save the full figures as a PDF from the Performance page. You receive this statement because your company asked for it; contact us to stop it.',
        footer: 'account',
      });
      mailer.send({ system: true, to: p.email, subject: `${company.name} support statement, ${monthLabel}`, html, text });
    }
  },

  // The one-time code that confirms a password change from the Profile page.
  passwordCode(user, code, minutes) {
    const { html, text } = mailer.render({
      icon: 'lock',
      heading: 'Your code to change your password',
      greeting: `Dear ${firstName(user.name)},`,
      intro: `Use this code to confirm the new password for your support portal account. It expires in ${minutes} minutes and can be used once.`,
      quote: code.replace(/(\d{3})(\d{3})/, '$1 $2'),
      quoteLabel: 'Your code',
      note: 'If you did not ask to change your password, ignore this email and your password stays the same. Never share this code with anyone, including our staff.',
      footer: 'account',
    });
    mailer.send({ system: true, to: user.email, subject: `${code} is your ${config.appName} code`, html, text, urgent: true });
  },

  passwordChanged(user) {
    const { html, text } = mailer.render({
      icon: 'lock',
      heading: 'Your password has been changed',
      greeting: `Dear ${firstName(user.name)},`,
      intro: `The password for your support portal account (${user.email}) was changed on ${new Date().toUTCString()}.`,
      paragraphs: ['If you made this change, no further action is needed.'],
      note: 'If you did not change your password, reset it immediately using the "Forgot password" link on the sign-in page and contact our support team.',
      ctaUrl: `${config.appUrl}/login`,
      ctaLabel: 'Go to sign in',
      footer: 'account',
    });
    mailer.send({ system: true, to: user.email, subject: `Your ${config.appName} password was changed`, html, text });
  },
};
