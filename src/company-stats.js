// A company's service figures for a period, safe to show the client: no staff names, internal notes or engineers.
// Used by the client Performance page and the monthly statement email.
const db = require('./db');
const sla = require('./sla');
const { parseTs, OPEN_STATUSES, PRIORITIES } = require('./util');
const { buckets } = require('./periods');

const minutesBetween = (a, b) => (parseTs(b) - parseTs(a)) / 60000;
const avg = (xs) => (xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : null);
const ranked = (rows, key) =>
  Object.entries(rows.reduce((m, r) => ((m[r[key]] = (m[r[key]] || 0) + 1), m), {}))
    .map(([name, total]) => ({ name, total }))
    .sort((a, b) => b.total - a.total);

async function companyStats(companyId, range) {
  const { since, until } = range;
  const [tickets, resolved, openNow, visits, ratings] = await Promise.all([
    db.query(
      `SELECT t.id, t.subject, t.category, t.priority, t.status, t.company_id, t.created_at, t.assigned_at, t.first_response_at, t.resolved_at,
        s.code AS site_code
       FROM tickets t LEFT JOIN sites s ON s.id = t.site_id
       WHERE t.company_id = ? AND t.created_at >= ? AND t.created_at < ? ORDER BY t.created_at DESC`,
      [companyId, since, until]
    ),
    db.query('SELECT id, created_at, assigned_at, resolved_at FROM tickets WHERE company_id = ? AND resolved_at IS NOT NULL AND resolved_at >= ? AND resolved_at < ?', [
      companyId,
      since,
      until,
    ]),
    db.one(`SELECT COUNT(*) AS n FROM tickets WHERE company_id = ? AND status IN (${db.inList(OPEN_STATUSES)})`, [companyId, ...OPEN_STATUSES]),
    db.query(
      `SELECT v.status FROM site_visits v JOIN tickets t ON t.id = v.ticket_id WHERE t.company_id = ? AND v.scheduled_at >= ? AND v.scheduled_at < ?`,
      [companyId, since, until]
    ),
    db.query(
      'SELECT r.rating FROM ticket_ratings r JOIN tickets t ON t.id = r.ticket_id WHERE t.company_id = ? AND r.updated_at >= ? AND r.updated_at < ?',
      [companyId, since, until]
    ),
  ]);

  const series = buckets(range);
  for (const t of tickets) {
    const b = series.index.get(series.keyOf(t.created_at));
    if (b) b.created++;
  }
  for (const t of resolved) {
    const b = series.index.get(series.keyOf(t.resolved_at));
    if (b) b.resolved++;
  }
  // Response and resolution times count from assignment, like the SLA.
  const from = (t) => t.assigned_at || t.created_at;
  const firstResponse = tickets.filter((t) => t.first_response_at).map((t) => Math.max(0, minutesBetween(from(t), t.first_response_at)));
  const resolution = resolved.map((t) => Math.max(0, minutesBetween(from(t), t.resolved_at)));
  const tally = sla.tally(tickets, companyId);
  const pct = (met, missed) => (met + missed ? Math.round((met / (met + missed)) * 100) : null);

  return {
    period: { from: range.from, to: range.to },
    kpis: {
      raised: tickets.length,
      resolved: resolved.length,
      openNow: Number(openNow.n),
      avgFirstResponseMin: avg(firstResponse),
      avgResolutionMin: avg(resolution),
      responsePct: pct(tally.slaMet, tally.slaMissed),
      resolutionPct: pct(tally.resolutionMet, tally.resolutionMissed),
      ...tally,
      visits: visits.length,
      visitsCompleted: visits.filter((v) => v.status === 'completed').length,
      ratings: ratings.length,
      avgRating: ratings.length ? Math.round((ratings.reduce((s, r) => s + Number(r.rating), 0) / ratings.length) * 10) / 10 : null,
    },
    series: series.list.map(({ key, created, resolved: done }) => ({ date: key, created, resolved: done })),
    weekly: series.weekly,
    byPriority: PRIORITIES.map((p) => ({ name: p, total: tickets.filter((t) => t.priority === p).length })),
    byCategory: ranked(tickets, 'category'),
    bySite: ranked(tickets.filter((t) => t.site_code), 'site_code').slice(0, 10),
  };
}

module.exports = { companyStats };
