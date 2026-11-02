// Reporting periods shared by the dashboard and company reports: a preset (last 7/30/90/365 days) or a custom
// from-to range of calendar dates (UTC), plus day or week buckets for charts.
const { now, parseTs, HttpError } = require('./util');

const DAY = 864e5;
const MAX_DAYS = 3 * 366;
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime());

// Returns { since, until } as stored timestamps (until is exclusive), the first and last day, and the length in days.
function parseRange(query) {
  if (query.from || query.to) {
    if (!isDate(query.from) || !isDate(query.to)) throw new HttpError(400, 'Choose a valid start and end date');
    const start = new Date(`${query.from}T00:00:00Z`);
    const end = new Date(`${query.to}T00:00:00Z`);
    if (end < start) throw new HttpError(400, 'The end date must be on or after the start date');
    const days = Math.round((end - start) / DAY) + 1;
    if (days > MAX_DAYS) throw new HttpError(400, 'Choose a range of three years or less');
    return { custom: true, from: query.from, to: query.to, days, start, end, since: now(start), until: now(new Date(end.getTime() + DAY)) };
  }
  const days = [7, 30, 90, 365].includes(Number(query.days)) ? Number(query.days) : 30;
  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  const start = new Date(end.getTime() - (days - 1) * DAY);
  return {
    custom: false,
    days,
    start,
    end,
    from: start.toISOString().slice(0, 10),
    to: end.toISOString().slice(0, 10),
    since: now(new Date(Date.now() - days * DAY)),
    until: now(new Date(Date.now() + 60000)),
  };
}

// Day buckets for ranges up to a month, Monday-starting weeks for longer ones.
function buckets(range) {
  const weekly = range.days > 31;
  const out = [];
  const start = new Date(range.start);
  if (weekly) start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  for (let d = new Date(start); d <= range.end; d = new Date(d.getTime() + (weekly ? 7 : 1) * DAY)) {
    out.push({ key: d.toISOString().slice(0, 10), created: 0, resolved: 0 });
  }
  // Bucket keys depend only on the calendar day, so each day is worked out once.
  const cache = new Map();
  const keyOf = (ts) => {
    const day = String(ts).slice(0, 10);
    let key = cache.get(day);
    if (key === undefined) {
      const d = parseTs(`${day} 00:00:00`);
      if (weekly) d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
      key = d.toISOString().slice(0, 10);
      cache.set(day, key);
    }
    return key;
  };
  return { list: out, index: new Map(out.map((b) => [b.key, b])), keyOf, weekly };
}

module.exports = { parseRange, buckets };
