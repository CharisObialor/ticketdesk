// Device notifications (Web Push): desktop browsers, Android, and iPhone/iPad when the portal is on the Home Screen.
// Every bell notification is also pushed to the person's devices that have notifications turned on.
// The signing keys (VAPID) are made once and kept in the settings table, so nothing needs configuring.
const webpush = require('web-push');
const config = require('./config');
const db = require('./db');
const { now, HttpError } = require('./util');

const MAX_DEVICES = 10;
// Only real push services: a subscription is a web address the server will post to, so anything else is refused.
const PUSH_HOSTS = [/(^|\.)googleapis\.com$/, /(^|\.)mozilla\.com$/, /(^|\.)notify\.windows\.com$/, /(^|\.)push\.apple\.com$/];

let keys = null;

async function load() {
  const row = await db.one("SELECT value FROM settings WHERE name = 'vapid'");
  try {
    keys = row ? JSON.parse(row.value) : null;
  } catch {
    keys = null;
  }
  if (!keys || !keys.publicKey || !keys.privateKey) {
    keys = webpush.generateVAPIDKeys();
    const value = JSON.stringify(keys);
    const ts = now();
    const updated = await db.query("UPDATE settings SET value = ?, updated_at = ? WHERE name = 'vapid'", [value, ts]);
    if (!updated.affectedRows) await db.query("INSERT INTO settings (name, value, updated_at) VALUES ('vapid', ?, ?)", [value, ts]);
  }
  // Push services may contact this address about problems with our notifications.
  const from = String(config.smtp.from || '').replace(/^.*<|>.*$/g, '').trim();
  const contact = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(from) && !/localhost$/.test(from) ? `mailto:${from}` : config.appUrl.startsWith('https://') ? config.appUrl : 'mailto:support@dateheight.com';
  webpush.setVapidDetails(contact, keys.publicKey, keys.privateKey);
}

const publicKey = () => keys && keys.publicKey;

function cleanSubscription(sub) {
  const endpoint = String((sub && sub.endpoint) || '');
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    throw new HttpError(400, 'Invalid subscription');
  }
  if (url.protocol !== 'https:' || !PUSH_HOSTS.some((re) => re.test(url.hostname)) || endpoint.length > 1000) throw new HttpError(400, 'Unsupported push service');
  const k = (sub && sub.keys) || {};
  const p256dh = String(k.p256dh || '');
  const auth = String(k.auth || '');
  if (!/^[A-Za-z0-9_-]{40,200}$/.test(p256dh) || !/^[A-Za-z0-9_-]{10,100}$/.test(auth)) throw new HttpError(400, 'Invalid subscription keys');
  return { endpoint, p256dh, auth };
}

async function subscribe(user, sub, userAgent) {
  const s = cleanSubscription(sub);
  const ts = now();
  // The same device may re-subscribe (or another account may sign in on it): the endpoint belongs to the latest user.
  await db.query('DELETE FROM push_subscriptions WHERE endpoint = ?', [s.endpoint]);
  await db.query('INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
    user.id,
    s.endpoint,
    s.p256dh,
    s.auth,
    String(userAgent || '').slice(0, 255) || null,
    ts,
    ts,
  ]);
  // Keep each person to their most recent devices.
  const old = await db.query('SELECT id FROM push_subscriptions WHERE user_id = ? ORDER BY id DESC', [user.id]);
  for (const o of old.slice(MAX_DEVICES)) await db.query('DELETE FROM push_subscriptions WHERE id = ?', [o.id]);
}

const unsubscribe = (user, endpoint) => db.query('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?', [user.id, String(endpoint || '')]);

const countFor = async (userId) => Number((await db.one('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?', [userId])).n);

// Sends to every device the person has turned notifications on for. Gone devices are forgotten.
async function sendToUser(userId, { title, body, link, tag }) {
  if (!keys) return 0;
  const subs = await db.query('SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?', [userId]);
  if (!subs.length) return 0;
  const payload = JSON.stringify({ title: String(title || '').slice(0, 120), body: String(body || '').slice(0, 300), link: link || '/', tag: tag || undefined });
  let sent = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 24 * 3600, urgency: 'high', timeout: 10000 });
        sent++;
        await db.query('UPDATE push_subscriptions SET last_used_at = ? WHERE id = ?', [now(), s.id]);
      } catch (err) {
        if ([404, 410].includes(err.statusCode)) await db.query('DELETE FROM push_subscriptions WHERE id = ?', [s.id]);
        else console.error(`[push] to user ${userId} failed: ${err.statusCode || ''} ${err.message}`);
      }
    })
  );
  return sent;
}

module.exports = { load, publicKey, subscribe, unsubscribe, sendToUser, countFor };
