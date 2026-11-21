// The full transcript of a resolved or closed ticket, as one self-contained HTML page that prints cleanly to PDF:
// both logos, the ticket's details, everyone who worked on it with their email addresses, site visits, the whole
// conversation in order (job updates, emails with their senders and copies, photos shown in place), sign-off and the
// client's rating. Pictures are embedded, so the file works offline and the hosted copy needs no sign-in.
//
// Two audiences: 'staff' sees every name (technicians included) and, if asked, internal notes. 'client' follows the
// portal's privacy rule (privacy.js): technicians and work-update authors appear as the team, and internal notes,
// visit instructions and BCC lists are left out. Shared links always use the client version.
const fs = require('fs');
const path = require('path');
const db = require('./db');
const config = require('./config');
const svc = require('./services/tickets');
const { scrub, TEAM, ENGINEER, hidden } = require('./privacy');
const { uploadsDir } = require('./uploads');
const { ticketRef, escapeHtml: e, parseTs, now, STATUS_LABELS } = require('./util');

const publicDir = path.join(__dirname, '..', 'public');
const logosDir = path.join(config.storageDir, 'logos');

// Photos are embedded up to these sizes; anything over is listed by name instead.
const MAX_IMAGE = 6 * 1024 * 1024;
const MAX_IMAGES_TOTAL = 40 * 1024 * 1024;
const IMAGE = /^image\/(png|jpe?g|gif|webp)$/;
const MIME_BY_EXT = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' };

const ROLE_LABELS = { admin: 'Administrator', agent: 'Support agent', technician: 'Field engineer', client: 'Client' };
const VISIT_LABELS = { scheduled: 'Scheduled', in_progress: 'In progress', completed: 'Completed', cancelled: 'Cancelled' };

const when = (ts) =>
  ts ? parseTs(ts).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: config.timezone }) : '-';
const day = (ts) => parseTs(ts).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: config.timezone });
const sizeKb = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

function duration(fromTs, toTs) {
  if (!fromTs || !toTs) return null;
  const min = Math.max(0, Math.round((parseTs(toTs) - parseTs(fromTs)) / 60000));
  return minutes(min);
}
function minutes(min) {
  if (!min) return '0 min';
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = min % 60;
  return [d && `${d} d`, h && `${h} h`, m && `${m} min`].filter(Boolean).join(' ');
}

async function dataUri(file, mime) {
  try {
    const buf = await fs.promises.readFile(file);
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

// Our logo is read once.
let ownLogo;
async function ourLogo() {
  if (ownLogo === undefined) ownLogo = await dataUri(path.join(publicDir, 'logo.png'), 'image/png');
  return ownLogo;
}

async function companyLogo(c) {
  if (!c || !c.logo) return null;
  const name = path.basename(c.logo);
  return dataUri(path.join(logosDir, name), MIME_BY_EXT[path.extname(name).toLowerCase()] || 'image/png');
}

// Everything the transcript shows, already made safe for the audience.
async function gather(ticketId, { audience = 'client', includeInternal = false } = {}) {
  const staffCopy = audience === 'staff';
  const internal = staffCopy && includeInternal;
  const t = await svc.getTicket(ticketId);
  if (!t) return null;
  const [messages, visits, rating, signoffs, company, stored] = await Promise.all([
    svc.getMessages(t.id, internal),
    db.query(
      `SELECT v.*, u.name AS technician_name, u.email AS technician_email, u.phone AS technician_phone
       FROM site_visits v LEFT JOIN users u ON u.id = v.technician_id WHERE v.ticket_id = ? ORDER BY v.scheduled_at`,
      [t.id]
    ),
    db.one('SELECT r.*, u.name AS user_name FROM ticket_ratings r LEFT JOIN users u ON u.id = r.user_id WHERE r.ticket_id = ?', [t.id]),
    db.query(
      `SELECT s.round, s.decision, s.comment, s.created_at, u.name AS user_name, u.role AS user_role FROM ticket_signoffs s
       LEFT JOIN users u ON u.id = s.user_id WHERE s.ticket_id = ? ORDER BY s.id`,
      [t.id]
    ),
    db.one('SELECT id, name, logo, email_domain FROM companies WHERE id = ?', [t.company_id]),
    db.query('SELECT id, stored_name FROM attachments WHERE ticket_id = ?', [t.id]),
  ]);

  // The people involved, from everything they did on the ticket.
  const ids = new Set([t.created_by, t.assigned_to, ...messages.map((m) => m.user_id), ...visits.map((v) => v.technician_id)].filter(Boolean));
  const users = ids.size
    ? await db.query(`SELECT id, name, email, role, job_title, phone FROM users WHERE id IN (${db.inList([...ids])})`, [...ids])
    : [];
  const byId = new Map(users.map((u) => [u.id, { ...u, replies: 0, updates: 0, minutes: 0, visits: 0 }]));
  for (const m of messages) {
    const p = byId.get(m.user_id);
    if (!p || m.kind === 'system') continue;
    if (m.kind === 'work_update') {
      p.updates++;
      p.minutes += Number(m.time_spent_min) || 0;
    } else if (!m.is_internal) p.replies++;
  }
  for (const v of visits) if (byId.has(v.technician_id)) byId.get(v.technician_id).visits++;
  const assignee = byId.get(t.assigned_to);
  if (assignee) assignee.assigned = true;
  const creator = byId.get(t.created_by);
  if (creator) creator.raised = true;

  let staff = [...byId.values()].filter((u) => u.role !== 'client' && (u.replies || u.updates || u.visits || u.assigned));
  let clients = [...byId.values()].filter((u) => u.role === 'client');
  // People who wrote in by email without a portal account, and everyone copied in.
  const outside = new Map();
  for (const m of messages) {
    if (!m.user_id && m.sender_email) outside.set(m.sender_email.toLowerCase(), { name: m.sender_name || m.sender_email, email: m.sender_email });
  }
  const copied = new Set();
  for (const m of messages) for (const addr of m.cc || []) copied.add(String(addr).toLowerCase());

  let shownMessages = messages;
  let shownVisits = visits;
  let shownTicket = t;
  if (!staffCopy) {
    // The client's copy: technicians become the team, work updates come from "our engineer".
    shownTicket = scrub(t);
    shownMessages = scrub(messages).map((m) => ({ ...m, bcc: null }));
    shownVisits = scrub(visits).map((v) => ({ ...v, notes: null, technician_email: null }));
    staff = staff.filter((u) => !hidden(u.role));
    // Admins and agents who only posted work updates are shown as the engineer, so they are not listed either.
    staff = staff.filter((u) => u.replies || u.assigned).map((u) => ({ ...u, updates: 0, minutes: 0, visits: 0 }));
    if (shownTicket.assignee_name) shownTicket.assignee_name = assignee && !hidden(assignee.role) ? assignee.name : TEAM;
    if (visits.length || messages.some((m) => m.kind === 'work_update')) staff.push({ name: ENGINEER, role: 'technician', team: true, updates: messages.filter((m) => m.kind === 'work_update').length, visits: visits.length, minutes: messages.reduce((n, m) => n + (m.kind === 'work_update' ? Number(m.time_spent_min) || 0 : 0), 0) });
  }

  // Photos, embedded until the size budget runs out.
  const storedById = new Map(stored.map((a) => [a.id, a.stored_name]));
  let budget = MAX_IMAGES_TOTAL;
  for (const m of shownMessages) {
    for (const a of m.attachments || []) {
      if (!IMAGE.test(a.mime) || a.size > MAX_IMAGE || a.size > budget) continue;
      const name = storedById.get(a.id);
      if (!name) continue;
      a.src = await dataUri(path.join(uploadsDir, path.basename(name)), a.mime);
      if (a.src) budget -= a.size;
    }
  }

  return {
    audience,
    includeInternal: internal,
    ticket: shownTicket,
    company,
    messages: shownMessages,
    visits: shownVisits,
    rating,
    signoffs: staffCopy ? signoffs : signoffs.map((s) => ({ ...s, user_name: hidden(s.user_role) ? TEAM : s.user_name })),
    staff,
    clients,
    outside: [...outside.values()],
    copied: [...copied].filter((addr) => ![...byId.values()].some((u) => u.email && u.email.toLowerCase() === addr) && !outside.has(addr)),
    logos: { ours: await ourLogo(), theirs: await companyLogo(company) },
  };
}

// ---- Rendering ----

const STYLE = `
:root{--ink:#111827;--muted:#6b7280;--faint:#9ca3af;--line:#e5e7eb;--soft:#f9fafb;--brand:#336cb5;--note:#fffbeb;--note-line:#fde68a}
*{box-sizing:border-box}
html{background:#f3f4f6}
body{margin:0;background:#f3f4f6;color:var(--ink);font:14px/1.55 -apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.sheet{max-width:860px;margin:24px auto;background:#fff;border:1px solid var(--line);border-radius:8px;padding:40px 48px}
.bar{max-width:860px;margin:16px auto 0;display:flex;gap:12px;align-items:center;justify-content:space-between;color:var(--muted);font-size:13px;padding:0 4px}
.bar button{font:inherit;font-weight:600;color:#fff;background:var(--brand);border:0;border-radius:6px;padding:8px 16px;cursor:pointer}
header.top{display:flex;align-items:center;justify-content:space-between;gap:24px;padding-bottom:20px;border-bottom:1px solid var(--line)}
header.top img{max-height:56px;max-width:200px;object-fit:contain;display:block}
header.top .co{font-weight:600;font-size:16px}
h1{font-size:22px;line-height:1.3;margin:24px 0 4px}
h2{font-size:15px;margin:32px 0 12px;padding-bottom:6px;border-bottom:1px solid var(--line)}
.sub{color:var(--muted);margin:0}
.status{display:inline-block;font-size:12px;font-weight:600;border:1px solid var(--line);border-radius:999px;padding:1px 10px;margin-left:6px;vertical-align:middle;background:var(--soft)}
dl.facts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 32px;margin:20px 0 0}
dl.facts div{display:flex;gap:12px;padding:7px 0;border-bottom:1px solid var(--line)}
dl.facts dt{color:var(--muted);min-width:130px;flex-shrink:0}
dl.facts dd{margin:0;font-weight:500;word-break:break-word}
.stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:20px 0 0}
.stats div{border:1px solid var(--line);border-radius:6px;padding:10px 12px}
.stats b{display:block;font-size:16px}
.stats span{color:var(--muted);font-size:12px}
table.people{width:100%;border-collapse:collapse}
table.people th{text-align:left;font-weight:500;color:var(--muted);font-size:12px;padding:6px 8px;border-bottom:1px solid var(--line)}
table.people td{padding:8px;border-bottom:1px solid var(--line);vertical-align:top}
table.people a{color:var(--brand);text-decoration:none}
.muted{color:var(--muted)}.small{font-size:12px}
.visit{border:1px solid var(--line);border-radius:6px;padding:12px 14px;margin:0 0 10px;break-inside:avoid}
.visit h3{margin:0 0 4px;font-size:14px}
.visit .report{white-space:pre-wrap;margin:8px 0 0}
.day{margin:28px 0 8px;color:var(--muted);font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em}
.item{border:1px solid var(--line);border-radius:6px;padding:12px 14px;margin:0 0 10px;break-inside:avoid}
.item.client{background:var(--soft)}
.item.note{background:var(--note);border-color:var(--note-line)}
.item .h{display:flex;flex-wrap:wrap;gap:4px 10px;align-items:baseline;margin-bottom:6px}
.item .h b{font-weight:600}
.item .h .t{margin-left:auto;color:var(--muted);font-size:12px}
.tag{font-size:11px;font-weight:600;color:var(--muted);border:1px solid var(--line);border-radius:4px;padding:0 6px;background:#fff}
.meta{color:var(--muted);font-size:12px;margin:-2px 0 6px}
.body{white-space:pre-wrap;word-wrap:break-word}
.sys{color:var(--muted);font-size:12px;padding:4px 0 4px 2px;margin:0 0 8px;break-inside:avoid}
.sys .t{margin-right:8px}
.photos{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;margin-top:10px}
.photos figure{margin:0;break-inside:avoid}
.photos img{width:100%;max-height:320px;object-fit:contain;background:var(--soft);border:1px solid var(--line);border-radius:4px;display:block}
.photos figcaption{font-size:11px;color:var(--muted);margin-top:3px;word-break:break-all}
ul.files{margin:8px 0 0;padding-left:18px;font-size:13px}
.sign{display:flex;gap:10px;align-items:baseline;padding:6px 0;border-bottom:1px solid var(--line)}
footer.end{margin-top:36px;padding-top:14px;border-top:1px solid var(--line);color:var(--muted);font-size:12px;display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap}
@media (max-width:640px){.sheet{margin:0;border:0;border-radius:0;padding:24px 16px}dl.facts{grid-template-columns:1fr}.stats{grid-template-columns:repeat(2,minmax(0,1fr))}header.top{flex-wrap:wrap}.bar{padding:0 16px}}
@page{size:A4;margin:14mm 12mm}
@media print{html,body{background:#fff}.sheet{margin:0;border:0;padding:0;max-width:none}.bar{display:none}h2{break-after:avoid}.day{break-after:avoid}}
`;

const who = (m) => (m.kind === 'system' ? 'System' : m.user_name || m.sender_name || m.sender_email || 'Former user');

function photo(a) {
  const label = a.label ? `${cap(a.label)}: ` : '';
  return `<figure><img src="${a.src}" alt="${e(a.original_name)}"><figcaption>${e(label + a.original_name)}</figcaption></figure>`;
}

function messageHtml(m, d) {
  if (m.kind === 'system') return `<div class="sys"><span class="t">${e(when(m.created_at))}</span>${e(m.body)}</div>`;
  const client = m.user_role === 'client' || (!m.user_id && m.sender_email);
  const cls = m.is_internal ? 'note' : client ? 'client' : 'staff';
  const tags = [];
  if (m.kind === 'work_update') tags.push('Job update');
  if (m.is_internal) tags.push('Internal note');
  if (!m.user_id && m.sender_email) tags.push('By email');
  const role = m.user_role && m.kind !== 'work_update' ? ROLE_LABELS[m.user_role] : null;
  const meta = [];
  if (!m.user_id && m.sender_email) meta.push(`From ${e(m.sender_email)}`);
  if (m.cc && m.cc.length) meta.push(`Copied: ${e(m.cc.join(', '))}`);
  if (d.audience === 'staff' && m.bcc && m.bcc.length) meta.push(`Blind copied: ${e(m.bcc.join(', '))}`);
  if (m.time_spent_min) meta.push(`Time spent: ${e(minutes(Number(m.time_spent_min)))}`);
  if (m.edited_at) meta.push('Edited');
  const files = m.attachments || [];
  const pics = files.filter((a) => a.src);
  const others = files.filter((a) => !a.src);
  return `<div class="item ${cls}"><div class="h"><b>${e(who(m))}</b>${role ? `<span class="muted small">${e(role)}</span>` : ''}${tags
    .map((x) => `<span class="tag">${e(x)}</span>`)
    .join('')}<span class="t">${e(when(m.created_at))}</span></div>${meta.length ? `<div class="meta">${meta.join(' · ')}</div>` : ''}<div class="body">${e(
    m.body || ''
  )}</div>${pics.length ? `<div class="photos">${pics.map(photo).join('')}</div>` : ''}${
    others.length
      ? `<ul class="files">${others
          .map((a) => `<li>${e(a.label ? `${cap(a.label)}: ` : '')}${e(a.original_name)} <span class="muted">(${sizeKb(a.size)}${IMAGE.test(a.mime) ? ', photo too large to include' : ''})</span></li>`)
          .join('')}</ul>`
      : ''
  }</div>`;
}

function timeline(d) {
  let lastDay = null;
  return d.messages
    .map((m) => {
      const label = day(m.created_at);
      const head = label !== lastDay ? `<div class="day">${e(label)}</div>` : '';
      lastDay = label;
      return head + messageHtml(m, d);
    })
    .join('');
}

function peopleTable(rows, { work = false } = {}) {
  if (!rows.length) return '';
  const did = (p) =>
    [
      p.raised && 'Raised the ticket',
      p.assigned && 'Handled the ticket',
      p.replies && `${p.replies} ${p.replies === 1 ? 'reply' : 'replies'}`,
      p.updates && `${p.updates} job ${p.updates === 1 ? 'update' : 'updates'}`,
      p.visits && `${p.visits} site ${p.visits === 1 ? 'visit' : 'visits'}`,
      p.minutes && `${minutes(p.minutes)} on site work`,
    ]
      .filter(Boolean)
      .join(', ') || '-';
  return `<table class="people"><thead><tr><th>Name</th><th>Role</th><th>Email</th>${work ? '<th>Phone</th>' : ''}<th>Involvement</th></tr></thead><tbody>${rows
    .map(
      (p) =>
        `<tr><td><b>${e(p.name)}</b>${p.job_title ? `<div class="muted small">${e(p.job_title)}</div>` : ''}</td><td>${e(
          p.team ? 'Field engineering team' : ROLE_LABELS[p.role] || cap(p.role || '')
        )}</td><td>${p.email ? `<a href="mailto:${e(p.email)}">${e(p.email)}</a>` : '<span class="muted">-</span>'}</td>${
          work ? `<td>${p.phone ? e(p.phone) : '<span class="muted">-</span>'}</td>` : ''
        }<td>${e(did(p))}</td></tr>`
    )
    .join('')}</tbody></table>`;
}

function visitsHtml(d) {
  if (!d.visits.length) return '';
  return `<h2>Site visits</h2>${d.visits
    .map((v) => {
      const facts = [
        ['Scheduled', when(v.scheduled_at)],
        v.started_at && ['Started', when(v.started_at)],
        v.completed_at && ['Completed', when(v.completed_at)],
        v.location && ['Location', v.location],
        v.technician_name && ['Engineer', v.technician_name + (v.technician_email ? ` (${v.technician_email})` : '')],
        v.client_signed_name && ['Signed off by', `${v.client_signed_name}${v.client_signed_at ? `, ${when(v.client_signed_at)}` : ''}`],
        v.client_satisfied !== null && v.client_satisfied !== undefined && ['Client satisfied', Number(v.client_satisfied) ? 'Yes' : 'No'],
        d.audience === 'staff' && v.notes && ['Instructions', v.notes],
      ].filter(Boolean);
      return `<div class="visit"><h3>${e(VISIT_LABELS[v.status] || cap(v.status))} visit</h3><div class="small">${facts
        .map(([k, val]) => `<span class="muted">${e(k)}:</span> ${e(val)}`)
        .join('<br>')}</div>${v.report ? `<div class="report"><b>Visit report</b>\n${e(v.report)}</div>` : ''}${
        v.client_comment ? `<div class="report"><b>Client comment</b>\n${e(v.client_comment)}</div>` : ''
      }</div>`;
    })
    .join('')}`;
}

function outcomeHtml(d) {
  const parts = [];
  if (d.signoffs.length) {
    parts.push(
      `<h3 style="font-size:14px;margin:0 0 6px">Sign-off</h3>${d.signoffs
        .map(
          (s) =>
            `<div class="sign"><b>${e(s.user_name || 'Former user')}</b><span>${e(s.decision === 'approved' ? 'Approved' : s.decision === 'rejected' ? 'Sent back' : cap(s.decision))}</span><span class="muted small" style="margin-left:auto">${e(
              when(s.created_at)
            )}</span></div>${s.comment ? `<div class="small muted" style="padding:4px 0 8px">${e(s.comment)}</div>` : ''}`
        )
        .join('')}`
    );
  }
  if (d.rating) {
    parts.push(
      `<h3 style="font-size:14px;margin:${parts.length ? '18px' : '0'} 0 6px">Client rating</h3><p style="margin:0"><b>${e(String(d.rating.rating))} out of 5</b>${
        d.rating.user_name ? ` <span class="muted">from ${e(d.rating.user_name)}, ${e(when(d.rating.updated_at || d.rating.created_at))}</span>` : ''
      }</p>${d.rating.comment ? `<p class="body" style="margin:6px 0 0">${e(d.rating.comment)}</p>` : ''}`
    );
  }
  return parts.length ? `<h2>Outcome</h2>${parts.join('')}` : '';
}

// `hosted` adds the print button shown on the shared page; `generatedFor` names who downloaded it.
function render(d, { hosted = false, printScript = null } = {}) {
  const t = d.ticket;
  const ref = ticketRef(t);
  const work = d.messages.filter((m) => m.kind === 'work_update');
  const timeSpent = d.messages.reduce((n, m) => n + (Number(m.time_spent_min) || 0), 0);
  const photos = d.messages.reduce((n, m) => n + (m.attachments || []).filter((a) => IMAGE.test(a.mime)).length, 0);
  const facts = [
    ['Company', t.company_name],
    ['Raised by', t.creator_name ? `${t.creator_name}${t.creator_email ? ` (${t.creator_email})` : ''}` : '-'],
    t.site_code && ['Site', `${t.site_code}${t.site_location ? `, ${t.site_location}` : ''}`],
    ['Category', t.category],
    ['Priority', cap(t.priority)],
    ['Handled by', t.assignee_name || 'Not assigned'],
    t.om_name && ['Site contact (O&M)', `${t.om_name}${t.om_phone ? `, ${t.om_phone}` : ''}`],
    t.fse_name && ['Field contact (FSE)', `${t.fse_name}${t.fse_phone ? `, ${t.fse_phone}` : ''}`],
    ['Opened', when(t.created_at)],
    ['First response', t.first_response_at ? when(t.first_response_at) : '-'],
    ['Resolved', t.resolved_at ? when(t.resolved_at) : '-'],
    t.closed_at && ['Closed', when(t.closed_at)],
  ].filter(Boolean);
  const stats = [
    [duration(t.created_at, t.resolved_at || t.closed_at) || '-', 'Time to resolve'],
    [duration(t.created_at, t.first_response_at) || '-', 'First response'],
    [String(work.length), work.length === 1 ? 'Job update' : 'Job updates'],
    [timeSpent ? minutes(timeSpent) : String(photos), timeSpent ? 'Time on site work' : photos === 1 ? 'Photo' : 'Photos'],
  ];
  const clientsRows = [
    ...d.clients,
    ...d.outside.map((o) => ({ ...o, role: 'client', emailOnly: true })),
  ].map((p) => ({ ...p, job_title: p.emailOnly ? 'Wrote in by email' : p.job_title }));
  const title = `Ticket ${ref} transcript`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="color-scheme" content="light"><title>${e(title)}</title><style>${STYLE}</style></head><body>
${hosted ? `<div class="bar"><span>To keep a copy, choose Print and then Save as PDF.</span><button type="button" data-print>Print or save as PDF</button></div>` : `<div class="bar"><span>To save this as a PDF, press Ctrl+P (Cmd+P on a Mac) and choose Save as PDF.</span></div>`}
<main class="sheet">
<header class="top">
  ${d.logos.ours ? `<img src="${d.logos.ours}" alt="${e(config.companyName)}">` : `<span class="co">${e(config.companyName)}</span>`}
  ${d.logos.theirs ? `<img src="${d.logos.theirs}" alt="${e(t.company_name)}">` : `<span class="co">${e(t.company_name)}</span>`}
</header>
<h1>${e(ref)}: ${e(t.subject)} <span class="status">${e(STATUS_LABELS[t.status] || t.status)}</span></h1>
<p class="sub">Ticket transcript prepared by ${e(config.companyName)} for ${e(t.company_name)} on ${e(when(now()))}${
    d.includeInternal ? ' · <b>includes internal notes, for staff only</b>' : ''
  }</p>
<dl class="facts">${facts.map(([k, v]) => `<div><dt>${e(k)}</dt><dd>${e(v)}</dd></div>`).join('')}</dl>
<div class="stats">${stats.map(([v, k]) => `<div><b>${e(v)}</b><span>${e(k)}</span></div>`).join('')}</div>

<h2>People involved</h2>
${d.staff.length ? `<p class="muted small" style="margin:0 0 6px">${e(config.companyName)}</p>${peopleTable(d.staff, { work: d.audience === 'staff' })}` : ''}
${clientsRows.length ? `<p class="muted small" style="margin:18px 0 6px">${e(t.company_name)}</p>${peopleTable(clientsRows)}` : ''}
${d.copied.length ? `<p class="small" style="margin:14px 0 0"><span class="muted">Also copied on emails:</span> ${e(d.copied.join(', '))}</p>` : ''}

${visitsHtml(d)}

<h2>Conversation and job updates</h2>
${timeline(d) || '<p class="muted">No messages.</p>'}

${outcomeHtml(d)}

<footer class="end"><span>${e(config.companyName)} · ${e(config.appUrl.replace(/^https?:\/\//, ''))}</span><span>${e(ref)} · ${d.messages.length} entries</span></footer>
</main>
${hosted && printScript ? `<script src="${e(printScript)}"></script>` : ''}
</body></html>`;
}

async function build(ticketId, opts = {}) {
  const d = await gather(ticketId, opts);
  return d ? { html: render(d, opts), data: d } : null;
}

module.exports = { build, gather, render };
