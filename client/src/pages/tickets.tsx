import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Inbox, Plus, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState, PageHeader } from '@/components/common';
import { EscalatedBadge, PriorityBadge, SlaBadge, StatusBadge } from '@/components/ticket-badges';
import { useSession } from '@/hooks/use-session';
import { api, qs } from '@/lib/api';
import { PRIORITY_LABELS, STATUS_LABELS, formatDateTime, timeAgo } from '@/lib/format';
import type { Company, Priority, Status, Ticket } from '@/lib/types';

const VIEW_TITLES: Record<string, { staff: [string, string]; client: [string, string] }> = {
  open: {
    staff: ['All open tickets', 'Every ticket that is open, in progress or awaiting the client.'],
    client: ['Open tickets', "Your company's tickets that are still being worked on."],
  },
  mine: {
    staff: ['Assigned to me', 'Open tickets you are responsible for.'],
    client: ['Raised by me', 'Open tickets you raised.'],
  },
  unassigned: {
    staff: ['Unassigned', 'Open tickets waiting for someone to pick them up.'],
    client: ['Unassigned', ''],
  },
  escalated: {
    staff: ['Escalated', 'Open tickets that have been escalated and need attention.'],
    client: ['Escalated', ''],
  },
  resolved: {
    staff: ['Resolved', 'Tickets that have been resolved or closed.'],
    client: ['Resolved', 'Tickets that have been resolved or closed.'],
  },
};

const ALL = 'all';

export default function TicketsPage() {
  const { isStaff } = useSession();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const view = params.get('view') || 'open';
  const page = Number(params.get('page')) || 1;
  const priority = params.get('priority') || '';
  const status = params.get('status') || '';
  const companyId = params.get('company_id') || '';
  const q = params.get('q') || '';
  const [search, setSearch] = useState(q);

  useEffect(() => setSearch(q), [q]);

  const update = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v && v !== ALL) next.set(k, v);
      else next.delete(k);
    }
    if (!('page' in patch)) next.delete('page');
    setParams(next);
  };

  // Debounce the search box into the URL.
  useEffect(() => {
    if (search === q) return;
    const id = setTimeout(() => update({ q: search.trim() }), 350);
    return () => clearTimeout(id);
  }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  const tickets = useQuery({
    queryKey: ['tickets', { view, page, priority, status, companyId, q }],
    queryFn: () =>
      api.get<{ tickets: Ticket[]; hasMore: boolean; page: number }>(
        `/tickets${qs({ view, page, priority, status, company_id: companyId, q })}`
      ),
    placeholderData: keepPreviousData,
  });
  const companies = useQuery({
    queryKey: ['companies'],
    queryFn: () => api.get<{ companies: Company[] }>('/companies'),
    enabled: isStaff,
  });

  const [title, description] = (VIEW_TITLES[view] ?? VIEW_TITLES.open)[isStaff ? 'staff' : 'client'];
  const filtered = !!(priority || status || companyId || q);
  const statusOptions: Status[] = view === 'resolved' ? ['resolved', 'closed'] : ['open', 'in_progress', 'awaiting_client'];
  const rows = tickets.data?.tickets ?? [];

  return (
    <>
      <PageHeader
        title={title}
        description={description}
        actions={
          <Button asChild>
            <Link to="/tickets/new">
              <Plus />
              New ticket
            </Link>
          </Button>
        }
      />

      <div className="flex flex-col gap-2 md:flex-row md:items-center">
        <div className="relative md:max-w-xs md:flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={isStaff ? 'Search tickets and messages, or #ID' : 'Search tickets and messages, or #ID'}
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Select value={status || ALL} onValueChange={(v) => update({ status: v })}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All statuses</SelectItem>
              {statusOptions.map((s) => (
                <SelectItem key={s} value={s}>
                  {STATUS_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={priority || ALL} onValueChange={(v) => update({ priority: v })}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Priority" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All priorities</SelectItem>
              {(Object.keys(PRIORITY_LABELS) as Priority[]).map((p) => (
                <SelectItem key={p} value={p}>
                  {PRIORITY_LABELS[p]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {isStaff && (
            <Select value={companyId || ALL} onValueChange={(v) => update({ company_id: v })}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Company" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All companies</SelectItem>
                {companies.data?.companies.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {filtered && (
            <Button variant="ghost" onClick={() => setParams(new URLSearchParams({ view }))}>
              <X />
              Clear
            </Button>
          )}
        </div>
      </div>

      <Card className="gap-0 overflow-hidden py-0">
        {tickets.isPending ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={filtered ? Search : Inbox}
            title={filtered ? 'No matching tickets' : 'No tickets here'}
            description={filtered ? 'Try changing or clearing the filters.' : 'Tickets in this view will appear here.'}
            action={
              !filtered && (
                <Button variant="outline" asChild>
                  <Link to="/tickets/new">
                    <Plus />
                    New ticket
                  </Link>
                </Button>
              )
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead className="w-20 pl-4">ID</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead className="w-36">Status</TableHead>
                <TableHead className="w-28">Priority</TableHead>
                {view !== 'resolved' && <TableHead className="hidden w-32 sm:table-cell">Response SLA</TableHead>}
                {isStaff && <TableHead className="hidden w-40 lg:table-cell">Assignee</TableHead>}
                <TableHead className="hidden w-32 pr-4 text-right md:table-cell">Last activity</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((t) => (
                <TableRow key={t.id} className="cursor-pointer" onClick={() => navigate(`/tickets/${t.id}`)}>
                  <TableCell className="pl-4 font-mono text-xs text-muted-foreground">#{t.id}</TableCell>
                  <TableCell className="max-w-0">
                    <div className="flex items-center gap-2">
                      <Link to={`/tickets/${t.id}`} className="truncate font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
                        {t.subject}
                      </Link>
                      {!!t.escalated && <EscalatedBadge level={t.escalation_level} />}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {isStaff ? `${t.company_name} · ` : ''}
                      {t.creator_name ?? 'Unknown'} · {t.category}
                    </div>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={t.status} />
                  </TableCell>
                  <TableCell>
                    <PriorityBadge priority={t.priority} />
                  </TableCell>
                  {view !== 'resolved' && (
                    <TableCell className="hidden sm:table-cell">
                      <SlaBadge ticket={t} />
                    </TableCell>
                  )}
                  {isStaff && (
                    <TableCell className="hidden truncate text-sm lg:table-cell">
                      {t.assignee_name ?? <span className="text-muted-foreground">Unassigned</span>}
                    </TableCell>
                  )}
                  <TableCell className="hidden pr-4 text-right text-sm text-muted-foreground md:table-cell" title={formatDateTime(t.last_activity_at)}>
                    {timeAgo(t.last_activity_at)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {(page > 1 || tickets.data?.hasMore) && (
        <div className="flex items-center justify-end gap-2">
          <span className="mr-2 text-sm text-muted-foreground">Page {page}</span>
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => update({ page: String(page - 1) })}>
            <ChevronLeft />
            Previous
          </Button>
          <Button variant="outline" size="sm" disabled={!tickets.data?.hasMore} onClick={() => update({ page: String(page + 1) })}>
            Next
            <ChevronRight />
          </Button>
        </div>
      )}
    </>
  );
}
