// Shared by group chats ("group") and admin chats ("team"): replies, reactions, pins, delete for me / for
// everyone, forwarding, and the time limits on editing and deleting.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');
const config = require('./config');
const { uploadsDir } = require('./uploads');

const SCOPES = {
  group: { messages: 'chat_messages', attachments: 'chat_attachments', conv: 'group_id' },
  team: { messages: 'team_messages', attachments: 'team_attachments', conv: 'chat_id' },
};
// A reaction is a single emoji (with its skin tone, variation and joiner characters): no letters, numbers or text.
const EMOJI = /^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|[\u200d\ufe0f\u20e3])+$/u;
const isEmoji = (v) => typeof v === 'string' && v.length <= 16 && EMOJI.test(v) && /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(v);
const MAX_PINS = 3;
const DELETED_BODY = 'This message was deleted';

const ageMinutes = (ts) => (Date.now() - new Date(`${String(ts).replace(' ', 'T')}Z`).getTime()) / 60000;
const canEdit = (m) => !m.deleted_at && ageMinutes(m.created_at) <= config.chat.editMinutes;
const canDeleteForEveryone = (m) => !m.deleted_at && ageMinutes(m.created_at) <= config.chat.deleteMinutes;

// SQL (and its values) that leaves out messages this person deleted for themselves. The message table must be "m".
const notHidden = (scope, userId) => ({
  sql: 'AND NOT EXISTS (SELECT 1 FROM chat_hidden h WHERE h.scope = ? AND h.user_id = ? AND h.message_id = m.id)',
  params: [scope, userId],
});

// A short preview of a message, for replies and the pinned bar.
function preview(row) {
  if (row.deleted_at) return DELETED_BODY;
  const text = String(row.body || '');
  if (text === '(attachment)' && Number(row.files)) return Number(row.files) === 1 ? 'Attachment' : `${row.files} attachments`;
  return text.length > 140 ? `${text.slice(0, 140)}...` : text;
}

const quoted = async (scope, ids) => {
  if (!ids.length) return [];
  const s = SCOPES[scope];
  return db.query(
    `SELECT m.id, m.user_id, m.body, m.deleted_at, u.name AS user_name,
       (SELECT COUNT(*) FROM ${s.attachments} a WHERE a.message_id = m.id) AS files
     FROM ${s.messages} m LEFT JOIN users u ON u.id = m.user_id WHERE m.id IN (${db.inList(ids)})`,
    ids
  );
};

// Adds what the chat shows around each message: the message it replies to, reactions, pinned and forwarded flags.
// Reactions list who reacted, so each viewer can tell which are theirs.
async function decorate(scope, messages) {
  if (!messages.length) return messages;
  const ids = messages.map((m) => Number(m.id));
  const replies = await quoted(scope, [...new Set(messages.map((m) => Number(m.reply_to_id)).filter(Boolean))]);
  const reactions = await db.query(
    `SELECT r.message_id, r.emoji, r.user_id, u.name FROM chat_reactions r LEFT JOIN users u ON u.id = r.user_id
     WHERE r.scope = ? AND r.message_id IN (${db.inList(ids)}) ORDER BY r.created_at`,
    [scope, ...ids]
  );
  const pinned = new Set(
    (await db.query(`SELECT message_id FROM chat_pins WHERE scope = ? AND message_id IN (${db.inList(ids)})`, [scope, ...ids])).map((r) => Number(r.message_id))
  );
  for (const m of messages) {
    const r = m.reply_to_id && replies.find((x) => Number(x.id) === Number(m.reply_to_id));
    m.reply_to = m.reply_to_id
      ? r
        ? { id: Number(r.id), user_id: r.user_id, user_name: r.user_name, body: preview(r), deleted: !!r.deleted_at }
        : { id: Number(m.reply_to_id), user_id: null, user_name: null, body: 'Message no longer available', deleted: true }
      : null;
    const groups = new Map();
    for (const x of reactions.filter((x) => Number(x.message_id) === Number(m.id))) {
      if (!groups.has(x.emoji)) groups.set(x.emoji, { emoji: x.emoji, user_ids: [], names: [] });
      groups.get(x.emoji).user_ids.push(Number(x.user_id));
      groups.get(x.emoji).names.push(x.name || 'Someone');
    }
    m.reactions = [...groups.values()];
    m.pinned = pinned.has(Number(m.id));
    m.forwarded = !!Number(m.forwarded);
    m.deleted = !!m.deleted_at;
  }
  return messages;
}

// Pinned messages in a conversation, newest pin first, for the bar at the top of the chat.
async function pinsFor(scope, conversationId) {
  const s = SCOPES[scope];
  const rows = await db.query(
    `SELECT p.message_id, p.pinned_at, pu.name AS pinned_by_name, m.body, m.deleted_at, u.name AS user_name,
       (SELECT COUNT(*) FROM ${s.attachments} a WHERE a.message_id = m.id) AS files
     FROM chat_pins p JOIN ${s.messages} m ON m.id = p.message_id
     LEFT JOIN users u ON u.id = m.user_id LEFT JOIN users pu ON pu.id = p.pinned_by
     WHERE p.scope = ? AND p.conversation_id = ? ORDER BY p.pinned_at DESC`,
    [scope, conversationId]
  );
  return rows.map((r) => ({ id: Number(r.message_id), user_name: r.user_name, body: preview(r), pinned_by_name: r.pinned_by_name, pinned_at: r.pinned_at }));
}

// Copies a message's files under new names, for forwarding (each chat keeps its own copy, so deleting one leaves the other).
async function copyFiles(scope, messageId) {
  const s = SCOPES[scope];
  const rows = await db.query(`SELECT original_name, stored_name, mime, size FROM ${s.attachments} WHERE message_id = ?`, [messageId]);
  const files = [];
  for (const a of rows) {
    const filename = crypto.randomBytes(16).toString('hex');
    await fs.promises.copyFile(path.join(uploadsDir, path.basename(a.stored_name)), path.join(uploadsDir, filename));
    files.push({ originalname: a.original_name, filename, mimetype: a.mime, size: Number(a.size), path: path.join(uploadsDir, filename) });
  }
  return files;
}

// Deletes a message for everyone: the text is replaced, files, reactions and pins go.
async function deleteForEveryone(scope, message) {
  const s = SCOPES[scope];
  const files = await db.query(`SELECT stored_name FROM ${s.attachments} WHERE message_id = ?`, [message.id]);
  await db.query(`DELETE FROM ${s.attachments} WHERE message_id = ?`, [message.id]);
  await db.query(`UPDATE ${s.messages} SET body = ?, deleted_at = ?, edited_at = NULL WHERE id = ?`, [DELETED_BODY, require('./util').now(), message.id]);
  await db.query('DELETE FROM chat_reactions WHERE scope = ? AND message_id = ?', [scope, message.id]);
  await db.query('DELETE FROM chat_pins WHERE scope = ? AND message_id = ?', [scope, message.id]);
  for (const f of files) fs.unlink(path.join(uploadsDir, path.basename(f.stored_name)), () => {});
}

module.exports = { SCOPES, isEmoji, MAX_PINS, DELETED_BODY, canEdit, canDeleteForEveryone, notHidden, decorate, pinsFor, copyFiles, deleteForEveryone, quoted };
