// Clients never see who our engineers are: the names and phone numbers of technicians, of whoever a ticket is
// assigned to, of the technician on a site visit, and of whoever posted a work update. They see the team instead.
// Admins and agents who reply on tickets keep their names.
const TEAM = 'DateHeight Support';
const ENGINEER = 'DateHeight engineer';

const hidden = (role) => role === 'technician';

// Returns a copy of any API payload that is safe to show a client. Works on nested objects and arrays.
function scrub(value, depth = 0) {
  if (depth > 12 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  if (value instanceof Date || Buffer.isBuffer(value)) return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = scrub(v, depth + 1);

  // Tickets: who it is assigned to.
  if ('assignee_name' in out) out.assignee_name = out.assignee_name ? TEAM : null;
  for (const k of ['assignee_email', 'assignee_phone']) if (k in out) out[k] = null;
  // Site visits: the technician.
  if ('technician_name' in out) out.technician_name = out.technician_name ? ENGINEER : null;
  if ('technician_phone' in out) out.technician_phone = null;
  if ('technician_id' in out) out.technician_id = null;
  // Messages and chat posts by technicians, and every work update.
  if (out.kind === 'work_update' || hidden(out.user_role)) {
    if ('user_name' in out) out.user_name = out.kind === 'work_update' ? ENGINEER : TEAM;
    if ('user_id' in out) out.user_id = null;
  }
  // People lists (read receipts, chat members, typing): a technician appears as the team.
  if (hidden(out.role) && 'name' in out) {
    out.name = TEAM;
    for (const k of ['email', 'phone', 'avatar', 'avatar_url', 'job_title']) if (k in out) out[k] = null;
  }
  return out;
}

const isClient = (user) => !!user && user.role === 'client';

// Express middleware: every JSON response to a client goes through scrub().
function clientResponses(req, res, next) {
  if (isClient(req.user)) {
    const json = res.json.bind(res);
    res.json = (body) => json(scrub(body));
  }
  next();
}

// The name a client is shown for a staff member who did something (in emails and notifications).
const nameFor = (viewer, actor, { workUpdate = false } = {}) => {
  if (!actor) return actor;
  if (!isClient(viewer)) return actor.name;
  if (workUpdate) return ENGINEER;
  return hidden(actor.role) ? TEAM : actor.name;
};

module.exports = { TEAM, ENGINEER, scrub, clientResponses, nameFor, hidden, isClient };
