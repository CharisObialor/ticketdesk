const router = require('express').Router();
const { authenticate } = require('../auth');

router.use(authenticate);
router.use('/auth', require('./auth'));
router.use('/tickets', require('./tickets'));
router.use('/metrics', require('./metrics'));
router.use('/chats', require('./chats'));
router.use(require('./files'));
router.use(require('./admin'));
router.use(require('./extras'));
router.use((req, res) => res.status(404).json({ error: 'Not found' }));

module.exports = router;
