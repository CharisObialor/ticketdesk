import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CalendarClock, CircleCheck, Clock, Loader2, MapPin, Phone, Play, Ticket as TicketIcon, UserRound, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { EmptyState, PageHeader } from '@/components/common';
import { DropZone, FileChips, useFileList } from '@/components/file-attachments';
import { ScheduleVisitDialog, SignaturePad, VisitStatusBadge, formatVisitTime } from '@/components/visits';
import { useSession } from '@/hooks/use-session';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime, parseTs } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Visit } from '@/lib/types';

const dayFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
const dayKey = (ts: string) => parseTs(ts)!.toDateString();

export default function VisitsPage() {
  const { isAdmin } = useSession();
  const navigate = useNavigate();
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const [when, setWhen] = useState<'upcoming' | 'past'>('upcoming');
  const visits = useQuery({
    queryKey: ['visits', scope, when],
    queryFn: () => api.get<{ visits: Visit[] }>(`/visits?scope=${scope}&when=${when}`),
  });
  const rows = visits.data?.visits ?? [];

  // Group by day for an agenda view.
  const days: [string, Visit[]][] = [];
  for (const v of rows) {
    const k = dayKey(v.scheduled_at);
    const last = days[days.length - 1];
    if (last && last[0] === k) last[1].push(v);
    else days.push([k, [v]]);
  }
  const today = new Date().toDateString();

  return (
    <>
      <PageHeader title="Site visits" description="On-site work booked against client tickets. Schedule new visits from a ticket's page." />
      <div className="flex flex-wrap gap-2">
        <Tabs value={when} onValueChange={(v) => setWhen(v as 'upcoming' | 'past')}>
          <TabsList>
            <TabsTrigger value="upcoming">Upcoming</TabsTrigger>
            <TabsTrigger value="past">Completed and cancelled</TabsTrigger>
          </TabsList>
        </Tabs>
        <Tabs value={scope} onValueChange={(v) => setScope(v as 'mine' | 'all')}>
          <TabsList>
            <TabsTrigger value="mine">My visits</TabsTrigger>
            <TabsTrigger value="all">{isAdmin ? 'All technicians' : 'Whole team'}</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {visits.isPending ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={CalendarClock}
            title={when === 'upcoming' ? 'No upcoming visits' : 'No past visits'}
            description={when === 'upcoming' ? 'Visits scheduled from a ticket will appear here.' : undefined}
          />
        </Card>
      ) : (
        <div className="space-y-6">
          {days.map(([key, list]) => (
            <section key={key} className="space-y-2">
              <h2 className={cn('text-sm font-medium', key === today ? 'text-primary' : 'text-muted-foreground')}>
                {key === today ? 'Today · ' : ''}
                {dayFmt.format(new Date(key))}
              </h2>
              <div className="grid gap-2">
                {list.map((v) => (
                  <button key={v.id} onClick={() => navigate(`/visits/${v.id}`)} className="text-left">
                    <Card className="gap-0 py-3 transition-colors hover:bg-muted/40">
                      <CardContent className="flex flex-col gap-2 px-4 sm:flex-row sm:items-center">
                        <div className="flex w-24 shrink-0 items-center gap-1.5 text-sm font-semibold tabular-nums">
                          <Clock className="size-3.5 text-muted-foreground" />
                          {new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(parseTs(v.scheduled_at)!)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium">{v.company_name}</div>
                          <div className="truncate text-sm text-muted-foreground">
                            #{v.ticket_id} {v.ticket_subject}
                          </div>
                          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <UserRound className="size-3" />
                              {v.technician_name ?? 'Unassigned'}
                            </span>
                            {v.location && (
                              <span className="flex items-center gap-1">
                                <MapPin className="size-3" />
                                {v.location}
                              </span>
                            )}
                          </div>
                        </div>
                        <VisitStatusBadge status={v.status} />
                      </CardContent>
                    </Card>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}

export function VisitDetailPage() {
  const id = Number(useParams().id);
  const qc = useQueryClient();
  const [rescheduling, setRescheduling] = useState(false);
  const query = useQuery({ queryKey: ['visit', id], queryFn: () => api.get<{ visit: Visit }>(`/visits/${id}`) });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['visit', id] });
    qc.invalidateQueries({ queryKey: ['visits'] });
  };
  const start = useMutation({
    mutationFn: () => api.post(`/visits/${id}/start`),
    onSuccess: () => {
      toast.success('Visit started');
      refresh();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const cancel = useMutation({
    mutationFn: () => api.post(`/visits/${id}/cancel`),
    onSuccess: () => {
      toast.success('Visit cancelled. The client has been notified.');
      refresh();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  if (query.isPending) return <Skeleton className="h-96" />;
  if (query.isError) {
    return (
      <Card>
        <EmptyState icon={CalendarClock} title="Visit not found" />
      </Card>
    );
  }
  const v = query.data.visit;
  const active = v.status === 'scheduled' || v.status === 'in_progress';

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <Button variant="ghost" size="sm" className="-ml-2" asChild>
        <Link to="/visits">
          <ArrowLeft />
          All visits
        </Link>
      </Button>
      <PageHeader
        title={`Site visit: ${v.company_name}`}
        description={
          <Link to={`/tickets/${v.ticket_id}`} className="inline-flex items-center gap-1 hover:underline">
            <TicketIcon className="size-3.5" />#{v.ticket_id} {v.ticket_subject}
          </Link>
        }
        actions={<VisitStatusBadge status={v.status} />}
      />

      <Card>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Info icon={CalendarClock} label="When" value={`${formatVisitTime(v.scheduled_at)} (${v.duration_min} min)`} />
          <Info icon={UserRound} label="Technician" value={v.technician_name ?? 'Unassigned'} />
          <Info icon={MapPin} label="Location" value={v.location || v.company_name || '-'} />
          <Info icon={Phone} label="Client contact" value={v.requester_name ?? '-'} />
          {v.notes && (
            <div className="sm:col-span-2">
              <div className="text-xs font-medium text-muted-foreground">Notes</div>
              <p className="mt-1 text-sm whitespace-pre-wrap">{v.notes}</p>
            </div>
          )}
          {v.started_at && <Info icon={Play} label="Started" value={formatDateTime(v.started_at)} />}
          {v.completed_at && <Info icon={CircleCheck} label="Completed" value={formatDateTime(v.completed_at)} />}
        </CardContent>
        {active && (
          <CardFooter className="flex-wrap gap-2 border-t">
            {v.status === 'scheduled' && (
              <Button onClick={() => start.mutate()} disabled={start.isPending}>
                <Play />
                Start visit
              </Button>
            )}
            <Button variant="outline" onClick={() => setRescheduling(true)}>
              <CalendarClock />
              Reschedule
            </Button>
            <Button variant="ghost" className="text-destructive" onClick={() => confirm('Cancel this visit? The client will be emailed.') && cancel.mutate()} disabled={cancel.isPending}>
              <X />
              Cancel visit
            </Button>
          </CardFooter>
        )}
      </Card>

      {active && <CompleteVisitForm visit={v} onDone={refresh} />}

      {v.status === 'completed' && (
        <Card>
          <CardHeader>
            <CardTitle>Visit report</CardTitle>
            <CardDescription>Posted to the ticket conversation with any photos and the signature.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="whitespace-pre-wrap">{v.report}</p>
            {v.signed_by && <p className="text-muted-foreground">Signed off on site by {v.signed_by}</p>}
            <Button variant="outline" size="sm" asChild>
              <Link to={`/tickets/${v.ticket_id}`}>View on ticket</Link>
            </Button>
          </CardContent>
        </Card>
      )}
      {rescheduling && <ScheduleVisitDialog ticket={{ id: v.ticket_id, company_name: v.company_name ?? '' }} visit={v} onClose={() => setRescheduling(false)} />}
    </div>
  );
}

function Info({ icon: Icon, label, value }: { icon: typeof Clock; label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <div className="text-xs font-medium text-muted-foreground">{label}</div>
        <div className="text-sm break-words">{value}</div>
      </div>
    </div>
  );
}

function CompleteVisitForm({ visit, onDone }: { visit: Visit; onDone: () => void }) {
  const qc = useQueryClient();
  const files = useFileList();
  const [report, setReport] = useState('');
  const [signedBy, setSignedBy] = useState(visit.requester_name ?? '');
  const [signature, setSignature] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const fd = new FormData();
    fd.set('report', report);
    fd.set('signed_by', signedBy);
    if (signature) fd.set('signature', signature);
    for (const f of files.files) fd.append('files', f);
    try {
      await api.post(`/visits/${visit.id}/complete`, fd);
      toast.success('Visit completed', { description: 'The report has been posted to the ticket and the client notified.' });
      qc.invalidateQueries({ queryKey: ['ticket', visit.ticket_id] });
      onDone();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <Card>
        <CardHeader>
          <CardTitle>Complete visit</CardTitle>
          <CardDescription>Record the work done. The report, photos and signature are added to the ticket for the client.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          <div className="grid gap-2">
            <Label htmlFor="report">Work carried out *</Label>
            <Textarea id="report" required rows={6} placeholder="What you found, what you did, parts used and any follow-up needed" value={report} onChange={(e) => setReport(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label>Photos</Label>
            <DropZone list={files} />
            <FileChips list={files} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="signed-by">Client name</Label>
            <Input id="signed-by" maxLength={190} placeholder="Name of the person signing off" value={signedBy} onChange={(e) => setSignedBy(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label>Client signature</Label>
            <SignaturePad onChange={setSignature} />
          </div>
        </CardContent>
        <CardFooter className="justify-end border-t">
          <Button type="submit" disabled={busy || !report.trim()}>
            {busy ? <Loader2 className="animate-spin" /> : <CircleCheck />}
            Complete visit and post report
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
