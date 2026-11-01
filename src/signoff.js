// Resolving a ticket needs a second (and third) pair of eyes: when someone marks a ticket resolved, the ticket keeps
// its status and the other admins are asked to sign off. Only once two of them approve is it resolved: the resolution
// time is recorded and the client is told (and asked to rate). Any admin can send it back with a reason instead.
// With fewer admins, every other admin is needed (one other admin: one approval; a lone admin: none).
// Each request is a new "round", so approvals from an earlier round never count towards a later one.
const db = require('./db');
const { now, HttpError, STATUS_LABELS } = require('./util');

const APPROVALS_NEEDED = 2;

// How many approvals a resolution by `requesterId` needs: two other active admins, or as many as exist.
async function requiredFor(requesterId) {
  const row = await db.one("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND is_active = 1 AND id <> ?", [requesterId || 0]);
  return Math.min(APPROVALS_NEEDED, Number(row.n) || 0);
}

// Waiting for sign-off: a round is open (signoff_required is cleared when it is approved or sent back).
const pending = (t) => Number(t.signoff_required) > 0 && t.status !== 'closed';

async function decisions(t) {
  return db.query(
    `SELECT s.user_id, s.decision, s.comment, s.created_at, u.name FROM ticket_signoffs s LEFT JOIN users u ON u.id = s.user_id
     WHERE s.ticket_id = ? AND s.round = ? ORDER BY s.id`,
    [t.id, t.signoff_round]
  );
}

// The sign-off picture for the ticket page.
async function state(t) {
  if (!pending(t)) return { active: false };
  const rows = await decisions(t);
  const requester = t.signoff_requested_by ? await db.one('SELECT id, name FROM users WHERE id = ?', [t.signoff_requested_by]) : null;
  return {
    active: true,
    required: Number(t.signoff_required),
    approvals: rows.filter((r) => r.decision === 'approved'),
    requestedBy: requester,
    requestedAt: t.signoff_requested_at,
  };
}

module.exports = { requiredFor, pending, decisions, state, APPROVALS_NEEDED };

// Late requires: these modules depend on the ticket service, which is loaded after this one.
Object.assign(module.exports, {
  // Someone marked the ticket resolved: open a new round and ask the other admins. The ticket keeps its status.
  async start(t, actor) {
    const svc = require('./services/tickets');
    const notify = require('./notify');
    const required = await requiredFor(actor ? actor.id : null);
    const updated = await svc.touch(t.id, {
      signoff_round: Number(t.signoff_round || 0) + 1,
      signoff_required: required,
      signoff_requested_by: actor ? actor.id : null,
      signoff_requested_at: now(),
    });
    if (required > 0) {
      await svc.addMessage(updated, actor, {
        body: `${actor ? actor.name : 'Someone'} marked this ticket resolved. Waiting for sign-off from ${required === 1 ? 'another admin' : `${required} other admins`} before it is resolved and the client is told.`,
        internal: true,
        kind: 'system',
      });
      notify.signoffRequested(updated, actor, required);
    }
    return updated;
  },

  // An admin approves or sends the ticket back.
  async decide(t, user, decision, comment) {
    const svc = require('./services/tickets');
    const notify = require('./notify');
    if (!pending(t)) throw new HttpError(400, 'This ticket is not waiting for sign-off.');
    if (Number(t.signoff_requested_by) === user.id) throw new HttpError(403, 'You resolved this ticket, so other admins need to sign it off.');
    if (!['approved', 'rejected'].includes(decision)) throw new HttpError(400, 'Choose approve or send back');
    if (decision === 'rejected' && !comment) throw new HttpError(400, 'Say why it is being sent back');
    const already = await db.one('SELECT id FROM ticket_signoffs WHERE ticket_id = ? AND round = ? AND user_id = ?', [t.id, t.signoff_round, user.id]);
    if (already) throw new HttpError(409, 'You have already signed off on this ticket.');
    await db.query('INSERT INTO ticket_signoffs (ticket_id, round, user_id, decision, comment, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
      t.id,
      t.signoff_round,
      user.id,
      decision,
      comment || null,
      now(),
    ]);

    // Tickets resolved under the old flow had already told the client; new ones never did.
    const legacy = t.status === 'resolved';
    if (decision === 'rejected') {
      const updated = await svc.touch(t.id, legacy ? { status: 'in_progress', resolved_at: null, signoff_required: 0 } : { signoff_required: 0 });
      await svc.addMessage(updated, user, { body: `${user.name} sent this ticket back instead of signing it off: ${comment}`, internal: true, kind: 'system' });
      if (legacy) {
        await svc.systemMessage(updated, user, 'Status changed from Resolved to In progress.');
        notify.statusChanged(updated, user, 'resolved', 'in_progress', true);
      }
      notify.signoffRejected(updated, user, comment);
      return { ticket: updated, resolved: false, closed: false };
    }

    const approvals = (await decisions(t)).filter((r) => r.decision === 'approved');
    await svc.addMessage(t, user, { body: `${user.name} signed off (${approvals.length} of ${t.signoff_required}).${comment ? ` ${comment}` : ''}`, internal: true, kind: 'system' });
    if (approvals.length < Number(t.signoff_required)) return { ticket: await svc.getTicket(t.id), resolved: false, closed: false };

    const names = approvals.map((a) => a.name);
    if (legacy) {
      // Old flow: the ticket was already resolved and the client told; sign-off closes it.
      const updated = await svc.touch(t.id, { status: 'closed', signoff_required: 0 });
      await svc.addMessage(updated, null, { body: `Closed after sign-off by ${names.join(' and ')}.`, internal: true, kind: 'system' });
      await svc.systemMessage(updated, user, 'Status changed from Resolved to Closed.');
      notify.signoffCompleted(updated, names, 'closed');
      notify.statusChanged(updated, user, 'resolved', 'closed', true);
      svc.archiveTranscript(updated, user, 'closed').catch((err) => console.error('[transcript] archive failed', err));
      return { ticket: updated, resolved: true, closed: true };
    }
    // Signed off: now it is resolved. The resolution time is recorded and the client is told and asked to rate.
    const from = t.status;
    const updated = await svc.touch(t.id, { status: 'resolved', resolved_at: now(), signoff_required: 0 });
    await svc.addMessage(updated, null, { body: `Resolved after sign-off by ${names.join(' and ')}.`, internal: true, kind: 'system' });
    await svc.systemMessage(updated, user, `Status changed from ${STATUS_LABELS[from] || from} to Resolved.`);
    notify.signoffCompleted(updated, names, 'resolved');
    notify.statusChanged(updated, user, from, 'resolved', true);
    svc.archiveTranscript(updated, user, 'resolved').catch((err) => console.error('[transcript] archive failed', err));
    return { ticket: updated, resolved: true, closed: false };
  },
});
