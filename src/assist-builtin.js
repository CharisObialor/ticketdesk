// Built-in ticket assistant: no AI service, no cost, nothing leaves the server. It reads the ticket with rules and
// word lists to produce the same fields as the AI assistant: summary, next step, urgency, client mood, risks and
// a drafted reply (from templates and the team's saved replies).
const config = require('./config');
const sla = require('./sla');
const { parseTs, STATUS_LABELS } = require('./util');

const NEGATIVE = [
  'unacceptable', 'ridiculous', 'disappointed', 'disappointing', 'terrible', 'worst', 'useless', 'frustrated', 'frustrating', 'annoyed',
  'angry', 'poor service', 'no response', 'nobody', 'no one', 'still not', 'still waiting', 'yet again', 'again', 'how long', 'days now',
  'not happy', 'unhappy', 'complain', 'complaint', 'waste', 'slow', 'ignored', 'urgent', 'asap', 'immediately', 'right now',
];
const SEVERE = ['lawyer', 'legal action', 'cancel', 'terminate', 'contract', 'refund', 'manager', 'escalate', 'ceo', 'director', 'switch provider'];
const POSITIVE = ['thank', 'thanks', 'appreciate', 'great', 'perfect', 'excellent', 'awesome', 'working now', 'works now', 'resolved', 'fixed', 'brilliant', 'helpful'];
const OUTAGE = ['down', 'outage', 'not working', "isn't working", 'cannot access', "can't access", 'cant access', 'offline', 'no internet', 'not loading', 'crashed', 'stopped working', 'unable to'];
const SECURITY = ['hacked', 'breach', 'phishing', 'virus', 'malware', 'ransomware', 'suspicious', 'password leaked', 'compromised', 'unauthori'];
const RECURRING = ['again', 'same problem', 'same issue', 'still', 'keeps happening', 'happened before', 'recurring', 'every time'];
const PROMISE = /\b(i will|we will|i'll|we'll|i shall|we shall|by tomorrow|by end of (the )?day|later today|shortly|get back to you)\b/i;
const STOP = new Set('the a an and or but to of in on for with is are was were be been it this that i we you they he she my our your their me us at by from as have has had do does did not no can could would should will just so if then than there here what when where who how all any some please hello hi dear regards thanks thank'.split(' '));

const count = (text, words) => words.reduce((n, w) => n + (text.includes(w) ? 1 : 0), 0);
const minutesSince = (ts) => (Date.now() - parseTs(ts).getTime()) / 60000;
const ago = (min) => (min < 60 ? `${Math.max(1, Math.round(min))} minutes` : min < 1440 ? `${Math.round(min / 60)} hours` : `${Math.round(min / 1440)} days`);
const first = (name) => String(name || '').trim().split(/\s+/)[0] || 'there';
const isClient = (m) => m.kind === 'message' && !m.is_internal && (m.user_role === 'client' || m.sender_email);
const isStaffMsg = (m) => m.kind === 'message' && m.user_role && m.user_role !== 'client';
const sentence = (text, max) => {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  const s = (clean.match(/^.*?[.!?](\s|$)/) || [clean])[0].trim();
  return s.length > max ? s.slice(0, max - 3).trimEnd() + '...' : s;
};
const words = (text) => String(text || '').toLowerCase().match(/[a-z][a-z0-9]{2,}/g)?.filter((w) => !STOP.has(w)) || [];

function fill(text, t, agent) {
  const values = {
    client_name: t.creator_name || '',
    client_first_name: first(t.creator_name),
    company_name: t.company_name || '',
    ticket_id: String(t.id),
    ticket_subject: t.subject,
    agent_name: agent ? agent.name : '',
    agent_first_name: agent ? first(agent.name) : '',
  };
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => (k in values ? values[k] : m));
}

// The saved reply that best matches what this ticket is about (by shared keywords), if any matches well.
function bestSavedReply(t, recentClientText, savedReplies) {
  const ticketWords = new Set([...words(t.subject), ...words(t.category), ...words(recentClientText)]);
  let best = null;
  for (const r of savedReplies) {
    const score = new Set(words(`${r.title} ${r.title} ${r.body}`).filter((w) => ticketWords.has(w))).size;
    if (score >= 2 && (!best || score > best.score)) best = { reply: r, score };
  }
  return best && best.reply;
}

function analyse(t, messages, { visits = [], rating = null, savedReplies = [], agent = null, staffLoad = [] } = {}) {
  const pub = messages.filter((m) => m.kind === 'message' && !m.is_internal);
  const clientMsgs = messages.filter(isClient);
  const staffMsgs = messages.filter(isStaffMsg);
  const lastPublic = pub[pub.length - 1];
  const clientWaiting = lastPublic && isClient(lastPublic);
  const recentClient = clientMsgs.slice(-3).map((m) => m.body).join(' \n ');
  const recentLower = recentClient.toLowerCase();
  const allClientLower = clientMsgs.map((m) => m.body).join(' ').toLowerCase();
  const name = first(t.creator_name);
  const open = ['open', 'in_progress', 'awaiting_client'].includes(t.status);

  // Client mood from the latest messages: negative and severe words, shouting and exclamation marks.
  const shouting = (recentClient.match(/\b[A-Z]{4,}\b/g) || []).length;
  const bangs = (recentClient.match(/!/g) || []).length;
  const negative = count(recentLower, NEGATIVE) + Math.min(shouting, 3) + Math.min(Math.floor(bangs / 2), 2);
  const severe = count(recentLower, SEVERE);
  const positive = count(recentLower, POSITIVE);
  const sentiment =
    severe && negative >= 2 ? 'angry' : negative >= 5 ? 'angry' : negative >= 2 || severe ? 'frustrated' : positive > negative && positive >= 1 ? 'positive' : 'neutral';

  // SLA and waiting time.
  const limit = sla.response(t);
  const slaOverdue = !t.first_response_at && open && minutesSince(t.created_at) > limit;
  const waitedMin = clientWaiting ? minutesSince(lastPublic.created_at) : 0;

  // Urgency from priority, raised by outages, security, anger, escalation and missed response times.
  const levels = ['low', 'normal', 'high', 'critical'];
  let u = { low: 0, normal: 1, high: 2, urgent: 3 }[t.priority] ?? 1;
  const outage = count(recentLower, OUTAGE) > 0;
  const security = count(allClientLower, SECURITY) > 0;
  if (outage || sentiment === 'angry' || slaOverdue || waitedMin > 1440) u += 1;
  if (security || t.escalated) u = Math.max(u, 2);
  if (!open) u = Math.min(u, 1);
  const urgency = levels[Math.min(u, 3)];

  // Risks an admin should not miss.
  const risks = [];
  if (slaOverdue) risks.push(`First response is overdue (target ${ago(limit)} for ${t.priority} priority).`);
  if (clientWaiting && waitedMin > 240 && open) risks.push(`${name} has been waiting ${ago(waitedMin)} for a reply.`);
  if (t.escalated) risks.push(`Escalated to level ${t.escalation_level}.`);
  if (security) risks.push('Possible security issue mentioned; handle with priority and check for other affected accounts.');
  const reopened = messages.filter((m) => m.kind === 'system' && /from Resolved to Open/i.test(m.body)).length;
  if (reopened) risks.push(`Reopened ${reopened} time${reopened === 1 ? '' : 's'}; the earlier fix may not have held.`);
  else if (count(recentLower, RECURRING) && clientMsgs.length > 1) risks.push('The client describes this as a recurring or unresolved problem.');
  const lastStaff = staffMsgs[staffMsgs.length - 1];
  if (lastStaff && PROMISE.test(lastStaff.body) && minutesSince(lastStaff.created_at) > 1440 && open) {
    risks.push(`A follow-up was promised ${ago(minutesSince(lastStaff.created_at))} ago with no update since.`);
  }
  if (severe) risks.push('The client mentions cancelling, escalating or a manager; consider a call.');
  const overdueVisit = visits.find((v) => ['scheduled', 'in_progress'].includes(v.status) && minutesSince(v.scheduled_at) > Number(v.duration_min || 60) + 120);
  if (overdueVisit) risks.push(`Site visit on ${String(overdueVisit.scheduled_at).slice(0, 16)} UTC has no report yet.`);
  if (rating && rating.rating <= 2) risks.push(`Client rated this ticket ${rating.rating} out of 5.`);

  // Summary.
  const firstClient = clientMsgs[0];
  const days = Math.max(1, Math.round(minutesSince(t.created_at) / 1440));
  const summary = [
    `${t.creator_name || 'The client'} from ${t.company_name} reported: "${sentence(firstClient ? firstClient.body : t.subject, 160)}"`,
    `The ticket is ${(STATUS_LABELS[t.status] || t.status).toLowerCase()}, ${t.assignee_name ? `assigned to ${t.assignee_name}` : 'not assigned'}, with ${pub.length} message${pub.length === 1 ? '' : 's'} over ${days} day${days === 1 ? '' : 's'}.`,
    lastPublic && lastPublic !== firstClient
      ? `Latest, ${ago(minutesSince(lastPublic.created_at))} ago, ${isClient(lastPublic) ? first(lastPublic.user_name || lastPublic.sender_name) : 'the team'}: "${sentence(lastPublic.body, 140)}"`
      : '',
  ]
    .filter(Boolean)
    .join(' ');

  // Next step, from the ticket's situation.
  const lightest = staffLoad[0];
  const upcoming = visits.find((v) => v.status === 'scheduled' && minutesSince(v.scheduled_at) < 0);
  const asked = clientWaiting && /\?/.test(lastPublic.body);
  let nextStep;
  if (!open && rating && rating.rating <= 2) nextStep = `Call ${name} to understand the ${rating.rating}-star rating and agree how to put it right.`;
  else if (!open) nextStep = 'No action needed unless the client replies.';
  else if (!t.assigned_to) nextStep = `Assign the ticket${lightest ? ` (suggested: ${lightest.name}, ${lightest.open} open)` : ''} and send ${name} a first response.`;
  else if (t.escalated && !staffMsgs.some((m) => t.escalated_at && m.created_at > t.escalated_at))
    nextStep = `Take ownership of the escalation: call ${name} today and agree a clear plan and timeline.`;
  else if (!t.first_response_at) nextStep = `Send ${name} a first response confirming you are on it and when they will hear back.`;
  else if (overdueVisit) nextStep = `Get the site visit report from ${overdueVisit.technician_name || 'the technician'}, or reschedule the visit with ${name}.`;
  else if (clientWaiting) nextStep = `Reply to ${name}'s latest message${asked ? '; they asked a question' : ''}${sentiment !== 'neutral' && sentiment !== 'positive' ? ' and acknowledge their frustration' : ''}.`;
  else if (upcoming) nextStep = `Confirm the site visit on ${String(upcoming.scheduled_at).slice(0, 16)} UTC with ${name} and make sure ${upcoming.technician_name || 'the technician'} has access details.`;
  else if (t.status === 'awaiting_client' && minutesSince(t.last_activity_at) > 3 * 1440)
    nextStep = `Send ${name} a reminder; if there is no reply within 2 days, resolve the ticket.`;
  else if (t.status === 'awaiting_client') nextStep = `Wait for ${name}'s reply; follow up if nothing arrives within 3 days.`;
  else if (lastStaff && minutesSince(lastStaff.created_at) > 1440) nextStep = `Give ${name} a progress update; the last one was ${ago(minutesSince(lastStaff.created_at))} ago.`;
  else nextStep = 'Continue working on the fix and update the client when there is progress.';

  // Drafted reply: greeting, apology when needed, the situation's message (or the best saved reply), sign-off.
  const lines = [`Hello ${name},`, ''];
  if (clientWaiting && (waitedMin > 1440 || sentiment === 'angry' || sentiment === 'frustrated')) {
    lines.push(`I am sorry for the delay in getting back to you, and I understand how frustrating this has been.`, '');
  } else if (open) {
    lines.push(`Thank you for your ${clientMsgs.length > 1 ? 'update' : 'message'} about "${t.subject}".`, '');
  }
  const saved = open && bestSavedReply(t, recentClient, savedReplies);
  if (saved) {
    lines.push(fill(saved.body, t, agent).replace(/^(hello|hi|dear)\b[^\n]*\n+/i, '').trim(), '');
  } else if (!open) {
    lines.push(
      rating && rating.rating <= 2
        ? 'I saw your feedback on this ticket and I would like to understand what went wrong so we can put it right. Could we arrange a short call at a time that suits you?'
        : 'I am glad we could help. If anything else comes up, just reply to this email or raise a new ticket in the portal.',
      ''
    );
  } else if (security) {
    lines.push('We are treating this as a priority. As a precaution, please change any passwords you think may be affected and avoid opening suspicious links or attachments until we have checked things.', '', 'I will update you as soon as we have more information.', '');
  } else if (!t.first_response_at || !t.assigned_to) {
    lines.push(`We have received your request and ${agent ? 'I am' : 'our team is'} looking into it now. I will update you with our findings ${['urgent', 'high'].includes(t.priority) ? 'within the next few hours' : 'by tomorrow'}.`, '');
  } else if (upcoming) {
    lines.push(`This is to confirm that ${upcoming.technician_name || 'our technician'} will visit on ${String(upcoming.scheduled_at).slice(0, 16)} UTC. Please make sure someone is available to give access.`, '');
  } else if (asked) {
    lines.push('[Answer their question here.]', '', 'Please let me know if you have any other questions.', '');
  } else if (t.status === 'awaiting_client') {
    lines.push('I am following up on my earlier message. Could you send the information we asked for so we can continue? If the issue has been resolved, just let me know and I will close the ticket.', '');
  } else {
    lines.push('Here is an update on where things stand: [describe the progress and the next step].', '', 'I will keep you posted.', '');
  }
  lines.push('Kind regards,', agent ? agent.name : `${config.companyName} Support`, agent ? `${config.companyName} Support` : '');

  return {
    summary,
    next_step: nextStep,
    urgency,
    sentiment,
    risks: risks.slice(0, 4),
    draft_reply: lines.join('\n').trim(),
    used_saved_reply: saved ? saved.title : null,
  };
}

module.exports = { analyse };
