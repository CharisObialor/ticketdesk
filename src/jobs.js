const config = require('./config');
const sla = require('./sla');
const db = require('./db');
const tickets = require('./services/tickets');
const notify = require('./notify');
const backup = require('./backup');
const inbound = require('./inbound');
const { now, parseTs } = require('./util');

const minutesAgo = (min) => now(new Date(Date.now() - min * 60000));

// Auto-escalation follows the rules admins set on the System page (see escalation.js).
const checkSla = () => require('./escalation').run();

// Closes tickets that have stayed resolved, with no further activity, for AUTO_CLOSE_DAYS.
async function autoClose() {
  if (config.autoCloseDays <= 0) return;
  const cutoff = minutesAgo(config.autoCloseDays * 1440);
  // Tickets waiting for admin sign-off are left alone: they close when the admins approve them.
  const rows = await db.query(
    "SELECT id FROM tickets WHERE status = 'resolved' AND COALESCE(signoff_required, 0) = 0 AND resolved_at <= ? AND last_activity_at <= ?",
    [cutoff, cutoff]
  );
  for (const { id } of rows) {
    const t = await tickets.touch(id, { status: 'closed' });
    await tickets.systemMessage(t, null, `Closed automatically after ${config.autoCloseDays} days with no reply since it was resolved.`);
    notify.statusChanged(t, null, 'resolved', 'closed', false, { auto: true });
    tickets.archiveTranscript(t, null, 'closed').catch((err) => console.error('[jobs] transcript failed', err));
  }
  if (rows.length) console.log(`[jobs] auto-closed ${rows.length} ticket(s)`);
}

// Emails a summary to group members who have had unread messages for CHAT_DIGEST_MINUTES.
// Each message is included in at most one summary.
async function chatDigest() {
  if (config.chatDigestMinutes <= 0) return;
  const unread = `FROM chat_messages cm WHERE cm.group_id = m.group_id AND cm.kind = 'message' AND cm.user_id <> m.user_id
    AND cm.id > m.last_read_id AND cm.id > m.last_emailed_id`;
  const rows = await db.query(
    `SELECT m.group_id, m.user_id, g.name AS group_name, c.name AS company_name, u.name AS user_name, u.email, u.notify_prefs,
       (SELECT MIN(cm.created_at) ${unread}) AS oldest,
       (SELECT COUNT(*) ${unread}) AS cnt,
       (SELECT MAX(cm.id) ${unread}) AS max_id
     FROM chat_members m
     JOIN users u ON u.id = m.user_id
     JOIN chat_groups g ON g.id = m.group_id
     JOIN companies c ON c.id = g.company_id
     WHERE u.is_active = 1 AND u.notify_email = 1`
  );
  const cutoff = minutesAgo(config.chatDigestMinutes);
  const due = rows.filter((r) => Number(r.cnt) > 0 && r.oldest && r.oldest <= cutoff);
  const byUser = new Map();
  for (const r of due) {
    if (!byUser.has(r.user_id)) byUser.set(r.user_id, { user: { id: r.user_id, name: r.user_name, email: r.email, notify_prefs: r.notify_prefs }, groups: [] });
    const messages = await db.query(
      `SELECT cm.body, u.name AS user_name FROM chat_messages cm LEFT JOIN users u ON u.id = cm.user_id
       WHERE cm.group_id = ? AND cm.kind = 'message' AND cm.user_id <> ? AND cm.id <= ? ORDER BY cm.id DESC LIMIT 3`,
      [r.group_id, r.user_id, r.max_id]
    );
    byUser.get(r.user_id).groups.push({ id: r.group_id, name: r.group_name, company_name: r.company_name, count: Number(r.cnt), messages: messages.reverse() });
    await db.query('UPDATE chat_members SET last_emailed_id = ? WHERE group_id = ? AND user_id = ?', [r.max_id, r.group_id, r.user_id]);
  }
  for (const { user, groups } of byUser.values()) notify.chatDigest(user, groups);
}

// How long an item may sit before the bell reminds the admin about it again (then once a day).
const REMIND_AFTER_MIN = { urgent: 30, high: 120, normal: 480 };

// Reminds admins about actions they have not completed: an immediate email for new urgent items, bell reminders
// for items left waiting, and one summary email each weekday morning.
async function actionReminders() {
  const actions = require('./actions');
  const inapp = require('./inapp');
  const admins = await db.query("SELECT id, name, email, notify_email, sla_reminders FROM users WHERE role = 'admin' AND is_active = 1");
  if (!admins.length) return;
  const items = await actions.computeActions();
  const ts = now();
  const local = new Date(new Date().toLocaleString('en-US', { timeZone: config.timezone }));
  const today = `${local.getFullYear()}-${local.getMonth() + 1}-${local.getDate()}`;
  const weekday = local.getDay() >= 1 && local.getDay() <= 5;

  for (const admin of admins) {
    const { visible, states } = await actions.forUser(admin, items);

    // Track when each item was first seen by this admin; forget items that are done (unless snoozed/dismissed).
    const live = new Set(items.map((i) => i.key));
    for (const [key, s] of states) {
      if (!live.has(key) && !s.status && key !== '__daily__') await db.query('DELETE FROM action_states WHERE user_id = ? AND action_key = ?', [admin.id, key]);
    }
    for (const i of visible) {
      if (!states.has(i.key)) {
        await db.query('INSERT INTO action_states (user_id, action_key, first_seen_at, updated_at) VALUES (?, ?, ?, ?)', [admin.id, i.key, ts, ts]);
        states.set(i.key, { first_seen_at: ts, reminded_at: null, urgent_emailed_at: null });
      }
    }

    // Urgent: tell them straight away (bell for each, one email for the batch).
    const newUrgent = visible.filter((i) => !i.slaKind && i.severity === 'urgent' && !states.get(i.key).urgent_emailed_at);
    for (const i of newUrgent) {
      inapp.create(admin.id, { kind: 'action', title: `Urgent: ${i.title}`, body: i.suggestion, link: i.link }).catch(() => {});
      await db.query('UPDATE action_states SET urgent_emailed_at = ? WHERE user_id = ? AND action_key = ?', [ts, admin.id, i.key]);
    }
    if (newUrgent.length && config.actions.urgentEmails && Number(admin.notify_email)) notify.actionsEmail(admin, newUrgent);

    // Reminders for items left waiting, at most once a day each, grouped into one bell notification.
    const due = visible.filter((i) => {
      const s = states.get(i.key);
      const waited = (Date.now() - parseTs(s.first_seen_at).getTime()) / 60000;
      const sinceReminder = s.reminded_at ? (Date.now() - parseTs(s.reminded_at).getTime()) / 60000 : Infinity;
      return !i.slaKind && waited >= REMIND_AFTER_MIN[i.severity] && sinceReminder >= 1440 && !newUrgent.includes(i);
    });
    if (due.length) {
      inapp
        .create(admin.id, {
          kind: 'action',
          title: due.length === 1 ? `Reminder: ${due[0].title}` : `Reminder: ${due.length} actions still waiting`,
          body: due.length === 1 ? due[0].suggestion : due.slice(0, 3).map((i) => i.title).join(' · '),
          link: due.length === 1 ? due[0].link : '/actions',
        })
        .catch(() => {});
      for (const i of due) await db.query('UPDATE action_states SET reminded_at = ? WHERE user_id = ? AND action_key = ?', [ts, admin.id, i.key]);
    }

    // SLA deadlines: each admin chooses on their Profile page how often to hear about each kind of breach.
    const prefs = sla.reminderPrefs(admin.sla_reminders);
    const slaDue = visible.filter((i) => {
      const every = i.slaKind && prefs[i.slaKind];
      if (!every) return false;
      const last = states.get(i.key).reminded_at;
      return !last || (Date.now() - parseTs(last).getTime()) / 60000 >= every - 1;
    });
    if (slaDue.length) {
      const first = slaDue.filter((i) => !states.get(i.key).reminded_at);
      const one = slaDue[0];
      inapp
        .create(admin.id, {
          kind: 'action',
          title: slaDue.length === 1 ? `${first.length ? 'SLA' : 'Reminder'}: ${one.title}` : `SLA: ${slaDue.length} deadlines need attention`,
          body: slaDue.length === 1 ? one.suggestion : slaDue.slice(0, 3).map((i) => i.title).join(' · '),
          link: slaDue.length === 1 ? one.link : '/actions',
        })
        .catch(() => {});
      // Email: every reminder if the admin asked for it; otherwise only the first notice of an urgent item, as before.
      const emailNow = prefs.email ? slaDue : config.actions.urgentEmails ? first.filter((i) => i.severity === 'urgent') : [];
      if (emailNow.length && Number(admin.notify_email)) notify.actionsEmail(admin, emailNow);
      for (const i of slaDue) await db.query('UPDATE action_states SET reminded_at = ?, urgent_emailed_at = COALESCE(urgent_emailed_at, ?) WHERE user_id = ? AND action_key = ?', [ts, ts, admin.id, i.key]);
    }

    // Weekday morning summary (once per day, after ACTIONS_DAILY_HOUR in the company time zone).
    const daily = states.get('__daily__');
    if (weekday && local.getHours() >= config.actions.dailyHour && (!daily || daily.reason !== today)) {
      if (visible.length && Number(admin.notify_email)) notify.actionsEmail(admin, visible, { daily: true });
      if (daily) await db.query("UPDATE action_states SET reason = ?, updated_at = ? WHERE user_id = ? AND action_key = '__daily__'", [today, ts, admin.id]);
      else await db.query("INSERT INTO action_states (user_id, action_key, reason, first_seen_at, updated_at) VALUES (?, '__daily__', ?, ?, ?)", [admin.id, today, ts, ts]);
    }
  }
}

function every(ms, name, fn, firstDelay = 15000) {
  const run = () => fn().catch((err) => console.error(`[jobs] ${name} failed`, err));
  setTimeout(run, firstDelay).unref();
  setInterval(run, ms).unref();
}

function start() {
  every(5 * 60000, 'SLA check', checkSla);
  every(30 * 60000, 'auto-close', autoClose, 30000);
  every(2 * 60000, 'chat summary', chatDigest, 45000);
  every(10 * 60000, 'backup', backup.runIfDue, 60000);
  every(60 * 60000, 'monthly statements', require('./statement').runIfDue, 120000);
  every(5 * 60000, 'action reminders', actionReminders, 90000);
  every(30000, 'outbox', require('./mailer').processOutbox, 5000);
  every(6 * 3600e3, 'database statistics', db.optimize, 3600e3);
  if (config.inbound.enabled) every(config.inbound.pollSeconds * 1000, 'mailbox check', inbound.poll, 20000);
}

module.exports = { start, checkSla, autoClose, chatDigest, actionReminders };
