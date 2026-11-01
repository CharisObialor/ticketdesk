const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const config = require('../config');
const { authenticate, csrfCheck } = require('../auth');
const { HttpError } = require('../util');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const appHost = new URL(config.appUrl).host;

// Rejects state-changing requests sent from other websites (CSRF), on top of the SameSite session cookie.
// Browsers always send Origin (and Sec-Fetch-Site) on such requests; tools without them have no cookie to abuse.
function sameOrigin(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  if (req.get('sec-fetch-site') === 'cross-site') return next(new HttpError(403, 'Cross-site request blocked'));
  const origin = req.get('origin');
  if (origin && origin !== 'null') {
    let host;
    try {
      host = new URL(origin).host;
    } catch {
      return next(new HttpError(403, 'Cross-site request blocked'));
    }
    if (host !== req.get('host') && host !== appHost) return next(new HttpError(403, 'Cross-site request blocked'));
  } else if (origin === 'null') {
    return next(new HttpError(403, 'Cross-site request blocked'));
  }
  next();
}

// Generous ceiling per user (or per IP when signed out) to blunt scripted abuse and floods.
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 600,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => (req.user ? `u${req.user.id}` : `ip${req.ip}`),
  message: { error: 'Too many requests. Please slow down and try again in a minute.' },
});

// Runs `inner` only for matching paths, so its admin check does not affect other routes.
const adminOnlyPaths = (pattern, inner) => (req, res, next) => (pattern.test(req.path) ? inner(req, res, next) : next());

router.use(sameOrigin);
router.use(authenticate);
router.use(csrfCheck);
// Clients never see our engineers' names or numbers.
router.use(require('../privacy').clientResponses);
router.use(apiLimiter);
router.use('/auth', require('./auth'));
router.use(adminOnlyPaths(/^\/(actions|tickets\/\d+\/ai)(\/|$)/, require('./actions')));
router.use('/tickets', require('./tickets'));
router.use('/metrics', require('./metrics'));
router.use('/reports', require('./reports'));
router.use('/chats', require('./chats'));
router.use('/mail', require('./mail'));
router.use(require('./files'));
router.use(require('./admin'));
router.use(require('./extras'));
router.use(require('./client'));
router.use(require('./push'));
router.use((req, res) => res.status(404).json({ error: 'Not found' }));

module.exports = router;
