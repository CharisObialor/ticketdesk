// Company reports for admins: everything about one client company over a period, for reviews and account meetings.
const router = require('express').Router();
const config = require('../config');
const sla = require('../sla');
const db = require('../db');
const { requireAdmin } = require('../auth');
const { wrap, now, parseTs, HttpError, OPEN_STATUSES, PRIORITIES } = require('../util');
const { parseRange, buckets } = require('../periods');

const minutesBetween = (a, b) => (parseTs(b) - parseTs(a)) / 60000;
const avg = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const countBy = (rows, key) => rows.reduce((m, r) => ((m[r[key]] = (m[r[key]] || 0) + 1), m), {});
const ranked = (obj) =>
  Object.entries(obj)
    .map(([name, total]) => ({ name, total }))
    .sort((a, b) => b.total - a.total);

router.get(
  '/company/:id',
  requireAdmin,
  wrap(async (req, res) => {
    const company = await db.one('SELECT * FROM companies WHERE id = ?', [Number(req.params.id)]);
    if (!company) throw new HttpError(404, 'Company not found');
    const range = parseRange(req.query);
    const { since, until } = range;
    const cid = company.id;
    const openIn = db.inList(OPEN_STATUSES);

    const [tickets, openNow, people, ratings, visits, messages, chats, adminRatings] = await Promise.all([
      // Every ticket raised in the period, with who raised and handled it.
      db.query(
        `SELECT t.id, t.subject, t.category, t.priority, t.status, t.escalated, t.created_at, t.assigned_at, t.first_response_at, t.resolved_at,
          t.last_activity_at, t.assigned_to, cu.name AS requester, cu.email AS requester_email, cu.job_title AS requester_title, au.name AS assignee
         FROM tickets t LEFT JOIN users cu ON cu.id = t.created_by LEFT JOIN users au ON au.id = t.assigned_to
         WHERE t.company_id = ? AND t.created_at >= ? AND t.created_at < ? ORDER BY t.created_at DESC`,
        [cid, since, until]
      ),
      db.query(
        `SELECT t.id, t.subject, t.priority, t.status, t.escalated, t.created_at, t.first_response_at, au.name AS assignee
         FROM tickets t LEFT JOIN users au ON au.id = t.assigned_to
         WHERE t.company_id = ? AND t.status IN (${openIn}) ORDER BY t.created_at`,
        [cid, ...OPEN_STATUSES]
      ),
      db.query('SELECT id, name, email, job_title, phone, is_active, last_login_at FROM users WHERE company_id = ? ORDER BY name', [cid]),
      db.query(
        `SELECT r.ticket_id, r.rating, r.comment, r.updated_at, u.name AS user_name, t.subject, au.name AS assignee
         FROM ticket_ratings r JOIN tickets t ON t.id = r.ticket_id LEFT JOIN users u ON u.id = r.user_id LEFT JOIN users au ON au.id = t.assigned_to
         WHERE t.company_id = ? AND r.updated_at >= ? AND r.updated_at < ? ORDER BY r.updated_at DESC`,
        [cid, since, until]
      ),
      db.query(
        `SELECT v.id, v.ticket_id, v.scheduled_at, v.duration_min, v.location, v.status, v.started_at, v.completed_at, v.signed_by,
          v.report, tu.name AS technician, t.subject
         FROM site_visits v JOIN tickets t ON t.id = v.ticket_id LEFT JOIN users tu ON tu.id = v.technician_id
         WHERE t.company_id = ? AND v.scheduled_at >= ? AND v.scheduled_at < ? ORDER BY v.scheduled_at DESC`,
        [cid, since, until]
      ),
      db.one(
        `SELECT COUNT(*) AS n, SUM(CASE WHEN u.role = 'client' THEN 1 ELSE 0 END) AS from_client
         FROM messages m JOIN tickets t ON t.id = m.ticket_id LEFT JOIN users u ON u.id = m.user_id
         WHERE t.company_id = ? AND m.kind = 'message' AND m.is_internal = 0 AND m.created_at >= ? AND m.created_at < ?`,
        [cid, since, until]
      ),
      db.one(
        `SELECT COUNT(DISTINCT g.id) AS groups, COUNT(cm.id) AS messages
         FROM chat_groups g LEFT JOIN chat_messages cm ON cm.group_id = g.id AND cm.kind = 'message' AND cm.created_at >= ? AND cm.created_at < ?
         WHERE g.company_id = ?`,
        [since, until, cid]
      ),
      // How this company's people rated each of our admins.
      db.query(
        `SELECT r.admin_id, u.name, COUNT(*) AS n, AVG(r.rating) AS avg FROM admin_ratings r JOIN tickets t ON t.id = r.ticket_id JOIN users u ON u.id = r.admin_id
         WHERE t.company_id = ? AND r.updated_at >= ? AND r.updated_at < ? GROUP BY r.admin_id, u.name ORDER BY avg DESC`,
        [cid, since, until]
      ),
    ]);
    // Resolved in the period, whenever they were raised.
    const resolved = await db.query(
      `SELECT id, created_at, resolved_at, assigned_to FROM tickets
       WHERE company_id = ? AND resolved_at IS NOT NULL AND resolved_at >= ? AND resolved_at < ?`,
      [cid, since, until]
    );

    const series = buckets(range);
    for (const t of tickets) {
      const b = series.index.get(series.keyOf(t.created_at));
      if (b) b.created++;
    }
    for (const t of resolved) {
      const b = series.index.get(series.keyOf(t.resolved_at));
      if (b) b.resolved++;
    }

    const nowTs = now();
    const firstResponse = tickets.filter((t) => t.first_response_at).map((t) => minutesBetween(t.created_at, t.first_response_at));
    const resolution = resolved.map((t) => minutesBetween(t.created_at, t.resolved_at));
    const { slaMet, slaMissed, resolutionMet, resolutionMissed } = sla.tally(tickets, cid);

    // Who at the company raised what, and who on our side handled it.
    const byRequester = ranked(countBy(tickets.filter((t) => t.requester), 'requester')).slice(0, 10);
    const handled = {};
    for (const t of tickets) {
      if (!t.assignee) continue;
      const h = (handled[t.assignee] ||= { name: t.assignee, tickets: 0, resolved: 0, ratings: [] });
      h.tickets++;
      if (t.resolved_at) h.resolved++;
    }
    for (const r of ratings) if (r.assignee && handled[r.assignee]) handled[r.assignee].ratings.push(Number(r.rating));

    const ageDays = (ts) => Math.floor(minutesBetween(ts, nowTs) / 1440);
    res.json({
      generatedAt: nowTs,
      period: { from: range.from, to: range.to, days: range.days, custom: range.custom, weekly: series.weekly },
      company: {
        id: company.id,
        name: company.name,
        rc_number: company.rc_number,
        email_domain: company.email_domain,
        is_active: !!company.is_active,
        logo_url: company.logo ? `/api/companies/${company.id}/logo?v=${company.logo}` : null,
        since: company.created_at,
      },
      kpis: {
        raised: tickets.length,
        resolved: resolved.length,
        openNow: openNow.length,
        escalated: tickets.filter((t) => Number(t.escalated)).length,
        urgent: tickets.filter((t) => t.priority === 'urgent').length,
        avgFirstResponseMin: avg(firstResponse),
        medianFirstResponseMin: median(firstResponse),
        avgResolutionMin: avg(resolution),
        medianResolutionMin: median(resolution),
        slaMet,
        slaMissed,
        slaPct: slaMet + slaMissed ? Math.round((slaMet / (slaMet + slaMissed)) * 100) : null,
        resolutionMet,
        resolutionMissed,
        resolutionPct: resolutionMet + resolutionMissed ? Math.round((resolutionMet / (resolutionMet + resolutionMissed)) * 100) : null,
        // The targets this company is held to.
        sla: sla.forCompany(cid),
        ratings: ratings.length,
        avgRating: avg(ratings.map((r) => Number(r.rating))),
        csatPct: ratings.length ? Math.round((ratings.filter((r) => Number(r.rating) >= 4).length / ratings.length) * 100) : null,
        messages: Number(messages.n) || 0,
        clientMessages: Number(messages.from_client) || 0,
        chatGroups: Number(chats.groups) || 0,
        chatMessages: Number(chats.messages) || 0,
        visits: visits.length,
        visitsCompleted: visits.filter((v) => v.status === 'completed').length,
        activeUsers: people.filter((p) => p.is_active).length,
        requesters: new Set(tickets.map((t) => t.requester_email).filter(Boolean)).size,
      },
      series: series.list,
      byStatus: ranked(countBy(tickets, 'status')),
      byPriority: PRIORITIES.map((p) => ({ name: p, total: tickets.filter((t) => t.priority === p).length })),
      byCategory: ranked(countBy(tickets, 'category')),
      byRequester,
      handledBy: Object.values(handled)
        .map((h) => ({ name: h.name, tickets: h.tickets, resolved: h.resolved, ratings: h.ratings.length, avgRating: avg(h.ratings) }))
        .sort((a, b) => b.tickets - a.tickets),
      ratingBreakdown: [1, 2, 3, 4, 5].map((n) => ({ rating: n, total: ratings.filter((r) => Number(r.rating) === n).length })),
      adminRatings: adminRatings.map((r) => ({ name: r.name, ratings: Number(r.n), avgRating: Math.round(Number(r.avg) * 10) / 10 })),
      ratings: ratings.slice(0, 50),
      openNow: openNow.map((t) => ({ ...t, ageDays: ageDays(t.created_at) })),
      visits,
      people,
      tickets: tickets.map((t) => ({
        ...t,
        firstResponseMin: t.first_response_at ? minutesBetween(t.created_at, t.first_response_at) : null,
        resolutionMin: t.resolved_at ? minutesBetween(t.created_at, t.resolved_at) : null,
      })),
    });
  })
);

module.exports = router;
