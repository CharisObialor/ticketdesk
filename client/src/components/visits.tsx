import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, CalendarPlus, Eraser, Loader2, MapPin, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { DateTimePicker } from '@/components/date-time-picker';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useSession } from '@/hooks/use-session';
import { api, errorMessage } from '@/lib/api';
import { ROLE_LABELS, parseTs, VISIT_DURATIONS, visitDuration } from '@/lib/format';
import { cn } from '@/lib/utils';
import { ClientVisitActions } from '@/components/client-visit';
import type { StaffMember, Ticket, Visit, VisitStatus } from '@/lib/types';

const visitFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
export const formatVisitTime = (ts: string) => {
  const d = parseTs(ts);
  return d ? visitFmt.format(d) : '-';
};

const STATUS: Record<VisitStatus, { label: string; className: string }> = {
  scheduled: { label: 'Scheduled', className: 'border-blue-500/40 text-blue-700 dark:text-blue-300' },
  in_progress: { label: 'On site', className: 'border-amber-500/40 text-amber-700 dark:text-amber-300' },
  completed: { label: 'Completed', className: 'border-emerald-500/40 text-emerald-700 dark:text-emerald-300' },
  cancelled: { label: 'Cancelled', className: 'text-muted-foreground' },
};

export function VisitStatusBadge({ status }: { status: VisitStatus }) {
  return (
    <Badge variant="outline" className={cn('font-normal', STATUS[status].className)}>
      {STATUS[status].label}
    </Badge>
  );
}

// datetime-local inputs work in local time; the API takes ISO (UTC).
const toLocalInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

export function ScheduleVisitDialog({ ticket, visit, onClose }: { ticket: Pick<Ticket, 'id' | 'company_name'>; visit?: Visit; onClose: () => void }) {
  const qc = useQueryClient();
  const staff = useQuery({ queryKey: ['staff'], queryFn: () => api.get<{ staff: StaffMember[] }>('/staff'), staleTime: 5 * 60_000 });
  const defaultWhen = () => {
    const d = new Date(Date.now() + 86400000);
    d.setHours(9, 0, 0, 0);
    return d;
  };
  const [when, setWhen] = useState(toLocalInput(visit ? parseTs(visit.scheduled_at)! : defaultWhen()));
  const [technician, setTechnician] = useState(visit?.technician_id ? String(visit.technician_id) : '');
  const [duration, setDuration] = useState(String(visit?.duration_min ?? 60));
  const [location, setLocation] = useState(visit?.location ?? '');
  const [notes, setNotes] = useState(visit?.notes ?? '');
  const [busy, setBusy] = useState(false);
  // Technicians first, then the rest of the team.
  const people = [...(staff.data?.staff ?? [])].sort((a, b) => Number(b.role === 'technician') - Number(a.role === 'technician') || a.name.localeCompare(b.name));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!technician) return toast.error('Choose a technician');
    setBusy(true);
    const body = { technician_id: Number(technician), scheduled_at: new Date(when).toISOString(), duration_min: Number(duration), location, notes };
    try {
      if (visit) await api.patch(`/visits/${visit.id}`, body);
      else await api.post('/visits', { ...body, ticket_id: ticket.id });
      toast.success(visit ? 'Visit updated' : 'Site visit scheduled', { description: 'The technician and the client have been notified.' });
      qc.invalidateQueries({ queryKey: ['ticket', ticket.id] });
      qc.invalidateQueries({ queryKey: ['visits'] });
      qc.invalidateQueries({ queryKey: ['visit'] });
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{visit ? 'Reschedule site visit' : 'Schedule a site visit'}</DialogTitle>
            <DialogDescription>
              Ticket #{ticket.id} for {ticket.company_name}. The technician and the client are emailed the details.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="visit-when">Date and time *</Label>
              <DateTimePicker id="visit-when" value={when} onChange={setWhen} fromDate={visit ? undefined : new Date(new Date().setHours(0, 0, 0, 0))} />
            </div>
            <div className="grid gap-2">
              <Label>Expected duration</Label>
              <Select value={duration} onValueChange={setDuration}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[...new Set([...VISIT_DURATIONS, Number(duration)])]
                    .sort((a, b) => a - b)
                    .map((m) => (
                      <SelectItem key={m} value={String(m)}>
                        {visitDuration(m)}
                        {m === 480 ? ' (full working day)' : ''}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-2">
            <Label>Technician *</Label>
            <Select value={technician} onValueChange={setTechnician}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Choose who will attend" />
              </SelectTrigger>
              <SelectContent>
                {people.map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    {s.name} <span className="text-muted-foreground">({ROLE_LABELS[s.role]})</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="visit-location">Location</Label>
            <Input id="visit-location" maxLength={255} placeholder={`For example: ${ticket.company_name} head office, 3rd floor`} value={location} onChange={(e) => setLocation(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="visit-notes">Notes for the technician</Label>
            <Textarea id="visit-notes" rows={3} maxLength={5000} placeholder="Access instructions, equipment to bring, contact on site" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="animate-spin" />}
              {visit ? 'Save changes' : 'Schedule visit'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// Sidebar card on the ticket page.
export function VisitsCard({ ticket, visits }: { ticket: Ticket; visits: Visit[] }) {
  const { isStaff } = useSession();
  const [scheduling, setScheduling] = useState(false);
  if (!isStaff && visits.length === 0) return null;
  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle className="type-h5">Site visits</CardTitle>
        {isStaff && ticket.status !== 'closed' && (
          <CardAction>
            <Button variant="ghost" size="xs" onClick={() => setScheduling(true)}>
              <CalendarPlus />
              Schedule
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        {visits.length === 0 ? (
          <p className="text-sm text-muted-foreground">Book a technician to visit the client on site.</p>
        ) : (
          visits.map((v) => {
            const body = (
              <>
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    <CalendarClock className="size-3.5 text-muted-foreground" />
                    {formatVisitTime(v.scheduled_at)}
                  </span>
                  <VisitStatusBadge status={v.status} />
                </div>
                <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <UserRound className="size-3" />
                  {v.technician_name ?? 'Technician to be confirmed'}
                </div>
                {v.location && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <MapPin className="size-3" />
                    <span className="truncate">{v.location}</span>
                  </div>
                )}
              </>
            );
            return isStaff ? (
              <Link key={v.id} to={`/visits/${v.id}`} className="block rounded-md border p-2.5 transition-colors hover:bg-muted/50">
                {body}
              </Link>
            ) : (
              <div key={v.id} className="space-y-2 rounded-md border p-2.5">
                {body}
                <ClientVisitActions visit={{ ...v, subject: ticket.subject }} />
              </div>
            );
          })
        )}
      </CardContent>
      {scheduling && <ScheduleVisitDialog ticket={ticket} onClose={() => setScheduling(false)} />}
    </Card>
  );
}

// Finger or mouse signature capture; returns a PNG data URL through onChange (null when cleared).
export function SignaturePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    const c = canvas.current!;
    const ratio = window.devicePixelRatio || 1;
    c.width = c.offsetWidth * ratio;
    c.height = c.offsetHeight * ratio;
    const ctx = c.getContext('2d')!;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#111827';
  }, []);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = canvas.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };

  return (
    <div className="space-y-2">
      <div className="relative overflow-hidden rounded-md border bg-white">
        <canvas
          ref={canvas}
          className="block h-40 w-full touch-none"
          onPointerDown={(e) => {
            drawing.current = true;
            canvas.current!.setPointerCapture(e.pointerId);
            const ctx = canvas.current!.getContext('2d')!;
            const [x, y] = point(e);
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x + 0.1, y + 0.1);
            ctx.stroke();
          }}
          onPointerMove={(e) => {
            if (!drawing.current) return;
            const ctx = canvas.current!.getContext('2d')!;
            const [x, y] = point(e);
            ctx.lineTo(x, y);
            ctx.stroke();
          }}
          onPointerUp={() => {
            if (!drawing.current) return;
            drawing.current = false;
            setEmpty(false);
            onChange(canvas.current!.toDataURL('image/png'));
          }}
        />
        {empty && <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-zinc-400">Sign here</span>}
        <div className="pointer-events-none absolute inset-x-6 bottom-8 border-b border-dashed border-zinc-300" />
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={empty}
        onClick={() => {
          const c = canvas.current!;
          c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
          setEmpty(true);
          onChange(null);
        }}
      >
        <Eraser />
        Clear signature
      </Button>
    </div>
  );
}
