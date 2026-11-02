// Permanent deletion of tickets, user accounts and client companies (the owner only). The database removes the
// rows that belong to what is deleted (messages, ratings, visits, chat memberships...); this module also removes the
// files on disk and the notifications and to-do entries that would point at something gone.
const fs = require('fs');
const path = require('path');
const db = require('./db');
const realtime = require('./realtime');
const { uploadsDir, transcriptsDir } = require('./uploads');

const unlinkAll = (dir, names) => {
  for (const n of names) if (n) fs.unlink(path.join(dir, path.basename(n)), () => {});
};

// Action-list entries are keyed "<kind>:<ticket id>[:...]".
async function clearTicketActions(ticketId) {
  const rows = await db.query('SELECT DISTINCT action_key FROM action_states WHERE action_key LIKE ?', [`%:${ticketId}%`]);
  const keys = rows.map((r) => r.action_key).filter((k) => k.split(':')[1] === String(ticketId));
  if (keys.length) await db.query(`DELETE FROM action_states WHERE action_key IN (${db.inList(keys)})`, keys);
}

async function deleteTicket(ticketId) {
  const t = await db.one('SELECT id, company_id, subject FROM tickets WHERE id = ?', [ticketId]);
  if (!t) return null;
  const files = (await db.query('SELECT stored_name FROM attachments WHERE ticket_id = ?', [t.id])).map((r) => r.stored_name);
  const transcripts = (await db.query('SELECT filename FROM transcripts WHERE ticket_id = ?', [t.id])).map((r) => r.filename);
  await db.query('DELETE FROM notifications WHERE link = ? OR link LIKE ? OR link LIKE ?', [`/tickets/${t.id}`, `/tickets/${t.id}?%`, `/tickets/${t.id}#%`]);
  await clearTicketActions(t.id);
  await db.query('DELETE FROM tickets WHERE id = ?', [t.id]);
  unlinkAll(uploadsDir, files);
  unlinkAll(transcriptsDir, transcripts);
  realtime.toTicket(t, 'ticket:deleted', { ticketId: t.id });
  return { files: files.length + transcripts.length };
}

// The account and everything that is only theirs: notifications, device sign-ups, chat memberships and their direct
// admin chats. What they wrote on tickets and in group chats stays, shown as from a former user.
async function deleteUser(userId) {
  const user = await db.one('SELECT id, role, email FROM users WHERE id = ?', [userId]);
  if (!user) return null;
  const direct = await db.query('SELECT c.id FROM team_chats c JOIN team_chat_members m ON m.chat_id = c.id WHERE c.is_direct = 1 AND m.user_id = ?', [user.id]);
  const chatIds = direct.map((c) => c.id);
  if (chatIds.length) {
    const files = await db.query(`SELECT stored_name FROM team_attachments WHERE chat_id IN (${db.inList(chatIds)})`, chatIds);
    await db.query(`DELETE FROM team_chats WHERE id IN (${db.inList(chatIds)})`, chatIds);
    unlinkAll(uploadsDir, files.map((f) => f.stored_name));
  }
  await db.query('DELETE FROM users WHERE id = ?', [user.id]);
  realtime.disconnectUser(user.id);
  return { directChats: chatIds.length };
}

// What deleting a client company removes, for the confirmation.
async function companyUsage(companyId) {
  const count = async (sql) => Number((await db.one(sql, [companyId])).n);
  return {
    tickets: await count('SELECT COUNT(*) AS n FROM tickets WHERE company_id = ?'),
    users: await count("SELECT COUNT(*) AS n FROM users WHERE company_id = ? AND role = 'client'"),
    groups: await count('SELECT COUNT(*) AS n FROM chat_groups WHERE company_id = ?'),
    sites: await count('SELECT COUNT(*) AS n FROM sites WHERE company_id = ?'),
  };
}

// The company with all its tickets, client accounts, group chats and sites. Staff linked to it are kept.
async function deleteCompany(companyId) {
  const company = await db.one('SELECT id, name, logo FROM companies WHERE id = ?', [companyId]);
  if (!company) return null;
  const usage = await companyUsage(company.id);
  for (const t of await db.query('SELECT id FROM tickets WHERE company_id = ?', [company.id])) await deleteTicket(t.id);
  for (const u of await db.query("SELECT id FROM users WHERE company_id = ? AND role = 'client'", [company.id])) await deleteUser(u.id);
  const groupFiles = await db.query('SELECT a.stored_name FROM chat_attachments a JOIN chat_groups g ON g.id = a.group_id WHERE g.company_id = ?', [company.id]);
  await db.query('DELETE FROM companies WHERE id = ?', [company.id]);
  unlinkAll(uploadsDir, groupFiles.map((f) => f.stored_name));
  if (company.logo) unlinkAll(path.join(require('./config').storageDir, 'logos'), [company.logo]);
  return { name: company.name, ...usage };
}

// To-do kinds that are about a ticket (or its visit, rating or sign-off).
const TICKET_ACTIONS = ['sla', 'ttr', 'unassigned', 'escalated', 'waiting', 'stale', 'signoff', 'visit', 'rating'];

// Every ticket on the platform and what comes with them, for a fresh start: numbering begins again at #1, and reply
// addresses from older emails stop working. Companies, people, sites, technicians and chats stay.
async function clearAllTickets() {
  const tickets = Number((await db.one('SELECT COUNT(*) AS n FROM tickets')).n);
  const files = (await db.query('SELECT stored_name FROM attachments')).map((r) => r.stored_name);
  const transcripts = (await db.query('SELECT filename FROM transcripts')).map((r) => r.filename);
  await db.query("DELETE FROM notifications WHERE link LIKE '/tickets/%' OR link LIKE '/visits/%'");
  await db.query(`DELETE FROM action_states WHERE ${TICKET_ACTIONS.map(() => 'action_key LIKE ?').join(' OR ')}`, TICKET_ACTIONS.map((k) => `${k}:%`));
  // Ticket emails still waiting to go out (held for an admin who is away, or retrying) are about tickets that are gone.
  await db.query("DELETE FROM mail_outbox WHERE status <> 'sent' AND subject LIKE '%[Ticket #%'");
  await db.query('DELETE FROM tickets');
  if (db.dialect() === 'mysql') await db.query('ALTER TABLE tickets AUTO_INCREMENT = 1');
  else await db.query("DELETE FROM sqlite_sequence WHERE name = 'tickets'").catch(() => {});
  const epoch = String(Date.now());
  const ts = require('./util').now();
  const updated = await db.query("UPDATE settings SET value = ?, updated_at = ? WHERE name = 'reply_epoch'", [epoch, ts]);
  if (!updated.affectedRows) await db.query("INSERT INTO settings (name, value, updated_at) VALUES ('reply_epoch', ?, ?)", [epoch, ts]);
  require('./replyto').setEpoch(epoch);
  unlinkAll(uploadsDir, files);
  unlinkAll(transcriptsDir, transcripts);
  realtime.toEveryone('tickets:cleared', {});
  return { tickets, files: files.length + transcripts.length };
}

module.exports = { deleteTicket, deleteUser, deleteCompany, companyUsage, clearAllTickets };
