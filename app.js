// Entry point. On cPanel set this as the "Application startup file" in Setup Node.js App.
const fs = require('fs');
const http = require('http');
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const hasher = require('./src/hasher');
const config = require('./src/config');
const db = require('./src/db');
const realtime = require('./src/realtime');
const jobs = require('./src/jobs');
const { errorHandler, now } = require('./src/util');
const { passwordProblems } = require('./src/password');

const publicDir = path.join(__dirname, 'public');

// The React client (client/) builds into public/. Its index.html is served for every app route.
const indexFile = path.join(publicDir, 'index.html');
function sendApp(req, res) {
  if (!fs.existsSync(indexFile)) return res.status(503).type('text').send('Client not built. Run: cd client && npm install && npm run build');
  res.set('Cache-Control', 'no-cache').sendFile(indexFile);
}

async function seedAdmin() {
  const row = await db.one('SELECT COUNT(*) AS n FROM users');
  if (Number(row.n) > 0) return;
  const { name, email, password } = config.admin;
  if (!email || !password) {
    console.warn('[setup] No users yet. Set ADMIN_EMAIL and ADMIN_PASSWORD in .env, or run: npm run create-admin');
    return;
  }
  const problems = passwordProblems(password, { email, name });
  if (problems.length) {
    console.warn(`[setup] ADMIN_PASSWORD is too weak (needs ${problems.join(', ')}). No admin created.`);
    return;
  }
  await db.query(
    "INSERT INTO users (name, email, password_hash, role, is_active, notify_email, created_at) VALUES (?, ?, ?, 'admin', 1, 1, ?)",
    [name, email.toLowerCase(), await hasher.hash(password, 11), now()]
  );
  console.log(`[setup] Created admin account ${email}`);
}

async function main() {
  await db.init();
  await require('./src/sla').load();
  await require('./src/escalation').load();
  await require('./src/push').load();
  await seedAdmin();

  const app = express();
  // How many proxies sit in front of the app (cPanel's web server is one). Each request's address, used by the
  // rate limits, is read from the header the proxy adds. Set TRUST_PROXY=0 if the app is ever exposed directly,
  // or visitors could fake their address and dodge the sign-in limit.
  app.set('trust proxy', config.trustProxy);
  app.disable('x-powered-by');
  // Website and API on different addresses (dateheightsupport.com and api.dateheightsupport.com).
  const appOrigin = new URL(config.appUrl).origin;
  const split = new URL(config.apiUrl).origin !== appOrigin;
  if (split) {
    // The website may call the API with its sign-in cookies; no other site may.
    app.use('/api', (req, res, next) => {
      if (req.get('origin') === appOrigin) {
        res.set({
          'Access-Control-Allow-Origin': appOrigin,
          'Access-Control-Allow-Credentials': 'true',
          'Access-Control-Allow-Headers': 'Content-Type, X-CSRF-Token',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE',
          'Access-Control-Max-Age': '600',
          Vary: 'Origin',
        });
      }
      if (req.method === 'OPTIONS') return res.sendStatus(204);
      next();
    });
  }
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          'img-src': ["'self'", 'data:', 'blob:'],
          'connect-src': ["'self'", config.appUrl.replace(/^http/, 'ws')],
          // Attachment previews (PDFs) are shown in a frame on the website's address.
          'frame-ancestors': ["'self'", appOrigin],
          'upgrade-insecure-requests': config.appUrl.startsWith('https://') ? [] : null,
        },
      },
      strictTransportSecurity: config.appUrl.startsWith('https://'),
      // Files and logos are loaded by the website from the API's address (same site, different subdomain).
      crossOriginResourcePolicy: { policy: 'same-site' },
      // frame-ancestors above decides who may frame previews; the older header would block the website.
      xFrameOptions: split ? false : { action: 'sameorigin' },
    })
  );
  app.use(compression());
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.use('/api', require('./src/uploads').limitRequestSize);
  app.use('/api', require('./src/routes'));
  // The service worker and manifest must be re-checked on every visit so app updates reach installed copies.
  app.get(['/sw.js', '/manifest.webmanifest'], (req, res, next) => {
    res.set('Cache-Control', 'no-cache');
    next();
  });
  // Vite fingerprints everything under /assets, so those can be cached for good.
  app.use('/assets', express.static(path.join(publicDir, 'assets'), { maxAge: config.isProd ? '1y' : 0, immutable: config.isProd }));
  app.use(express.static(publicDir, { index: false, maxAge: config.isProd ? '1d' : 0 }));
  // With a separate website, the API's address only serves the API; anything else goes to the website.
  if (split) app.get('*', (req, res) => res.redirect(302, config.appUrl + req.originalUrl));
  else app.get('*', sendApp);
  app.use(errorHandler);

  const server = http.createServer(app);
  // Large email attachments can take a while to upload on slow connections.
  server.requestTimeout = 30 * 60 * 1000;
  realtime.init(server);
  jobs.start();
  server.listen(config.port, () => console.log(`${config.appName} running on port ${config.port} (${config.db.client})`));
}

main().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
