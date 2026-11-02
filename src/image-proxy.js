// Shows remote pictures in emails without the browser contacting the sender's servers (as Gmail does): the email
// body's image links are rewritten to signed portal links, and the portal fetches the picture itself.
// - Links are signed and expire, so this cannot be used as an open proxy.
// - Private, loopback and link-local addresses are refused at connect time, so it cannot reach the internal network.
// - Only images are passed through, size-capped, and SVGs are sandboxed so they can never run scripts.
const crypto = require('crypto');
const dns = require('dns');
const http = require('http');
const https = require('https');
const net = require('net');
const config = require('./config');

const MAX_BYTES = 8 * 1024 * 1024;
const TTL_SECONDS = 7 * 24 * 3600;
const sign = (url, exp) => crypto.createHmac('sha256', config.jwtSecret).update(`img:${exp}:${url}`).digest('base64url').slice(0, 32);

function proxied(url) {
  const exp = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  // Absolute when the API is on its own address, as the email is shown on the website's address.
  const base = config.apiUrl !== config.appUrl ? config.apiUrl : '';
  return `${base}/api/mail/image?u=${encodeURIComponent(url)}&e=${exp}&s=${sign(url, exp)}`;
}

function verify(url, exp, sig) {
  if (!url || !/^\d+$/.test(String(exp)) || Number(exp) < Date.now() / 1000) return false;
  const expected = sign(url, exp);
  return typeof sig === 'string' && sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

// Rewrites http(s) image sources (src, srcset, background, CSS url()) in an email body.
function rewriteImages(html) {
  if (!html) return html;
  const own = config.appUrl.replace(/\/+$/, '') + '/';
  const swap = (u) => {
    if (!/^https?:\/\//i.test(u)) return u;
    // The portal's own pictures (email icons, avatars) are served directly.
    if (u.startsWith(own)) return '/' + u.slice(own.length);
    return proxied(u.replace(/&amp;/g, '&'));
  };
  return html
    .replace(/(<img\b[^>]*?\bsrc\s*=\s*)(["'])(.*?)\2/gi, (m, pre, q, u) => `${pre}${q}${swap(u.trim())}${q}`)
    .replace(/(<img\b[^>]*?\bsrcset\s*=\s*)(["'])(.*?)\2/gi, (m, pre, q, v) => `${pre}${q}${v.split(',').map((part) => part.trim().replace(/^(\S+)/, (u) => swap(u))).join(', ')}${q}`)
    .replace(/(\bbackground\s*=\s*)(["'])(https?:[^"']+)\2/gi, (m, pre, q, u) => `${pre}${q}${swap(u)}${q}`)
    .replace(/url\(\s*(["']?)(https?:[^"')]+)\1\s*\)/gi, (m, q, u) => `url(${q}${swap(u)}${q})`);
}

function isPrivate(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return isPrivate(v.slice(7));
  return v === '::' || v === '::1' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') || v.startsWith('ff');
}

// DNS lookup that refuses internal addresses; used for the actual connection, so a changing DNS answer cannot slip past.
function safeLookup(hostname, options, cb) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return cb(err);
    if (!addresses.length || addresses.some((a) => isPrivate(a.address))) return cb(new Error('Blocked address'));
    // Newer Node versions ask for every address (to try IPv4 and IPv6 together); older ones for just one.
    if (options && options.all) cb(null, addresses);
    else cb(null, addresses[0].address, addresses[0].family);
  });
}

function fetchImage(url, redirects = 3) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(url);
    } catch {
      return reject(new Error('Bad URL'));
    }
    if (!/^https?:$/.test(u.protocol) || (u.port && !['80', '443'].includes(u.port))) return reject(new Error('Blocked URL'));
    if (net.isIP(u.hostname) && isPrivate(u.hostname)) return reject(new Error('Blocked address'));
    const lib = u.protocol === 'https:' ? https : http;
    const r = lib.get(u, { lookup: safeLookup, timeout: 10000, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SupportPortalImageProxy)', Accept: 'image/*' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
        res.resume();
        return fetchImage(new URL(res.headers.location, u).toString(), redirects - 1).then(resolve, reject);
      }
      const type = String(res.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (res.statusCode !== 200 || !type.startsWith('image/')) {
        res.resume();
        return reject(new Error('Not an image'));
      }
      const chunks = [];
      let size = 0;
      res.on('data', (c) => {
        size += c.length;
        if (size > MAX_BYTES) {
          r.destroy();
          reject(new Error('Too large'));
        } else chunks.push(c);
      });
      res.on('end', () => resolve({ type, data: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    r.on('timeout', () => r.destroy(new Error('Timed out')));
    r.on('error', reject);
  });
}

// Express handler for /api/mail/image. No sign-in needed: the signature is the permission (sandboxed email frames
// cannot send the session cookie), and it only ever covers an image link found in an admin's own email.
async function handler(req, res) {
  const { u, e, s } = req.query;
  if (!verify(String(u || ''), e, s)) return res.status(403).end();
  try {
    const img = await fetchImage(String(u));
    res.set('Cache-Control', 'private, max-age=86400');
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    res.type(img.type).send(img.data);
  } catch {
    // A transparent 1x1 GIF keeps the email layout intact when a picture cannot be fetched.
    res.set('Cache-Control', 'private, max-age=600');
    res.type('image/gif').send(Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'));
  }
}

module.exports = { rewriteImages, handler, isPrivate, fetchImage, proxied };
