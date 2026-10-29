import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Loader2, MoreHorizontal, Pencil, Plus, Search, Ticket as TicketIcon, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { EmptyState, PageHeader } from '@/components/common';
import { useSession } from '@/hooks/use-session';
import { api, errorMessage } from '@/lib/api';
import { formatDate } from '@/lib/format';
import type { Company } from '@/lib/types';

export default function CompaniesPage() {
  const { isAdmin } = useSession();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Company | 'new' | null>(null);
  const companies = useQuery({ queryKey: ['companies'], queryFn: () => api.get<{ companies: Company[] }>('/companies') });

  const term = search.trim().toLowerCase();
  const rows = (companies.data?.companies ?? []).filter(
    (c) => !term || c.name.toLowerCase().includes(term) || (c.email_domain ?? '').toLowerCase().includes(term)
  );

  return (
    <>
      <PageHeader
        title="Companies"
        description="Client organisations with access to the support portal."
        actions={
          isAdmin && (
            <Button onClick={() => setEditing('new')}>
              <Plus />
              Add company
            </Button>
          )
        }
      />
      <div className="relative max-w-xs">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="Search companies" className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <Card className="gap-0 overflow-hidden py-0">
        {companies.isPending ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon={Building2} title={term ? 'No matching companies' : 'No companies yet'} description={term ? undefined : 'Add a client company to start inviting its users.'} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead className="pl-4">Company</TableHead>
                <TableHead className="hidden md:table-cell">Email domain</TableHead>
                <TableHead className="text-right">Users</TableHead>
                <TableHead className="text-right">Open tickets</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Total tickets</TableHead>
                <TableHead className="hidden lg:table-cell">Status</TableHead>
                <TableHead className="w-12 pr-4" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="pl-4">
                    <div className="font-medium">{c.name}</div>
                    <div className="text-xs text-muted-foreground">Since {formatDate(c.created_at)}</div>
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground md:table-cell">{c.email_domain ? `@${c.email_domain}` : '-'}</TableCell>
                  <TableCell className="text-right tabular-nums">{c.user_count}</TableCell>
                  <TableCell className="text-right tabular-nums">{c.open_tickets}</TableCell>
                  <TableCell className="hidden text-right tabular-nums sm:table-cell">{c.total_tickets}</TableCell>
                  <TableCell className="hidden lg:table-cell">
                    <Badge variant={c.is_active ? 'secondary' : 'outline'}>{c.is_active ? 'Active' : 'Disabled'}</Badge>
                  </TableCell>
                  <TableCell className="pr-4">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${c.name}`}>
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem asChild>
                          <Link to={`/tickets?view=open&company_id=${c.id}`}>
                            <TicketIcon />
                            View open tickets
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem asChild>
                          <Link to={`/users?company_id=${c.id}`}>
                            <Users />
                            View users
                          </Link>
                        </DropdownMenuItem>
                        {isAdmin && (
                          <DropdownMenuItem onClick={() => setEditing(c)}>
                            <Pencil />
                            Edit company
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
      {editing && <CompanyDialog company={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function CompanyDialog({ company, onClose }: { company: Company | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(company?.name ?? '');
  const [domain, setDomain] = useState(company?.email_domain ?? '');
  const [notes, setNotes] = useState(company?.notes ?? '');
  const [active, setActive] = useState(company ? !!company.is_active : true);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const body = { name, email_domain: domain, notes, is_active: active };
    try {
      if (company) await api.patch(`/companies/${company.id}`, body);
      else await api.post('/companies', body);
      toast.success(company ? 'Company updated' : 'Company added');
      qc.invalidateQueries({ queryKey: ['companies'] });
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{company ? 'Edit company' : 'Add company'}</DialogTitle>
            <DialogDescription>{company ? 'Update the company details.' : 'Create a client company. You can invite its users afterwards.'}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="company-name">Company name *</Label>
            <Input id="company-name" required maxLength={190} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="company-domain">Email domain</Label>
            <Input id="company-domain" placeholder="example.com" value={domain} onChange={(e) => setDomain(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="company-notes">Internal notes</Label>
            <Textarea id="company-notes" rows={3} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div className="space-y-0.5">
              <Label htmlFor="company-active">Active</Label>
              <p className="text-xs text-muted-foreground">Users of disabled companies cannot sign in.</p>
            </div>
            <Switch id="company-active" checked={active} onCheckedChange={setActive} />
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="animate-spin" />}
              {company ? 'Save changes' : 'Add company'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
