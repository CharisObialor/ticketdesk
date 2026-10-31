// Email design system. Matches the portal's type scale and colours, with graphical elements that work in every
// mail client: PNG icons (Gmail and Outlook do not show SVG), table-built status pills, a progress tracker,
// initials avatars and star ratings. No accent stripes. Everything has a plain-text equivalent and alt text, and
// the layout still reads well when images are blocked.
const config = require('./config');
const { escapeHtml: e } = require('./util');

const C = {
  brand: '#336cb5',
  font: "'Inter','Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif",
  heading: '#111827',
  text: '#374151',
  muted: '#6b7280',
  faint: '#9ca3af',
  line: '#e5e7eb',
  panel: '#f8fafc',
  page: '#f3f4f6',
};
const T = {
  h1: `margin:0;font-family:${C.font};font-size:22px;line-height:30px;font-weight:600;letter-spacing:-0.3px;color:${C.heading}`,
  h3: `margin:0 0 10px;font-family:${C.font};font-size:17px;line-height:24px;font-weight:600;color:${C.heading}`,
  eyebrow: `margin:0 0 8px;font-family:${C.font};font-size:12px;line-height:16px;font-weight:600;letter-spacing:0.6px;text-transform:uppercase;color:${C.muted}`,
  body: `margin:0 0 16px;font-family:${C.font};font-size:15px;line-height:24px;color:${C.text}`,
  small: `margin:0;font-family:${C.font};font-size:13px;line-height:20px;color:${C.muted}`,
  caption: `margin:0;font-family:${C.font};font-size:12px;line-height:18px;color:${C.faint}`,
};

const STATUS = {
  open: { label: 'Open', bg: '#e8f0fb', fg: '#1d4f91' },
  in_progress: { label: 'In progress', bg: '#fef3c7', fg: '#92400e' },
  awaiting_client: { label: 'Awaiting your reply', bg: '#ede9fe', fg: '#5b21b6' },
  resolved: { label: 'Resolved', bg: '#dcfce7', fg: '#166534' },
  closed: { label: 'Closed', bg: '#f1f5f9', fg: '#475569' },
};
const STEP_OF = { open: 0, in_progress: 1, awaiting_client: 1, resolved: 2, closed: 2 };
const STEPS = ['Received', 'In progress', 'Resolved'];

const REPLY_MARKER = '##- Please type your reply above this line -##';
const FOOTERS = {
  notification: 'You are receiving this because you have an account on the DateHeight support portal.',
  account: 'This is a service message about your support portal account.',
  // A ticket an admin sent on to someone, who may not use the portal.
  shared: 'This ticket summary was shared with you by the DateHeight support team.',
};

const asset = (name) => `${config.appUrl}/${name}`;
const initials = (name) =>
  String(name || '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

const p = (s) => `<p style="${T.body}">${e(s)}</p>`;

function icon(name) {
  if (!name) return '';
  return `<tr><td align="center" style="padding:0 0 16px"><img src="${e(asset(`email/${name}.png`))}" width="56" height="56" alt="" style="display:block;border:0;outline:none;width:56px;height:56px"></td></tr>`;
}

function pill(status) {
  const s = STATUS[status];
  if (!s) return '';
  return `<tr><td align="center" style="padding:12px 0 0"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="background:${s.bg};border-radius:999px;padding:4px 12px;font-family:${C.font};font-size:12px;line-height:18px;font-weight:600;color:${s.fg}">${e(s.label)}</td></tr></table></td></tr>`;
}

// Received -> In progress -> Resolved, drawn with table cells (circles are rounded cells, joins are 2px rules).
function tracker(status) {
  if (!(status in STEP_OF)) return '';
  const at = STEP_OF[status];
  const done = '#16a34a';
  const cells = STEPS.map((label, i) => {
    const state = i < at || (i === at && i === 2) ? 'done' : i === at ? 'current' : 'todo';
    const bg = state === 'done' ? done : state === 'current' ? C.brand : '#ffffff';
    const border = state === 'todo' ? `2px solid #d1d5db` : `2px solid ${bg}`;
    // A drawn tick image, not a text symbol (some phones turn symbols into emoji).
    const mark =
      state === 'done'
        ? `<img src="${e(asset('email/tick.png'))}" width="14" height="14" alt="Done" style="display:inline-block;border:0;width:14px;height:14px;vertical-align:middle">`
        : String(i + 1);
    const color = state === 'todo' ? C.faint : '#ffffff';
    const circle = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td width="28" height="28" align="center" valign="middle" style="width:28px;height:28px;border-radius:50%;background:${bg};border:${border};font-family:${C.font};font-size:13px;font-weight:700;color:${color};line-height:28px">${mark}</td></tr></table>`;
    const labelColor = state === 'todo' ? C.faint : C.heading;
    return `<td width="33%" align="center" valign="top" style="padding:0 4px">${circle}<p style="margin:6px 0 0;font-family:${C.font};font-size:12px;line-height:16px;font-weight:${state === 'current' ? 600 : 500};color:${labelColor}">${label}</p></td>`;
  });
  const join = (i) => `<td valign="top" style="padding-top:15px"><div style="height:2px;line-height:2px;font-size:0;background:${i < at ? done : '#d1d5db'}">&nbsp;</div></td>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;table-layout:fixed"><tr>${cells[0]}${join(0)}${cells[1]}${join(1)}${cells[2]}</tr></table>`;
}

function detailsPanel(details) {
  if (!details.length) return '';
  const rows = details
    .map(
      ([k, v], i) =>
        `<tr><td valign="top" style="padding:10px 16px;${i ? `border-top:1px solid ${C.line};` : ''}width:128px;font-family:${C.font};font-size:13px;line-height:20px;color:${C.muted}">${e(k)}</td><td valign="top" style="padding:10px 16px 10px 0;${i ? `border-top:1px solid ${C.line};` : ''}font-family:${C.font};font-size:14px;line-height:20px;font-weight:500;color:${C.heading}">${e(v)}</td></tr>`
    )
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;background:${C.panel};border:1px solid ${C.line};border-radius:10px">${rows}</table>`;
}

// Round photo when there is one, otherwise initials on a soft blue circle.
function avatar(name, url, size) {
  if (url) {
    return `<img src="${e(url)}" width="${size}" height="${size}" alt="${e(name || '')}" style="display:block;border:0;width:${size}px;height:${size}px;border-radius:50%;object-fit:cover">`;
  }
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td width="${size}" height="${size}" align="center" valign="middle" style="width:${size}px;height:${size}px;border-radius:50%;background:#e8f0fb;font-family:${C.font};font-size:${Math.round(size * 0.38)}px;font-weight:700;color:${C.brand};line-height:${size}px">${e(initials(name))}</td></tr></table>`;
}

// A quoted message with the author's avatar.
function quoteBlock(quote, label, from, fromAvatar) {
  if (!quote) return '';
  const author = from
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 10px"><tr>
<td width="32" valign="middle">${avatar(from, fromAvatar, 32)}</td>
<td style="padding-left:10px;font-family:${C.font};font-size:14px;line-height:20px;font-weight:600;color:${C.heading}">${e(from)}</td></tr></table>`
    : '';
  return `${label ? `<p style="${T.eyebrow}">${e(label)}</p>` : ''}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;background:${C.panel};border:1px solid ${C.line};border-radius:10px"><tr><td style="padding:16px 20px">${author}<div style="font-family:${C.font};font-size:15px;line-height:24px;color:${C.text};white-space:pre-wrap">${e(quote)}</div></td></tr></table>`;
}

// Button that keeps its shape in desktop Outlook (VML) and everywhere else (styled link).
const button = (url, label) => `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:4px auto 16px"><tr><td align="center">
<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${e(url)}" style="height:46px;v-text-anchor:middle;width:240px;" arcsize="14%" stroke="f" fillcolor="${C.brand}"><w:anchorlock/><center style="color:#ffffff;font-family:Arial,sans-serif;font-size:15px;font-weight:bold;">${e(label)}</center></v:roundrect><![endif]-->
<!--[if !mso]><!--><a href="${e(url)}" style="display:inline-block;background:${C.brand};color:#ffffff;font-family:${C.font};font-size:15px;line-height:20px;font-weight:600;text-decoration:none;padding:13px 28px;border-radius:8px">${e(label)}</a><!--<![endif]-->
</td></tr></table>`;

// Five star links (1-5), drawn as images rather than text symbols so no mail app shows them as emoji.
// With images blocked, each shows its number ("1" to "5") instead.
function stars(links) {
  if (!links) return '';
  const cells = links
    .map(
      (r) =>
        `<td style="padding:0 4px"><a href="${e(r.url)}" title="${r.value} out of 5" style="text-decoration:none"><img src="${e(asset('email/rate-star.png'))}" width="32" height="32" alt="${r.value}" style="display:block;border:0;width:32px;height:32px;font-family:${C.font};font-size:16px;font-weight:700;color:#b45309;text-align:center;line-height:32px"></a></td>`
    )
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;background:${C.panel};border:1px solid ${C.line};border-radius:10px"><tr><td align="center" style="padding:20px">
<p style="${T.h3}">How did we do?</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center"><tr>${cells}</tr></table>
<p style="${T.caption};margin:6px 0 0">Tap a star: 1 = very poor, 5 = excellent</p>
</td></tr></table>`;
}

// The sending admin's signature: their photo (if set), first line bold, the rest smaller.
function signatureBlock(sig, photoUrl) {
  if (!sig || !sig.trim()) return '';
  const [first, ...rest] = sig.trim().split(/\r?\n/);
  const photo = photoUrl ? `<td width="56" valign="top" style="padding-right:14px">${avatar(first, photoUrl, 56)}</td>` : '';
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 8px"><tr>${photo}<td valign="middle" style="font-family:${C.font}">
<p style="margin:0;font-size:15px;line-height:22px;font-weight:600;color:${C.heading}">${e(first)}</p>
${rest.map((l) => `<p style="margin:0;font-size:13px;line-height:20px;color:${C.muted}">${e(l)}</p>`).join('')}
</td></tr></table>`;
}

// Absolute URL of the avatar a user chose, for emails (null when they have none).
const avatarUrl = (user) => {
  const p = user && require('./auth').avatarPath(user.avatar);
  return p ? `${config.appUrl}${p}` : null;
};

const signatureText = (sig) => (sig && sig.trim() ? `\n${sig.trim()}` : null);

function render({
  heading,
  greeting,
  intro,
  paragraphs = [],
  quote,
  quoteLabel,
  quoteFrom,
  quoteAvatar,
  details = [],
  ctaUrl,
  ctaLabel,
  note,
  footer = 'notification',
  replyable = false,
  ratingLinks,
  icon: iconName,
  status,
  showProgress = false,
  signature,
  signatureAvatar,
}) {
  // Links in emails only ever point to web pages or email addresses.
  if (ctaUrl && !/^(https?:|mailto:)/i.test(String(ctaUrl))) ctaUrl = null;
  const body = [intro, ...paragraphs].filter(Boolean);
  const html = `<!doctype html><html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><meta name="x-apple-disable-message-reformatting"><title>${e(heading)}</title>
<!--[if mso]><style>table,td,p,a,h1{font-family:Arial,sans-serif !important}</style><![endif]--></head>
<body style="margin:0;padding:0;background:${C.page};-webkit-text-size-adjust:100%">
${replyable ? `<div style="font-family:${C.font};color:${C.faint};font-size:11px;line-height:16px;padding:12px 12px 0;text-align:center">${REPLY_MARKER}</div>` : ''}
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all">${e(intro || heading)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.page}"><tr><td align="center" style="padding:28px 12px">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px">
<tr><td align="center" style="padding:0 0 20px"><img src="${e(asset('logo.png'))}" width="134" height="45" alt="${e(config.appName)}" style="display:block;border:0;outline:none;height:45px;width:134px;font-family:${C.font};font-size:18px;font-weight:700;color:${C.heading}"></td></tr>
<tr><td style="background:#ffffff;border:1px solid ${C.line};border-radius:12px;padding:36px 32px 28px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px">
${icon(iconName)}
<tr><td align="center"><h1 style="${T.h1}">${e(heading)}</h1></td></tr>
${pill(status)}
</table>
${showProgress ? tracker(status) : ''}
${greeting ? p(greeting) : ''}
${body.map(p).join('')}
${detailsPanel(details)}
${quoteBlock(quote, quoteLabel, quoteFrom, quoteAvatar)}
${ctaUrl ? `${button(ctaUrl, ctaLabel || 'Open portal')}<p style="${T.caption};text-align:center;margin:0 0 8px;word-break:break-all">Or open: <a href="${e(ctaUrl)}" style="color:${C.brand};text-decoration:underline">${e(ctaUrl)}</a></p>` : ''}
${stars(ratingLinks)}
${signatureBlock(signature, signatureAvatar)}
${note ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:20px"><tr><td style="border-top:1px solid ${C.line};padding-top:16px"><p style="${T.small}">${e(note)}</p></td></tr></table>` : ''}
</td></tr>
<tr><td align="center" style="padding:24px 24px 8px">
<img src="${e(asset('logo-mark.png'))}" width="28" height="28" alt="" style="display:block;border:0;width:28px;height:28px;margin:0 auto 10px">
<p style="${T.small};font-weight:600;color:${C.text}">${e(config.companyName)}</p>
<p style="${T.caption};margin:6px 0">${e(FOOTERS[footer] || FOOTERS.notification)} ${footer === 'shared' ? 'Replying to this email reaches the person who sent it.' : replyable ? 'You can reply to this email to add a message to the ticket.' : 'Please use the support portal to respond.'}</p>
<p style="${T.caption}"><a href="${e(config.appUrl)}" style="color:${C.muted};text-decoration:underline">Support portal</a>${footer === 'notification' ? ` &nbsp;&middot;&nbsp; <a href="${e(config.appUrl)}/profile" style="color:${C.muted};text-decoration:underline">Email preferences</a>` : ''}</p>
</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table></body></html>`;

  const text = [
    replyable ? `${REPLY_MARKER}\n` : null,
    heading,
    status && STATUS[status] ? `Status: ${STATUS[status].label}` : null,
    '',
    greeting,
    ...body,
    details.length ? '' : null,
    ...details.map(([k, v]) => `${k}: ${v}`),
    quote ? `\n${quoteLabel ? quoteLabel + (quoteFrom ? ` (${quoteFrom})` : '') + ':\n' : ''}> ${String(quote).split('\n').join('\n> ')}\n` : null,
    ctaUrl ? `${ctaLabel || 'Open portal'}: ${ctaUrl}` : null,
    ratingLinks ? `\nHow did we do? Rate 1 (very poor) to 5 (excellent):\n${ratingLinks.map((r) => `${r.value}: ${r.url}`).join('\n')}` : null,
    signatureText(signature),
    note ? `\n${note}` : null,
    '',
    '--',
    config.companyName,
    `${FOOTERS[footer] || FOOTERS.notification} ${replyable ? 'You can reply to this email to add a message to the ticket.' : 'Please use the support portal to respond.'}`,
    footer === 'notification' ? `Email preferences: ${config.appUrl}/profile` : null,
  ]
    .filter((x) => x !== undefined && x !== null)
    .join('\n');
  return { html, text };
}

// Default signature for someone who has not written their own.
const defaultSignature = (user) => [user.name, config.companyName, user.email].filter(Boolean).join('\n');
const signatureFor = (user) => (user && user.signature && user.signature.trim() ? user.signature.trim() : user ? defaultSignature(user) : '');

module.exports = { render, REPLY_MARKER, signatureBlock, signatureFor, defaultSignature, avatarUrl, C };
