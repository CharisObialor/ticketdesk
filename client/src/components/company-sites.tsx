import { useMemo, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronsUpDown, ClipboardPaste, Loader2, MapPin, MoreHorizontal, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { Company, Site } from '@/lib/types';

// A company's sites. Staff can pass `all` to include inactive ones; clients only ever get their own active sites.
export function useSites(companyId: number | null | undefined, { all = false, enabled = true } = {}) {
  return useQuery({
    queryKey: ['sites', companyId, all],
    queryFn: () => api.get<{ sites: Site[] }>(`/sites?company_id=${companyId ?? ''}${all ? '&all=1' : ''}`),
    enabled: enabled && companyId != null,
  });
}

export const siteLabel = (s: Pick<Site, 'code' | 'location'>) => (s.location ? `${s.code} - ${s.location}` : s.code);

const matches = (s: Site, q: string) => !q || `${s.code} ${s.location ?? ''} ${s.details ?? ''}`.toLowerCase().includes(q.toLowerCase());

// Section on the company profile: the site list, with add, paste and edit for admins.
export function CompanySites({ company, canEdit }: { company: Company; canEdit: boolean }) {
  const sites = useSites(company.id, { all: canEdit });
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Site | 'new' | null>(null);
  const [pasting, setPasting] = useState(false);
  const [removing, setRemoving] = useState<Site | null>(null);
  const list = sites.data?.sites ?? [];
  const shown = list.filter((s) => matches(s, q));

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="type-h6">Sites ({list.length})</h3>
          <p className="text-xs text-muted-foreground">Clients choose the site ID when they log a ticket.</p>
        </div>
        {canEdit && (
          <div className="flex gap-1.5">
            <Button variant="outline" size="sm" onClick={() => setPasting(true)}>
              <ClipboardPaste />
              Paste list
            </Button>
            <Button size="sm" onClick={() => setEditing('new')}>
              <Plus />
              Add site
            </Button>
          </div>
        )}
      </div>
      {list.length > 6 && (
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search site ID or location" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      )}
      {sites.isPending ? (
        <div className="h-16 animate-pulse rounded-lg bg-muted" />
      ) : list.length === 0 ? (
        <p className="text-sm text-muted-foreground">No sites recorded yet.</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">No sites match "{q}".</p>
      ) : (
        <ul className="max-h-96 divide-y overflow-y-auto rounded-lg border">
          {shown.map((s) => (
            <li key={s.id} className="flex items-start gap-2 p-3">
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{s.code}</span>
                  {!s.is_active && <Badge variant="outline">Inactive</Badge>}
                </div>
                {s.location && (
                  <div className="flex items-start gap-1.5 text-sm">
                    <MapPin className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                    {s.location}
                  </div>
                )}
                {s.details && <p className="text-xs whitespace-pre-wrap text-muted-foreground">{s.details}</p>}
              </div>
              {canEdit && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="size-7" aria-label={`Actions for ${s.code}`}>
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => setEditing(s)}>
                      <Pencil />
                      Edit
                    </DropdownMenuItem>
                    <DropdownMenuItem variant="destructive" onSelect={() => setRemoving(s)}>
                      <Trash2 />
                      Remove
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing && <SiteDialog company={company} site={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {pasting && <PasteSitesDialog company={company} onClose={() => setPasting(false)} />}
      {removing && <RemoveSiteDialog site={removing} onClose={() => setRemoving(null)} />}
    </section>
  );
}

function SiteDialog({ company, site, onClose }: { company: Company; site: Site | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [code, setCode] = useState(site?.code ?? '');
  const [location, setLocation] = useState(site?.location ?? '');
  const [details, setDetails] = useState(site?.details ?? '');
  const [active, setActive] = useState(site?.is_active ?? true);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const body = { code, location, details, is_active: active };
    try {
      if (site) await api.patch(`/sites/${site.id}`, body);
      else await api.post(`/companies/${company.id}/sites`, body);
      qc.invalidateQueries({ queryKey: ['sites'] });
      toast.success(site ? 'Site updated' : `Site ${code.trim()} added`);
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
            <DialogTitle>{site ? `Edit site ${site.code}` : 'Add a site'}</DialogTitle>
            <DialogDescription>{company.name}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="site-code">Site ID *</Label>
            <Input id="site-code" required maxLength={60} placeholder="For example LAG-0123" value={code} onChange={(e) => setCode(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="site-location">Location</Label>
            <Input id="site-location" maxLength={255} placeholder="Address, town or state" value={location} onChange={(e) => setLocation(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="site-details">Site details</Label>
            <Textarea
              id="site-details"
              rows={4}
              maxLength={2000}
              placeholder="Equipment on site, access instructions, landmarks"
              value={details}
              onChange={(e) => setDetails(e.target.value)}
            />
          </div>
          {site && (
            <label className="flex items-center justify-between gap-3 text-sm">
              <span>
                Active
                <span className="block text-xs text-muted-foreground">Inactive sites are not offered on new tickets.</span>
              </span>
              <Switch checked={active} onCheckedChange={setActive} />
            </label>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="animate-spin" />}
              {site ? 'Save' : 'Add site'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// One site per line: Site ID, Location, Details. Columns copied from a spreadsheet (tab-separated) work too.
function parseSites(text: string) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cells = (line.includes('\t') ? line.split('\t') : line.split(',')).map((c) => c.trim());
    if (/^site\s*id$/i.test(cells[0])) continue; // a header row
    if (!cells[0]) continue;
    rows.push({ code: cells[0], location: cells[1] ?? '', details: cells.slice(2).filter(Boolean).join(', ') });
  }
  return rows;
}

function PasteSitesDialog({ company, onClose }: { company: Company; onClose: () => void }) {
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const rows = useMemo(() => parseSites(text), [text]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!rows.length) return toast.error('Paste at least one site');
    setBusy(true);
    try {
      const r = await api.post<{ added: number; skipped: string[] }>(`/companies/${company.id}/sites`, { sites: rows });
      qc.invalidateQueries({ queryKey: ['sites'] });
      toast.success(`${r.added} site${r.added === 1 ? '' : 's'} added`, {
        description: r.skipped.length ? `Already on the list: ${r.skipped.slice(0, 8).join(', ')}${r.skipped.length > 8 ? ` and ${r.skipped.length - 8} more` : ''}` : undefined,
      });
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Paste a list of sites</DialogTitle>
            <DialogDescription>
              One site per line: Site ID, Location, Details. You can also copy the columns straight from a spreadsheet. Site IDs already on the list are
              skipped.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            rows={10}
            className="font-mono text-xs"
            placeholder={'LAG-0123, Ikeja Lagos, 500kVA DT\nLAG-0124, Lekki Phase 1, Rooftop site'}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          {rows.length > 0 && (
            <p className="text-sm text-muted-foreground">
              {rows.length} site{rows.length === 1 ? '' : 's'} found. First: {siteLabel(rows[0])}
            </p>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={busy || !rows.length}>
              {busy && <Loader2 className="animate-spin" />}
              Add {rows.length || ''} site{rows.length === 1 ? '' : 's'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RemoveSiteDialog({ site, onClose }: { site: Site; onClose: () => void }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  async function remove() {
    setBusy(true);
    try {
      const r = await api.delete<{ archived: boolean }>(`/sites/${site.id}`);
      qc.invalidateQueries({ queryKey: ['sites'] });
      toast.success(r.archived ? `Site ${site.code} marked inactive` : `Site ${site.code} removed`, {
        description: r.archived ? 'Tickets refer to it, so it is kept for those tickets.' : undefined,
      });
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
        <DialogHeader>
          <DialogTitle>Remove site {site.code}?</DialogTitle>
          <DialogDescription>
            {site.ticket_count > 0
              ? `${site.ticket_count} ticket${site.ticket_count === 1 ? ' refers' : 's refer'} to this site, so it will be marked inactive instead and no longer offered on new tickets.`
              : 'It will no longer be offered on new tickets.'}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button variant="destructive" onClick={remove} disabled={busy}>
            {busy && <Loader2 className="animate-spin" />}
            Remove
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Searchable site list for the new ticket form; companies can have hundreds of sites.
export function SitePicker({
  sites,
  value,
  onChange,
  disabled,
  placeholder = 'Choose the site ID',
}: {
  sites: Site[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const chosen = sites.find((s) => String(s.id) === value);
  const shown = sites.filter((s) => matches(s, q)).slice(0, 100);
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQ('');
      }}
    >
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" role="combobox" aria-expanded={open} disabled={disabled} className="w-full justify-between font-normal">
          <span className={cn('truncate', !chosen && 'text-muted-foreground')}>{chosen ? siteLabel(chosen) : placeholder}</span>
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
        <div className="border-b p-2">
          <Input autoFocus placeholder="Search site ID or location" value={q} onChange={(e) => setQ(e.target.value)} className="h-8" />
        </div>
        <ul className="max-h-64 overflow-y-auto p-1" role="listbox">
          {shown.length === 0 && <li className="px-2 py-3 text-center text-sm text-muted-foreground">No sites match.</li>}
          {shown.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                role="option"
                aria-selected={String(s.id) === value}
                onClick={() => {
                  onChange(String(s.id));
                  setOpen(false);
                  setQ('');
                }}
                className="flex w-full items-start gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
              >
                <Check className={cn('mt-0.5 size-4 shrink-0', String(s.id) === value ? 'opacity-100' : 'opacity-0')} />
                <span className="min-w-0">
                  <span className="font-medium">{s.code}</span>
                  {s.location && <span className="block truncate text-xs text-muted-foreground">{s.location}</span>}
                </span>
              </button>
            </li>
          ))}
          {sites.filter((s) => matches(s, q)).length > shown.length && (
            <li className="px-2 py-1.5 text-xs text-muted-foreground">Keep typing to narrow the list.</li>
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
