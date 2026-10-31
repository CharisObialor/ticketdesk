import { useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import {
  AlarmClock,
  Building2,
  CalendarClock,
  CircleCheck,
  Clock,
  FileSpreadsheet,
  Inbox,
  Printer,
  Smile,
  Ticket as TicketIcon,
  TimerReset,
  type LucideIcon,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CompanyLogo, EmptyState, PageHeader } from '@/components/common';
import { PeriodPicker, periodKey, periodLabel, periodQuery, type Period } from '@/components/period-picker';
import { PriorityBadge, StatusBadge } from '@/components/ticket-badges';
import { Stars } from '@/components/rating';
import { api, errorMessage } from '@/lib/api';
import { BRAND } from '@/lib/brand';
import { PRIORITY_LABELS, STATUS_LABELS, duration, formatDate, formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Company, Priority, Status } from '@/lib/types';

interface ReportTicket {
  id: number;
  subject: string;
  category: string;
  priority: Priority;
  status: Status;
  escalated: number;
  created_at: string;
  first_response_at: string | null;
  resolved_at: string | null;
  requester: string | null;
  requester_email: string | null;
  requester_title: string | null;
  assignee: string | null;
  firstResponseMin: number | null;
  resolutionMin: number | null;
}
interface Report {
  generatedAt: string;
  period: { from: string; to: string; days: number; custom: boolean; weekly: boolean };
  company: { id: number; name: string; rc_number: string | null; email_domain: string | null; is_active: boolean; logo_url: string | null; since: string };
  kpis: {
    raised: number;
    resolved: number;
    openNow: number;
    escalated: number;
    urgent: number;
    avgFirstResponseMin: number | null;
    medianFirstResponseMin: number | null;
    avgResolutionMin: number | null;
    medianResolutionMin: number | null;
    slaMet: number;
    slaMissed: number;
    slaPct: number | null;
    resolutionMet: number;
    resolutionMissed: number;
    resolutionPct: number | null;
    ratings: number;
    avgRating: number | null;
    csatPct: number | null;
    messages: number;
    clientMessages: number;
    chatGroups: number;
    chatMessages: number;
    visits: number;
    visitsCompleted: number;
    activeUsers: number;
    requesters: number;
  };
  series: { key: string; created: number; resolved: number }[];
  byStatus: { name: Status; total: number }[];
  byPriority: { name: Priority; total: number }[];
  byCategory: { name: string; total: number }[];
  byRequester: { name: string; total: number }[];
  handledBy: { name: string; tickets: number; resolved: number; ratings: number; avgRating: number | null }[];
  // How this company's people rated each of our admins.
  adminRatings?: { name: string; ratings: number; avgRating: number }[];
  ratingBreakdown: { rating: number; total: number }[];
  ratings: { ticket_id: number; rating: number; comment: string | null; updated_at: string; user_name: string | null; subject: string }[];
  openNow: { id: number; subject: string; priority: Priority; status: Status; escalated: number; created_at: string; assignee: string | null; ageDays: number }[];
  visits: { id: number; ticket_id: number; scheduled_at: string; location: string | null; status: string; technician: string | null; subject: string; signed_by: string | null }[];
  people: { id: number; name: string; email: string; job_title: string | null; phone: string | null; is_active: number; last_login_at: string | null }[];
  tickets: ReportTicket[];
}

const trendConfig = {
  created: { label: 'Raised', color: 'var(--chart-1)' },
  resolved: { label: 'Resolved', color: 'var(--chart-2)' },
} satisfies ChartConfig;

const shortDate = (key: string) => new Date(`${key}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const pct = (n: number | null) => (n === null ? '-' : `${n}%`);

// Spreadsheet export: a short summary followed by every ticket in the period.
function toCsv(r: Report) {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    // Leading = + - @ would run as formulas in Excel; prefix them so they stay text.
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const k = r.kpis;
  const lines = [
    ['Company report', r.company.name],
    ['RC number', r.company.rc_number ?? ''],
    ['Period', `${r.period.from} to ${r.period.to}`],
    ['Generated', formatDateTime(r.generatedAt)],
    [],
    ['Tickets raised', k.raised],
    ['Tickets resolved', k.resolved],
    ['Open now', k.openNow],
    ['Escalated', k.escalated],
    ['Average first response', duration(k.avgFirstResponseMin)],
    ['Average resolution time', duration(k.avgResolutionMin)],
    ['Responded on time (SLA)', pct(k.slaPct)],
    ['Resolved within SLA (TTR compliance)', pct(k.resolutionPct)],
    ['Satisfaction (4-5 stars)', pct(k.csatPct)],
    ['Average rating', k.avgRating === null ? '' : k.avgRating.toFixed(1)],
    ['Site visits', k.visits],
    [],
    ['Ticket', 'Subject', 'Requester', 'Position', 'Category', 'Priority', 'Status', 'Escalated', 'Raised', 'First response', 'Resolved', 'Resolution time', 'Handled by'],
    ...r.tickets.map((t) => [
      `#${t.id}`,
      t.subject,
      t.requester ?? '',
      t.requester_title ?? '',
      t.category,
      PRIORITY_LABELS[t.priority],
      STATUS_LABELS[t.status],
      t.escalated ? 'Yes' : 'No',
      formatDateTime(t.created_at),
      duration(t.firstResponseMin),
      t.resolved_at ? formatDateTime(t.resolved_at) : '',
      duration(t.resolutionMin),
      t.assignee ?? 'Unassigned',
    ]),
  ];
  return '﻿' + lines.map((row) => row.map(esc).join(',')).join('\r\n');
}

function download(r: Report) {
  const blob = new Blob([toCsv(r)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${r.company.name.replace(/[^\w.-]+/g, '-')}-report-${r.period.from}-to-${r.period.to}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function ReportsPage() {
  const [params, setParams] = useSearchParams();
  const companyId = params.get('company') ?? '';
  const [period, setPeriod] = useState<Period>({ days: '90' });
  const companies = useQuery({ queryKey: ['companies'], queryFn: () => api.get<{ companies: Company[] }>('/companies') });
  const report = useQuery({
    queryKey: ['report', companyId, periodKey(period)],
    queryFn: () => api.get<Report>(`/reports/company/${companyId}?${periodQuery(period)}`),
    enabled: !!companyId,
  });
  const list = useMemo(() => [...(companies.data?.companies ?? [])].sort((a, b) => a.name.localeCompare(b.name)), [companies.data]);
  const r = report.data;

  return (
    <>
      <div className="print:hidden">
        <PageHeader
          title="Company reports"
          description="A complete picture of one client's support over any period: volumes, response times, satisfaction, site visits and every ticket."
          actions={
            r && (
              <>
                <Button variant="outline" onClick={() => download(r)}>
                  <FileSpreadsheet />
                  Export CSV
                </Button>
                <Button onClick={() => window.print()}>
                  <Printer />
                  Print or save PDF
                </Button>
              </>
            )
          }
        />
      </div>
      <Card className="print:hidden">
        <CardContent className="flex flex-wrap items-center gap-3">
          <Select value={companyId} onValueChange={(v) => setParams({ company: v }, { replace: true })}>
            <SelectTrigger className="w-72" aria-label="Company">
              <SelectValue placeholder={companies.isPending ? 'Loading companies...' : 'Choose a company'} />
            </SelectTrigger>
            <SelectContent>
              {list.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <PeriodPicker value={period} onChange={setPeriod} />
        </CardContent>
      </Card>

      {!companyId ? (
        <Card className="print:hidden">
          <EmptyState icon={Building2} title="Choose a company" description="Pick a client company and a period to generate its report." />
        </Card>
      ) : report.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      ) : report.isError ? (
        <Card>
          <EmptyState icon={Building2} title="Could not build this report" description={errorMessage(report.error)} />
        </Card>
      ) : r ? (
        <ReportView r={r} />
      ) : null}
    </>
  );
}

function Kpi({ icon: Icon, label, value, hint, warn }: { icon: LucideIcon; label: string; value: ReactNode; hint?: ReactNode; warn?: boolean }) {
  return (
    <Card className="gap-1 py-4 break-inside-avoid">
      <CardHeader className="px-4">
        <CardDescription className="flex items-center justify-between gap-2">
          {label}
          <Icon className={cn('size-4 text-muted-foreground', warn && 'text-orange-600 dark:text-orange-400')} />
        </CardDescription>
        <CardTitle className="text-2xl font-semibold tabular-nums">{value}</CardTitle>
      </CardHeader>
      {hint && <CardContent className="px-4 text-xs text-muted-foreground">{hint}</CardContent>}
    </Card>
  );
}

// Plain bars rather than a chart library, so they print crisply.
function Bars({ rows, label }: { rows: { name: string; total: number }[]; label?: (n: string) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.total));
  const sum = rows.reduce((n, r) => n + r.total, 0);
  if (!sum) return <p className="text-sm text-muted-foreground">Nothing in this period.</p>;
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.name} className="grid grid-cols-[minmax(0,9rem)_1fr_4.5rem] items-center gap-3 text-sm">
          <span className="truncate">{label ? label(r.name) : r.name}</span>
          <span className="h-2.5 overflow-hidden rounded-full bg-muted">
            <span className="block h-full rounded-full bg-primary print:[print-color-adjust:exact]" style={{ width: `${(r.total / max) * 100}%` }} />
          </span>
          <span className="text-right text-muted-foreground tabular-nums">
            {r.total} <span className="text-xs">({Math.round((r.total / sum) * 100)}%)</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function Section({ title, description, children, className }: { title: string; description?: string; children: ReactNode; className?: string }) {
  return (
    <Card className={cn('break-inside-avoid', className)}>
      <CardHeader>
        <CardTitle className="type-h5">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function ReportView({ r }: { r: Report }) {
  const k = r.kpis;
  const period: Period = r.period.custom ? { from: r.period.from, to: r.period.to } : { days: String(r.period.days) };
  return (
    <div className="report space-y-6">
      {/* Cover */}
      <Card className="break-inside-avoid">
        <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <CompanyLogo src={r.company.logo_url} name={r.company.name} className="size-16" />
          <div className="min-w-0 flex-1 space-y-1">
            <h2 className="type-h2">{r.company.name}</h2>
            <p className="text-sm text-muted-foreground">
              {[r.company.rc_number, r.company.email_domain && `@${r.company.email_domain}`, `Client since ${formatDate(r.company.since)}`].filter(Boolean).join(' · ')}
            </p>
          </div>
          <div className="text-sm sm:text-right">
            <div className="font-medium">Support report</div>
            <div className="text-muted-foreground">{periodLabel(period)}</div>
            <div className="text-xs text-muted-foreground">
              {formatDate(r.period.from)} to {formatDate(r.period.to)}
            </div>
            <div className="text-xs text-muted-foreground">
              Prepared by {BRAND.company}, {formatDateTime(r.generatedAt)}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Headline figures */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 print:grid-cols-4">
        <Kpi icon={TicketIcon} label="Tickets raised" value={k.raised} hint={`${k.urgent} urgent · ${k.escalated} escalated`} />
        <Kpi icon={CircleCheck} label="Tickets resolved" value={k.resolved} hint="Resolved during the period" />
        <Kpi icon={Inbox} label="Open now" value={k.openNow} warn={k.openNow > 0} hint="Still being worked on today" />
        <Kpi icon={AlarmClock} label="Responded on time" value={pct(k.slaPct)} warn={k.slaPct !== null && k.slaPct < 80} hint={`${k.slaMet} on time · ${k.slaMissed} late`} />
        <Kpi icon={Clock} label="Average first response" value={duration(k.avgFirstResponseMin)} hint={`Median ${duration(k.medianFirstResponseMin)}`} />
        <Kpi icon={TimerReset} label="Average time to resolve" value={duration(k.avgResolutionMin)} hint={`Median ${duration(k.medianResolutionMin)}`} />
        <Kpi
          icon={CircleCheck}
          label="Resolved within SLA"
          value={pct(k.resolutionPct)}
          warn={k.resolutionPct !== null && k.resolutionPct < 80}
          hint={`${k.resolutionMet} within target · ${k.resolutionMissed} late or overdue`}
        />
        <Kpi
          icon={Smile}
          label="Satisfaction"
          value={pct(k.csatPct)}
          hint={k.ratings ? `${k.avgRating?.toFixed(1)} of 5 from ${k.ratings} rating${k.ratings === 1 ? '' : 's'}` : 'No ratings in this period'}
        />
        <Kpi icon={CalendarClock} label="Site visits" value={k.visits} hint={`${k.visitsCompleted} completed`} />
      </div>

      <Section title="Tickets raised and resolved" description={r.period.weekly ? 'Per week' : 'Per day'}>
        <ChartContainer config={trendConfig} className="aspect-auto h-64 w-full">
          <AreaChart data={r.series} margin={{ left: -20, right: 8 }}>
            <defs>
              <linearGradient id="report-created" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-created)" stopOpacity={0.3} />
                <stop offset="95%" stopColor="var(--color-created)" stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="report-resolved" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-resolved)" stopOpacity={0.3} />
                <stop offset="95%" stopColor="var(--color-resolved)" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="key" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} tickFormatter={shortDate} />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={44} />
            <ChartTooltip content={<ChartTooltipContent labelFormatter={(v) => (r.period.weekly ? `Week of ${shortDate(String(v))}` : shortDate(String(v)))} />} />
            <Area dataKey="created" type="monotone" stroke="var(--color-created)" fill="url(#report-created)" strokeWidth={2} isAnimationActive={false} />
            <Area dataKey="resolved" type="monotone" stroke="var(--color-resolved)" fill="url(#report-resolved)" strokeWidth={2} isAnimationActive={false} />
            <ChartLegend content={<ChartLegendContent />} />
          </AreaChart>
        </ChartContainer>
      </Section>

      <div className="grid gap-6 lg:grid-cols-3 print:grid-cols-3">
        <Section title="By priority">
          <Bars rows={r.byPriority} label={(n) => PRIORITY_LABELS[n as Priority] ?? n} />
        </Section>
        <Section title="By category">
          <Bars rows={r.byCategory} />
        </Section>
        <Section title="By current status" description="Tickets raised in the period">
          <Bars rows={r.byStatus} label={(n) => STATUS_LABELS[n as Status] ?? n} />
        </Section>
      </div>

      <div className="grid gap-6 lg:grid-cols-2 print:grid-cols-2">
        <Section title="Who raised tickets" description={`${k.requesters} of ${k.activeUsers} active users raised tickets`}>
          <Bars rows={r.byRequester} />
        </Section>
        <Section title="Handled by" description="Our team members on this account">
          {r.handledBy.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing assigned in this period.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Team member</TableHead>
                  <TableHead className="text-right">Tickets</TableHead>
                  <TableHead className="text-right">Resolved</TableHead>
                  <TableHead className="text-right">Ticket rating</TableHead>
                  <TableHead className="text-right">Admin rating</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {r.handledBy.map((h) => (
                  <TableRow key={h.name}>
                    <TableCell className="font-medium">{h.name}</TableCell>
                    <TableCell className="text-right tabular-nums">{h.tickets}</TableCell>
                    <TableCell className="text-right tabular-nums">{h.resolved}</TableCell>
                    <TableCell className="text-right tabular-nums">{h.avgRating === null ? '-' : `${h.avgRating.toFixed(1)} (${h.ratings})`}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {(() => {
                        const a = r.adminRatings?.find((x) => x.name === h.name);
                        return a ? `${a.avgRating.toFixed(1)} (${a.ratings})` : '-';
                      })()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Section>
      </div>

      <div className="grid gap-6 lg:grid-cols-2 print:grid-cols-2">
        <Section title="Satisfaction" description={k.ratings ? `${k.ratings} rating${k.ratings === 1 ? '' : 's'} in the period` : undefined}>
          {k.ratings === 0 ? (
            <p className="text-sm text-muted-foreground">No ratings in this period.</p>
          ) : (
            <div className="space-y-4">
              <Bars rows={[...r.ratingBreakdown].reverse().map((b) => ({ name: `${b.rating} star${b.rating === 1 ? '' : 's'}`, total: b.total }))} />
              <ul className="space-y-3">
                {r.ratings
                  .filter((x) => x.comment)
                  .slice(0, 6)
                  .map((x) => (
                    <li key={x.ticket_id} className="rounded-md border p-3 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <Stars value={x.rating} size="size-3.5" />
                        <span className="text-xs text-muted-foreground">{formatDate(x.updated_at)}</span>
                      </div>
                      <p className="mt-1">&ldquo;{x.comment}&rdquo;</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {x.user_name ?? 'Client'} on #{x.ticket_id} {x.subject}
                      </p>
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </Section>
        <Section title="Communication">
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-muted-foreground">Ticket messages</dt>
              <dd className="text-xl font-semibold tabular-nums">{k.messages}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">From the client</dt>
              <dd className="text-xl font-semibold tabular-nums">{k.clientMessages}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Group chats</dt>
              <dd className="text-xl font-semibold tabular-nums">{k.chatGroups}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Chat messages</dt>
              <dd className="text-xl font-semibold tabular-nums">{k.chatMessages}</dd>
            </div>
          </dl>
        </Section>
      </div>

      <Section title="Open tickets" description={`${r.openNow.length} still open today, oldest first`}>
        {r.openNow.length === 0 ? (
          <p className="text-sm text-muted-foreground">No open tickets.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ticket</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Handled by</TableHead>
                <TableHead className="text-right">Open for</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {r.openNow.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="max-w-80">
                    <Link to={`/tickets/${t.id}`} className="block truncate font-medium hover:underline">
                      #{t.id} {t.subject}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <PriorityBadge priority={t.priority} />
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={t.status} />
                  </TableCell>
                  <TableCell>{t.assignee ?? <span className="text-muted-foreground">Unassigned</span>}</TableCell>
                  <TableCell className={cn('text-right tabular-nums', t.ageDays > 7 && 'font-medium text-orange-700 dark:text-orange-400')}>
                    {t.ageDays} day{t.ageDays === 1 ? '' : 's'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>

      {r.visits.length > 0 && (
        <Section title="Site visits" description={`${k.visitsCompleted} of ${k.visits} completed`}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Ticket</TableHead>
                <TableHead>Technician</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Signed off by</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {r.visits.map((v) => (
                <TableRow key={v.id}>
                  <TableCell className="whitespace-nowrap">{formatDateTime(v.scheduled_at)}</TableCell>
                  <TableCell className="max-w-64 truncate">
                    #{v.ticket_id} {v.subject}
                  </TableCell>
                  <TableCell>{v.technician ?? '-'}</TableCell>
                  <TableCell className="max-w-48 truncate">{v.location ?? '-'}</TableCell>
                  <TableCell>
                    <Badge variant={v.status === 'completed' ? 'secondary' : 'outline'} className="capitalize">
                      {v.status}
                    </Badge>
                  </TableCell>
                  <TableCell>{v.signed_by ?? '-'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Section>
      )}

      <Section title="People at this company" description={`${k.activeUsers} active account${k.activeUsers === 1 ? '' : 's'}`}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Position</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Last sign-in</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {r.people.map((p) => (
              <TableRow key={p.id} className={cn(!p.is_active && 'text-muted-foreground')}>
                <TableCell className="font-medium">
                  {p.name}
                  {!p.is_active && ' (disabled)'}
                </TableCell>
                <TableCell>{p.job_title ?? '-'}</TableCell>
                <TableCell>
                  <a href={`mailto:${p.email}`} className="text-primary hover:underline">
                    {p.email}
                  </a>
                </TableCell>
                <TableCell>{p.last_login_at ? formatDate(p.last_login_at) : 'Never'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>

      <Section title="All tickets in the period" description={`${r.tickets.length} ticket${r.tickets.length === 1 ? '' : 's'}, newest first`}>
        {r.tickets.length === 0 ? (
          <p className="text-sm text-muted-foreground">No tickets raised in this period.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ticket</TableHead>
                <TableHead>Requester</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Raised</TableHead>
                <TableHead className="text-right">First response</TableHead>
                <TableHead className="text-right">Resolved in</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {r.tickets.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="max-w-72">
                    <Link to={`/tickets/${t.id}`} className="block truncate font-medium hover:underline">
                      #{t.id} {t.subject}
                    </Link>
                    <span className="text-xs text-muted-foreground">{t.category}</span>
                  </TableCell>
                  <TableCell className="max-w-40 truncate">{t.requester ?? '-'}</TableCell>
                  <TableCell>
                    <PriorityBadge priority={t.priority} />
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={t.status} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{formatDate(t.created_at)}</TableCell>
                  <TableCell className="text-right tabular-nums">{duration(t.firstResponseMin)}</TableCell>
                  <TableCell className="text-right tabular-nums">{duration(t.resolutionMin)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>
      <p className="hidden text-center text-xs text-muted-foreground print:block">
        {BRAND.company} · Confidential: prepared for {r.company.name}
      </p>
    </div>
  );
}
