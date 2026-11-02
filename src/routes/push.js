// Turning device notifications on and off, for anyone signed in.
const router = require('express').Router();
const push = require('../push');
const { requireAuth } = require('../auth');
const { wrap, HttpError } = require('../util');

router.get(
  '/push/key',
  requireAuth,
  wrap(async (req, res) => {
    res.json({ publicKey: push.publicKey(), devices: await push.countFor(req.user.id) });
  })
);

router.post(
  '/push/subscribe',
  requireAuth,
  wrap(async (req, res) => {
    await push.subscribe(req.user, req.body.subscription, req.get('user-agent'));
    res.json({ ok: true, devices: await push.countFor(req.user.id) });
  })
);

router.post(
  '/push/unsubscribe',
  requireAuth,
  wrap(async (req, res) => {
    await push.unsubscribe(req.user, req.body.endpoint);
    res.json({ ok: true, devices: await push.countFor(req.user.id) });
  })
);

// A test notification to all of the person's devices.
router.post(
  '/push/test',
  requireAuth,
  wrap(async (req, res) => {
    const sent = await push.sendToUser(req.user.id, {
      title: 'Notifications are on',
      body: 'You will get a notification here for updates on your tickets.',
      link: '/profile',
      tag: 'test',
    });
    if (!sent) throw new HttpError(400, 'No devices have notifications turned on yet');
    res.json({ sent });
  })
);

module.exports = router;
