import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { MapPin, Search } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState, PageHeader } from '@/components/common';
import { api } from '@/lib/api';
import { timeAgo } from '@/lib/format';

interface ClientSite {
  id: number;
  code: string;
  location: string | null;
  details: string | null;
  open_count: number;
  total_count: number;
  last_ticket_at: string | null;
}

// The client's sites, each with its open and past tickets.
export default function ClientSitesPage() {
  const query = useQuery({ queryKey: ['client-sites'], queryFn: () => api.get<{ sites: ClientSite[] }>('/client/sites') });
  const [q, setQ] = useState('');
  const term = q.trim().toLowerCase();
  const list = (query.data?.sites ?? []).filter((s) => !term || `${s.code} ${s.location ?? ''}`.toLowerCase().includes(term));
  return (
    <>
      <PageHeader title="Sites" description="Your sites and the tickets raised for each. Click a site to see its tickets." />
      <div className="relative max-w-xs">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-8" placeholder="Search site ID or location" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {query.isPending ? (
        <Skeleton className="h-48" />
      ) : list.length === 0 ? (
        <EmptyState icon={MapPin} title={term ? 'No sites match' : 'No sites yet'} description={term ? 'Try another site ID or place.' : 'Our team adds your sites here.'} />
      ) : (
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Site ID</TableHead>
                <TableHead className="hidden md:table-cell">Location</TableHead>
                <TableHead className="text-right">Open</TableHead>
                <TableHead className="text-right">All tickets</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Last ticket</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((s) => (
                <TableRow key={s.id} className="cursor-pointer">
                  <TableCell className="font-medium">
                    <Link to={`/tickets?view=all&site_id=${s.id}&site=${encodeURIComponent(s.code)}`} className="hover:underline">
                      {s.code}
                    </Link>
                    {s.location && <div className="text-xs font-normal text-muted-foreground md:hidden">{s.location}</div>}
                  </TableCell>
                  <TableCell className="hidden max-w-sm truncate text-muted-foreground md:table-cell">{s.location || '-'}</TableCell>
                  <TableCell className={s.open_count ? 'text-right font-medium tabular-nums' : 'text-right text-muted-foreground tabular-nums'}>{s.open_count}</TableCell>
                  <TableCell className="text-right tabular-nums">{s.total_count}</TableCell>
                  <TableCell className="hidden text-right text-xs text-muted-foreground sm:table-cell">{s.last_ticket_at ? timeAgo(s.last_ticket_at) : '-'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </>
  );
}
