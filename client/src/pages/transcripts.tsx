import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Archive, Download, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState, PageHeader } from '@/components/common';
import { api, qs } from '@/lib/api';
import { fileSize, formatDateTime } from '@/lib/format';
import type { Transcript } from '@/lib/types';
import { apiHref } from '@/lib/api';

const REASONS: Record<string, string> = { resolved: 'Resolved', closed: 'Closed', manual: 'Saved manually' };

export default function TranscriptsPage() {
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setQ(search.trim()), 350);
    return () => clearTimeout(id);
  }, [search]);

  const transcripts = useQuery({
    queryKey: ['transcripts', q],
    queryFn: () => api.get<{ transcripts: Transcript[] }>(`/transcripts${qs({ q })}`),
    placeholderData: keepPreviousData,
  });
  const rows = transcripts.data?.transcripts ?? [];

  return (
    <>
      <PageHeader title="Transcripts" description="Archived copies of ticket conversations, including internal notes. Saved automatically when a ticket is resolved or closed." />
      <div className="relative max-w-xs">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="Search subject, company or #ID" className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <Card className="gap-0 overflow-hidden py-0">
        {transcripts.isPending ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon={Archive} title={q ? 'No matching transcripts' : 'No transcripts yet'} description={q ? undefined : 'Transcripts appear here once tickets are resolved or closed.'} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead className="w-20 pl-4">Ticket</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead className="hidden md:table-cell">Reason</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Messages</TableHead>
                <TableHead className="hidden lg:table-cell">Saved</TableHead>
                <TableHead className="w-28 pr-4 text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((tr) => (
                <TableRow key={tr.id}>
                  <TableCell className="pl-4 font-mono text-xs">
                    <Link to={`/tickets/${tr.ticket_id}`} className="text-muted-foreground hover:text-foreground hover:underline">
                      #{tr.ticket_id}
                    </Link>
                  </TableCell>
                  <TableCell className="max-w-0">
                    <div className="truncate font-medium">{tr.subject}</div>
                    <div className="truncate text-xs text-muted-foreground">{tr.company_name}</div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <Badge variant="outline">{REASONS[tr.reason] ?? tr.reason}</Badge>
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums sm:table-cell">{tr.message_count}</TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">
                    {formatDateTime(tr.created_at)}
                    {tr.created_by_name && <div className="text-xs">by {tr.created_by_name}</div>}
                  </TableCell>
                  <TableCell className="pr-4 text-right">
                    <Button variant="outline" size="sm" asChild>
                      <a href={apiHref(`/api/transcripts/${tr.id}/download`)}>
                        <Download />
                        {fileSize(tr.size)}
                      </a>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </>
  );
}
