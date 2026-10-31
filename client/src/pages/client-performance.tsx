import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/common';
import { PeriodPicker, periodKey, periodLabel, periodQuery, type Period } from '@/components/period-picker';
import { Stars } from '@/components/rating';
import { useSession } from '@/hooks/use-session';
import { api } from '@/lib/api';
import { PRIORITY_LABELS, duration } from '@/lib/format';
import type { Priority } from '@/lib/types';

interface Performance {
  period: { from: string; to: string };
  kpis: {
    raised: number;
    resolved: number;
    openNow: number;
    avgFirstResponseMin: number | null;
    avgResolutionMin: number | null;
    responsePct: number | null;
    resolutionPct: number | null;
    visits: number;
    visitsCompleted: number;
    ratings: number;
    avgRating: number | null;
  };
  series: { date: string; created: number; resolved: number }[];
  weekly: boolean;
  byPriority: { name: Priority; total: number }[];
  byCategory: { name: string; total: number }[];
  bySite: { name: string; total: number }[];
}

// The client's view of the service they received: read-only, their company only. Print saves it as a PDF.
export default function ClientPerformancePage() {
  const { user } = useSession();
  const [period, setPeriod] = useState<Period>({ days: '30' });
  const query = useQuery({
    queryKey: ['client-performance', periodKey(period)],
    queryFn: () => api.get<Performance>(`/client/performance?${periodQuery(period)}`),
  });
  const d = query.data;
  const k = d?.kpis;
  return (
    <div className="report mx-auto w-full max-w-5xl space-y-6">
      <PageHeader
        title="Performance"
        description={`How we supported ${user?.company_name ?? 'you'}: ${periodLabel(period).toLowerCase()}.`}
        actions={
          <div className="flex gap-2 print:hidden">
            <PeriodPicker value={period} onChange={setPeriod} />
            <Button variant="outline" onClick={() => window.print()}>
              <Printer />
              Print or save PDF
            </Button>
          </div>
        }
      />
      {!k || !d ? (
        <Skeleton className="h-64" />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi label="Tickets raised" value={k.raised} />
            <Kpi label="Tickets resolved" value={k.resolved} />
            <Kpi label="First reply on time" value={k.responsePct === null ? '-' : `${k.responsePct}%`} hint={k.avgFirstResponseMin === null ? undefined : `Average ${duration(k.avgFirstResponseMin)}`} />
            <Kpi label="Resolved on time" value={k.resolutionPct === null ? '-' : `${k.resolutionPct}%`} hint={k.avgResolutionMin === null ? undefined : `Average ${duration(k.avgResolutionMin)}`} />
            <Kpi label="Open now" value={k.openNow} />
            <Kpi label="Site visits" value={`${k.visitsCompleted} of ${k.visits}`} hint="completed" />
            <Card className="gap-1 sm:col-span-2">
              <CardHeader>
                <CardDescription>Your rating of our support</CardDescription>
                <CardTitle className="flex items-center gap-2 text-2xl font-semibold tabular-nums">
                  {k.avgRating === null ? '-' : k.avgRating.toFixed(1)}
                  {k.avgRating !== null && <Stars value={k.avgRating} />}
                </CardTitle>
                <p className="text-xs text-muted-foreground">{k.ratings ? `From ${k.ratings} rating${k.ratings === 1 ? '' : 's'}` : 'No ratings in this period'}</p>
              </CardHeader>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Raised and resolved</CardTitle>
              <CardDescription>{d.weekly ? 'By week' : 'By day'}. Times are counted from when each ticket was assigned, as in our SLA.</CardDescription>
            </CardHeader>
            <CardContent>
              <Columns series={d.series} />
            </CardContent>
          </Card>

          <div className="grid gap-6 md:grid-cols-3">
            <Breakdown title="By fault" rows={d.byCategory} />
            <Breakdown title="By priority" rows={d.byPriority.filter((p) => p.total).map((p) => ({ name: PRIORITY_LABELS[p.name], total: p.total }))} />
            <Breakdown title="Busiest sites" rows={d.bySite} />
          </div>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <Card className="gap-1">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl font-semibold tabular-nums">{value}</CardTitle>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardHeader>
    </Card>
  );
}

// Simple paired columns: raised (muted) and resolved (primary) for each day or week.
function Columns({ series }: { series: Performance['series'] }) {
  const max = Math.max(1, ...series.map((s) => Math.max(s.created, s.resolved)));
  if (!series.some((s) => s.created || s.resolved)) return <p className="py-8 text-center text-sm text-muted-foreground">No tickets in this period.</p>;
  return (
    <div>
      <div className="flex h-40 items-end gap-1">
        {series.map((s) => (
          <div key={s.date} className="flex h-full min-w-0 flex-1 items-end justify-center gap-px" title={`${s.date}: ${s.created} raised, ${s.resolved} resolved`}>
            <div className="w-1/2 rounded-t-sm bg-muted-foreground/30" style={{ height: `${(s.created / max) * 100}%` }} />
            <div className="w-1/2 rounded-t-sm bg-primary" style={{ height: `${(s.resolved / max) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-xs text-muted-foreground">
        <span>{series[0]?.date}</span>
        <span className="flex gap-3">
          <span className="flex items-center gap-1">
            <span className="size-2 rounded-sm bg-muted-foreground/30" /> Raised
          </span>
          <span className="flex items-center gap-1">
            <span className="size-2 rounded-sm bg-primary" /> Resolved
          </span>
        </span>
        <span>{series[series.length - 1]?.date}</span>
      </div>
    </div>
  );
}

function Breakdown({ title, rows }: { title: string; rows: { name: string; total: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.total));
  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle className="type-h5">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing in this period.</p>
        ) : (
          rows.slice(0, 8).map((r) => (
            <div key={r.name} className="space-y-1">
              <div className="flex justify-between gap-2 text-sm">
                <span className="truncate">{r.name}</span>
                <span className="tabular-nums">{r.total}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary" style={{ width: `${(r.total / max) * 100}%` }} />
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
