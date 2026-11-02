import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock, MapPin, MessageSquareReply, Plus, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/common';
import { ClientVisitActions, type ClientVisit } from '@/components/client-visit';
import { ResolutionBadge, StatusBadge } from '@/components/ticket-badges';
import { formatVisitTime } from '@/components/visits';
import { useSession } from '@/hooks/use-session';
import { api } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import type { Ticket } from '@/lib/types';

interface HomeData {
  open: Ticket[];
  awaitingYou: Ticket[];
  toRate: Ticket[];
  visits: ClientVisit[];
  visitsToSign: ClientVisit[];
}

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};

// Client landing page: what is open, what needs them, and upcoming site visits.
export default function ClientHomePage() {
  const { user } = useSession();
  const query = useQuery({ queryKey: ['client-home'], queryFn: () => api.get<HomeData>('/client/home') });
  const d = query.data;
  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <PageHeader
        title={`${greeting()}, ${user?.name.split(' ')[0] ?? ''}`}
        description={user?.company_name ? `Support for ${user.company_name}` : 'Your support overview'}
        actions={
          <Button asChild>
            <Link to="/tickets/new">
              <Plus />
              New ticket
            </Link>
          </Button>
        }
      />
      {!d ? (
        <div className="grid gap-6 md:grid-cols-2">
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat label="Open tickets" value={d.open.length + d.awaitingYou.length} to="/tickets?view=open" />
            <Stat label="Waiting on you" value={d.awaitingYou.length} to="/tickets?view=open&status=awaiting_client" highlight={d.awaitingYou.length > 0} />
            <Stat label="Upcoming site visits" value={d.visits.length} />
          </div>

          {d.awaitingYou.length > 0 && (
            <Card className="gap-3 border-amber-500/40">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MessageSquareReply className="size-4 text-amber-600" />
                  Waiting on you
                </CardTitle>
                <CardDescription>Our team asked you something on these tickets.</CardDescription>
              </CardHeader>
              <CardContent>
                <TicketList tickets={d.awaitingYou} />
              </CardContent>
            </Card>
          )}

          {(d.visitsToSign.length > 0 || d.visits.length > 0) && (
            <Card className="gap-3">
              <CardHeader>
                <CardTitle>Site visits</CardTitle>
                <CardDescription>Confirm when our engineer arrives, and sign off the job when it is done.</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="divide-y rounded-lg border">
                  {[...d.visitsToSign, ...d.visits].map((v) => (
                    <li key={v.id} className="space-y-1.5 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Link to={`/tickets/${v.ticket_id}`} className="truncate text-sm font-medium hover:underline">
                          #{v.ticket_id} {v.subject}
                        </Link>
                        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <CalendarClock className="size-3.5" />
                          {v.status === 'completed' ? 'Completed' : formatVisitTime(v.scheduled_at)}
                        </span>
                      </div>
                      {v.location && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <MapPin className="size-3" />
                          {v.location}
                        </div>
                      )}
                      <ClientVisitActions visit={v} />
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          <Card className="gap-3">
            <CardHeader>
              <CardTitle>Open tickets</CardTitle>
              <CardDescription>Time left is the agreed time to resolve, counted from when the ticket was assigned.</CardDescription>
            </CardHeader>
            <CardContent>
              {d.open.length === 0 ? <p className="text-sm text-muted-foreground">Nothing open. Raise a new ticket if you need help.</p> : <TicketList tickets={d.open} />}
            </CardContent>
          </Card>

          {d.toRate.length > 0 && (
            <Card className="gap-3">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Star className="size-4 text-amber-500" />
                  Tell us how we did
                </CardTitle>
                <CardDescription>Recently resolved tickets you have not rated yet.</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="divide-y rounded-lg border">
                  {d.toRate.map((t) => (
                    <li key={t.id}>
                      <Link to={`/tickets/${t.id}`} className="flex items-center justify-between gap-3 p-3 text-sm hover:bg-muted/50">
                        <span className="truncate">
                          #{t.id} {t.subject}
                        </span>
                        <span className="shrink-0 text-xs text-primary">Rate</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, to, highlight }: { label: string; value: number; to?: string; highlight?: boolean }) {
  const body = (
    <Card className={highlight ? 'gap-1 border-amber-500/50' : 'gap-1'}>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl font-semibold tabular-nums">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
  return to ? (
    <Link to={to} className="rounded-xl transition-opacity hover:opacity-90">
      {body}
    </Link>
  ) : (
    body
  );
}

function TicketList({ tickets }: { tickets: Ticket[] }) {
  return (
    <ul className="divide-y rounded-lg border">
      {tickets.map((t) => (
        <li key={t.id}>
          <Link to={`/tickets/${t.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3 hover:bg-muted/50">
            <span className="min-w-0 flex-1 truncate text-sm font-medium">
              #{t.id} {t.subject}
            </span>
            {t.site_code && <span className="text-xs text-muted-foreground">{t.site_code}</span>}
            <StatusBadge status={t.status} />
            <ResolutionBadge ticket={t} />
            <span className="w-20 text-right text-xs text-muted-foreground">{timeAgo(t.last_activity_at)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
