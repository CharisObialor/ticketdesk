const config = require('./config');
const { escapeHtml, parseTs, now, STATUS_LABELS } = require('./util');

const fmt = (s) => (s ? parseTs(s).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '-');
const author = (m) => (m.kind === 'system' ? 'System' : m.user_name || 'Deleted user');
const visible = (messages, includeInternal) => messages.filter((m) => includeInternal || !m.is_internal);
const sizeKb = (n) => `${Math.max(1, Math.round(n / 1024))} KB`;

function header(t) {
  return [
    ['Ticket', `#${t.id} - ${t.subject}`],
    ['Company', t.company_name],
    ['Requester', t.creator_name || '-'],
    ['Assigned to', t.assignee_name || 'Unassigned'],
    ['Category', t.category],
    ['Priority', t.priority],
    ['Status', STATUS_LABELS[t.status] || t.status],
    ['Escalated', t.escalation_level ? `Level ${t.escalation_level}${t.escalated ? '' : ' (cleared)'}` : 'No'],
    ['Opened', fmt(t.created_at)],
    ['Resolved', fmt(t.resolved_at)],
  ];
}

function toText(t, messages, { includeInternal = false } = {}) {
  const lines = [`${config.appName} - Ticket transcript`, `Exported ${fmt(now())}`, ''];
  for (const [k, v] of header(t)) lines.push(`${k.padEnd(12)} ${v}`);
  lines.push('', '-'.repeat(72), '');
  for (const m of visible(messages, includeInternal)) {
    const label = m.kind === 'system' ? '[system]' : m.is_internal ? '[internal note]' : '';
    lines.push(`[${fmt(m.created_at)}] ${author(m)} ${label}`.trim());
    lines.push(m.body);
    for (const a of m.attachments || []) lines.push(`  Attachment: ${a.original_name} (${sizeKb(a.size)})`);
    lines.push('');
  }
  return lines.join('\n');
}

function toJson(t, messages, { includeInternal = false } = {}) {
  return JSON.stringify(
    {
      exported_at: new Date().toISOString(),
      ticket: Object.fromEntries(header(t)),
      messages: visible(messages, includeInternal).map((m) => ({
        id: m.id,
        at: fmt(m.created_at),
        author: author(m),
        role: m.user_role,
        kind: m.kind,
        internal: !!m.is_internal,
        body: m.body,
        attachments: (m.attachments || []).map((a) => ({ name: a.original_name, size: a.size, type: a.mime })),
      })),
    },
    null,
    2
  );
}

// Self-contained HTML that prints cleanly to PDF from any browser.
function toHtml(t, messages, { includeInternal = false } = {}) {
  const rows = header(t)
    .map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`)
    .join('');
  const items = visible(messages, includeInternal)
    .map((m) => {
      const cls = m.kind === 'system' ? 'sys' : m.is_internal ? 'note' : m.user_role === 'client' ? 'client' : 'staff';
      const files = (m.attachments || [])
        .map((a) => `<li>Attachment: ${escapeHtml(a.original_name)} <span>(${sizeKb(a.size)})</span></li>`)
        .join('');
      return `<div class="m ${cls}"><div class="h"><b>${escapeHtml(author(m))}</b>${
        m.is_internal ? ' <em>internal note</em>' : ''
      }<span>${fmt(m.created_at)}</span></div><div class="b">${escapeHtml(m.body)}</div>${files ? `<ul>${files}</ul>` : ''}</div>`;
    })
    .join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Ticket #${t.id} transcript</title>
<style>
body{font:14px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827;max-width:820px;margin:24px auto;padding:0 16px}
h1{font-size:20px;margin:0 0 4px}.sub{color:#6b7280;margin:0 0 16px}
table{border-collapse:collapse;margin-bottom:20px}th{text-align:left;color:#6b7280;font-weight:500;padding:3px 16px 3px 0}td{padding:3px 0}
.m{border:1px solid #e5e7eb;border-radius:8px;padding:10px 14px;margin:10px 0;page-break-inside:avoid}
.m.client{background:#f9fafb}.m.staff{background:#eff6ff;border-color:#bfdbfe}.m.note{background:#fefce8;border-color:#fde68a}
.m.sys{border:none;color:#6b7280;font-size:12px;text-align:center;padding:2px}
.h{display:flex;gap:8px;font-size:13px;margin-bottom:4px}.h span{margin-left:auto;color:#6b7280}.h em{color:#92400e}
.sys .h{justify-content:center}.sys .h span{margin-left:8px}.sys .h b{font-weight:500}
.b{white-space:pre-wrap;word-wrap:break-word}ul{margin:6px 0 0;padding-left:18px;font-size:13px}ul span{color:#6b7280}
</style></head><body>
<h1>Ticket #${t.id}: ${escapeHtml(t.subject)}</h1>
<p class="sub">${escapeHtml(config.appName)} · transcript exported ${fmt(now())}</p>
<table>${rows}</table>${items}</body></html>`;
}

module.exports = { toText, toJson, toHtml };
