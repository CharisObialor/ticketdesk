import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useSession } from '@/hooks/use-session';
import { api, errorMessage } from '@/lib/api';
import { PRIORITY_LABELS } from '@/lib/format';
import type { Company, CompanySla, FaultCategory, Priority, SlaTargets } from '@/lib/types';

const PRIORITIES: Priority[] = ['urgent', 'high', 'normal', 'low'];
const UNITS = [
  { value: 'minutes', label: 'minutes', min: 1 },
  { value: 'hours', label: 'hours', min: 60 },
  { value: 'days', label: 'days', min: 1440 },
  { value: 'weeks', label: 'weeks', min: 10080 },
] as const;
type Unit = (typeof UNITS)[number]['value'];

// Shows a number of minutes in the largest unit that divides it evenly (5 days, 72 hours, 4 weeks).
function split(min: number | null | undefined): { amount: string; unit: Unit } {
  if (!min) return { amount: '', unit: 'hours' };
  for (const u of [...UNITS].reverse()) if (min % u.min === 0) return { amount: String(min / u.min), unit: u.value };
  return { amount: String(min), unit: 'minutes' };
}

// A time entered as a number and a unit. Empty means "use the default", shown as the placeholder.
export function DurationInput({ value, onChange, placeholder }: { value: number | null; onChange: (v: number | null) => void; placeholder?: number }) {
  const [state, setState] = useState(() => split(value));
  const hint = placeholder ? split(placeholder) : null;
  function update(next: { amount: string; unit: Unit }) {
    setState(next);
    const n = Number(next.amount);
    onChange(next.amount === '' || !Number.isFinite(n) || n <= 0 ? null : Math.round(n * UNITS.find((u) => u.value === next.unit)!.min));
  }
  return (
    <div className="flex gap-1.5">
      <Input
        type="number"
        min="0"
        step="any"
        inputMode="decimal"
        className="h-8 w-20"
        placeholder={hint ? hint.amount : ''}
        value={state.amount}
        onChange={(e) => update({ ...state, amount: e.target.value })}
      />
      <Select value={state.amount === '' && hint ? hint.unit : state.unit} onValueChange={(u) => update({ ...state, unit: u as Unit })}>
        <SelectTrigger size="sm" className="w-24">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {UNITS.map((u) => (
            <SelectItem key={u.value} value={u.value}>
              {u.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

type Targets = Record<'response' | 'resolution', Partial<Record<Priority, number | null>>>;

function TargetsTable({ value, onChange, defaults }: { value: Targets; onChange: (v: Targets) => void; defaults?: SlaTargets }) {
  const set = (kind: 'response' | 'resolution', p: Priority, v: number | null) => onChange({ ...value, [kind]: { ...value[kind], [p]: v } });
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Priority</TableHead>
          <TableHead>First response within</TableHead>
          <TableHead>Resolve within</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {PRIORITIES.map((p) => (
          <TableRow key={p}>
            <TableCell className="font-medium">{PRIORITY_LABELS[p]}</TableCell>
            <TableCell>
              <DurationInput value={value.response[p] ?? null} onChange={(v) => set('response', p, v)} placeholder={defaults?.response[p]} />
            </TableCell>
            <TableCell>
              <DurationInput value={value.resolution[p] ?? null} onChange={(v) => set('resolution', p, v)} placeholder={defaults?.resolution[p]} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// System page: the targets every company gets unless it has its own.
export function DefaultSlaCard() {
  const qc = useQueryClient();
  const { isAdmin } = useSession();
  const query = useQuery({ queryKey: ['sla'], queryFn: () => api.get<{ defaults: SlaTargets }>('/sla') });
  const [draft, setDraft] = useState<Targets | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const value: Targets | null = draft ?? query.data?.defaults ?? null;
  const save = useMutation({
    mutationFn: (v: Targets) => api.put<{ defaults: SlaTargets }>('/sla', v),
    onSuccess: () => {
      toast.success('Default SLA saved');
      setDraft(null);
      qc.invalidateQueries({ queryKey: ['sla'] });
      qc.invalidateQueries({ queryKey: ['me'] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Service levels (SLA)</CardTitle>
        <CardDescription>
          Default time to send the first reply and to resolve a ticket, by priority. A company can have its own times and fault categories, set on the Companies page.
          What happens when these times are missed is set in the escalation rules below.
        </CardDescription>
      </CardHeader>
      <CardContent className={isAdmin ? '' : 'pointer-events-none opacity-80'}>
        {value ? <TargetsTable key={`${query.dataUpdatedAt}-${resetKey}`} value={value} onChange={setDraft} /> : <Skeleton className="h-48" />}
      </CardContent>
      {isAdmin && (
        <CardFooter className="justify-end gap-2">
          {draft && (
            <Button
              variant="ghost"
              onClick={() => {
                setDraft(null);
                setResetKey((k) => k + 1);
              }}
            >
              Discard changes
            </Button>
          )}
          <Button disabled={!draft || save.isPending} onClick={() => draft && save.mutate(draft)}>
            {save.isPending && <Loader2 className="animate-spin" />}
            Save SLA
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}

const emptyCategory = (): FaultCategory => ({ name: '', description: null, priority: 'high', resolution: null });

// Companies page: this company's own targets and fault categories (from its SLA contract).
export function CompanySlaDialog({ company, open, onOpenChange }: { company: Company; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const defaults = useQuery({ queryKey: ['sla'], queryFn: () => api.get<{ defaults: SlaTargets }>('/sla'), enabled: open });
  const own = company.sla ?? {};
  const [targets, setTargets] = useState<Targets>({ response: { ...own.response }, resolution: { ...own.resolution } });
  const [categories, setCategories] = useState<FaultCategory[]>(own.categories ?? []);
  const setCat = (i: number, patch: Partial<FaultCategory>) => setCategories((prev) => prev.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  const save = useMutation({
    mutationFn: () => {
      const strip = (r: Targets['response']) => Object.fromEntries(Object.entries(r).filter(([, v]) => v));
      const body: CompanySla = {
        response: strip(targets.response),
        resolution: strip(targets.resolution),
        categories: categories.filter((c) => c.name.trim()),
      };
      return api.patch<{ company: Company }>(`/companies/${company.id}`, { sla: body });
    },
    onSuccess: () => {
      toast.success(`SLA saved for ${company.name}`);
      qc.invalidateQueries({ queryKey: ['companies'] });
      qc.invalidateQueries({ queryKey: ['me'] });
      onOpenChange(false);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !save.isPending && onOpenChange(o)}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>SLA for {company.name}</DialogTitle>
          <DialogDescription>Leave a time empty to use the default (shown in grey). Fault categories replace the standard ticket categories for this company.</DialogDescription>
        </DialogHeader>

        <section className="space-y-2">
          <h3 className="type-h5">Times by priority</h3>
          <TargetsTable value={targets} onChange={setTargets} defaults={defaults.data?.defaults} />
        </section>

        <section className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="type-h5">Fault categories</h3>
              <p className="text-sm text-muted-foreground">Each category sets the ticket's priority and, optionally, its own time to resolve.</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => setCategories((prev) => [...prev, emptyCategory()])}>
              <Plus />
              Add category
            </Button>
          </div>
          {categories.length === 0 ? (
            <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">No fault categories. Tickets use the standard categories.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-48">Category</TableHead>
                  <TableHead>Typical faults</TableHead>
                  <TableHead className="w-28">Priority</TableHead>
                  <TableHead className="w-48">Resolve within</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {categories.map((c, i) => (
                  <TableRow key={i}>
                    <TableCell className="align-top">
                      <Input className="h-8" maxLength={60} placeholder="e.g. ATS" value={c.name} onChange={(e) => setCat(i, { name: e.target.value })} />
                    </TableCell>
                    <TableCell className="space-y-1.5 align-top">
                      <Input className="h-8" maxLength={300} placeholder="What this covers" value={c.description ?? ''} onChange={(e) => setCat(i, { description: e.target.value || null })} />
                      <Textarea
                        rows={2}
                        maxLength={2000}
                        className="min-h-0 text-xs"
                        placeholder="Template for the client (optional): what to describe for this fault"
                        value={c.template ?? ''}
                        onChange={(e) => setCat(i, { template: e.target.value || null })}
                      />
                      <Select value={String(c.photos_min ?? 0)} onValueChange={(v) => setCat(i, { photos_min: Number(v) })}>
                        <SelectTrigger size="sm" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {[0, 1, 2, 3, 4, 5].map((n) => (
                            <SelectItem key={n} value={String(n)}>
                              {n === 0 ? 'No photos required' : `Client must attach ${n} photo${n === 1 ? '' : 's'}`}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="align-top">
                      <Select value={c.priority} onValueChange={(v) => setCat(i, { priority: v as Priority })}>
                        <SelectTrigger size="sm" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PRIORITIES.map((p) => (
                            <SelectItem key={p} value={p}>
                              {PRIORITY_LABELS[p]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="align-top">
                      <DurationInput
                        value={c.resolution}
                        onChange={(v) => setCat(i, { resolution: v })}
                        placeholder={targets.resolution[c.priority] ?? defaults.data?.defaults.resolution[c.priority]}
                      />
                    </TableCell>
                    <TableCell className="align-top">
                      <Button variant="ghost" size="icon-sm" aria-label={`Remove ${c.name || 'category'}`} onClick={() => setCategories((prev) => prev.filter((_, j) => j !== i))}>
                        <Trash2 />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </section>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending && <Loader2 className="animate-spin" />}
            Save SLA
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// One line describing a company's SLA, for the company panel.
export function slaSummary(sla: CompanySla | null | undefined) {
  if (!sla) return 'Default service levels';
  const parts = [];
  const changed = Object.keys(sla.response ?? {}).length + Object.keys(sla.resolution ?? {}).length;
  if (changed) parts.push(`${changed} custom time${changed === 1 ? '' : 's'}`);
  if (sla.categories?.length) parts.push(`${sla.categories.length} fault categor${sla.categories.length === 1 ? 'y' : 'ies'}`);
  return parts.length ? parts.join(', ') : 'Default service levels';
}

