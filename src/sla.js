const config = require('./config');
const db = require('./db');
const { now, parseTs, HttpError, CATEGORIES } = require('./util');

// SLA targets, in minutes, for each priority: how long we have to send the first reply (response) and to
// resolve the ticket (resolution). Admins set the defaults on the System page. A company can have its own
// targets and its own fault categories, each with a priority and a time to resolve (from its SLA contract).
const PRIORITIES = ['urgent', 'high', 'normal', 'low'];
const KINDS = ['response', 'resolution'];
const BUILT_IN = {
  response: { ...config.slaMinutes },
  resolution: { urgent: 240, high: 1440, normal: 4320, low: 10080 },
};
// At least 5 minutes, at most 120 days.
const MIN = 5;
const MAX = 120 * 1440;
const MAX_CATEGORIES = 60;

let defaults = BUILT_IN;
const companies = new Map();

function minutesValue(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < MIN || n > MAX) throw new HttpError(400, `SLA times must be between ${MIN} minutes and 120 days`);
  return n;
}

// Keeps only valid numbers; with `partial`, missing values are left out (they fall back to the defaults).
function clean(input, partial) {
  const out = {};
  for (const kind of KINDS) {
    const src = (input && input[kind]) || {};
    const k = {};
    for (const p of PRIORITIES) {
      const v = src[p];
      if (v === null || v === undefined || v === '') {
        if (!partial) k[p] = BUILT_IN[kind][p];
        continue;
      }
      k[p] = minutesValue(v);
    }
    if (!partial || Object.keys(k).length) out[kind] = k;
  }
  return out;
}

// A company's fault categories: name, what it covers, its priority and (optionally) its own time to resolve.
function cleanCategories(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const c of list.slice(0, MAX_CATEGORIES)) {
    const name = String((c && c.name) || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push({
      name,
      description: String(c.description || '').replace(/\s+/g, ' ').trim().slice(0, 300) || null,
      priority: PRIORITIES.includes(c.priority) ? c.priority : 'normal',
      resolution: c.resolution === null || c.resolution === undefined || c.resolution === '' ? null : minutesValue(c.resolution),
      // What to describe for this fault (prefilled on the new ticket form), and photos the client must attach.
      template: String(c.template || '').replace(/\r\n/g, '\n').trim().slice(0, 2000) || null,
      photos_min: Math.min(Math.max(Math.round(Number(c.photos_min) || 0), 0), 5),
    });
  }
  return out;
}

const parse = (s) => {
  try {
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
};

// Reads the defaults and every company's own targets into memory; called at startup and after a change.
async function load() {
  const row = await db.one("SELECT value FROM settings WHERE name = 'sla'");
  const saved = parse(row && row.value);
  defaults = saved ? { response: { ...BUILT_IN.response, ...saved.response }, resolution: { ...BUILT_IN.resolution, ...saved.resolution } } : BUILT_IN;
  companies.clear();
  for (const c of await db.query('SELECT id, sla FROM companies WHERE sla IS NOT NULL')) {
    const own = parse(c.sla);
    if (own) companies.set(Number(c.id), own);
  }
}

// The targets that apply to one company: its own where set, the defaults otherwise.
function forCompany(companyId) {
  const own = companies.get(Number(companyId)) || {};
  return {
    response: { ...defaults.response, ...own.response },
    resolution: { ...defaults.resolution, ...own.resolution },
    categories: own.categories || [],
  };
}
const findCategory = (limits, name) => {
  const key = String(name || '').toLowerCase();
  return limits.categories.find((c) => c.name.toLowerCase() === key) || null;
};

const response = (t) => forCompany(t.company_id).response[t.priority] || defaults.response.normal;
// A fault category with its own time to resolve wins over the priority's.
function resolution(t, companyId) {
  const limits = forCompany(companyId ?? t.company_id);
  const cat = findCategory(limits, t.category);
  return (cat && cat.resolution) || limits.resolution[t.priority] || limits.resolution.normal;
}

// Categories a ticket for this company can use: the company's fault categories (plus Other), or the standard list.
function categoryNames(companyId) {
  const own = forCompany(companyId).categories.map((c) => c.name);
  if (!own.length) return CATEGORIES;
  return own.some((n) => n.toLowerCase() === 'other') ? own : [...own, 'Other'];
}
const categoryOf = (companyId, name) => findCategory(forCompany(companyId), name);

const minutes = (from, to) => (parseTs(to).getTime() - parseTs(from).getTime()) / 60000;

// The SLA clocks run from when the ticket was first assigned; an unassigned ticket has no clock yet.
const start = (t) => t.assigned_at || null;
// When the time to resolve runs out (a Date), or null while the ticket is unassigned.
function resolutionDue(t) {
  const s = start(t);
  return s ? new Date(parseTs(s).getTime() + resolution(t) * 60000) : null;
}

// Counts tickets that met or missed each target. A ticket still waiting past its target counts as missed.
// Rows need company_id (or pass companyId), priority, category, status, assigned_at, first_response_at and resolved_at.
// Tickets never assigned have no clock running and are not counted.
function tally(rows, companyId) {
  const nowTs = now();
  const r = { slaMet: 0, slaMissed: 0, resolutionMet: 0, resolutionMissed: 0 };
  for (const t of rows) {
    const from = start(t);
    if (!from) continue;
    const limits = forCompany(companyId ?? t.company_id);
    const respLimit = limits.response[t.priority] || limits.response.normal;
    const waited = Math.max(0, minutes(from, t.first_response_at || nowTs));
    if (t.first_response_at && waited <= respLimit) r.slaMet++;
    else if (waited > respLimit) r.slaMissed++;
    const resLimit = resolution(t, companyId);
    if (t.resolved_at) {
      if (Math.max(0, minutes(from, t.resolved_at)) <= resLimit) r.resolutionMet++;
      else r.resolutionMissed++;
    } else if (t.status !== 'closed' && minutes(from, nowTs) > resLimit) r.resolutionMissed++;
  }
  return r;
}

async function setDefaults(input) {
  const value = clean(input, false);
  const ts = now();
  const updated = await db.query("UPDATE settings SET value = ?, updated_at = ? WHERE name = 'sla'", [JSON.stringify(value), ts]);
  if (!updated.affectedRows) await db.query("INSERT INTO settings (name, value, updated_at) VALUES ('sla', ?, ?)", [JSON.stringify(value), ts]);
  await load();
  return defaults;
}

// Saves a company's own targets and fault categories; null (or nothing set) means it follows the defaults.
async function setCompany(companyId, input) {
  const value = input ? clean(input, true) : {};
  const categories = input ? cleanCategories(input.categories) : [];
  if (categories.length) value.categories = categories;
  await db.query('UPDATE companies SET sla = ? WHERE id = ?', [Object.keys(value).length ? JSON.stringify(value) : null, companyId]);
  await load();
  return companies.get(Number(companyId)) || null;
}

// What the browser needs to show countdowns: staff get every company, a client only their own company's targets.
function forUser(user) {
  if (user.role === 'client') {
    const own = companies.get(Number(user.company_id));
    return { defaults: forCompany(user.company_id), companies: own ? { [user.company_id]: own } : {} };
  }
  return { defaults, companies: Object.fromEntries(companies) };
}

// How often each admin is reminded about SLA deadlines, in minutes, per kind of breach. 0 means no reminders
// (the item still shows on the Actions page and in the morning summary). `email` sends the reminders by email too.
const REMINDER_KINDS = ['response_due', 'response_overdue', 'resolution_due', 'resolution_overdue'];
const REMINDER_CHOICES = [0, 15, 30, 60, 120, 240, 480, 1440];
const REMINDER_DEFAULTS = { response_due: 60, response_overdue: 120, resolution_due: 1440, resolution_overdue: 240, email: false };

function reminderPrefs(raw) {
  const saved = typeof raw === 'string' ? parse(raw) : raw;
  const out = { ...REMINDER_DEFAULTS };
  if (!saved || typeof saved !== 'object') return out;
  for (const k of REMINDER_KINDS) if (REMINDER_CHOICES.includes(Number(saved[k]))) out[k] = Number(saved[k]);
  if (saved.email !== undefined) out.email = !!saved.email;
  return out;
}

module.exports = {
  PRIORITIES,
  REMINDER_KINDS,
  REMINDER_CHOICES,
  reminderPrefs,
  BUILT_IN,
  load,
  forCompany,
  response,
  resolution,
  start,
  resolutionDue,
  categoryNames,
  categoryOf,
  tally,
  setDefaults,
  setCompany,
  forUser,
  own: (id) => companies.get(Number(id)) || null,
};
