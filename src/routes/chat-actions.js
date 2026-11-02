// Actions on a single chat message, for group chats (scope "group") and admin chats (scope "team"):
// react, pin, delete for me, delete for everyone, and forward to other chats.
const router = require('express').Router();
const db = require('../db');
const config = require('../config');
const extras = require('../chat-extras');
const { cleanup } = require('../uploads');
const { requireAuth } = require('../auth');
const { wrap, now, HttpError } = require('../util');

router.use(requireAuth);

const chats = () => ({ group: require('./chats').groupChat, team: require('./team').teamChat });
const MAX_FORWARD = 10;

// The message and its conversation, if this person can see it.
async function load(req) {
  const scope = req.params.scope;
  const s = extras.SCOPES[scope];
  if (!s) throw new HttpError(404, 'Not found');
  const row = await db.one(`SELECT * FROM ${s.messages} WHERE id = ?`, [Number(req.params.id)]);
  if (!row) throw new HttpError(404, 'Message not found');
  const api = chats()[scope];
  const { members } = await api.access(Number(row[s.conv]), req.user);
  return { scope, s, api, row, conversationId: Number(row[s.conv]), isMember: members.includes(req.user.id) };
}

const ensureMessage = (row) => {
  if (row.kind !== 'message') throw new HttpError(400, 'That cannot be done to this message');
  if (row.deleted_at) throw new HttpError(400, 'This message was deleted');
};
const ensureMember = (ctx) => {
  if (!ctx.isMember) throw new HttpError(403, 'Join the conversation first: send a message in it');
};

async function announce(ctx) {
  const message = await ctx.api.loadMessage(ctx.row.id);
  await ctx.api.announceUpdate(ctx.conversationId, message);
  return message;
}

// One reaction per person per message: the same one again removes it, another replaces it.
router.post(
  '/:scope/:id/react',
  wrap(async (req, res) => {
    const ctx = await load(req);
    ensureMessage(ctx.row);
    ensureMember(ctx);
    const emoji = req.body.emoji ? String(req.body.emoji) : null;
    if (emoji && !extras.REACTIONS.includes(emoji)) throw new HttpError(400, 'Choose one of the reactions shown');
    const had = await db.one('SELECT emoji FROM chat_reactions WHERE scope = ? AND message_id = ? AND user_id = ?', [ctx.scope, ctx.row.id, req.user.id]);
    await db.query('DELETE FROM chat_reactions WHERE scope = ? AND message_id = ? AND user_id = ?', [ctx.scope, ctx.row.id, req.user.id]);
    if (emoji && (!had || had.emoji !== emoji)) {
      await db.query('INSERT INTO chat_reactions (scope, message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?, ?)', [ctx.scope, ctx.row.id, req.user.id, emoji, now()]);
    }
    res.json({ message: await announce(ctx) });
  })
);

router.post(
  '/:scope/:id/pin',
  wrap(async (req, res) => {
    const ctx = await load(req);
    ensureMessage(ctx.row);
    ensureMember(ctx);
    const pin = req.body.pinned !== false;
    await db.query('DELETE FROM chat_pins WHERE scope = ? AND message_id = ?', [ctx.scope, ctx.row.id]);
    if (pin) {
      const count = await db.one('SELECT COUNT(*) AS n FROM chat_pins WHERE scope = ? AND conversation_id = ?', [ctx.scope, ctx.conversationId]);
      if (Number(count.n) >= extras.MAX_PINS) throw new HttpError(400, `Up to ${extras.MAX_PINS} messages can be pinned. Unpin one first.`);
      await db.query('INSERT INTO chat_pins (scope, conversation_id, message_id, pinned_by, pinned_at) VALUES (?, ?, ?, ?, ?)', [
        ctx.scope,
        ctx.conversationId,
        ctx.row.id,
        req.user.id,
        now(),
      ]);
    }
    res.json({ message: await announce(ctx), pins: await extras.pinsFor(ctx.scope, ctx.conversationId) });
  })
);

// Delete for me: hidden from this person only.
router.post(
  '/:scope/:id/hide',
  wrap(async (req, res) => {
    const ctx = await load(req);
    if (ctx.row.kind !== 'message') throw new HttpError(400, 'That cannot be done to this message');
    await db.query('DELETE FROM chat_hidden WHERE scope = ? AND user_id = ? AND message_id = ?', [ctx.scope, req.user.id, ctx.row.id]);
    await db.query('INSERT INTO chat_hidden (scope, message_id, user_id, hidden_at) VALUES (?, ?, ?, ?)', [ctx.scope, ctx.row.id, req.user.id, now()]);
    res.json({ ok: true });
  })
);

// Delete for everyone: the author, within the time limit.
router.delete(
  '/:scope/:id',
  wrap(async (req, res) => {
    const ctx = await load(req);
    ensureMessage(ctx.row);
    if (Number(ctx.row.user_id) !== req.user.id) throw new HttpError(403, 'You can only delete your own messages for everyone');
    if (!extras.canDeleteForEveryone(ctx.row)) {
      throw new HttpError(400, `Messages can only be deleted for everyone within ${config.chat.deleteMinutes} minutes of sending. You can still delete it for yourself.`);
    }
    await extras.deleteForEveryone(ctx.scope, ctx.row);
    res.json({ message: await announce(ctx), pins: await extras.pinsFor(ctx.scope, ctx.conversationId) });
  })
);

// Forward to other chats this person can post in ({ to: [{ type: 'group' | 'team', id }] }), files included.
router.post(
  '/:scope/:id/forward',
  wrap(async (req, res) => {
    const ctx = await load(req);
    ensureMessage(ctx.row);
    const targets = (Array.isArray(req.body.to) ? req.body.to : [])
      .map((t) => ({ type: String(t && t.type), id: Number(t && t.id) }))
      .filter((t) => extras.SCOPES[t.type] && t.id > 0)
      .filter((t, i, all) => all.findIndex((x) => x.type === t.type && x.id === t.id) === i);
    if (!targets.length) throw new HttpError(400, 'Choose where to forward it');
    if (targets.length > MAX_FORWARD) throw new HttpError(400, `Forward to at most ${MAX_FORWARD} conversations at a time`);
    // Check every destination before sending to any.
    const apis = chats();
    const checked = [];
    for (const t of targets) {
      const api = apis[t.type];
      const { group, chat, members } = await api.access(t.id, req.user).catch(() => {
        throw new HttpError(400, 'You cannot send messages to one of the chosen conversations');
      });
      if (t.type === 'group' && !members.includes(req.user.id) && req.user.role !== 'admin') throw new HttpError(400, 'You cannot send messages to one of the chosen conversations');
      checked.push({ api, conversation: group || chat, members });
    }
    let sent = 0;
    for (const t of checked) {
      const files = await extras.copyFiles(ctx.scope, ctx.row.id);
      try {
        await t.api.postForwarded(t.conversation, t.members, req.user, { body: ctx.row.body, files });
        sent += 1;
      } catch (err) {
        cleanup(files);
        throw err;
      }
    }
    res.json({ sent });
  })
);

module.exports = router;
