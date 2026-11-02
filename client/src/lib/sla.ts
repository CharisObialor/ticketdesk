import { useEffect, useState } from 'react';
import { parseTs } from './format';
import type { AppMeta, FaultCategory, Priority, SlaTargets, Ticket } from './types';

export type SlaState =
  | { kind: 'met'; minutes: number }
  | { kind: 'due'; minutesLeft: number; fraction: number }
  | { kind: 'overdue'; minutesOver: number }
  // Not assigned yet: the clock starts on assignment.
  | { kind: 'pending' }
  | { kind: 'none' };

export interface CompanyTargets extends SlaTargets {
  categories: FaultCategory[];
}

// The targets one company is held to: its own where set, the defaults otherwise.
export function targetsFor(sla: AppMeta['sla'] | undefined, companyId: number | null | undefined): CompanyTargets | null {
  if (!sla) return null;
  const own = (companyId != null && sla.companies[String(companyId)]) || {};
  return {
    response: { ...sla.defaults.response, ...own.response },
    resolution: { ...sla.defaults.resolution, ...own.resolution },
    categories: own.categories ?? [],
  };
}

export const faultCategory = (targets: CompanyTargets | null, name: string) =>
  targets?.categories.find((c) => c.name.toLowerCase() === name.toLowerCase()) ?? null;

// Minutes allowed to resolve: the fault category's own time when it has one, the priority's otherwise.
export function resolutionLimit(t: Pick<Ticket, 'company_id' | 'priority' | 'category'>, sla: AppMeta['sla'] | undefined) {
  const targets = targetsFor(sla, t.company_id);
  if (!targets) return null;
  return faultCategory(targets, t.category)?.resolution || targets.resolution[t.priority as Priority] || null;
}

function countdown(start: number, limit: number, nowMs: number): SlaState {
  const due = start + limit * 60000;
  if (nowMs > due) return { kind: 'overdue', minutesOver: (nowMs - due) / 60000 };
  return { kind: 'due', minutesLeft: (due - nowMs) / 60000, fraction: (due - nowMs) / (limit * 60000) };
}

// The SLA clocks run from when the ticket was first assigned.
const clockStart = (t: Pick<Ticket, 'assigned_at'>) => (t.assigned_at ? (parseTs(t.assigned_at)?.getTime() ?? null) : null);

// When the time to resolve runs out, or null while the ticket is unassigned.
export function resolutionDue(t: Pick<Ticket, 'company_id' | 'priority' | 'category' | 'assigned_at'>, sla: AppMeta['sla'] | undefined) {
  const from = clockStart(t);
  const limit = resolutionLimit(t, sla);
  return from && limit ? new Date(from + limit * 60000) : null;
}

// First-response SLA: the time allowed for the first staff reply, by priority.
export function slaState(t: Ticket, sla: AppMeta['sla'] | undefined, nowMs = Date.now()): SlaState {
  const limit = targetsFor(sla, t.company_id)?.response[t.priority];
  if (!limit) return { kind: 'none' };
  const from = clockStart(t);
  if (t.first_response_at && from) {
    const responded = parseTs(t.first_response_at)!.getTime();
    return { kind: 'met', minutes: Math.max(0, (responded - from) / 60000) };
  }
  if (t.status === 'resolved' || t.status === 'closed') return { kind: 'none' };
  if (!from) return t.first_response_at ? { kind: 'none' } : { kind: 'pending' };
  return countdown(from, limit, nowMs);
}

// Resolution SLA (time to resolve): met when resolved within the limit, otherwise counting down or overdue.
export function resolutionState(t: Ticket, sla: AppMeta['sla'] | undefined, nowMs = Date.now()): SlaState & { limit?: number } {
  const limit = resolutionLimit(t, sla);
  if (!limit) return { kind: 'none' };
  const from = clockStart(t);
  if (!from) return t.resolved_at || t.status === 'closed' ? { kind: 'none' } : { kind: 'pending', limit };
  if (t.resolved_at) {
    const minutes = Math.max(0, (parseTs(t.resolved_at)!.getTime() - from) / 60000);
    return minutes <= limit ? { kind: 'met', minutes, limit } : { kind: 'overdue', minutesOver: minutes - limit, limit };
  }
  if (t.status === 'closed') return { kind: 'none' };
  return { ...countdown(from, limit, nowMs), limit };
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

// Categories to offer for a company's ticket: its fault categories (plus Other) or the standard list.
export function categoryOptions(app: AppMeta | null | undefined, companyId: number | null | undefined) {
  const own = targetsFor(app?.sla, companyId)?.categories.map((c) => c.name) ?? [];
  if (!own.length) return app?.categories ?? ['General'];
  return own.some((n) => n.toLowerCase() === 'other') ? own : [...own, 'Other'];
}
