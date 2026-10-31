import { ArrowDown, ArrowRight, ArrowUp, ChevronsUp, CircleCheck, Timer, TriangleAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useSession } from '@/hooks/use-session';
import { cn } from '@/lib/utils';
import { PRIORITY_LABELS, STATUS_LABELS, duration } from '@/lib/format';
import { resolutionState, slaState, useNow } from '@/lib/sla';
import type { Priority, Status, Ticket } from '@/lib/types';

const STATUS_DOT: Record<Status, string> = {
  open: 'bg-blue-500',
  in_progress: 'bg-amber-500',
  awaiting_client: 'bg-violet-500',
  resolved: 'bg-emerald-500',
  closed: 'bg-zinc-400',
};

export function StatusBadge({ status, className }: { status: Status; className?: string }) {
  return (
    <Badge variant="outline" className={cn('gap-1.5 font-normal', className)}>
      <span className={cn('size-1.5 rounded-full', STATUS_DOT[status])} aria-hidden />
      {STATUS_LABELS[status] ?? status}
    </Badge>
  );
}

const PRIORITY_STYLE: Record<Priority, { icon: typeof ArrowUp; className: string }> = {
  low: { icon: ArrowDown, className: 'text-muted-foreground' },
  normal: { icon: ArrowRight, className: 'text-foreground' },
  high: { icon: ArrowUp, className: 'text-orange-600 dark:text-orange-400' },
  urgent: { icon: ChevronsUp, className: 'text-red-600 dark:text-red-400' },
};

export function PriorityBadge({ priority, className }: { priority: Priority; className?: string }) {
  const { icon: Icon, className: tone } = PRIORITY_STYLE[priority] ?? PRIORITY_STYLE.normal;
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs font-medium', tone, className)}>
      <Icon className="size-3.5" aria-hidden />
      {PRIORITY_LABELS[priority] ?? priority}
    </span>
  );
}

// First-response SLA countdown: time left, overdue, or met.
export function SlaBadge({ ticket, className, long = false }: { ticket: Ticket; className?: string; long?: boolean }) {
  const { app } = useSession();
  const nowMs = useNow();
  const s = slaState(ticket, app?.sla, nowMs);
  if (s.kind === 'none') return <span className={cn('text-xs text-muted-foreground', className)}>-</span>;
  if (s.kind === 'pending') return <span className={cn('text-xs text-muted-foreground', className)}>{long ? 'Starts when assigned' : 'Not started'}</span>;
  if (s.kind === 'met') {
    return (
      <span className={cn('inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400', className)} title={`First response in ${duration(s.minutes)}`}>
        <CircleCheck className="size-3.5" />
        {long ? `Responded in ${duration(s.minutes)}` : 'Met'}
      </span>
    );
  }
  if (s.kind === 'overdue') {
    return (
      <span className={cn('inline-flex items-center gap-1 text-xs font-medium text-red-600 dark:text-red-400', className)}>
        <Timer className="size-3.5" />
        {long ? `Response overdue by ${duration(s.minutesOver)}` : `${duration(s.minutesOver)} over`}
      </span>
    );
  }
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs', s.fraction < 0.25 ? 'font-medium text-orange-600 dark:text-orange-400' : 'text-muted-foreground', className)}>
      <Timer className="size-3.5" />
      {long ? `Respond within ${duration(s.minutesLeft)}` : `${duration(s.minutesLeft)} left`}
    </span>
  );
}

// Resolution SLA (time to resolve) from the company's targets or the ticket's fault category.
export function ResolutionBadge({ ticket, className, long = false }: { ticket: Ticket; className?: string; long?: boolean }) {
  const { app } = useSession();
  const nowMs = useNow();
  const s = resolutionState(ticket, app?.sla, nowMs);
  const target = s.limit ? `Target: resolve within ${duration(s.limit)}` : undefined;
  if (s.kind === 'none') return <span className={cn('text-xs text-muted-foreground', className)}>-</span>;
  if (s.kind === 'pending') return <span className={cn('text-xs text-muted-foreground', className)} title={target}>{long ? 'Starts when assigned' : 'Not started'}</span>;
  if (s.kind === 'met') {
    return (
      <span className={cn('inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400', className)} title={target}>
        <CircleCheck className="size-3.5" />
        {long ? `Resolved in ${duration(s.minutes)}, within target` : 'Met'}
      </span>
    );
  }
  if (s.kind === 'overdue') {
    const done = !!ticket.resolved_at;
    return (
      <span className={cn('inline-flex items-center gap-1 text-xs font-medium text-red-600 dark:text-red-400', className)} title={target}>
        <Timer className="size-3.5" />
        {long ? (done ? `Resolved ${duration(s.minutesOver)} past target` : `Resolution overdue by ${duration(s.minutesOver)}`) : `${duration(s.minutesOver)} over`}
      </span>
    );
  }
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs', s.fraction < 0.2 ? 'font-medium text-orange-600 dark:text-orange-400' : 'text-muted-foreground', className)} title={target}>
      <Timer className="size-3.5" />
      {long ? `Resolve within ${duration(s.minutesLeft)}` : `${duration(s.minutesLeft)} left`}
    </span>
  );
}

export function EscalatedBadge({ level }: { level?: number }) {
  return (
    <Badge variant="destructive" className="gap-1">
      <TriangleAlert aria-hidden />
      Escalated{level ? ` L${level}` : ''}
    </Badge>
  );
}
