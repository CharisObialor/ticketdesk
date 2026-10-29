import { useEffect, useState } from 'react';
import { parseTs } from './format';
import type { Priority, Ticket } from './types';

export type SlaState =
  | { kind: 'met'; minutes: number }
  | { kind: 'due'; minutesLeft: number; fraction: number }
  | { kind: 'overdue'; minutesOver: number }
  | { kind: 'none' };

// First-response SLA: the time allowed for the first staff reply, by priority.
export function slaState(t: Ticket, slaMinutes: Record<Priority, number> | undefined, nowMs = Date.now()): SlaState {
  const limit = slaMinutes?.[t.priority];
  const created = parseTs(t.created_at)?.getTime();
  if (!limit || !created) return { kind: 'none' };
  if (t.first_response_at) {
    const responded = parseTs(t.first_response_at)!.getTime();
    return { kind: 'met', minutes: (responded - created) / 60000 };
  }
  if (t.status === 'resolved' || t.status === 'closed') return { kind: 'none' };
  const due = created + limit * 60000;
  if (nowMs > due) return { kind: 'overdue', minutesOver: (nowMs - due) / 60000 };
  return { kind: 'due', minutesLeft: (due - nowMs) / 60000, fraction: (due - nowMs) / (limit * 60000) };
}

// Re-renders every 30 seconds so countdowns stay current.
export function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
