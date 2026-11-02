import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import {
  CircleCheck,
  Clock,
  Gauge,
  Inbox,
  ListTodo,
  Star,
  Ticket as TicketIcon,
  Timer,
  TriangleAlert,
  UserX,
  type LucideIcon,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Greeting, PageHeader, UserAvatar } from '@/components/common';
import { Stars } from '@/components/rating';
import { PeriodPicker, periodKey, periodQuery, type Period } from '@/components/period-picker';
import { ActionCard, useActions } from '@/pages/actions';
import { Button } from '@/components/ui/button';
import { PriorityBadge, StatusBadge } from '@/components/ticket-badges';
import { useRealtime } from '@/hooks/use-realtime';
import { useSession } from '@/hooks/use-session';
import { api } from '@/lib/api';
import { PRIORITY_LABELS, ROLE_LABELS, duration, timeAgo } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Metrics } from '@/lib/types';


const trendConfig = {
  created: { label: 'Raised', color: 'var(--chart-1)' },
  resolved: { label: 'Resolved', color: 'var(--chart-2)' },
} satisfies ChartConfig;
const barConfig = { total: { label: 'Tickets', color: 'var(--chart-1)' } } satisfies ChartConfig;

const shortDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const fmtKey = (k: string) => shortDate.format(new Date(k + 'T00:00:00Z'));

export default function DashboardPage() {
  const { user, isAdmin, app } = useSession();
  const [period, setPeriod] = useState<Period>({ days: '30' });
  const metrics = useQuery({
    queryKey: ['metrics', periodKey(period)],
    queryFn: () => api.get<Metrics>(`/metrics?${periodQuery(period)}`),
    refetchInterval: 60_000,
  });
  const m = metrics.data;

  return (
    <>
      <PageHeader
        title={user ? <Greeting name={user.name} /> : 'Dashboard'}
        description="Here is how support is performing."
        actions={
          <PeriodPicker value={period} onChange={setPeriod} />
        }
      />

      {isAdmin && <NeedsAttention aiEnabled={!!app?.ai} />}

      {!m ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi icon={TicketIcon} label="Tickets raised" value={m.kpis.raised} hint={`${m.kpis.messages} messages exchanged`} />
            <Kpi icon={CircleCheck} label="Tickets resolved" value={m.kpis.resolved} hint={`Average resolution ${duration(m.kpis.avgResolutionMin)}`} />
            <Kpi icon={Inbox} label="Open now" value={m.kpis.open} hint={`${m.kpis.urgentOpen} urgent`} to="/tickets?view=open" />
            <Kpi icon={UserX} label="Unassigned" value={m.kpis.unassigned} hint="Waiting to be picked up" to="/tickets?view=unassigned" warn={m.kpis.unassigned > 0} />
            <Kpi icon={TriangleAlert} label="Escalated" value={m.kpis.escalatedOpen} hint={`${m.kpis.escalationsInPeriod} escalations in period`} to="/tickets?view=escalated" warn={m.kpis.escalatedOpen > 0} />
            <Kpi icon={Clock} label="Avg. first response" value={duration(m.kpis.avgFirstResponseMin)} hint={`Median ${duration(m.kpis.medianFirstResponseMin)}`} />
            <Kpi icon={Timer} label="Avg. resolution time" value={duration(m.kpis.avgResolutionMin)} hint="From creation to resolved" />
            <SlaCard met={m.kpis.slaMet} missed={m.kpis.slaMissed} />
          </div>

          <SatisfactionCard metrics={m} />

          <div className="grid gap-4 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHeader>
                <CardTitle>Raised vs resolved</CardTitle>
                <CardDescription>{m.weekly ? 'Weekly totals' : 'Daily totals'} for the selected period</CardDescription>
              </CardHeader>
              <CardContent>
                <ChartContainer config={trendConfig} className="aspect-auto h-72 w-full">
                  <AreaChart data={m.series} margin={{ left: -20, right: 8 }}>
                    <defs>
                      {(['created', 'resolved'] as const).map((k) => (
                        <linearGradient key={k} id={`fill-${k}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={`var(--color-${k})`} stopOpacity={0.3} />
                          <stop offset="95%" stopColor={`var(--color-${k})`} stopOpacity={0.02} />
                        </linearGradient>
                      ))}
                    </defs>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="key" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} tickFormatter={fmtKey} />
                    <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={48} />
                    <ChartTooltip content={<ChartTooltipContent indicator="line" labelFormatter={(v) => (m.weekly ? `Week of ${fmtKey(String(v))}` : fmtKey(String(v)))} />} />
                    <Area dataKey="created" type="monotone" stroke="var(--color-created)" fill="url(#fill-created)" strokeWidth={2} />
                    <Area dataKey="resolved" type="monotone" stroke="var(--color-resolved)" fill="url(#fill-resolved)" strokeWidth={2} />
                    <ChartLegend content={<ChartLegendContent />} />
                  </AreaChart>
                </ChartContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>By priority</CardTitle>
                <CardDescription>Tickets raised in period</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {m.byPriority.map((p) => {
                  const pct = m.kpis.raised ? Math.round((p.total / m.kpis.raised) * 100) : 0;
                  return (
                    <div key={p.name} className="space-y-1.5">
                      <div className="flex items-center justify-between text-sm">
                        <PriorityBadge priority={p.name} />
                        <span className="text-muted-foreground tabular-nums">
                          {p.total} <span className="text-xs">({pct}%)</span>
                        </span>
                      </div>
                      <Progress value={pct} aria-label={`${PRIORITY_LABELS[p.name]} ${pct}%`} />
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <HorizontalBars title="By category" description="Tickets raised in period" data={m.byCategory} />
            <HorizontalBars title="Top companies" description="Most tickets raised in period" data={m.byCompany} />
          </div>

          <div className="grid gap-4 xl:grid-cols-5">
            <TeamCard metrics={m} />
            <RecentCard metrics={m} />
          </div>
        </>
      )}
    </>
  );
}

// Top of the dashboard for admins: the most pressing suggested actions.
function NeedsAttention({ aiEnabled }: { aiEnabled: boolean }) {
  const actions = useActions();
  const items = actions.data?.items ?? [];
  if (!actions.data || items.length === 0) return null;
  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ListTodo className="size-4 text-primary" />
          Needs attention
        </CardTitle>
        <CardDescription>
          {actions.data.counts.urgent ? `${actions.data.counts.urgent} urgent, ` : ''}
          {items.length} in total
        </CardDescription>
        <CardAction>
          <Button variant="outline" size="sm" asChild>
            <Link to="/actions">View all</Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-3">
        {items.slice(0, 3).map((i) => (
          <ActionCard key={i.key} item={i} aiEnabled={aiEnabled} compact />
        ))}
      </CardContent>
    </Card>
  );
}

function Kpi({ icon: Icon, label, value, hint, to, warn }: { icon: LucideIcon; label: string; value: string | number; hint?: string; to?: string; warn?: boolean }) {
  const content = (
    <Card className={cn('h-full gap-2', to && 'transition-colors hover:bg-muted/40')}>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardAction>
          <Icon className={cn('size-4 text-muted-foreground', warn && 'text-orange-600 dark:text-orange-400')} />
        </CardAction>
        <CardTitle className="text-2xl font-semibold tabular-nums">{value}</CardTitle>
      </CardHeader>
      {hint && <CardContent className="text-xs text-muted-foreground">{hint}</CardContent>}
    </Card>
  );
  return to ? <Link to={to}>{content}</Link> : content;
}

function SlaCard({ met, missed }: { met: number; missed: number }) {
  const total = met + missed;
  const rate = total ? Math.round((met / total) * 100) : null;
  return (
    <Card className="gap-2">
      <CardHeader>
        <CardDescription>SLA compliance</CardDescription>
        <CardAction>
          <Gauge className="size-4 text-muted-foreground" />
        </CardAction>
        <CardTitle className="text-2xl font-semibold tabular-nums">{rate === null ? '-' : `${rate}%`}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <Progress value={rate ?? 0} />
        <p className="text-xs text-muted-foreground">
          {met} met · {missed} missed first-response target
        </p>
      </CardContent>
    </Card>
  );
}

// Customer satisfaction: share of 4-5 star ratings, average, distribution and latest feedback.
function SatisfactionCard({ metrics: m }: { metrics: Metrics }) {
  const total = m.kpis.ratings;
  const max = Math.max(1, ...m.ratingBreakdown.map((r) => r.total));
  return (
    <Card>
      <CardHeader>
        <CardTitle>Customer satisfaction</CardTitle>
        <CardDescription>Ratings clients gave on resolved tickets in this period</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        {total === 0 ? (
          <p className="text-sm text-muted-foreground lg:col-span-2">No ratings yet. Clients are asked to rate support when a ticket is resolved.</p>
        ) : (
          <>
            <div className="space-y-4">
              <div className="flex items-end gap-6">
                <div>
                  <div className="text-3xl font-semibold tabular-nums">{m.kpis.csatPct}%</div>
                  <div className="text-xs text-muted-foreground">satisfied (4 or 5 stars)</div>
                </div>
                <div>
                  <div className="flex items-center gap-2 text-3xl font-semibold tabular-nums">
                    {m.kpis.avgRating?.toFixed(1)}
                    <Stars value={m.kpis.avgRating ?? 0} />
                  </div>
                  <div className="text-xs text-muted-foreground">average from {total} rating{total === 1 ? '' : 's'}</div>
                </div>
              </div>
              <div className="space-y-1.5">
                {[...m.ratingBreakdown].reverse().map((r) => (
                  <div key={r.rating} className="flex items-center gap-2 text-xs">
                    <span className="w-3 text-right tabular-nums">{r.rating}</span>
                    <Star className="size-3 fill-amber-400 text-amber-400" />
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-amber-400" style={{ width: `${(r.total / max) * 100}%` }} />
                    </div>
                    <span className="w-6 text-right text-muted-foreground tabular-nums">{r.total}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <div className="text-sm font-medium">Latest feedback</div>
              {m.recentRatings.map((r) => (
                <Link key={r.ticket_id} to={`/tickets/${r.ticket_id}`} className="block rounded-md border px-3 py-2 transition-colors hover:bg-muted/50">
                  <div className="flex items-center justify-between gap-2">
                    <Stars value={r.rating} size="size-3.5" />
                    <span className="text-xs text-muted-foreground">{timeAgo(r.updated_at)}</span>
                  </div>
                  {r.comment && <p className="mt-1 line-clamp-2 text-sm">"{r.comment}"</p>}
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {r.user_name ?? 'Client'}, {r.company_name} · #{r.ticket_id} {r.subject}
                  </p>
                </Link>
              ))}
            </div>
          </>
        )}
      </CardContent>
      {!!m.adminRatings?.length && (
        <CardContent className="space-y-2 border-t pt-4">
          <div className="text-sm font-medium">Ratings for our admins</div>
          <p className="text-xs text-muted-foreground">How clients rated each admin's handling of their jobs in this period.</p>
          <ul className="divide-y rounded-md border">
            {m.adminRatings.map((a) => (
              <li key={a.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate font-medium">{a.name}</span>
                <Stars value={a.avgRating} size="size-3.5" />
                <span className="w-8 text-right tabular-nums">{a.avgRating.toFixed(1)}</span>
                <span className="w-24 text-right text-xs text-muted-foreground">
                  {a.ratings} rating{a.ratings === 1 ? '' : 's'}
                  {a.low > 0 && <span className="text-destructive">, {a.low} low</span>}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      )}
    </Card>
  );
}

function HorizontalBars({ title, description, data }: { title: string; description: string; data: { name: string; total: number }[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">No tickets in this period</p>
        ) : (
          <ChartContainer config={barConfig} className="aspect-auto w-full" style={{ height: Math.max(160, data.length * 40) }}>
            <BarChart data={data} layout="vertical" margin={{ left: 0, right: 16 }}>
              <CartesianGrid horizontal={false} />
              <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} />
              <YAxis type="category" dataKey="name" tickLine={false} axisLine={false} width={130} tickFormatter={(v: string) => (v.length > 18 ? v.slice(0, 17) + '...' : v)} />
              <ChartTooltip cursor={false} content={<ChartTooltipContent hideIndicator />} />
              <Bar dataKey="total" fill="var(--color-total)" radius={4} barSize={20} />
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}

function TeamCard({ metrics: m }: { metrics: Metrics }) {
  const { presence } = useRealtime();
  const online = new Set((presence ?? m.online).users.map((u) => u.id));
  return (
    <Card className="xl:col-span-3">
      <CardHeader>
        <CardTitle>Team workload</CardTitle>
        <CardDescription>Open tickets per team member and tickets resolved in period</CardDescription>
      </CardHeader>
      <CardContent className="px-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-6">Member</TableHead>
              <TableHead className="text-right">Open</TableHead>
              <TableHead className="text-right">Escalated</TableHead>
              <TableHead className="text-right">Resolved</TableHead>
              <TableHead className="pr-6 text-right">Rating</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {m.agents.map((a) => (
              <TableRow key={a.id}>
                <TableCell className="pl-6">
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <UserAvatar name={a.name} userId={a.id} />
                      <span className={cn('absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-card', online.has(a.id) ? 'bg-emerald-500' : 'bg-zinc-300 dark:bg-zinc-600')} />
                    </div>
                    <div className="min-w-0">
                      <div className="truncate font-medium">{a.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {ROLE_LABELS[a.role]} · {online.has(a.id) ? 'Online' : a.last_seen_at ? `Seen ${timeAgo(a.last_seen_at)}` : 'Offline'}
                      </div>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-right tabular-nums">{a.open}</TableCell>
                <TableCell className="text-right tabular-nums">{a.escalated ? <Badge variant="destructive">{a.escalated}</Badge> : 0}</TableCell>
                <TableCell className="text-right tabular-nums">{a.resolved}</TableCell>
                <TableCell className="pr-6 text-right tabular-nums">{a.avgRating ? a.avgRating.toFixed(1) : '-'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function RecentCard({ metrics: m }: { metrics: Metrics }) {
  const navigate = useNavigate();
  return (
    <Card className="xl:col-span-2">
      <CardHeader>
        <CardTitle>Recent activity</CardTitle>
        <CardDescription>Most recently updated tickets</CardDescription>
      </CardHeader>
      <CardContent className="space-y-1 px-3">
        {m.recent.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No tickets yet</p>}
        {m.recent.map((t) => (
          <button key={t.id} onClick={() => navigate(`/tickets/${t.id}`)} className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left hover:bg-muted/50">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">
                <span className="font-mono text-xs text-muted-foreground">#{t.id}</span> {t.subject}
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {t.company_name} · {timeAgo(t.last_activity_at)}
              </div>
            </div>
            <StatusBadge status={t.status} />
          </button>
        ))}
      </CardContent>
    </Card>
  );
}
