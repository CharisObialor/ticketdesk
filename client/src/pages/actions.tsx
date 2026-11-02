import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlarmClock,
  CalendarClock,
  CircleCheck,
  Clock,
  Eye,
  Mail,
  RotateCcw,
  Server,
  Sparkles,
  Ticket as TicketIcon,
  UserCheck,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmptyState, PageHeader } from '@/components/common';
import { AiInsightPanel } from '@/components/ai-assistant';
import { useSession } from '@/hooks/use-session';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime, timeAgo } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useActions } from '@/hooks/use-actions';

export interface ActionItem {
  key: string;
  type: string;
  category: 'tickets' | 'visits' | 'team' | 'system';
  severity: 'urgent' | 'high' | 'normal';
  title: string;
  detail: string;
  suggestion: string;
  since: string;
  link: string;
  ticketId?: number;
  quick?: { kind: 'assign' | 'invite'; userId: number; userName: string } | null;
  state?: 'snoozed' | 'dismissed';
  snoozeUntil?: string;
  reason?: string | null;
}

export interface ActionsData {
  items: ActionItem[];
  hidden: ActionItem[];
  counts: { urgent: number; high: number; normal: number; total: number };
}

export { useActions };

const SEVERITY: Record<ActionItem['severity'], { label: string; className: string; bar: string }> = {
  urgent: { label: 'Urgent', className: 'bg-red-600 text-white', bar: 'bg-red-600' },
  high: { label: 'High', className: 'bg-orange-500 text-white', bar: 'bg-orange-500' },
  normal: { label: 'Normal', className: 'bg-secondary text-secondary-foreground', bar: 'bg-muted-foreground/40' },
};

const ICONS: Record<string, LucideIcon> = {
  sla: AlarmClock,
  unassigned: UserCheck,
  escalated: AlarmClock,
  waiting: Clock,
  stale: Clock,
  visit: CalendarClock,
  rating: TicketIcon,
  invite: Mail,
  load: Users,
  system: Server,
};

type Filter = 'all' | 'urgent' | ActionItem['category'] | 'hidden';

export default function ActionsPage() {
  const { app } = useSession();
  const query = useActions();
  const [filter, setFilter] = useState<Filter>('all');
  const data = query.data;
  const list = !data
    ? []
    : filter === 'hidden'
      ? data.hidden
      : data.items.filter((i) => filter === 'all' || (filter === 'urgent' ? i.severity === 'urgent' : i.category === filter));
  const n = (f: Filter) =>
    !data ? 0 : f === 'hidden' ? data.hidden.length : data.items.filter((i) => f === 'all' || (f === 'urgent' ? i.severity === 'urgent' : i.category === f)).length;

  return (
    <>
      <PageHeader
        title="Actions"
        description="Things across the portal that need an admin, worked out from live tickets, visits, the team and system health. Items clear themselves once the work is done."
      />
      {data && (
        <div className="grid gap-3 sm:grid-cols-3">
          {(['urgent', 'high', 'normal'] as const).map((s) => (
            <Card key={s} className="gap-1 py-4">
              <CardContent className="flex items-center justify-between px-5">
                <div>
                  <div className="text-sm text-muted-foreground">{SEVERITY[s].label}</div>
                  <div className="text-2xl font-semibold tabular-nums">{data.counts[s]}</div>
                </div>
                <span className={cn('size-3 rounded-full', SEVERITY[s].bar)} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
        <TabsList className="h-auto flex-wrap">
          {(
            [
              ['all', 'All'],
              ['urgent', 'Urgent'],
              ['tickets', 'Tickets'],
              ['visits', 'Site visits'],
              ['team', 'Team'],
              ['system', 'System'],
              ['hidden', 'Snoozed and dismissed'],
            ] as [Filter, string][]
          ).map(([f, label]) => (
            <TabsTrigger key={f} value={f}>
              {label}
              {n(f) > 0 && <span className="ml-1 text-xs text-muted-foreground tabular-nums">{n(f)}</span>}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {query.isPending ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <Card>
          <EmptyState
            icon={CircleCheck}
            title={filter === 'hidden' ? 'Nothing snoozed or dismissed' : 'All caught up'}
            description={filter === 'hidden' ? undefined : 'No actions need your attention right now. New ones appear here automatically.'}
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {list.map((i) => (
            <ActionCard key={i.key} item={i} aiEnabled={!!app?.ai} />
          ))}
        </div>
      )}
    </>
  );
}

export function ActionCard({ item: i, aiEnabled, compact = false }: { item: ActionItem; aiEnabled: boolean; compact?: boolean }) {
  const qc = useQueryClient();
  const [showAi, setShowAi] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const Icon = ICONS[i.type] ?? TicketIcon;
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['actions'] });
    qc.invalidateQueries({ queryKey: ['tickets'] });
    qc.invalidateQueries({ queryKey: ['counts'] });
  };
  const call = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: refresh,
    onError: (err) => toast.error(errorMessage(err)),
  });
  const snooze = (until: string, label: string) =>
    call.mutate(() => api.post('/actions/snooze', { key: i.key, until }).then(() => toast.success(`Snoozed until ${label}`)));
  const quick = () => {
    if (!i.quick) return;
    if (i.quick.kind === 'assign' && i.ticketId) {
      call.mutate(() => api.patch(`/tickets/${i.ticketId}`, { assigned_to: i.quick!.userId }).then(() => toast.success(`Assigned to ${i.quick!.userName}`)));
    } else if (i.quick.kind === 'invite') {
      call.mutate(() => api.post(`/users/${i.quick!.userId}/invite`).then(() => toast.success(`Invitation resent to ${i.quick!.userName}`)));
    }
  };

  return (
    <Card className={cn('relative gap-0 overflow-hidden py-0', i.state && 'opacity-80')}>
      <CardContent className="flex gap-3 px-4 py-4">
        <div className="hidden size-9 shrink-0 items-center justify-center rounded-full bg-muted sm:flex">
          <Icon className="size-4 text-muted-foreground" />
        </div>
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={cn('border-0', SEVERITY[i.severity].className)}>{SEVERITY[i.severity].label}</Badge>
            <span className="text-xs text-muted-foreground" title={formatDateTime(i.since)}>
              since {timeAgo(i.since)}
            </span>
            {i.state === 'snoozed' && i.snoozeUntil && <Badge variant="outline">Snoozed until {formatDateTime(i.snoozeUntil)}</Badge>}
            {i.state === 'dismissed' && <Badge variant="outline">Dismissed{i.reason ? `: ${i.reason}` : ''}</Badge>}
          </div>
          <Link to={i.link} className="block font-medium break-words hover:underline">
            {i.title}
          </Link>
          {!compact && <p className="text-sm text-muted-foreground">{i.detail}</p>}
          <p className="flex items-start gap-1.5 text-sm">
            <Sparkles className="mt-0.5 size-3.5 shrink-0 text-primary" />
            <span>{i.suggestion}</span>
          </p>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {i.state ? (
              <Button size="sm" variant="outline" onClick={() => call.mutate(() => api.post('/actions/restore', { key: i.key }))}>
                <RotateCcw />
                Restore
              </Button>
            ) : (
              <>
                {i.quick && (
                  <Button size="sm" onClick={quick} disabled={call.isPending}>
                    {i.quick.kind === 'assign' ? <UserCheck /> : <Mail />}
                    {i.quick.kind === 'assign' ? `Assign to ${i.quick.userName}` : 'Resend invitation'}
                  </Button>
                )}
                <Button size="sm" variant={i.quick ? 'outline' : 'default'} asChild>
                  <Link to={i.link}>
                    <Eye />
                    Open
                  </Link>
                </Button>
                {aiEnabled && i.ticketId && !compact && (
                  <Button size="sm" variant="outline" onClick={() => setShowAi((v) => !v)}>
                    <Sparkles />
                    {showAi ? 'Hide AI' : 'AI suggestion'}
                  </Button>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="ghost">
                      <AlarmClock />
                      Snooze
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuLabel>Remind me</DropdownMenuLabel>
                    <DropdownMenuItem onClick={() => snooze('1h', 'in 1 hour')}>In 1 hour</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => snooze('4h', 'in 4 hours')}>In 4 hours</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => snooze('tomorrow', 'tomorrow 08:00')}>Tomorrow morning</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => snooze('week', 'next week')}>Next week</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setDismissing(true)}>
                  <X />
                  Dismiss
                </Button>
              </>
            )}
          </div>
          {showAi && i.ticketId && (
            <div className="pt-2">
              <AiInsightPanel ticketId={i.ticketId} autoRun />
            </div>
          )}
        </div>
      </CardContent>
      {dismissing && (
        <DismissDialog
          onClose={() => setDismissing(false)}
          onConfirm={(reason) => call.mutate(() => api.post('/actions/dismiss', { key: i.key, reason }).then(() => toast.success('Dismissed')))}
        />
      )}
    </Card>
  );
}

function DismissDialog({ onClose, onConfirm }: { onClose: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState('');
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onConfirm(reason);
            onClose();
          }}
          className="grid gap-4"
        >
          <DialogHeader>
            <DialogTitle>Dismiss this action?</DialogTitle>
            <DialogDescription>It is hidden for you only. You can restore it from "Snoozed and dismissed".</DialogDescription>
          </DialogHeader>
          <Input placeholder="Reason (optional), e.g. handled by phone" maxLength={255} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit">Dismiss</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
