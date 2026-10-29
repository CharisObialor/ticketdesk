const config = require('./config');
const db = require('./db');
const mailer = require('./mailer');
const inapp = require('./inapp');
const { replyAddress } = require('./replyto');
const { STATUS_LABELS } = require('./util');
const { STAFF_ROLES } = require('./auth');

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
  rows.push(['Assigned to', t.assignee_name || (internal ? 'Unassigned' : 'Our support team')]);
  return rows;
}

// Recipients include everyone relevant; `notify_email` decides whether they also get an email.
const USER_COLS = 'id, name, email, role, notify_email';

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
function sendEach(recipients, actor, build, { ticketId, includeActor = false, kind = 'ticket', link, email = true } = {}) {
  const seen = new Set();
  for (const r of recipients) {
    if (!r || seen.has(r.id) || (!includeActor && actor && r.id === actor.id)) continue;
    seen.add(r.id);
    const { subject, inAppTitle, ...content } = build(r);
    inapp
      .create(r.id, { kind, title: inAppTitle || content.heading, body: content.intro, link: link || (ticketId ? ticketPath(ticketId) : null) })
      .catch((err) => console.error('[notify] in-app failed', err.message));
    if (!email || !Number(r.notify_email)) continue;
    const reply = ticketId ? replyAddress(ticketId, r.id) : null;
    mailer.send({ to: r.email, subject, ticketId, replyTo: reply || undefined, ...mailer.render({ ...content, replyable: !!reply }) });
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
        greeting: `Hello ${firstName(r.name)},`,
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
      { ticketId: t.id, includeActor: true, kind: 'ticket_created' }
    );

    sendEach(await staff(), actor, (r) => ({
      subject: subjectFor(t, false),
      heading: `New ticket from ${t.company_name}`,
      inAppTitle: `New ticket #${t.id}: ${t.subject}`,
      greeting: `Hello ${firstName(r.name)},`,
      intro: actorIsStaff
        ? `${actor.name} opened a ticket on behalf of ${t.creator_name || t.company_name}.${attachments}`
        : `${actor.name} opened a new ticket.${attachments} It is waiting to be picked up.`,
      details: details(t, { internal: true }),
      quote: excerpt(body),
      quoteLabel: 'Description',
      ctaUrl: ticketUrl(t.id),
      ctaLabel: 'View ticket',
    }), { ticketId: t.id, kind: 'ticket_created' });
  },

  // Public reply: staff replies go to the requester; client replies go to the assignee (or all staff).
  async messagePosted(t, actor, message, fileCount, actorIsStaff) {
    if (message.is_internal) return; // internal notes never notify the client
    const recipients = actorIsStaff ? [await activeUser(t.created_by)] : await ticketWatchers(t);
    const attachments = fileCount ? ` with ${plural(fileCount, 'attachment')}` : '';
    sendEach(recipients, actor, (r) => ({
      subject: subjectFor(t),
      heading: actorIsStaff ? 'New reply from our support team' : `New reply from ${t.company_name}`,
      inAppTitle: `${actor.name} replied on #${t.id}`,
      greeting: `Hello ${firstName(r.name)},`,
      intro: `${actor.name} replied to ticket #${t.id}${attachments}.`,
      details: details(t, { internal: !actorIsStaff }),
      quote: excerpt(message.body),
      quoteLabel: 'Message',
      ctaUrl: ticketUrl(t.id),
      ctaLabel: actorIsStaff ? 'View and reply' : 'Reply in portal',
    }), { ticketId: t.id, kind: 'reply' });
  },

  async statusChanged(t, actor, from, to, actorIsStaff, { auto = false } = {}) {
    if (actorIsStaff || auto) {
      const copy = CLIENT_STATUS_COPY[to];
      if (!copy) return;
      sendEach([await activeUser(t.created_by)], actor, (r) => ({
        subject: subjectFor(t),
        heading: copy.heading,
        inAppTitle: `Ticket #${t.id}: ${STATUS_LABELS[to]}`,
        greeting: `Hello ${firstName(r.name)},`,
        intro: auto && to === 'closed' ? `Ticket #${t.id} was closed automatically because it has been resolved for ${config.autoCloseDays} days with no further replies.` : copy.body,
        paragraphs:
          to === 'resolved' && config.autoCloseDays > 0
            ? [`If we do not hear from you, the ticket will close automatically in ${plural(config.autoCloseDays, 'day')}.`]
            : [],
        details: details(t),
        ratingLinks: to === 'resolved' ? ratingLinks(t) : undefined,
        ctaUrl: ticketUrl(t.id),
        ctaLabel: 'View ticket',
      }), { ticketId: t.id, kind: 'status' });
      return;
    }
    const reopened = to === 'open';
    sendEach(await ticketWatchers(t), actor, (r) => ({
      subject: subjectFor(t),
      heading: reopened ? 'Ticket reopened by client' : `Ticket marked ${STATUS_LABELS[to]} by client`,
      greeting: `Hello ${firstName(r.name)},`,
      intro: `${actor ? actor.name : 'The client'} changed the status of ticket #${t.id} from ${STATUS_LABELS[from]} to ${STATUS_LABELS[to]}.`,
      paragraphs: reopened ? ['The client indicated the issue is not yet resolved. Please follow up.'] : [],
      details: details(t, { internal: true }),
      ctaUrl: ticketUrl(t.id),
      ctaLabel: 'View ticket',
    }), { ticketId: t.id, kind: 'status' });
  },

  // Escalation: admins and the assignee are alerted; a client who requested it gets an acknowledgement.
  async escalated(t, actor, reason) {
    const recipients = [...(await staff({ adminsOnly: true })), await activeUser(t.assigned_to)];
    sendEach(recipients, actor, (r) => ({
      subject: subjectFor(t),
      heading: `Ticket escalated to level ${t.escalation_level}`,
      inAppTitle: `Ticket #${t.id} escalated`,
      greeting: `Hello ${firstName(r.name)},`,
      intro: `Ticket #${t.id} has been escalated and needs attention.`,
      quote: reason,
      quoteLabel: 'Reason',
      details: details(t, { internal: true }),
      ctaUrl: ticketUrl(t.id),
      ctaLabel: 'Review ticket',
    }), { ticketId: t.id, kind: 'escalated' });

    if (actor && actor.role === 'client') {
      sendEach([await activeUser(actor.id)], actor, (r) => ({
        subject: subjectFor(t),
        heading: 'Your escalation request has been received',
        greeting: `Hello ${firstName(r.name)},`,
        intro: `Ticket #${t.id} has been escalated to our support management team, who will review it as a priority.`,
        details: details(t),
        ctaUrl: ticketUrl(t.id),
        ctaLabel: 'View ticket',
      }), { ticketId: t.id, includeActor: true, kind: 'escalated' });
    }
  },

  async assigned(t, actor) {
    sendEach([await activeUser(t.assigned_to)], actor, (r) => ({
      subject: subjectFor(t),
      heading: 'A ticket has been assigned to you',
      inAppTitle: `Ticket #${t.id} assigned to you`,
      greeting: `Hello ${firstName(r.name)},`,
      intro: `${actor.name} assigned ticket #${t.id} to you.`,
      details: details(t, { internal: true }),
      ctaUrl: ticketUrl(t.id),
      ctaLabel: 'Open ticket',
    }), { ticketId: t.id, kind: 'assigned' });
  },

  // A client rated a ticket: the assignee always hears; admins too when the rating is low.
  async ratingReceived(t, actor, rating, comment) {
    const recipients = [await activeUser(t.assigned_to), ...(rating <= 2 ? await staff({ adminsOnly: true }) : [])];
    sendEach(recipients, actor, () => ({
      subject: subjectFor(t),
      heading: `Ticket #${t.id} rated ${rating} out of 5`,
      intro: comment ? `${actor.name}: "${excerpt(comment, 200)}"` : `${actor.name} rated the support on this ticket.`,
    }), { ticketId: t.id, kind: 'rating', email: false });
  },

  // Site visits: the technician and the requester are told when a visit is booked, moved or cancelled.
  async visitChanged(visit, t, actor, change) {
    const when = visitTime(visit.scheduled_at);
    const rows = [
      ['Ticket', `#${t.id} ${t.subject}`],
      ['Date and time', when],
      ['Expected duration', `${visit.duration_min} minutes`],
      ['Location', visit.location || t.company_name],
      ['Technician', visit.technician_name || 'To be confirmed'],
    ];
    const verb = { scheduled: 'scheduled', rescheduled: 'rescheduled', cancelled: 'cancelled' }[change];
    sendEach([await activeUser(visit.technician_id)], actor, (r) => ({
      subject: subjectFor(t),
      heading: change === 'cancelled' ? 'Site visit cancelled' : change === 'rescheduled' ? 'Site visit rescheduled' : 'You have a new site visit',
      inAppTitle: `Site visit ${verb}: ${when}`,
      greeting: `Hello ${firstName(r.name)},`,
      intro: `${actor.name} ${verb} a site visit for ${t.company_name} (ticket #${t.id}).`,
      details: rows,
      quote: visit.notes || undefined,
      quoteLabel: 'Notes',
      ctaUrl: `${config.appUrl}/visits/${visit.id}`,
      ctaLabel: 'Open visit',
    }), { ticketId: t.id, kind: 'visit', link: `/visits/${visit.id}` });

    sendEach([await activeUser(t.created_by)], actor, (r) => ({
      subject: subjectFor(t),
      heading: change === 'cancelled' ? 'Your site visit has been cancelled' : change === 'rescheduled' ? 'Your site visit has been rescheduled' : 'A site visit has been scheduled',
      inAppTitle: `Site visit ${verb} for #${t.id}`,
      greeting: `Hello ${firstName(r.name)},`,
      intro:
        change === 'cancelled'
          ? `The site visit for ticket #${t.id} planned for ${when} has been cancelled. Our team will be in touch if a new visit is needed.`
          : `A technician will visit on ${when} to work on ticket #${t.id}.`,
      details: change === 'cancelled' ? rows.slice(0, 2) : rows,
      paragraphs: change === 'cancelled' ? [] : ['Please make sure someone is available to give access. Reply to this email if the time does not suit you.'],
      ctaUrl: ticketUrl(t.id),
      ctaLabel: 'View ticket',
    }), { ticketId: t.id, kind: 'visit' });
  },

  // Someone was added to a group conversation.
  async addedToGroup(group, actor, userIds) {
    if (!userIds.length) return;
    const recipients = await db.query(`SELECT ${USER_COLS} FROM users WHERE id IN (${db.inList(userIds)}) AND is_active = 1`, userIds);
    sendEach(recipients, actor, (r) => ({
      subject: `You were added to "${group.name}"`,
      heading: 'You have been added to a group conversation',
      inAppTitle: `${actor.name} added you to "${group.name}"`,
      greeting: `Hello ${firstName(r.name)},`,
      intro: `${actor.name} added you to the group "${group.name}" for ${group.company_name}.`,
      paragraphs: ['Group conversations let your team and our support staff discuss issues together. Open the portal to read the conversation and reply.'],
      ctaUrl: `${config.appUrl}/messages/group/${group.id}`,
      ctaLabel: 'Open conversation',
    }), { kind: 'group', link: `/messages/group/${group.id}` });
  },

  // Unread group messages summary. `groups` is [{ id, name, company_name, count, messages: [{ user_name, body }] }].
  chatDigest(user, groups) {
    const total = groups.reduce((s, g) => s + g.count, 0);
    const lines = groups.flatMap((g) => [
      `${g.name} (${g.company_name}): ${plural(g.count, 'unread message')}`,
      ...g.messages.map((m) => `  ${m.user_name || 'Someone'}: ${excerpt(m.body, 160)}`),
    ]);
    const { html, text } = mailer.render({
      heading: `You have ${plural(total, 'unread message')}`,
      greeting: `Hello ${firstName(user.name)},`,
      intro: `There ${total === 1 ? 'is' : 'are'} ${plural(total, 'new message')} in your group conversations that you have not read yet.`,
      quote: lines.join('\n'),
      quoteLabel: 'Latest messages',
      ctaUrl: groups.length === 1 ? `${config.appUrl}/messages/group/${groups[0].id}` : `${config.appUrl}/messages`,
      ctaLabel: 'Read messages',
    });
    mailer.send({ to: user.email, subject: `${plural(total, 'unread message')} in ${groups.length === 1 ? `"${groups[0].name}"` : `${groups.length} conversations`}`, html, text });
  },

  // Account emails are always sent, whatever the notification preference.
  // Account created for someone. Without a password yet, the login link first lets them choose one.
  invite(user, token) {
    const hasPassword = !!user.password_hash;
    const { html, text } = mailer.render({
      heading: 'Your account has been created',
      greeting: `Hello ${firstName(user.name)},`,
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
    mailer.send({ to: user.email, subject: `Your ${config.appName} account has been created`, html, text });
  },

  passwordReset(user, token) {
    const { html, text } = mailer.render({
      heading: 'Reset your password',
      greeting: `Hello ${firstName(user.name)},`,
      intro: 'We received a request to reset the password for your support portal account. Use the button below to choose a new password. This link expires in 1 hour.',
      ctaUrl: loginUrl(token),
      ctaLabel: 'Reset password',
      note: 'If you did not request a password reset, you can ignore this email. Your password will not change.',
      footer: 'account',
    });
    mailer.send({ to: user.email, subject: `Reset your ${config.appName} password`, html, text });
  },

  passwordChanged(user) {
    const { html, text } = mailer.render({
      heading: 'Your password has been changed',
      greeting: `Hello ${firstName(user.name)},`,
      intro: `The password for your support portal account (${user.email}) was changed on ${new Date().toUTCString()}.`,
      paragraphs: ['If you made this change, no further action is needed.'],
      note: 'If you did not change your password, reset it immediately using the "Forgot password" link on the sign-in page and contact our support team.',
      ctaUrl: `${config.appUrl}/login`,
      ctaLabel: 'Go to sign in',
      footer: 'account',
    });
    mailer.send({ to: user.email, subject: `Your ${config.appName} password was changed`, html, text });
  },
};
