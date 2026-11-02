// Ticket assistant. Given a ticket and its conversation, returns a summary, the suggested next step, risk flags and
// a drafted reply. Uses the free built-in engine by default, a self-hosted Ollama model, or Claude when configured.
// AI results are stored per ticket and reused until the conversation changes, so each version is analysed once.
const Anthropic = require('@anthropic-ai/sdk').default;
const config = require('./config');
const db = require('./db');
const { now, STATUS_LABELS } = require('./util');

// The built-in assistant needs nothing, so the assistant is always available.
const enabled = () => true;
let client;
const getClient = () => (client ||= new Anthropic({ apiKey: config.ai.apiKey, timeout: 120000, maxRetries: 2 }));

// Kept identical on every request so it is served from the prompt cache.
const SYSTEM_PROMPT = `You are the support assistant for ${config.companyName}, an IT services company in Nigeria. You help the company's support admins handle client tickets.

You receive one ticket: its details, the conversation between the client and the support team (internal notes are marked and are never visible to the client), any site visits, and the client's rating if there is one.

Produce:
- summary: two or three sentences on what the client needs and where things stand now.
- next_step: the single most useful action an admin should take next, written as an instruction (for example "Call the client to confirm the router model, then schedule a site visit for tomorrow").
- urgency: low, normal, high or critical, judged from business impact, the client's tone and how long they have waited.
- sentiment: the client's current mood: positive, neutral, frustrated or angry.
- risks: up to four short flags an admin should not miss (for example a missed promise, a repeated problem, a security concern, a client threatening to escalate). Empty if there are none.
- draft_reply: a reply the admin can send to the client as is or after light editing. Professional, warm and concise, in plain text with no markdown. Address the client by first name, answer what they asked, say clearly what happens next and when, and do not promise anything the conversation does not support. Never reveal internal notes. Sign off as "${config.companyName} Support". If the ticket does not need a reply right now, write the most useful short update instead.

Base everything strictly on the ticket. If information is missing, say what to ask for rather than guessing.`;

const SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    next_step: { type: 'string' },
    urgency: { type: 'string', enum: ['low', 'normal', 'high', 'critical'] },
    sentiment: { type: 'string', enum: ['positive', 'neutral', 'frustrated', 'angry'] },
    risks: { type: 'array', items: { type: 'string' } },
    draft_reply: { type: 'string' },
  },
  required: ['summary', 'next_step', 'urgency', 'sentiment', 'risks', 'draft_reply'],
  additionalProperties: false,
};

const MAX_MESSAGES = 60;
const MAX_CHARS = 4000;

// Renders the ticket as plain text for the model.
function ticketText(t, messages, visits, rating) {
  const lines = [
    `Ticket #${t.id}: ${t.subject}`,
    `Company: ${t.company_name}`,
    `Requester: ${t.creator_name || 'unknown'}`,
    `Status: ${STATUS_LABELS[t.status] || t.status}, priority ${t.priority}, category ${t.category}${t.escalated ? `, escalated (level ${t.escalation_level})` : ''}`,
    `Assigned to: ${t.assignee_name || 'nobody yet'}`,
    `Opened: ${t.created_at} UTC; last activity ${t.last_activity_at} UTC; current time ${now()} UTC`,
    '',
    'Conversation (oldest first):',
  ];
  const recent = messages.slice(-MAX_MESSAGES);
  if (messages.length > recent.length) lines.push(`(${messages.length - recent.length} earlier messages not shown)`);
  for (const m of recent) {
    const who =
      m.kind === 'system'
        ? 'System'
        : m.sender_email
          ? `${m.sender_name || m.sender_email} (outside contact, by email)`
          : `${m.user_name || 'Unknown'} (${m.user_role === 'client' ? 'client' : 'support team'})`;
    const tag = m.is_internal ? ' [INTERNAL NOTE - not visible to client]' : '';
    const files = m.attachments && m.attachments.length ? ` [attachments: ${m.attachments.map((a) => a.original_name).join(', ')}]` : '';
    const body = String(m.body || '').slice(0, MAX_CHARS);
    lines.push(`--- ${m.created_at} UTC - ${who}${tag}${files}`, body);
  }
  if (visits.length) {
    lines.push('', 'Site visits:');
    for (const v of visits) lines.push(`- ${v.status}: ${v.scheduled_at} UTC with ${v.technician_name || 'unassigned'}${v.report ? `; report: ${String(v.report).slice(0, 1000)}` : ''}`);
  }
  if (rating) lines.push('', `Client rating: ${rating.rating}/5${rating.comment ? ` - "${rating.comment}"` : ''}`);
  return lines.join('\n');
}

class AiUnavailableError extends Error {}

// Which engine answers: Claude (paid, if ANTHROPIC_API_KEY is set), Ollama (free, self-hosted, if OLLAMA_URL is set),
// or the built-in assistant (free, always available). AI_PROVIDER forces one.
function provider() {
  const forced = String(config.ai.provider || '').toLowerCase();
  if (forced === 'builtin') return 'builtin';
  if (forced === 'claude' && config.ai.apiKey) return 'claude';
  if (forced === 'ollama' && config.ai.ollamaUrl) return 'ollama';
  if (config.ai.apiKey) return 'claude';
  if (config.ai.ollamaUrl) return 'ollama';
  return 'builtin';
}

async function gather(t) {
  const svc = require('./services/tickets');
  const { STAFF_ROLES } = require('./auth');
  const { OPEN_STATUSES } = require('./util');
  const [messages, visits, rating, staff] = await Promise.all([
    svc.getMessages(t.id, true),
    db.query('SELECT v.*, u.name AS technician_name FROM site_visits v LEFT JOIN users u ON u.id = v.technician_id WHERE v.ticket_id = ? ORDER BY v.scheduled_at', [t.id]),
    db.one('SELECT * FROM ticket_ratings WHERE ticket_id = ?', [t.id]),
    db.query(
      `SELECT u.id, u.name, (SELECT COUNT(*) FROM tickets x WHERE x.assigned_to = u.id AND x.status IN (${db.inList(OPEN_STATUSES)})) AS open
       FROM users u WHERE u.is_active = 1 AND u.role IN (${db.inList(STAFF_ROLES)}) ORDER BY open, u.name`,
      [...OPEN_STATUSES, ...STAFF_ROLES]
    ),
  ]);
  return { messages, visits, rating, staffLoad: staff.map((s) => ({ ...s, open: Number(s.open) })) };
}

async function builtinInsight(t, data, user, extra = {}) {
  const builtin = require('./assist-builtin');
  const savedReplies = user ? await db.query('SELECT title, body FROM saved_replies WHERE is_shared = 1 OR created_by = ?', [user.id]) : [];
  const out = builtin.analyse(t, data.messages, { ...data, savedReplies, agent: user });
  return { ...out, created_at: now(), model: 'built-in', provider: 'builtin', ...extra };
}

async function askClaude(t, data) {
  const response = await getClient().beta.messages.create({
    model: config.ai.model,
    max_tokens: 16000,
    // If the model declines (safety classifier), the API retries on a fallback model inside the same call.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: ticketText(t, data.messages, data.visits, data.rating) }],
  });
  if (response.stop_reason === 'refusal') throw new Error('Claude declined to analyse this ticket');
  if (response.stop_reason === 'max_tokens') throw new Error('Claude response was cut short');
  const text = response.content.find((b) => b.type === 'text');
  if (!text) throw new Error('Claude returned no answer');
  console.log(
    `[ai] ticket #${t.id} analysed (${response.model}; in ${response.usage.input_tokens}, cached ${response.usage.cache_read_input_tokens || 0}, out ${response.usage.output_tokens})`
  );
  return { insight: JSON.parse(text.text), model: response.model };
}

// Ollama runs open models (e.g. Llama, Qwen) on your own machine for free; its API takes the same JSON schema.
async function askOllama(t, data) {
  const res = await fetch(`${config.ai.ollamaUrl.replace(/\/+$/, '')}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(180000),
    body: JSON.stringify({
      model: config.ai.ollamaModel,
      stream: false,
      format: SCHEMA,
      options: { temperature: 0.2 },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: ticketText(t, data.messages, data.visits, data.rating) },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Ollama returned ${res.status}`);
  const body = await res.json();
  const insight = JSON.parse(body.message && body.message.content);
  for (const k of SCHEMA.required) if (insight[k] === undefined) throw new Error(`Ollama answer missing ${k}`);
  if (!Array.isArray(insight.risks)) insight.risks = [];
  console.log(`[ai] ticket #${t.id} analysed with Ollama (${config.ai.ollamaModel})`);
  return { insight, model: `ollama:${config.ai.ollamaModel}` };
}

// Returns { insight, cached }. `force` re-runs an AI analysis even when the conversation has not changed.
// The built-in assistant is instant and free, so it always runs fresh and is never stored.
async function analyseTicket(ticketId, { force = false, user = null } = {}) {
  const svc = require('./services/tickets');
  const t = await svc.getTicket(ticketId);
  if (!t) throw new Error('Ticket not found');
  const data = await gather(t);
  const engine = provider();
  if (engine === 'builtin') return { insight: { ...(await builtinInsight(t, data, user)), created_at: now() }, cached: false };

  const lastId = data.messages.length ? data.messages[data.messages.length - 1].id : 0;
  const stored = await db.one('SELECT * FROM ai_insights WHERE ticket_id = ?', [t.id]);
  if (stored && !force && Number(stored.last_message_id) === lastId) {
    return { insight: { ...JSON.parse(stored.data), created_at: stored.created_at, model: stored.model, provider: engine }, cached: true };
  }

  let result;
  try {
    result = engine === 'claude' ? await askClaude(t, data) : await askOllama(t, data);
  } catch (err) {
    // The paid or self-hosted engine failed: fall back to the built-in assistant so admins still get help.
    console.error(`[ai] ${engine} failed for ticket #${t.id}: ${err.message}; using the built-in assistant`);
    return { insight: await builtinInsight(t, data, user, { fallback: `${engine === 'claude' ? 'Claude' : 'Ollama'} was unavailable` }), cached: false };
  }
  const ts = now();
  await db.query('DELETE FROM ai_insights WHERE ticket_id = ?', [t.id]);
  await db.query('INSERT INTO ai_insights (ticket_id, last_message_id, data, model, created_at) VALUES (?, ?, ?, ?, ?)', [
    t.id,
    lastId,
    JSON.stringify(result.insight),
    result.model,
    ts,
  ]);
  return { insight: { ...result.insight, created_at: ts, model: result.model, provider: engine }, cached: false };
}

// What to show when the card opens: the built-in analysis (free, computed now) or the last stored AI analysis.
async function storedInsight(ticketId, user) {
  if (provider() === 'builtin') return (await analyseTicket(ticketId, { user })).insight;
  const row = await db.one('SELECT * FROM ai_insights WHERE ticket_id = ?', [ticketId]);
  if (!row) return null;
  const lastMsg = await db.one('SELECT MAX(id) AS id FROM messages WHERE ticket_id = ?', [ticketId]);
  return {
    ...JSON.parse(row.data),
    created_at: row.created_at,
    model: row.model,
    provider: provider(),
    stale: Number(row.last_message_id) !== Number(lastMsg.id || 0),
  };
}

module.exports = { enabled, provider, analyseTicket, storedInsight, AiUnavailableError, SYSTEM_PROMPT };
