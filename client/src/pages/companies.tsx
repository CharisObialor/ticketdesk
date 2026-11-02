import { useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Building2,
  Contact,
  FileChartColumn,
  ImageUp,
  Mail,
  Phone,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Ticket as TicketIcon,
  Trash2,
  Users,
  Timer,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { DeleteForeverDialog } from '@/components/delete-forever-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { CompanyLogo, EmptyState, PageHeader } from '@/components/common';
import { optimiseImage } from '@/lib/image';
import { useSession } from '@/hooks/use-session';
import { CompanySlaDialog, slaSummary } from '@/components/sla-editor';
import { CompanySites } from '@/components/company-sites';
import { targetsFor } from '@/lib/sla';
import { api, errorMessage } from '@/lib/api';
import { PRIORITY_LABELS, duration, formatDate } from '@/lib/format';
import type { Company } from '@/lib/types';

export default function CompaniesPage() {
  const { isAdmin, user } = useSession();
  // Only the account owner can delete a company permanently.
  const isOwner = !!user?.is_owner;
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Company | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Company | null>(null);
  const [viewingId, setViewingId] = useState<number | null>(null);
  const companies = useQuery({ queryKey: ['companies'], queryFn: () => api.get<{ companies: Company[] }>('/companies') });

  const term = search.trim().toLowerCase();
  const rows = (companies.data?.companies ?? []).filter(
    (c) => !term || [c.name, c.email_domain, c.rc_number, ...c.contacts.map((p) => p.email)].some((v) => (v ?? '').toLowerCase().includes(term))
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
          <EmptyState
            icon={Building2}
            title={term ? 'No matching companies' : 'No companies yet'}
            description={term ? undefined : 'Add a client company to start inviting its users.'}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead className="pl-4">Company</TableHead>
                <TableHead className="hidden md:table-cell">RC number</TableHead>
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
                <ContextMenu key={c.id}>
                  <ContextMenuTrigger asChild>
                    <TableRow className="cursor-pointer" onClick={() => setViewingId(c.id)}>
                      <TableCell className="pl-4">
                        <div className="flex items-center gap-3">
                          <CompanyLogo src={c.logo_url} name={c.name} />
                          <div className="min-w-0">
                            <div className="truncate font-medium">{c.name}</div>
                            <div className="text-xs text-muted-foreground">Since {formatDate(c.created_at)}</div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground tabular-nums md:table-cell">{c.rc_number || '-'}</TableCell>
                      <TableCell className="hidden text-muted-foreground md:table-cell">{c.email_domain ? `@${c.email_domain}` : '-'}</TableCell>
                      <TableCell className="text-right tabular-nums">{c.user_count}</TableCell>
                      <TableCell className="text-right tabular-nums">{c.open_tickets}</TableCell>
                      <TableCell className="hidden text-right tabular-nums sm:table-cell">{c.total_tickets}</TableCell>
                      <TableCell className="hidden lg:table-cell">
                        <Badge variant={c.is_active ? 'secondary' : 'outline'}>{c.is_active ? 'Active' : 'Disabled'}</Badge>
                      </TableCell>
                      <TableCell className="pr-4" onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${c.name}`}>
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setViewingId(c.id)}>
                              <Contact />
                              Details and contacts
                            </DropdownMenuItem>
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
                            {isOwner && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem variant="destructive" onClick={() => setDeleting(c)}>
                                  <Trash2 />
                                  Delete permanently
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  </ContextMenuTrigger>
                  <ContextMenuContent className="w-56">
                    <ContextMenuItem onClick={() => setViewingId(c.id)}>
                      <Contact />
                      Details and contacts
                    </ContextMenuItem>
                    {isAdmin && (
                      <ContextMenuItem asChild>
                        <Link to={`/reports?company=${c.id}`}>
                          <FileChartColumn />
                          Generate report
                        </Link>
                      </ContextMenuItem>
                    )}
                    {isAdmin && (
                      <ContextMenuItem onClick={() => setEditing(c)}>
                        <Pencil />
                        Edit company
                      </ContextMenuItem>
                    )}
                    <ContextMenuSeparator />
                    <ContextMenuItem asChild>
                      <Link to={`/tickets?view=open&company_id=${c.id}`}>
                        <TicketIcon />
                        View open tickets
                      </Link>
                    </ContextMenuItem>
                    <ContextMenuItem asChild>
                      <Link to={`/users?company_id=${c.id}`}>
                        <Users />
                        View users
                      </Link>
                    </ContextMenuItem>
                    {c.contacts.some((p) => p.is_active) && (
                      <ContextMenuItem asChild>
                        <a
                          href={`mailto:${c.contacts
                            .filter((p) => p.is_active)
                            .map((p) => p.email)
                            .join(',')}`}
                        >
                          <Mail />
                          Email everyone
                        </a>
                      </ContextMenuItem>
                    )}
                    {isOwner && (
                      <>
                        <ContextMenuSeparator />
                        <ContextMenuItem variant="destructive" onClick={() => setDeleting(c)}>
                          <Trash2 />
                          Delete permanently
                        </ContextMenuItem>
                      </>
                    )}
                  </ContextMenuContent>
                </ContextMenu>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
      <CompanySheet
        company={(companies.data?.companies ?? []).find((c) => c.id === viewingId) ?? null}
        onClose={() => setViewingId(null)}
        onEdit={isAdmin ? (c) => setEditing(c) : undefined}
      />
      {editing && <CompanyDialog company={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {deleting && <DeleteCompanyDialog company={deleting} onClose={() => setDeleting(null)} />}
    </>
  );
}

// Permanent deletion of a client company, with a count of everything that goes with it.
function DeleteCompanyDialog({ company, onClose }: { company: Company; onClose: () => void }) {
  const qc = useQueryClient();
  const usage = useQuery({
    queryKey: ['company-usage', company.id],
    queryFn: () => api.get<{ usage: { tickets: number; users: number; groups: number; sites: number } }>(`/companies/${company.id}/usage`),
  });
  const u = usage.data?.usage;
  const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
  return (
    <DeleteForeverDialog
      title={`Delete ${company.name}`}
      confirmWord={company.name}
      onClose={onClose}
      onConfirm={async () => {
        await api.delete(`/companies/${company.id}`);
        toast.success(`${company.name} was deleted`);
        for (const key of ['companies', 'users', 'tickets', 'chats', 'dashboard']) qc.invalidateQueries({ queryKey: [key] });
      }}
    >
      <p>The company is removed with everything that belongs to it:</p>
      {u ? (
        <ul className="list-disc space-y-1 pl-5">
          <li>{n(u.tickets, 'ticket', 'tickets')}, with their conversations, files, visits, sign-offs and ratings</li>
          <li>{n(u.users, 'client account', 'client accounts')}</li>
          <li>{n(u.groups, 'group chat', 'group chats')}</li>
          <li>{n(u.sites, 'site', 'sites')}, and the company logo</li>
        </ul>
      ) : (
        <p className="text-muted-foreground">{usage.isError ? errorMessage(usage.error) : 'Counting...'}</p>
      )}
      <p className="text-muted-foreground">
        Reports will no longer include its tickets. To stop its people signing in but keep the history, edit the company and turn it off instead.
      </p>
    </DeleteForeverDialog>
  );
}

// Monthly statement: which client contacts get last month's figures by email on the 1st, and a send-now button.
function StatementSection({ company }: { company: Company }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const recipients = company.statement_recipients ?? [];
  const people = company.contacts.filter((p) => p.is_active);

  async function setRecipients(next: number[]) {
    setBusy(true);
    try {
      await api.patch(`/companies/${company.id}`, { statement_recipients: next });
      qc.invalidateQueries({ queryKey: ['companies'] });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  async function sendNow() {
    setBusy(true);
    try {
      const r = await api.post<{ sent: number }>(`/companies/${company.id}/statement`);
      toast.success(`Last month's statement sent to ${r.sent} ${r.sent === 1 ? 'person' : 'people'}`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="type-h6">Monthly statement</h3>
          <p className="text-xs text-muted-foreground">Emailed on the 1st of each month with last month's figures.</p>
        </div>
        <Button variant="outline" size="sm" onClick={sendNow} disabled={busy || !recipients.length}>
          {busy && <Loader2 className="animate-spin" />}
          Send now
        </Button>
      </div>
      {people.length === 0 ? (
        <p className="text-sm text-muted-foreground">Add people to this company first.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {people.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <span className="min-w-0 truncate">
                {p.name}
                {p.job_title && <span className="text-xs text-muted-foreground"> · {p.job_title}</span>}
              </span>
              <Switch
                checked={recipients.includes(p.id)}
                disabled={busy}
                onCheckedChange={(on) => setRecipients(on ? [...recipients, p.id] : recipients.filter((id) => id !== p.id))}
                aria-label={`Send the monthly statement to ${p.name}`}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// Company profile with everyone registered under it, each with a mailto link.
function CompanySheet({ company, onClose, onEdit }: { company: Company | null; onClose: () => void; onEdit?: (c: Company) => void }) {
  const active = company?.contacts.filter((p) => p.is_active) ?? [];
  const emailAll = active.length ? `mailto:${active.map((p) => p.email).join(',')}` : null;
  const { app } = useSession();
  const [slaOpen, setSlaOpen] = useState(false);
  const targets = company ? targetsFor(app?.sla, company.id) : null;
  return (
    <Sheet open={!!company} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
        {company && (
          <>
            <SheetHeader className="border-b">
              <div className="flex items-center gap-3 pr-6">
                <CompanyLogo src={company.logo_url} name={company.name} className="size-14" />
                <div className="min-w-0">
                  <SheetTitle className="truncate">{company.name}</SheetTitle>
                  <SheetDescription>{company.rc_number ? company.rc_number : 'No RC number recorded'}</SheetDescription>
                </div>
              </div>
            </SheetHeader>
            <div className="space-y-6 p-4">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                <div>
                  <dt className="text-muted-foreground">Email domain</dt>
                  <dd className="font-medium">{company.email_domain ? `@${company.email_domain}` : '-'}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Status</dt>
                  <dd className="font-medium">{company.is_active ? 'Active' : 'Disabled'}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Open tickets</dt>
                  <dd className="font-medium tabular-nums">{company.open_tickets}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Total tickets</dt>
                  <dd className="font-medium tabular-nums">{company.total_tickets}</dd>
                </div>
                {company.notes && (
                  <div className="col-span-2">
                    <dt className="text-muted-foreground">Internal notes</dt>
                    <dd className="whitespace-pre-wrap">{company.notes}</dd>
                  </div>
                )}
              </dl>

              <section className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h3 className="type-h6">Service levels (SLA)</h3>
                    <p className="text-xs text-muted-foreground">{slaSummary(company.sla)}</p>
                  </div>
                  {onEdit && (
                    <Button variant="outline" size="sm" onClick={() => setSlaOpen(true)}>
                      <Timer />
                      Edit SLA
                    </Button>
                  )}
                </div>
                {targets && (
                  <table className="w-full text-sm">
                    <thead className="text-xs text-muted-foreground">
                      <tr>
                        <th className="pb-1 text-left font-normal">{targets.categories.length ? 'Fault category' : 'Priority'}</th>
                        {!targets.categories.length && <th className="pb-1 text-left font-normal">Respond</th>}
                        <th className="pb-1 text-right font-normal">Resolve</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {targets.categories.length
                        ? targets.categories.map((c) => (
                            <tr key={c.name}>
                              <td className="py-1.5">
                                {c.name} <span className="text-xs text-muted-foreground">({PRIORITY_LABELS[c.priority]})</span>
                              </td>
                              <td className="py-1.5 text-right tabular-nums">{duration(c.resolution ?? targets.resolution[c.priority])}</td>
                            </tr>
                          ))
                        : (['urgent', 'high', 'normal', 'low'] as const).map((p) => (
                            <tr key={p}>
                              <td className="py-1.5">{PRIORITY_LABELS[p]}</td>
                              <td className="py-1.5 tabular-nums">{duration(targets.response[p])}</td>
                              <td className="py-1.5 text-right tabular-nums">{duration(targets.resolution[p])}</td>
                            </tr>
                          ))}
                    </tbody>
                  </table>
                )}
              </section>
              {slaOpen && <CompanySlaDialog company={company} open={slaOpen} onOpenChange={setSlaOpen} />}

              <CompanySites company={company} canEdit={!!onEdit} />
              {onEdit && <StatementSection company={company} />}

              <section className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="type-h6">People ({company.contacts.length})</h3>
                  {emailAll && (
                    <Button variant="outline" size="sm" asChild>
                      <a href={emailAll}>
                        <Mail />
                        Email everyone
                      </a>
                    </Button>
                  )}
                </div>
                {company.contacts.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nobody is registered under this company yet.</p>
                ) : (
                  <ul className="divide-y rounded-lg border">
                    {company.contacts.map((p) => (
                      <li key={p.id} className="space-y-1 p-3">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-medium">{p.name}</span>
                          {!p.is_active && <Badge variant="outline">Disabled</Badge>}
                        </div>
                        {p.job_title && <div className="text-xs text-muted-foreground">{p.job_title}</div>}
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                          <a href={`mailto:${p.email}`} className="inline-flex min-w-0 items-center gap-1.5 text-primary hover:underline">
                            <Mail className="size-3.5 shrink-0" />
                            <span className="truncate">{p.email}</span>
                          </a>
                          {p.phone && (
                            <a href={`tel:${p.phone.replace(/[^+\d]/g, '')}`} className="inline-flex items-center gap-1.5 text-primary hover:underline">
                              <Phone className="size-3.5" />
                              {p.phone}
                            </a>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" asChild>
                  <Link to={`/tickets?view=open&company_id=${company.id}`}>
                    <TicketIcon />
                    Open tickets
                  </Link>
                </Button>
                {onEdit && (
                  <Button size="sm" asChild>
                    <Link to={`/reports?company=${company.id}`}>
                      <FileChartColumn />
                      Generate report
                    </Link>
                  </Button>
                )}
                <Button variant="outline" size="sm" asChild>
                  <Link to={`/users?company_id=${company.id}`}>
                    <Users />
                    Manage users
                  </Link>
                </Button>
                {onEdit && (
                  <Button variant="outline" size="sm" onClick={() => onEdit(company)}>
                    <Pencil />
                    Edit company
                  </Button>
                )}
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function CompanyDialog({ company, onClose }: { company: Company | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(company?.name ?? '');
  const [domain, setDomain] = useState(company?.email_domain ?? '');
  const [notes, setNotes] = useState(company?.notes ?? '');
  const [rc, setRc] = useState(company?.rc_number ?? '');
  // A newly chosen logo file, or 'remove' to clear the current one.
  const [logo, setLogo] = useState<File | 'remove' | null>(null);
  const [preview, setPreview] = useState<string | null>(company?.logo_url ?? null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function pickLogo(file: File | undefined) {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return toast.error('Choose a PNG, JPG or WebP image');
    const small = await optimiseImage(file);
    if (small.size > 2 * 1024 * 1024) return toast.error('Logos can be up to 2 MB');
    setLogo(small);
    setPreview(URL.createObjectURL(small));
  }
  const [active, setActive] = useState(company ? !!company.is_active : true);
  const [siteContacts, setSiteContacts] = useState(!!Number(company?.site_contacts));
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const body = { name, email_domain: domain, notes, rc_number: rc, site_contacts: siteContacts, is_active: active };
    try {
      const saved = company
        ? (await api.patch<{ company: Company }>(`/companies/${company.id}`, body)).company
        : (await api.post<{ company: Company }>('/companies', body)).company;
      if (logo === 'remove') await api.delete(`/companies/${saved.id}/logo`);
      else if (logo) {
        const fd = new FormData();
        fd.append('logo', logo);
        await api.post(`/companies/${saved.id}/logo`, fd);
      }
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
          <div className="flex items-center gap-4">
            <CompanyLogo src={preview} name={name || 'Company'} className="size-16" />
            <div className="grid gap-1.5">
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                  <ImageUp />
                  {preview ? 'Change logo' : 'Upload logo'}
                </Button>
                {preview && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setLogo(company?.logo_url ? 'remove' : null);
                      setPreview(null);
                    }}
                  >
                    <Trash2 />
                    Remove
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">PNG, JPG or WebP, up to 2 MB. A square logo looks best.</p>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => {
                  pickLogo(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="company-name">Company name *</Label>
            <Input id="company-name" required maxLength={190} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="company-rc">RC number</Label>
            <Input id="company-rc" placeholder="RC 1234567" maxLength={40} value={rc} onChange={(e) => setRc(e.target.value)} />
            <p className="text-xs text-muted-foreground">CAC registration number (RC for companies, BN for business names).</p>
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
              <Label htmlFor="company-site-contacts">Ask for OM and FSE</Label>
              <p className="text-xs text-muted-foreground">Clients must give the site's Operations Manager and Field Service Engineer on each new ticket.</p>
            </div>
            <Switch id="company-site-contacts" checked={siteContacts} onCheckedChange={setSiteContacts} />
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
