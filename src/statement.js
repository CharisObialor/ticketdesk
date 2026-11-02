// Monthly statement: on the 1st of each month (after STATEMENT_HOUR in the company time zone) each client company's
// chosen contacts are emailed last month's figures, with a link to the Performance page to see more or save a PDF.
const config = require('./config');
const db = require('./db');
const { companyStats } = require('./company-stats');
const { HttpError } = require('./util');

const SEND_HOUR = 8;

const parseIds = (s) => {
  try {
    const v = JSON.parse(s || '[]');
    return Array.isArray(v) ? v.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
  } catch {
    return [];
  }
};

// The calendar month before `date` (local time), as a reporting range.
function lastMonth(date = new Date()) {
  const local = new Date(date.toLocaleString('en-US', { timeZone: config.timezone }));
  const first = new Date(Date.UTC(local.getFullYear(), local.getMonth() - 1, 1));
  const next = new Date(Date.UTC(local.getFullYear(), local.getMonth(), 1));
  const iso = (d) => d.toISOString().slice(0, 10);
  const last = new Date(next.getTime() - 864e5);
  return {
    key: iso(first).slice(0, 7),
    label: first.toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
    range: { custom: true, from: iso(first), to: iso(last), days: Math.round((next - first) / 864e5), start: first, end: last, since: `${iso(first)} 00:00:00`, until: `${iso(next)} 00:00:00` },
  };
}

// Recipients must be active client contacts of the company.
async function cleanRecipients(companyId, ids) {
  const list = [...new Set((Array.isArray(ids) ? ids : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 20);
  if (!list.length) return [];
  const rows = await db.query(`SELECT id FROM users WHERE company_id = ? AND role = 'client' AND id IN (${db.inList(list)})`, [companyId, ...list]);
  if (rows.length !== list.length) throw new HttpError(400, 'Statements can only go to people at this company');
  return list;
}

async function sendFor(company, month = lastMonth()) {
  const ids = parseIds(company.statement_recipients);
  if (!ids.length) return 0;
  const people = await db.query(`SELECT id, name, email, role, notify_email FROM users WHERE id IN (${db.inList(ids)}) AND is_active = 1 AND role = 'client'`, ids);
  if (!people.length) return 0;
  const stats = await companyStats(company.id, month.range);
  require('./notify').statement(company, people, stats, month.label);
  await db.query('UPDATE companies SET statement_sent_for = ? WHERE id = ?', [month.key, company.id]);
  return people.length;
}

// Runs hourly; sends each company's statement once a month.
async function runIfDue() {
  const local = new Date(new Date().toLocaleString('en-US', { timeZone: config.timezone }));
  if (local.getHours() < SEND_HOUR) return;
  const month = lastMonth();
  const due = await db.query("SELECT * FROM companies WHERE is_active = 1 AND statement_recipients IS NOT NULL AND statement_recipients <> '[]' AND (statement_sent_for IS NULL OR statement_sent_for <> ?)", [
    month.key,
  ]);
  for (const c of due) await sendFor(c, month).catch((err) => console.error(`[statement] company ${c.id} failed: ${err.message}`));
}

module.exports = { runIfDue, sendFor, lastMonth, cleanRecipients, parseIds };
