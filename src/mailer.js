const nodemailer = require('nodemailer');
const config = require('./config');
const { escapeHtml } = require('./util');

let transport;
function getTransport() {
  if (!transport) {
    transport = config.smtp.host
      ? nodemailer.createTransport({
          host: config.smtp.host,
          port: config.smtp.port,
          secure: config.smtp.secure,
          auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
        })
      : nodemailer.createTransport({ jsonTransport: true });
  }
  return transport;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mailDomain = () => new URL(config.appUrl).hostname || 'localhost';

// Every email about a ticket references the same root id so mail clients group them into one thread.
const threadHeaders = (ticketId) => {
  if (!ticketId) return {};
  const root = `<ticket-${ticketId}@${mailDomain()}>`;
  return { inReplyTo: root, references: [root] };
};

// Fire-and-forget with retries so a slow SMTP server never delays an API response.
function send({ to, subject, html, text, ticketId, replyTo }) {
  if (!to) return;
  setImmediate(async () => {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await getTransport().sendMail({
          from: config.smtp.from,
          replyTo: replyTo || config.smtp.replyTo || undefined,
          to,
          subject,
          html,
          text,
          ...threadHeaders(ticketId),
          headers: { 'X-Auto-Response-Suppress': 'OOF, AutoReply', 'Auto-Submitted': 'auto-generated' },
        });
        if (!config.smtp.host) console.log(`[mail:dev] to=${to} subject="${subject}"`);
        return;
      } catch (err) {
        console.error(`[mail] attempt ${attempt} to ${to} failed: ${err.message}`);
        if (attempt < 3) await sleep(attempt * 5000);
      }
    }
  });
}

// Inbound replies are cut at this line, so anything quoted below it is ignored.
const REPLY_MARKER = '##- Please type your reply above this line -##';

const FOOTERS = {
  notification: 'You are receiving this because you have an account on the support portal. You can turn off notification emails on your profile page.',
  account: 'This is a service message about your support portal account.',
};

// Standard transactional layout: brand header, heading, greeting, body, optional details/quote, button and fallback link.
function render({ heading, greeting, intro, paragraphs = [], quote, quoteLabel, details = [], ctaUrl, ctaLabel, note, footer = 'notification', replyable = false, ratingLinks }) {
  const brand = '#336cb5'; // DateHeight blue, darkened for readable white button text
  const p = (s) => `<p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#374151">${escapeHtml(s)}</p>`;
  const body = [intro, ...paragraphs].filter(Boolean);
  const rows = details
    .map(
      ([k, v]) =>
        `<tr><td style="padding:6px 16px 6px 0;color:#6b7280;font-size:13px;white-space:nowrap;vertical-align:top">${escapeHtml(k)}</td><td style="padding:6px 0;font-size:13px;color:#111827">${escapeHtml(v)}</td></tr>`
    )
    .join('');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(heading)}</title></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
${replyable ? `<div style="color:#9ca3af;font-size:11px;padding:8px 12px;text-align:center">${REPLY_MARKER}</div>` : ''}
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(intro || heading)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:580px">
<tr><td style="padding:0 4px 16px"><img src="${escapeHtml(config.appUrl)}/logo.png" width="134" height="45" alt="${escapeHtml(config.appName)}" style="display:block;border:0;height:45px;width:134px;font-size:16px;font-weight:700;color:#111827"></td></tr>
<tr><td style="background:#ffffff;border:1px solid #e5e7eb;border-top:3px solid ${brand};border-radius:8px;padding:28px">
<h1 style="margin:0 0 16px;font-size:19px;line-height:1.3;color:#111827">${escapeHtml(heading)}</h1>
${greeting ? p(greeting) : ''}
${body.map(p).join('')}
${rows ? `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:4px 0 18px;border-top:1px solid #f0f1f3;border-bottom:1px solid #f0f1f3;padding:6px 0">${rows}</table>` : ''}
${quote ? `${quoteLabel ? `<p style="margin:0 0 6px;font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.04em">${escapeHtml(quoteLabel)}</p>` : ''}<div style="border-left:3px solid ${brand};background:#f9fafb;padding:12px 14px;margin:0 0 20px;font-size:14px;line-height:1.6;color:#374151;white-space:pre-wrap">${escapeHtml(quote)}</div>` : ''}
${ctaUrl ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 18px"><tr><td style="border-radius:6px;background:${brand}"><a href="${escapeHtml(ctaUrl)}" style="display:inline-block;padding:11px 20px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none">${escapeHtml(ctaLabel || 'Open portal')}</a></td></tr></table>
<p style="margin:0 0 4px;font-size:12px;color:#6b7280">If the button does not work, copy and paste this link into your browser:</p>
<p style="margin:0 0 14px;font-size:12px;word-break:break-all"><a href="${escapeHtml(ctaUrl)}" style="color:${brand}">${escapeHtml(ctaUrl)}</a></p>` : ''}
${ratingLinks ? `<p style="margin:6px 0 8px;font-size:14px;font-weight:600;color:#111827">How did we do?</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 6px"><tr>${ratingLinks
          .map((r) => `<td style="padding:0 6px 0 0"><a href="${escapeHtml(r.url)}" style="display:inline-block;min-width:44px;padding:8px 0;border:1px solid #d1d5db;border-radius:6px;text-align:center;font-size:15px;font-weight:600;color:#111827;text-decoration:none">${r.value}</a></td>`)
          .join('')}</tr></table>
<p style="margin:0 0 16px;font-size:12px;color:#6b7280">1 = Very poor, 5 = Excellent</p>` : ''}
${note ? `<p style="margin:14px 0 0;font-size:13px;line-height:1.5;color:#6b7280">${escapeHtml(note)}</p>` : ''}
</td></tr>
<tr><td style="padding:18px 4px 0;font-size:12px;line-height:1.6;color:#9ca3af">
${escapeHtml(FOOTERS[footer] || FOOTERS.notification)} ${replyable ? 'You can reply to this email to add a message to the ticket.' : 'Please do not reply to this email; replies are not monitored. Use the support portal to respond.'}<br>
&copy; ${new Date().getFullYear()} ${escapeHtml(config.companyName)}. All rights reserved.
</td></tr>
</table></td></tr></table></body></html>`;

  const text = [
    replyable ? `${REPLY_MARKER}\n` : null,
    heading,
    '',
    greeting,
    ...body,
    rows ? '' : null,
    ...details.map(([k, v]) => `${k}: ${v}`),
    quote ? `\n${quoteLabel ? quoteLabel + ':\n' : ''}> ${String(quote).split('\n').join('\n> ')}\n` : null,
    ctaUrl ? `${ctaLabel || 'Open portal'}: ${ctaUrl}` : null,
    ratingLinks ? `\nHow did we do? Rate 1 (very poor) to 5 (excellent):\n${ratingLinks.map((r) => `${r.value}: ${r.url}`).join('\n')}` : null,
    note ? `\n${note}` : null,
    '',
    '--',
    `${FOOTERS[footer] || FOOTERS.notification} ${replyable ? 'You can reply to this email to add a message to the ticket.' : 'Please do not reply to this email; use the support portal to respond.'}`,
    `(c) ${new Date().getFullYear()} ${config.companyName}`,
  ]
    .filter((x) => x !== undefined && x !== null)
    .join('\n');
  return { html, text };
}

module.exports = { send, render, REPLY_MARKER };
