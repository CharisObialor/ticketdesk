// Email layout: a plain, professional letter. White page, the logo centred at the top over a thin rule, then
// left-aligned text that opens with "Dear ...", key facts in bold, one simple button, and "Kind regards" with the
// sender's signature. A small grey footer carries the preferences link and company line. Built from tables and
// inline styles so it looks the same in Outlook, Gmail and phone mail apps, and reads well with images off.
const config = require('./config');
const { escapeHtml: e } = require('./util');

const C = {
  brand: '#336cb5',
  font: "'Segoe UI','Helvetica Neue',Helvetica,Arial,sans-serif",
  heading: '#1f1f1f',
  text: '#3a3a3a',
  muted: '#6b6b6b',
  faint: '#8c8c8c',
  line: '#e3e3e3',
};
const T = {
  heading: `margin:0 0 20px;font-family:${C.font};font-size:20px;line-height:28px;font-weight:600;color:${C.heading}`,
  body: `margin:0 0 18px;font-family:${C.font};font-size:16px;line-height:26px;color:${C.text}`,
  label: `margin:0 0 6px;font-family:${C.font};font-size:14px;line-height:20px;color:${C.muted}`,
  small: `margin:0 0 16px;font-family:${C.font};font-size:14px;line-height:22px;color:${C.muted}`,
  footer: `margin:0 0 8px;font-family:${C.font};font-size:12px;line-height:18px;color:${C.muted};text-align:center`,
};

const STATUS_LABELS = { open: 'Open', in_progress: 'In progress', awaiting_client: 'Awaiting your reply', resolved: 'Resolved', closed: 'Closed' };

const REPLY_MARKER = '##- Please type your reply above this line -##';
const FOOTERS = {
  notification: 'You are receiving this email because you have an account on the DateHeight support portal.',
  account: 'This is a service message about your DateHeight support portal account.',
  // A ticket an admin sent on to someone, who may not use the portal.
  shared: 'This ticket summary was shared with you by the DateHeight support team. Replying to this email reaches the person who sent it.',
};

const asset = (name) => `${config.appUrl}/${name}`;
const link = (url, label, color = C.brand) => `<a href="${e(url)}" style="color:${color};text-decoration:underline">${e(label)}</a>`;

// Text is escaped, then **like this** becomes bold, so callers can highlight the key facts in a sentence.
// Ticket numbers are always bold.
const STRONG = `<strong style="font-weight:600;color:${C.heading}">$1</strong>`;
const rich = (s) =>
  e(s)
    .replace(/\*\*(.+?)\*\*/g, STRONG)
    .replace(/(?<![\w>])((?:ticket )?#\d+)(?![\w<])/gi, STRONG);
const plain = (s) => String(s).replace(/\*\*(.+?)\*\*/g, '$1');
const p = (s) => `<p style="${T.body}">${rich(s)}</p>`;

// Key facts as a simple two-column list between thin rules (no shaded boxes).
function detailsList(details) {
  if (!details.length) return '';
  const rows = details
    .map(
      ([k, v]) =>
        `<tr><td valign="top" width="150" style="padding:9px 16px 9px 0;border-bottom:1px solid ${C.line};width:150px;font-family:${C.font};font-size:14px;line-height:22px;color:${C.muted}">${e(k)}</td><td valign="top" style="padding:9px 0;border-bottom:1px solid ${C.line};font-family:${C.font};font-size:15px;line-height:22px;color:${C.heading}">${e(v)}</td></tr>`
    )
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 26px;border-top:1px solid ${C.line}">${rows}</table>`;
}

// A quoted message, set off with a thin rule on the left.
function quoteBlock(quote, label, from) {
  if (!quote) return '';
  const heading = label || from ? `<p style="${T.label}">${e(label || 'Message')}${from ? ` from <span style="color:${C.heading};font-weight:600">${e(from)}</span>` : ''}:</p>` : '';
  return `${heading}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 26px"><tr><td style="border-left:3px solid ${C.line};padding:2px 0 2px 16px;font-family:${C.font};font-size:15px;line-height:24px;color:${C.text};white-space:pre-wrap">${e(quote)}</td></tr></table>`;
}

// A plain rectangular button, left-aligned with the text. Desktop Outlook gets the VML version.
const button = (url, label) => `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 28px"><tr><td>
<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${e(url)}" style="height:44px;v-text-anchor:middle;width:220px;" arcsize="7%" stroke="f" fillcolor="${C.brand}"><w:anchorlock/><center style="color:#ffffff;font-family:Arial,sans-serif;font-size:15px;font-weight:bold;">${e(label)}</center></v:roundrect><![endif]-->
<!--[if !mso]><!--><a href="${e(url)}" style="display:inline-block;background:${C.brand};color:#ffffff;font-family:${C.font};font-size:15px;line-height:20px;font-weight:600;text-decoration:none;padding:12px 26px;border-radius:3px">${e(label)}</a><!--<![endif]-->
</td></tr></table>`;

// Rating links 1 to 5 as small numbered boxes (text, so nothing turns into emoji or needs images).
function ratingRow(links) {
  if (!links) return '';
  const cells = links
    .map(
      (r) =>
        `<td style="padding:0 6px 0 0"><a href="${e(r.url)}" title="${r.value} out of 5" style="display:inline-block;width:40px;height:40px;line-height:40px;text-align:center;border:1px solid ${C.brand};border-radius:3px;font-family:${C.font};font-size:16px;font-weight:600;color:${C.brand};text-decoration:none">${r.value}</a></td>`
    )
    .join('');
  return `<p style="${T.body};margin-bottom:10px">How would you rate the support you received on this ticket?</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 8px"><tr>${cells}</tr></table>
<p style="${T.small};margin-bottom:26px">1 = poor, 5 = excellent</p>`;
}

// "Kind regards," followed by the sender's signature: their name on the first line, the rest beneath it.
function signatureBlock(sig) {
  if (!sig || !sig.trim()) return '';
  const lines = sig.trim().split(/\r?\n/);
  return `<p style="${T.body};margin-bottom:0">${lines.map((l, i) => (i === 0 ? `<span style="color:${C.heading}">${e(l)}</span>` : e(l))).join('<br>')}</p>`;
}

// Absolute URL of the avatar a user chose (kept for callers; emails no longer show photos).
const avatarUrl = (user) => {
  const path = user && require('./auth').avatarPath(user.avatar);
  return path ? `${config.appUrl}${path}` : null;
};

const TEAM_SIGNATURE = `The DateHeight Support Team\n${config.companyName}`;

function render({
  heading,
  greeting,
  intro,
  paragraphs = [],
  quote,
  quoteLabel,
  quoteFrom,
  details = [],
  ctaUrl,
  ctaLabel,
  note,
  footer = 'notification',
  replyable = false,
  ratingLinks,
  signature,
  unsubscribeUrl,
}) {
  // Links in emails only ever point to web pages or email addresses.
  if (ctaUrl && !/^(https?:|mailto:)/i.test(String(ctaUrl))) ctaUrl = null;
  const body = [intro, ...paragraphs].filter(Boolean);
  const sig = signature && signature.trim() ? signature.trim() : TEAM_SIGNATURE;
  const preferences = unsubscribeUrl || `${config.appUrl}/profile`;
  const html = `<!doctype html><html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><meta name="x-apple-disable-message-reformatting"><title>${e(heading)}</title>
<!--[if mso]><style>table,td,p,a,span{font-family:'Segoe UI',Arial,sans-serif !important}</style><![endif]--></head>
<body style="margin:0;padding:0;background:#ffffff;-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all">${e(plain(intro || heading))}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff"><tr><td align="center" style="padding:20px 16px 32px">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px">
${replyable ? `<tr><td style="padding:0 0 10px;font-family:${C.font};font-size:12px;line-height:18px;color:${C.faint};text-align:center">${REPLY_MARKER}</td></tr>` : ''}
${ctaUrl ? `<tr><td style="padding:0 0 22px;font-family:${C.font};font-size:12px;line-height:18px;color:${C.muted};text-align:center">If you are having trouble reading this email, ${link(ctaUrl, 'view it in the support portal', C.muted)}.</td></tr>` : ''}
<tr><td align="center" style="padding:0 0 22px"><img src="${e(asset('logo.png'))}" width="134" height="45" alt="${e(config.companyName)}" style="display:block;border:0;outline:none;height:45px;width:134px;font-family:${C.font};font-size:18px;font-weight:600;color:${C.heading}"></td></tr>
<tr><td style="border-top:1px solid ${C.line};font-size:0;line-height:0">&nbsp;</td></tr>
<tr><td style="padding:30px 0 0">
${heading ? `<p style="${T.heading}">${rich(heading)}</p>` : ''}
${greeting ? p(greeting) : ''}
${body.map(p).join('\n')}
${detailsList(details)}
${quoteBlock(quote, quoteLabel, quoteFrom)}
${ctaUrl ? button(ctaUrl, ctaLabel || 'Open the support portal') : ''}
${ratingRow(ratingLinks)}
<p style="${T.body};margin-bottom:6px">Kind regards,</p>
${signatureBlock(sig)}
${note ? `<p style="${T.small};margin-top:26px">${rich(note)}</p>` : ''}
</td></tr>
<tr><td style="padding:40px 0 0">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-top:1px solid ${C.line};padding:22px 8px 0">
<p style="${T.footer}">${e(FOOTERS[footer] || FOOTERS.notification)}${footer === 'notification' ? ` If you do not wish to receive these emails, ${link(preferences, 'click here', C.muted)}.` : ''}</p>
${replyable ? `<p style="${T.footer}">You can reply to this email to add a message to your ticket.</p>` : ''}
<p style="${T.footer}">This email was sent by ${e(config.companyName)} through its support portal, ${link(config.appUrl, config.appUrl.replace(/^https?:\/\//, ''), C.muted)}.</p>
</td></tr></table>
</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table></body></html>`;

  const text = [
    replyable ? `${REPLY_MARKER}\n` : null,
    heading ? plain(heading) : null,
    '',
    greeting ? plain(greeting) : null,
    '',
    ...body.map((b) => `${plain(b)}\n`),
    ...details.map(([k, v]) => `${k}: ${v}`),
    details.length ? '' : null,
    quote ? `${quoteLabel || 'Message'}${quoteFrom ? ` from ${quoteFrom}` : ''}:\n> ${String(quote).split('\n').join('\n> ')}\n` : null,
    ctaUrl ? `${ctaLabel || 'Open the support portal'}: ${ctaUrl}\n` : null,
    ratingLinks ? `How would you rate the support you received? (1 = poor, 5 = excellent)\n${ratingLinks.map((r) => `${r.value}: ${r.url}`).join('\n')}\n` : null,
    'Kind regards,',
    sig,
    note ? `\n${plain(note)}` : null,
    '',
    '--',
    FOOTERS[footer] || FOOTERS.notification,
    replyable ? 'You can reply to this email to add a message to your ticket.' : null,
    footer === 'notification' ? `Email preferences: ${preferences}` : null,
    `${config.companyName} - ${config.appUrl}`,
  ]
    .filter((x) => x !== undefined && x !== null)
    .join('\n');
  return { html, text };
}

// Default signature for someone who has not written their own.
const defaultSignature = (user) => [user.name, config.companyName, user.email].filter(Boolean).join('\n');
const signatureFor = (user) => (user && user.signature && user.signature.trim() ? user.signature.trim() : user ? defaultSignature(user) : '');

module.exports = { render, REPLY_MARKER, signatureBlock, signatureFor, defaultSignature, avatarUrl, STATUS_LABELS, C };
