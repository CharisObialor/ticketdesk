import { useMemo, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ClipboardPaste, HardHat, Loader2, MessageCircle, MoreHorizontal, Pencil, Phone, Plus, Search, Trash2 } from 'lucide-react';
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
import { useTechnicians } from '@/hooks/use-technicians';
import { api, errorMessage } from '@/lib/api';
import { international } from '@/lib/phone';
import type { Technician } from '@/lib/types';

// Field technicians' names and numbers. They do not sign in to the portal; jobs reach them by WhatsApp or text.
export default function TechniciansPage() {
  const { isAdmin } = useSession();
  const techs = useTechnicians();
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Technician | 'new' | null>(null);
  const [pasting, setPasting] = useState(false);
  const [removing, setRemoving] = useState<Technician | null>(null);
  const term = q.trim().toLowerCase();
  const list = (techs.data?.technicians ?? []).filter((t) => !term || `${t.name} ${t.phone ?? ''} ${t.area ?? ''}`.toLowerCase().includes(term));

  return (
    <>
      <PageHeader
        title="Technicians"
        description="Contact list for field technicians. They do not sign in to the portal; send them jobs with Message engineer on a ticket."
        actions={
          isAdmin && (
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setPasting(true)}>
                <ClipboardPaste />
                Paste list
              </Button>
              <Button onClick={() => setEditing('new')}>
                <Plus />
                Add technician
              </Button>
            </div>
          )
        }
      />
      <div className="relative max-w-xs">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="Search name, number or area" className="pl-8" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {techs.isPending ? (
        <Skeleton className="h-48" />
      ) : list.length === 0 ? (
        <EmptyState
          icon={HardHat}
          title={term ? 'No technicians match' : 'No technicians yet'}
          description={term ? 'Try another name, number or area.' : isAdmin ? 'Add your field technicians and their phone numbers.' : 'An admin adds technicians here.'}
        />
      ) : (
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead className="hidden md:table-cell">Area</TableHead>
                <TableHead className="hidden lg:table-cell">Notes</TableHead>
                {isAdmin && <TableHead className="w-10" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((t) => (
                <TableRow key={t.id} className={!t.is_active ? 'text-muted-foreground' : undefined}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      {t.name}
                      {!t.is_active && <Badge variant="outline">Inactive</Badge>}
                    </div>
                    {t.area && <div className="text-xs font-normal text-muted-foreground md:hidden">{t.area}</div>}
                  </TableCell>
                  <TableCell>
                    {t.phone ? (
                      <div className="flex items-center gap-3">
                        <a href={`tel:+${international(t.phone)}`} className="inline-flex items-center gap-1.5 text-primary hover:underline">
                          <Phone className="size-3.5" />
                          {t.phone}
                        </a>
                        <a
                          href={`https://wa.me/${international(t.phone)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-muted-foreground hover:text-primary"
                          aria-label={`WhatsApp ${t.name}`}
                        >
                          <MessageCircle className="size-4" />
                        </a>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{t.area || '-'}</TableCell>
                  <TableCell className="hidden max-w-xs truncate text-muted-foreground lg:table-cell">{t.notes || '-'}</TableCell>
                  {isAdmin && (
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="size-8" aria-label={`Actions for ${t.name}`}>
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => setEditing(t)}>
                            <Pencil />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem variant="destructive" onSelect={() => setRemoving(t)}>
                            <Trash2 />
                            Remove
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      {editing && <TechnicianDialog technician={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {pasting && <PasteTechniciansDialog onClose={() => setPasting(false)} />}
      {removing && <RemoveTechnicianDialog technician={removing} onClose={() => setRemoving(null)} />}
    </>
  );
}

function TechnicianDialog({ technician, onClose }: { technician: Technician | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(technician?.name ?? '');
  const [phone, setPhone] = useState(technician?.phone ?? '');
  const [area, setArea] = useState(technician?.area ?? '');
  const [notes, setNotes] = useState(technician?.notes ?? '');
  const [active, setActive] = useState(technician?.is_active ?? true);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const body = { name, phone, area, notes, is_active: active };
    try {
      if (technician) await api.patch(`/technicians/${technician.id}`, body);
      else await api.post('/technicians', body);
      qc.invalidateQueries({ queryKey: ['technicians'] });
      toast.success(technician ? 'Technician updated' : `${name.trim()} added`);
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
            <DialogTitle>{technician ? `Edit ${technician.name}` : 'Add a technician'}</DialogTitle>
            <DialogDescription>Only the support team sees technicians' details. Clients never do.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="tech-name">Name *</Label>
              <Input id="tech-name" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="tech-phone">Phone number</Label>
              <Input id="tech-phone" type="tel" maxLength={40} placeholder="0803 123 4567" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="tech-area">Area</Label>
            <Input id="tech-area" maxLength={190} placeholder="Where they work, for example Ikeja and Alimosho" value={area} onChange={(e) => setArea(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="tech-notes">Notes</Label>
            <Textarea id="tech-notes" rows={3} maxLength={2000} placeholder="Skills, second number, availability" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          {technician && (
            <label className="flex items-center justify-between gap-3 text-sm">
              <span>
                Active
                <span className="block text-xs text-muted-foreground">Inactive technicians are not offered in Message engineer.</span>
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
              {technician ? 'Save' : 'Add technician'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// One technician per line: Name, Phone, Area, Notes. Columns copied from a spreadsheet (tab-separated) work too.
function parseTechnicians(text: string) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cells = (line.includes('\t') ? line.split('\t') : line.split(',')).map((c) => c.trim());
    if (!cells[0] || /^(name|technician)s?$/i.test(cells[0])) continue; // blank or a header row
    rows.push({ name: cells[0], phone: cells[1] ?? '', area: cells[2] ?? '', notes: cells.slice(3).filter(Boolean).join(', ') });
  }
  return rows;
}

function PasteTechniciansDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const rows = useMemo(() => parseTechnicians(text), [text]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.post<{ added: number; skipped: string[] }>('/technicians', { technicians: rows });
      qc.invalidateQueries({ queryKey: ['technicians'] });
      toast.success(`${r.added} technician${r.added === 1 ? '' : 's'} added`, {
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
            <DialogTitle>Paste a list of technicians</DialogTitle>
            <DialogDescription>
              One technician per line: Name, Phone, Area, Notes. You can also copy the columns straight from a spreadsheet. Anyone already on the list with the
              same name and number is skipped.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            rows={10}
            className="font-mono text-xs"
            placeholder={'Musa Bello, 0803 123 4567, Ikeja\nChidi Okafor, 0805 765 4321, Lekki'}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          {rows.length > 0 && (
            <p className="text-sm text-muted-foreground">
              {rows.length} technician{rows.length === 1 ? '' : 's'} found. First: {rows[0].name}
              {rows[0].phone ? `, ${rows[0].phone}` : ''}
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
              Add {rows.length || ''} technician{rows.length === 1 ? '' : 's'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RemoveTechnicianDialog({ technician, onClose }: { technician: Technician; onClose: () => void }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  async function remove() {
    setBusy(true);
    try {
      await api.delete(`/technicians/${technician.id}`);
      qc.invalidateQueries({ queryKey: ['technicians'] });
      toast.success(`${technician.name} removed`);
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
          <DialogTitle>Remove {technician.name}?</DialogTitle>
          <DialogDescription>
            They are taken off the contact list. Job messages already sent stay recorded on their tickets. To keep their details but stop offering them, edit
            them and turn off Active instead.
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
