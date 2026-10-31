const db = require('./db');
const sla = require('./sla');
const { now, parseTs, HttpError, PRIORITIES, OPEN_STATUSES } = require('./util');

// Escalation rules, set by admins on the System page. Each rule escalates a ticket to its level when its condition
// has held for a while, alerts the people chosen, and can raise the priority or assign the ticket.
//   when: 'response'   - no first reply from the team, `after` minutes past the response time
//         'resolution' - not resolved, `after` minutes past the time to resolve (paused while awaiting the client)
//         'idle'       - no activity on the ticket for `after` minutes (not while awaiting the client)
// A rule only fires while the ticket is below its level, so each level happens once and a manual
// de-escalation is not undone by the same rule.
const WHEN = ['response', 'resolution', 'idle'];
const MAX_RULES = 30;
const MAX_LEVEL = 3;
const MAX_AFTER = 120 * 1440;

// Until an admin changes them: what the portal has always done.
const DEFAULT_RULES = [
  { id: 'default-response', name: 'No first reply within the SLA', enabled: true, when: 'response', after: 0, level: 1, priorities: [], company_id: null, notify_admins: true, notify_assignee: true, notify_users: [], set_priority: null, assign_to: null },
];

let rules = DEFAULT_RULES;

const parse = (s) => {
  try {
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
};

async function load() {
  const row = await db.one("SELECT value FROM settings WHERE name = 'escalation'");
  const saved = parse(row && row.value);
  rules = saved && Array.isArray(saved.rules) ? saved.rules : DEFAULT_RULES;
}

const int = (v) => (v === null || v === undefined || v === '' ? null : Math.round(Number(v)));

// Checks and tidies one rule from the editor. People and companies must exist (checked in save()).
function cleanRule(r, i) {
  if (!r || typeof r !== 'object') throw new HttpError(400, `Rule ${i + 1} is not valid`);
  const name = String(r.name || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!name) throw new HttpError(400, `Give rule ${i + 1} a name`);
  if (!WHEN.includes(r.when)) throw new HttpError(400, `Choose when "${name}" applies`);
  const after = int(r.after) ?? 0;
  if (!Number.isFinite(after) || after < 0 || after > MAX_AFTER) throw new HttpError(400, `The wait for "${name}" must be between 0 and 120 days`);
  if (r.when === 'idle' && after < 15) throw new HttpError(400, `"${name}" needs at least 15 minutes without activity`);
  const level = int(r.level);
  if (!level || level < 1 || level > MAX_LEVEL) throw new HttpError(400, `The level for "${name}" must be 1, 2 or 3`);
  const priorities = Array.isArray(r.priorities) ? [...new Set(r.priorities.filter((p) => PRIORITIES.includes(p)))] : [];
  const notifyUsers = Array.isArray(r.notify_users) ? [...new Set(r.notify_users.map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 20) : [];
  const out = {
    id: String(r.id || '').replace(/[^\w-]/g, '').slice(0, 40) || `rule-${Date.now().toString(36)}-${i}`,
    name,
    enabled: r.enabled !== false,
    when: r.when,
    after,
    level,
    priorities: priorities.length === PRIORITIES.length ? [] : priorities,
    company_id: int(r.company_id) || null,
    notify_admins: !!r.notify_admins,
    notify_assignee: !!r.notify_assignee,
    notify_users: notifyUsers,
    set_priority: ['urgent', 'high'].includes(r.set_priority) ? r.set_priority : null,
    assign_to: int(r.assign_to) || null,
  };
  if (!out.notify_admins && !out.notify_assignee && !out.notify_users.length) throw new HttpError(400, `Choose who "${name}" alerts`);
  return out;
}

async function save(input) {
  const list = Array.isArray(input) ? input : [];
  if (list.length > MAX_RULES) throw new HttpError(400, `At most ${MAX_RULES} rules`);
  const cleaned = list.map(cleanRule);
  const ids = new Set();
  for (const r of cleaned) {
    while (ids.has(r.id)) r.id = `${r.id}-x`;
    ids.add(r.id);
  }
  const staffIds = [...new Set(cleaned.flatMap((r) => [...r.notify_users, ...(r.assign_to ? [r.assign_to] : [])]))];
  if (staffIds.length) {
    const found = await db.query(`SELECT id FROM users WHERE id IN (${db.inList(staffIds)}) AND role IN ('admin', 'agent', 'technician') AND is_active = 1`, staffIds);
    const ok = new Set(found.map((u) => Number(u.id)));
    const bad = staffIds.find((id) => !ok.has(id));
    if (bad) throw new HttpError(400, 'Alerts and assignments can only go to active team members');
  }
  const companyIds = [...new Set(cleaned.map((r) => r.company_id).filter(Boolean))];
  if (companyIds.length) {
    const found = await db.query(`SELECT id FROM companies WHERE id IN (${db.inList(companyIds)})`, companyIds);
    if (found.length !== companyIds.length) throw new HttpError(400, 'One of the rules names a company that does not exist');
  }
  const value = JSON.stringify({ rules: cleaned });
  const ts = now();
  const updated = await db.query("UPDATE settings SET value = ?, updated_at = ? WHERE name = 'escalation'", [value, ts]);
  if (!updated.affectedRows) await db.query("INSERT INTO settings (name, value, updated_at) VALUES ('escalation', ?, ?)", [value, ts]);
  await load();
  return rules;
}

const minutesSince = (ts) => (Date.now() - parseTs(ts).getTime()) / 60000;

// Minutes the rule's condition has been past due for this ticket (negative or null when not yet due).
function overdueBy(rule, t) {
  if (rule.when === 'response') {
    if (t.first_response_at || !t.assigned_at || !['open', 'in_progress'].includes(t.status)) return null;
    return minutesSince(t.assigned_at) - sla.response(t);
  }
  if (t.status === 'awaiting_client') return null;
  if (rule.when === 'resolution') return t.assigned_at ? minutesSince(t.assigned_at) - sla.resolution(t) : null;
  return minutesSince(t.last_activity_at || t.created_at);
}

const human = (min) => (min >= 1440 && min % 1440 === 0 ? `${min / 1440} day${min === 1440 ? '' : 's'}` : min >= 60 && min % 60 === 0 ? `${min / 60} hour${min === 60 ? '' : 's'}` : `${min} minutes`);

function reasonFor(rule, t) {
  if (rule.when === 'response') return `Auto-escalated by "${rule.name}": no first reply within the ${human(sla.response(t))} SLA for ${t.priority} priority${rule.after ? `, ${human(rule.after)} later` : ''}.`;
  if (rule.when === 'resolution') return `Auto-escalated by "${rule.name}": not resolved within the ${human(sla.resolution(t))} time to resolve${rule.after ? `, ${human(rule.after)} later` : ''}.`;
  return `Auto-escalated by "${rule.name}": no activity for ${human(rule.after)}.`;
}

// Runs every few minutes. Each ticket moves up at most one rule per run, lowest level first.
async function run() {
  const active = rules.filter((r) => r.enabled);
  if (!active.length) return;
  const tickets = require('./services/tickets');
  const rows = await db.query(
    `SELECT id, company_id, priority, category, status, escalation_level, created_at, assigned_at, first_response_at, last_activity_at, assigned_to
     FROM tickets WHERE status IN (${db.inList(OPEN_STATUSES)}) AND escalation_level < ?`,
    [...OPEN_STATUSES, MAX_LEVEL]
  );
  const ordered = [...active].sort((a, b) => a.level - b.level);
  for (const row of rows) {
    const rule = ordered.find(
      (r) =>
        Number(row.escalation_level) < r.level &&
        (!r.priorities.length || r.priorities.includes(row.priority)) &&
        (!r.company_id || Number(r.company_id) === Number(row.company_id)) &&
        (overdueBy(r, row) ?? -1) >= r.after
    );
    if (!rule) continue;
    const t = await tickets.getTicket(row.id);
    await tickets.escalate(t, null, reasonFor(rule, row), { level: rule.level, rule });
  }
}

module.exports = { load, save, run, rules: () => rules, DEFAULT_RULES, WHEN, MAX_LEVEL };
