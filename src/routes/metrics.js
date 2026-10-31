const router = require('express').Router();
const config = require('../config');
const db = require('../db');
const realtime = require('../realtime');
const { TICKET_SELECT } = require('../services/tickets');
const { requireStaff, STAFF_ROLES } = require('../auth');
const { wrap, now, parseTs, OPEN_STATUSES, PRIORITIES } = require('../util');
const { parseRange, buckets } = require('../periods');

const minutesBetween = (a, b) => (parseTs(b) - parseTs(a)) / 60000;
const avg = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// The figures are the same for every staff member, so each period is worked out once and shared: for up to
// 30 seconds while nothing changes, and at most 2 seconds once tickets, messages or ratings have changed.
// Concurrent requests for the same period wait on the same computation instead of repeating it.
const CACHE_MS = 30_000;
const STALE_AFTER_CHANGE_MS = 2_000;
const cache = new Map();

router.get(
  '/',
  requireStaff,
  wrap(async (req, res) => {
    const range = parseRange(req.query);
    const key = range.custom ? `${range.from}_${range.to}` : `d${range.days}`;
    let hit = cache.get(key);
    const fresh = hit && hit.expires > Date.now() && (hit.version === db.version() || Date.now() - hit.at < STALE_AFTER_CHANGE_MS);
    if (!fresh) {
      for (const [k, v] of cache) if (v.expires < Date.now()) cache.delete(k);
      hit = { at: Date.now(), expires: Date.now() + CACHE_MS, version: db.version(), body: build(range) };
      cache.set(key, hit);
      hit.body.catch(() => cache.delete(key));
    }
    const body = await hit.body;
    // Who is online changes by the second, so it is added fresh on every request.
    const presence = realtime.presence();
    const onlineIds = new Set(presence.users.map((u) => u.id));
    res.json({
      ...body,
      online: presence,
      agents: body.agents.map((a) => ({ ...a, online: onlineIds.has(a.id) })),
    });
  })
);

async function build(range) {
  const { since, until, days } = range;
  const openIn = db.inList(OPEN_STATUSES);

  const [statusRows, openAgg, created, resolved, escalations, byCompany, workload, staffRows, messages, recent] = await Promise.all([
    db.query('SELECT status, COUNT(*) AS n FROM tickets GROUP BY status'),
    db.one(
      `SELECT SUM(CASE WHEN escalated = 1 THEN 1 ELSE 0 END) AS escalated,
        SUM(CASE WHEN assigned_to IS NULL THEN 1 ELSE 0 END) AS unassigned,
        SUM(CASE WHEN priority = 'urgent' THEN 1 ELSE 0 END) AS urgent
       FROM tickets WHERE status IN (${openIn})`,
      OPEN_STATUSES
    ),
    db.query('SELECT id, priority, category, created_at, first_response_at FROM tickets WHERE created_at >= ? AND created_at < ?', [since, until]),
    db.query('SELECT id, created_at, resolved_at, assigned_to FROM tickets WHERE resolved_at IS NOT NULL AND resolved_at >= ? AND resolved_at < ?', [
      since,
      until,
    ]),
    db.one('SELECT COUNT(*) AS n FROM tickets WHERE escalated_at IS NOT NULL AND escalated_at >= ? AND escalated_at < ?', [since, until]),
    db.query(
      `SELECT c.name, COUNT(*) AS total FROM tickets t JOIN companies c ON c.id = t.company_id
       WHERE t.created_at >= ? AND t.created_at < ? GROUP BY c.id, c.name ORDER BY total DESC LIMIT 8`,
      [since, until]
    ),
    db.query(
      `SELECT assigned_to, COUNT(*) AS open_count, SUM(CASE WHEN escalated = 1 THEN 1 ELSE 0 END) AS escalated
       FROM tickets WHERE status IN (${openIn}) AND COALESCE(assigned_to, 0) <> 0 GROUP BY assigned_to`,
      OPEN_STATUSES
    ),
    db.query(`SELECT id, name, role, last_seen_at FROM users WHERE role IN (${db.inList(STAFF_ROLES)}) AND is_active = 1 ORDER BY name`, STAFF_ROLES),
    db.one("SELECT COUNT(*) AS n FROM messages WHERE kind = 'message' AND created_at >= ? AND created_at < ?", [since, until]),
    db.query(`${TICKET_SELECT} ORDER BY t.last_activity_at DESC LIMIT 8`),
  ]);
  const ratings = await db.query(
    `SELECT r.ticket_id, r.rating, r.comment, r.updated_at, u.name AS user_name, c.name AS company_name, t.subject, t.assigned_to
     FROM ticket_ratings r JOIN tickets t ON t.id = r.ticket_id JOIN companies c ON c.id = t.company_id
     LEFT JOIN users u ON u.id = r.user_id WHERE r.updated_at >= ? AND r.updated_at < ? ORDER BY r.updated_at DESC`,
    [since, until]
  );

  const status = Object.fromEntries(statusRows.map((r) => [r.status, Number(r.n)]));
  const series = buckets(range);
  for (const t of created) {
    const b = series.index.get(series.keyOf(t.created_at));
    if (b) b.created++;
  }
  for (const t of resolved) {
    const b = series.index.get(series.keyOf(t.resolved_at));
    if (b) b.resolved++;
  }

  const firstResponse = created.filter((t) => t.first_response_at).map((t) => minutesBetween(t.created_at, t.first_response_at));
  const resolution = resolved.map((t) => minutesBetween(t.created_at, t.resolved_at));

  // SLA: tickets that got a first response in time vs. those that missed it (answered late or still overdue).
  let slaMet = 0;
  let slaMissed = 0;
  const nowTs = now();
  for (const t of created) {
    const limit = config.slaMinutes[t.priority] || config.slaMinutes.normal;
    const waited = t.first_response_at ? minutesBetween(t.created_at, t.first_response_at) : minutesBetween(t.created_at, nowTs);
    if (t.first_response_at && waited <= limit) slaMet++;
    else if (waited > limit) slaMissed++;
  }

  const count = (rows, key) => rows.reduce((m, r) => ((m[r[key]] = (m[r[key]] || 0) + 1), m), {});
  const resolvedBy = count(resolved, 'assigned_to');
  const load = new Map(workload.map((w) => [Number(w.assigned_to), w]));

  return {
    days,
    from: range.from,
    to: range.to,
    custom: range.custom,
    weekly: series.weekly,
    kpis: {
      raised: created.length,
      resolved: resolved.length,
      open: OPEN_STATUSES.reduce((s, k) => s + (status[k] || 0), 0),
      escalatedOpen: Number(openAgg.escalated) || 0,
      escalationsInPeriod: Number(escalations.n) || 0,
      unassigned: Number(openAgg.unassigned) || 0,
      urgentOpen: Number(openAgg.urgent) || 0,
      avgFirstResponseMin: avg(firstResponse),
      medianFirstResponseMin: median(firstResponse),
      avgResolutionMin: avg(resolution),
      slaMet,
      slaMissed,
      // Customer satisfaction: share of ratings that are 4 or 5, plus the average.
      ratings: ratings.length,
      csatPct: ratings.length ? Math.round((ratings.filter((r) => r.rating >= 4).length / ratings.length) * 100) : null,
      avgRating: ratings.length ? avg(ratings.map((r) => Number(r.rating))) : null,
      messages: Number(messages.n) || 0,
    },
    status,
    series: series.list,
    byPriority: PRIORITIES.map((p) => ({
      name: p,
      total: created.filter((t) => t.priority === p).length,
    })),
    byCategory: Object.entries(count(created, 'category'))
      .map(([name, total]) => ({ name, total }))
      .sort((a, b) => b.total - a.total),
    byCompany: byCompany.map((r) => ({ name: r.name, total: Number(r.total) })),
    agents: staffRows.map((s) => ({
      id: s.id,
      name: s.name,
      role: s.role,
      last_seen_at: s.last_seen_at,
      open: Number(load.get(s.id)?.open_count) || 0,
      escalated: Number(load.get(s.id)?.escalated) || 0,
      resolved: resolvedBy[s.id] || 0,
      avgRating: avg(ratings.filter((r) => Number(r.assigned_to) === s.id).map((r) => Number(r.rating))),
    })),
    recent,
    ratingBreakdown: [1, 2, 3, 4, 5].map((n) => ({
      rating: n,
      total: ratings.filter((r) => Number(r.rating) === n).length,
    })),
    recentRatings: ratings.slice(0, 6),
  };
}

module.exports = router;
