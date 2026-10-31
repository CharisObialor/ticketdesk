// Suggested actions for admins: things in the portal that need someone to act, found by rules over live data.
// Items disappear by themselves once the work is done; admins can also snooze or dismiss them for themselves.
const config = require('./config');
const sla = require('./sla');
const db = require('./db');
const backup = require('./backup');
const inbound = require('./inbound');
const { STAFF_ROLES } = require('./auth');
const { now, parseTs, OPEN_STATUSES } = require('./util');

const SEVERITY_RANK = { urgent: 0, high: 1, normal: 2 };
const minutesSince = (ts) => (Date.now() - parseTs(ts).getTime()) / 60000;
const ago = (min) => (min < 60 ? `${Math.max(1, Math.round(min))} min` : min < 1440 ? `${Math.round(min / 60)} h` : `${Math.round(min / 1440)} days`);

async function staffLoad() {
  const staff = await db.query(`SELECT id, name, role FROM users WHERE role IN (${db.inList(STAFF_ROLES)}) AND is_active = 1`, STAFF_ROLES);
  const counts = await db.query(
    `SELECT assigned_to, COUNT(*) AS n FROM tickets WHERE status IN (${db.inList(OPEN_STATUSES)}) AND COALESCE(assigned_to, 0) <> 0 GROUP BY assigned_to`,
    OPEN_STATUSES
  );
  const byId = new Map(counts.map((c) => [Number(c.assigned_to), Number(c.n)]));
  return staff.map((s) => ({ ...s, open: byId.get(Number(s.id)) || 0 })).sort((a, b) => a.open - b.open || a.name.localeCompare(b.name));
}

// Every outstanding action for the team. Each item has a stable key, so snoozes and reminders attach to it.
async function computeActions() {
  const items = [];
  const openIn = db.inList(OPEN_STATUSES);
  const tickets = await db.query(
    `SELECT t.*, c.name AS company_name, au.name AS assignee_name FROM tickets t
     JOIN companies c ON c.id = t.company_id LEFT JOIN users au ON au.id = t.assigned_to
     WHERE t.status IN (${openIn})`,
    OPEN_STATUSES
  );
  const load = await staffLoad();
  const lightest = load[0];
  const ref = (t) => `#${t.id} ${t.subject} (${t.company_name})`;

  for (const t of tickets) {
    const link = `/tickets/${t.id}`;
    const quickAssign = !t.assigned_to && lightest ? { kind: 'assign', userId: lightest.id, userName: lightest.name } : null;

    // 1. First-response SLA about to be missed, or missed.
    // SLA clocks run from assignment; unassigned tickets are covered by the "unassigned" item below.
    if (!t.first_response_at && ['open', 'in_progress'].includes(t.status) && t.assigned_at) {
      const limit = sla.response(t);
      const waited = minutesSince(t.assigned_at);
      const left = limit - waited;
      if (left <= limit * 0.25) {
        const overdue = left <= 0;
        items.push({
          key: `sla:${t.id}:${overdue ? 'overdue' : 'due'}`,
          type: 'sla',
          slaKind: overdue ? 'response_overdue' : 'response_due',
          category: 'tickets',
          severity: overdue || ['urgent', 'high'].includes(t.priority) ? 'urgent' : 'high',
          title: overdue ? `Response overdue by ${ago(-left)}: ${ref(t)}` : `Respond within ${ago(left)}: ${ref(t)}`,
          detail: `${t.priority[0].toUpperCase() + t.priority.slice(1)} priority. No one from the team has replied since it was assigned ${ago(waited)} ago.`,
          suggestion: t.assigned_to ? `Remind ${t.assignee_name} or reply now.` : `Assign it${lightest ? ` (suggested: ${lightest.name}, ${lightest.open} open)` : ''} and reply.`,
          since: t.assigned_at,
          link,
          ticketId: t.id,
          quick: quickAssign,
        });
        continue;
      }
    }

    // 1b. Time to resolve (from the company's SLA) about to run out, or already passed.
    {
      const limit = sla.resolution(t);
      const age = t.assigned_at ? minutesSince(t.assigned_at) : 0;
      const left = limit - age;
      if (t.assigned_at && t.status !== 'awaiting_client' && left <= Math.min(limit * 0.2, 1440)) {
        const overdue = left <= 0;
        items.push({
          key: `ttr:${t.id}:${overdue ? 'overdue' : 'due'}`,
          type: 'sla',
          slaKind: overdue ? 'resolution_overdue' : 'resolution_due',
          category: 'tickets',
          severity: overdue ? 'urgent' : 'high',
          title: overdue ? `Resolution overdue by ${ago(-left)}: ${ref(t)}` : `Resolve within ${ago(left)}: ${ref(t)}`,
          detail: `${t.category}, ${t.priority} priority. The SLA allows ${ago(limit)} to resolve; it was assigned ${ago(age)} ago.`,
          suggestion: t.assigned_to ? `Check progress with ${t.assignee_name} and post a work update.` : `Assign it${lightest ? ` (suggested: ${lightest.name})` : ''} and start work.`,
          since: t.assigned_at,
          link,
          ticketId: t.id,
          quick: quickAssign,
        });
        continue;
      }
    }

    // 2. Unassigned for more than 30 minutes.
    if (!t.assigned_to && minutesSince(t.created_at) > 30) {
      items.push({
        key: `unassigned:${t.id}`,
        type: 'unassigned',
        category: 'tickets',
        severity: ['urgent', 'high'].includes(t.priority) ? 'high' : 'normal',
        title: `Unassigned for ${ago(minutesSince(t.created_at))}: ${ref(t)}`,
        detail: `${t.priority[0].toUpperCase() + t.priority.slice(1)} priority, ${t.category}.`,
        suggestion: lightest ? `Assign to ${lightest.name}, who has the lightest load (${lightest.open} open).` : 'Assign it to a team member.',
        since: t.created_at,
        link,
        ticketId: t.id,
        quick: quickAssign,
      });
    }

    // 3. Escalated and nobody on the team has responded since.
    if (t.escalated && t.escalated_at && minutesSince(t.escalated_at) > 60) {
      const staffSince = await db.one(
        `SELECT COUNT(*) AS n FROM messages m JOIN users u ON u.id = m.user_id
         WHERE m.ticket_id = ? AND m.kind = 'message' AND m.created_at > ? AND u.role IN (${db.inList(STAFF_ROLES)})`,
        [t.id, t.escalated_at, ...STAFF_ROLES]
      );
      if (!Number(staffSince.n)) {
        items.push({
          key: `escalated:${t.id}:${t.escalation_level}`,
          type: 'escalated',
          category: 'tickets',
          severity: 'urgent',
          title: `Escalation untouched for ${ago(minutesSince(t.escalated_at))}: ${ref(t)}`,
          detail: `Escalated to level ${t.escalation_level}. No team reply or note since.`,
          suggestion: 'Review the ticket, take ownership and update the client.',
          since: t.escalated_at,
          link,
          ticketId: t.id,
          quick: quickAssign,
        });
      }
    }

    // 4. Client (or an outside contact) wrote last and is waiting.
    const last = await db.one(
      `SELECT m.id, m.created_at, m.sender_email, u.role FROM messages m LEFT JOIN users u ON u.id = m.user_id
       WHERE m.ticket_id = ? AND m.kind = 'message' AND m.is_internal = 0 ORDER BY m.id DESC LIMIT 1`,
      [t.id]
    );
    const fromClient = last && (last.sender_email || last.role === 'client');
    const threshold = ['urgent', 'high'].includes(t.priority) ? 60 : 240;
    if (fromClient && t.first_response_at && minutesSince(last.created_at) > threshold) {
      const waited = minutesSince(last.created_at);
      items.push({
        key: `waiting:${t.id}:${last.id}`,
        type: 'waiting',
        category: 'tickets',
        severity: waited > 1440 || t.priority === 'urgent' ? 'high' : 'normal',
        title: `Client waiting ${ago(waited)} for a reply: ${ref(t)}`,
        detail: t.assignee_name ? `Assigned to ${t.assignee_name}.` : 'Not assigned to anyone.',
        suggestion: 'Reply to the client, or use the AI assistant to draft a reply.',
        since: last.created_at,
        link,
        ticketId: t.id,
        quick: quickAssign,
      });
    }

    // 5. Waiting on the client for more than 3 days.
    if (t.status === 'awaiting_client' && minutesSince(t.last_activity_at) > 3 * 1440) {
      items.push({
        key: `stale:${t.id}:${t.last_activity_at}`,
        type: 'stale',
        category: 'tickets',
        severity: 'normal',
        title: `No reply from the client for ${ago(minutesSince(t.last_activity_at))}: ${ref(t)}`,
        detail: 'The ticket is waiting on the client.',
        suggestion: 'Send a follow-up, or mark it resolved if the issue is fixed.',
        since: t.last_activity_at,
        link,
        ticketId: t.id,
      });
    }
  }

  // 6. Site visits whose time has passed without a report.
  const visits = await db.query(
    `SELECT v.*, u.name AS technician_name, t.subject, c.name AS company_name FROM site_visits v
     JOIN tickets t ON t.id = v.ticket_id JOIN companies c ON c.id = t.company_id LEFT JOIN users u ON u.id = v.technician_id
     WHERE v.status IN ('scheduled', 'in_progress')`
  );
  for (const v of visits) {
    const overMin = minutesSince(v.scheduled_at) - Number(v.duration_min || 60);
    if (overMin < 120) continue;
    items.push({
      key: `visit:${v.id}`,
      type: 'visit',
      category: 'visits',
      severity: overMin > 1440 ? 'high' : 'normal',
      title: `Site visit report missing: ${v.company_name}, ticket #${v.ticket_id}`,
      detail: `${v.technician_name || 'Unassigned'} was due on site ${ago(minutesSince(v.scheduled_at))} ago; the visit is still ${v.status === 'in_progress' ? 'in progress' : 'not started'}.`,
      suggestion: `Ask ${v.technician_name || 'the technician'} to complete the visit report, or reschedule or cancel it.`,
      since: v.scheduled_at,
      link: `/visits/${v.id}`,
      ticketId: v.ticket_id,
    });
  }

  // Resolved tickets waiting for admin sign-off before they can close.
  const awaiting = await db.query(
    `SELECT t.id, t.subject, t.signoff_round, t.signoff_required, t.signoff_requested_by, t.signoff_requested_at, c.name AS company_name, u.name AS requester
     FROM tickets t JOIN companies c ON c.id = t.company_id LEFT JOIN users u ON u.id = t.signoff_requested_by
     WHERE t.status = 'resolved' AND t.signoff_required > 0`
  );
  for (const t of awaiting) {
    const done = await db.query("SELECT user_id, decision FROM ticket_signoffs WHERE ticket_id = ? AND round = ?", [t.id, t.signoff_round]);
    const approved = done.filter((d) => d.decision === 'approved').length;
    const waited = minutesSince(t.signoff_requested_at);
    items.push({
      key: `signoff:${t.id}:${t.signoff_round}`,
      type: 'signoff',
      category: 'tickets',
      severity: waited > 1440 ? 'high' : 'normal',
      title: `Sign-off needed: ticket #${t.id} ${t.subject}`,
      detail: `${t.requester || 'A team member'} marked it resolved ${ago(waited)} ago for ${t.company_name}. ${approved} of ${t.signoff_required} approvals so far.`,
      suggestion: 'Check the resolution, then approve it or send it back with a reason.',
      since: t.signoff_requested_at,
      link: `/tickets/${t.id}`,
      ticketId: t.id,
      notFor: [Number(t.signoff_requested_by), ...done.map((d) => Number(d.user_id))],
    });
  }

  // 7. Low ratings with no follow-up from the team.
  const ratings = await db.query(
    `SELECT r.*, t.subject, c.name AS company_name, u.name AS client_name FROM ticket_ratings r
     JOIN tickets t ON t.id = r.ticket_id JOIN companies c ON c.id = t.company_id LEFT JOIN users u ON u.id = r.user_id
     WHERE r.rating <= 2 AND r.updated_at >= ?`,
    [now(new Date(Date.now() - 30 * 864e5))]
  );
  for (const r of ratings) {
    const followed = await db.one(
      `SELECT COUNT(*) AS n FROM messages m JOIN users u ON u.id = m.user_id
       WHERE m.ticket_id = ? AND m.kind = 'message' AND m.created_at > ? AND u.role IN (${db.inList(STAFF_ROLES)})`,
      [r.ticket_id, r.updated_at, ...STAFF_ROLES]
    );
    if (Number(followed.n)) continue;
    items.push({
      key: `rating:${r.ticket_id}:${r.updated_at}`,
      type: 'rating',
      category: 'tickets',
      severity: 'high',
      title: `${r.rating}-star rating from ${r.client_name || 'a client'}: #${r.ticket_id} ${r.subject} (${r.company_name})`,
      detail: r.comment ? `"${String(r.comment).slice(0, 200)}"` : 'No comment left.',
      suggestion: 'Contact the client to understand what went wrong and put it right.',
      since: r.updated_at,
      link: `/tickets/${r.ticket_id}`,
      ticketId: r.ticket_id,
    });
  }

  // 8. Invitations never accepted.
  const invites = await db.query("SELECT id, name, email, created_at FROM users WHERE is_active = 1 AND password_hash IS NULL AND created_at <= ?", [
    now(new Date(Date.now() - 3 * 864e5)),
  ]);
  for (const u of invites) {
    items.push({
      key: `invite:${u.id}`,
      type: 'invite',
      category: 'team',
      severity: 'normal',
      title: `${u.name} has not activated their account`,
      detail: `Invited ${ago(minutesSince(u.created_at))} ago (${u.email}).`,
      suggestion: 'Resend the invitation, or check the email address is right.',
      since: u.created_at,
      link: '/users',
      quick: { kind: 'invite', userId: u.id, userName: u.name },
    });
  }

  // 9. Someone carrying far more than their share.
  const working = load.filter((s) => s.role !== 'admin' || s.open > 0);
  const avg = working.length ? working.reduce((n, s) => n + s.open, 0) / working.length : 0;
  for (const s of load) {
    if (s.open >= 8 && s.open > avg * 2 && lightest && lightest.id !== s.id) {
      items.push({
        key: `load:${s.id}:${s.open}`,
        type: 'load',
        category: 'team',
        severity: 'normal',
        title: `${s.name} has ${s.open} open tickets`,
        detail: `More than twice the team average of ${avg.toFixed(1)}.`,
        suggestion: `Move some of ${s.name.split(' ')[0]}'s tickets to ${lightest.name} (${lightest.open} open).`,
        since: now(),
        link: `/tickets?view=open`,
      });
    }
  }

  // 10. Backups and email.
  const status = await backup.lastStatus();
  if (status && !status.ok) {
    items.push({
      key: `backup:${status.finished_at}`,
      type: 'system',
      category: 'system',
      severity: 'urgent',
      title: 'The last backup failed',
      detail: status.error || 'Unknown error.',
      suggestion: 'Open System and run a backup now; check free disk space.',
      since: now(new Date(status.finished_at)),
      link: '/system',
    });
  } else {
    const latest = (await backup.list())[0];
    const ageH = latest ? (Date.now() - new Date(latest.created_at).getTime()) / 3600e3 : null;
    if (ageH === null ? process.uptime() > 26 * 3600 : ageH > 30) {
      items.push({
        key: `backup-missing:${now().slice(0, 10)}`,
        type: 'system',
        category: 'system',
        severity: 'high',
        title: latest ? `No backup for ${Math.round(ageH)} hours` : 'No backup has been made yet',
        detail: 'Nightly backups should run every day.',
        suggestion: 'Open System and click Back up now.',
        since: now(),
        link: '/system',
      });
    }
  }
  const outbox = await require('./mailer').outboxStatus();
  if (outbox.failedCount) {
    items.push({
      key: `mail-failed:${outbox.failed[0].id}`,
      type: 'system',
      category: 'system',
      severity: 'high',
      title: `${outbox.failedCount} email${outbox.failedCount === 1 ? '' : 's'} could not be sent`,
      detail: outbox.failed[0].last_error || 'Unknown error.',
      suggestion: 'Check the internet connection and email settings, then retry them from the System page.',
      since: outbox.failed[0].created_at,
      link: '/system',
    });
  }
  if (outbox.pending && outbox.oldestPending && minutesSince(outbox.oldestPending) > 30) {
    items.push({
      key: `mail-stuck:${outbox.oldestPending}`,
      type: 'system',
      category: 'system',
      severity: 'high',
      title: `${outbox.pending} email${outbox.pending === 1 ? ' is' : 's are'} waiting to be sent`,
      detail: `The oldest has been waiting ${ago(minutesSince(outbox.oldestPending))}. The portal keeps retrying automatically.`,
      suggestion: 'Check that this server is connected to the internet.',
      since: outbox.oldestPending,
      link: '/system',
    });
  }
  if (config.inbound.enabled && inbound.status.lastError) {
    items.push({
      key: 'inbound-error',
      type: 'system',
      category: 'system',
      severity: 'high',
      title: 'Reply by email is failing',
      detail: inbound.status.lastError,
      suggestion: 'Check the Microsoft 365 mailbox settings on the System page.',
      since: now(),
      link: '/system',
    });
  }

  return items.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || (a.since < b.since ? -1 : 1));
}

// Splits the team list into what this admin should see and what they have snoozed or dismissed.
async function forUser(user, items) {
  const states = await db.query('SELECT * FROM action_states WHERE user_id = ?', [user.id]);
  const byKey = new Map(states.map((s) => [s.action_key, s]));
  const ts = now();
  const visible = [];
  const hidden = [];
  for (const item of items) {
    const s = byKey.get(item.key);
    // Some items are only for certain admins (sign-off is never asked of the admin who resolved the ticket).
    if (item.notFor && item.notFor.includes(user.id)) continue;
    if (s && s.status === 'dismissed') hidden.push({ ...item, state: 'dismissed', reason: s.reason });
    else if (s && s.status === 'snoozed' && s.snooze_until > ts) hidden.push({ ...item, state: 'snoozed', snoozeUntil: s.snooze_until });
    else visible.push(item);
  }
  return { visible, hidden, states: byKey };
}

// Snooze lengths, measured in the company time zone where "tomorrow" means 08:00 tomorrow.
function snoozeUntil(choice) {
  const h = 3600e3;
  if (choice === '1h') return now(new Date(Date.now() + h));
  if (choice === '4h') return now(new Date(Date.now() + 4 * h));
  const local = new Date(new Date().toLocaleString('en-US', { timeZone: config.timezone }));
  const offset = local.getTime() - Date.now();
  const target = new Date(local);
  target.setHours(8, 0, 0, 0);
  target.setDate(target.getDate() + (choice === 'week' ? 7 : 1));
  return now(new Date(target.getTime() - offset));
}

async function setState(user, key, fields) {
  const ts = now();
  const existing = await db.one('SELECT action_key FROM action_states WHERE user_id = ? AND action_key = ?', [user.id, key]);
  if (existing) {
    await db.query('UPDATE action_states SET status = ?, snooze_until = ?, reason = ?, updated_at = ? WHERE user_id = ? AND action_key = ?', [
      fields.status,
      fields.snooze_until || null,
      fields.reason || null,
      ts,
      user.id,
      key,
    ]);
  } else {
    await db.query(
      'INSERT INTO action_states (user_id, action_key, status, snooze_until, reason, first_seen_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [user.id, key, fields.status, fields.snooze_until || null, fields.reason || null, ts, ts]
    );
  }
}

module.exports = { computeActions, forUser, snoozeUntil, setState, SEVERITY_RANK };
