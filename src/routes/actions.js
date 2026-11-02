// Admin actions (suggestions and reminders) and the AI ticket assistant.
const router = require('express').Router();
const Anthropic = require('@anthropic-ai/sdk').default;
const actions = require('../actions');
const ai = require('../ai');
const svc = require('../services/tickets');
const { requireAdmin } = require('../auth');
const { wrap, HttpError } = require('../util');

router.use(requireAdmin);

const validKey = (k) => {
  const key = String(k || '');
  if (!/^[\w:.\- ]{3,120}$/.test(key) || key === '__daily__') throw new HttpError(400, 'Invalid action');
  return key;
};

router.get(
  '/actions',
  wrap(async (req, res) => {
    const items = await actions.computeActions();
    const { visible, hidden } = await actions.forUser(req.user, items);
    const count = (s) => visible.filter((i) => i.severity === s).length;
    res.json({ items: visible, hidden, counts: { urgent: count('urgent'), high: count('high'), normal: count('normal'), total: visible.length } });
  })
);

router.post(
  '/actions/snooze',
  wrap(async (req, res) => {
    const choice = ['1h', '4h', 'tomorrow', 'week'].includes(req.body.until) ? req.body.until : 'tomorrow';
    const until = actions.snoozeUntil(choice);
    await actions.setState(req.user, validKey(req.body.key), { status: 'snoozed', snooze_until: until });
    res.json({ ok: true, until });
  })
);

router.post(
  '/actions/dismiss',
  wrap(async (req, res) => {
    await actions.setState(req.user, validKey(req.body.key), { status: 'dismissed', reason: String(req.body.reason || '').trim().slice(0, 255) || null });
    res.json({ ok: true });
  })
);

router.post(
  '/actions/restore',
  wrap(async (req, res) => {
    await actions.setState(req.user, validKey(req.body.key), { status: null });
    res.json({ ok: true });
  })
);

// ---- AI ticket assistant ----

router.get(
  '/tickets/:id/ai',
  wrap(async (req, res) => {
    res.json({ enabled: true, provider: ai.provider(), insight: await ai.storedInsight(Number(req.params.id), req.user) });
  })
);

router.post(
  '/tickets/:id/ai',
  wrap(async (req, res) => {
    const t = await svc.getTicket(Number(req.params.id));
    if (!t) throw new HttpError(404, 'Ticket not found');
    try {
      res.json(await ai.analyseTicket(t.id, { force: req.body.force === true, user: req.user }));
    } catch (err) {
      if (err instanceof ai.AiUnavailableError) throw new HttpError(400, err.message);
      if (err instanceof Anthropic.AuthenticationError) throw new HttpError(502, 'The AI assistant could not sign in: check ANTHROPIC_API_KEY.');
      if (err instanceof Anthropic.RateLimitError) throw new HttpError(429, 'The AI assistant is busy. Please try again in a minute.');
      if (err instanceof Anthropic.APIError) {
        console.error('[ai] API error', err.status, err.message);
        throw new HttpError(502, 'The AI assistant is unavailable right now. Please try again.');
      }
      if (err instanceof SyntaxError) throw new HttpError(502, 'The AI assistant returned an unexpected answer. Please try again.');
      throw new HttpError(502, err.message || 'The AI assistant failed.');
    }
  })
);

module.exports = router;
