// Entry point. On cPanel set this as the "Application startup file" in Setup Node.js App.
const fs = require('fs');
const http = require('http');
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
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
    [name, email.toLowerCase(), await bcrypt.hash(password, 11), now()]
  );
  console.log(`[setup] Created admin account ${email}`);
}

async function main() {
  await db.init();
  await seedAdmin();

  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          'img-src': ["'self'", 'data:', 'blob:'],
          'connect-src': ["'self'", config.appUrl.replace(/^http/, 'ws')],
          'upgrade-insecure-requests': config.appUrl.startsWith('https://') ? [] : null,
        },
      },
      strictTransportSecurity: config.appUrl.startsWith('https://'),
    })
  );
  app.use(compression());
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.use('/api', require('./src/routes'));
  // The service worker and manifest must be re-checked on every visit so app updates reach installed copies.
  app.get(['/sw.js', '/manifest.webmanifest'], (req, res, next) => {
    res.set('Cache-Control', 'no-cache');
    next();
  });
  // Vite fingerprints everything under /assets, so those can be cached for good.
  app.use('/assets', express.static(path.join(publicDir, 'assets'), { maxAge: config.isProd ? '1y' : 0, immutable: config.isProd }));
  app.use(express.static(publicDir, { index: false, maxAge: config.isProd ? '1d' : 0 }));
  app.get('*', sendApp);
  app.use(errorHandler);

  const server = http.createServer(app);
  realtime.init(server);
  jobs.start();
  server.listen(config.port, () => console.log(`${config.appName} running on port ${config.port} (${config.db.client})`));
}

main().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
