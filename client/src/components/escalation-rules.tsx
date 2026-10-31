import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { DurationInput } from '@/components/sla-editor';
import { useSession } from '@/hooks/use-session';
import { api, errorMessage } from '@/lib/api';
import { PRIORITY_LABELS, duration } from '@/lib/format';
import type { Company, Priority, StaffMember } from '@/lib/types';

export interface EscalationRule {
  id: string;
  name: string;
  enabled: boolean;
  when: 'response' | 'resolution' | 'idle';
  after: number;
  level: number;
  priorities: Priority[];
  company_id: number | null;
  notify_admins: boolean;
  notify_assignee: boolean;
  notify_users: number[];
  set_priority: 'urgent' | 'high' | null;
  assign_to: number | null;
}

const PRIORITIES: Priority[] = ['urgent', 'high', 'normal', 'low'];
const WHEN_LABELS: Record<EscalationRule['when'], string> = {
  response: 'No first reply within the response time',
  resolution: 'Not resolved within the time to resolve',
  idle: 'No activity on the ticket',
};
const ANY = 'any';
const NONE = 'none';

// One line describing what a rule does, for the list.
function describe(r: EscalationRule, staff: StaffMember[], companies: Company[]) {
  const wait =
    r.when === 'idle' ? `after ${duration(r.after)} without activity` : r.after ? `${duration(r.after)} after the time runs out` : 'as soon as the time runs out';
  const who = [r.notify_admins && 'admins', r.notify_assignee && 'the assignee', ...r.notify_users.map((id) => staff.find((s) => s.id === id)?.name ?? 'a team member')]
    .filter(Boolean)
    .join(', ');
  const scope = [
    r.priorities.length ? r.priorities.map((p) => PRIORITY_LABELS[p]).join('/') + ' priority' : 'all priorities',
    r.company_id ? (companies.find((c) => c.id === r.company_id)?.name ?? 'one company') : 'all companies',
  ].join(', ');
  const extra = [r.set_priority && `raise to ${PRIORITY_LABELS[r.set_priority]}`, r.assign_to && `assign to ${staff.find((s) => s.id === r.assign_to)?.name ?? 'a team member'} if unassigned`]
    .filter(Boolean)
    .join('; ');
  return `${wait}. ${scope}. Alerts ${who || 'nobody'}${extra ? `; ${extra}` : ''}.`;
}

const blankRule = (): EscalationRule => ({
  id: '',
  name: '',
  enabled: true,
  when: 'resolution',
  after: 0,
  level: 2,
  priorities: [],
  company_id: null,
  notify_admins: true,
  notify_assignee: true,
  notify_users: [],
  set_priority: null,
  assign_to: null,
});

// System page: the escalation ladder. Admins edit; the team can see it.
export function EscalationRulesCard() {
  const qc = useQueryClient();
  const { isAdmin } = useSession();
  const query = useQuery({ queryKey: ['escalation'], queryFn: () => api.get<{ rules: EscalationRule[] }>('/escalation') });
  const staff = useQuery({ queryKey: ['staff'], queryFn: () => api.get<{ staff: StaffMember[] }>('/staff'), staleTime: 5 * 60_000 });
  const companies = useQuery({ queryKey: ['companies'], queryFn: () => api.get<{ companies: Company[] }>('/companies'), staleTime: 5 * 60_000 });
  const [draft, setDraft] = useState<EscalationRule[] | null>(null);
  const [editing, setEditing] = useState<{ rule: EscalationRule; index: number | null } | null>(null);
  const rules = draft ?? query.data?.rules ?? null;
  const staffList = staff.data?.staff ?? [];
  const companyList = companies.data?.companies ?? [];

  const save = useMutation({
    mutationFn: (list: EscalationRule[]) => api.put<{ rules: EscalationRule[] }>('/escalation', { rules: list }),
    onSuccess: (r) => {
      toast.success('Escalation rules saved');
      setDraft(null);
      qc.setQueryData(['escalation'], r);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const change = (next: EscalationRule[]) => setDraft(next);
  const sorted = (rules ?? []).map((r, i) => ({ r, i })).sort((a, b) => a.r.level - b.r.level);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Escalation rules</CardTitle>
        <CardDescription>
          When a ticket is escalated automatically, and who hears about it. Each rule moves a ticket up to its level once. Level 1 is the first alarm;
          use levels 2 and 3 for when it is still not sorted. People can still escalate a ticket by hand at any time.
        </CardDescription>
        {isAdmin && (
          <CardAction>
            <Button size="sm" variant="outline" onClick={() => setEditing({ rule: blankRule(), index: null })} disabled={!rules}>
              <Plus />
              Add rule
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        {!rules ? (
          <Skeleton className="h-32" />
        ) : rules.length === 0 ? (
          <p className="text-sm text-muted-foreground">No rules: tickets are only escalated by hand.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {sorted.map(({ r, i }) => (
              <li key={r.id || i} className="flex items-start gap-3 p-3">
                <Badge variant="outline" className="mt-0.5 shrink-0 tabular-nums">
                  Level {r.level}
                </Badge>
                <div className={r.enabled ? 'min-w-0 flex-1' : 'min-w-0 flex-1 opacity-60'}>
                  <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {r.name}
                    {!r.enabled && <Badge variant="secondary">Off</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {WHEN_LABELS[r.when]}, {describe(r, staffList, companyList)}
                  </p>
                </div>
                {isAdmin && (
                  <div className="flex shrink-0 items-center gap-2">
                    <Switch
                      checked={r.enabled}
                      onCheckedChange={(enabled) => change(rules.map((x, j) => (j === i ? { ...x, enabled } : x)))}
                      aria-label={`${r.enabled ? 'Turn off' : 'Turn on'} ${r.name}`}
                    />
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="size-8" aria-label={`Actions for ${r.name}`}>
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => setEditing({ rule: r, index: i })}>
                          <Pencil />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem variant="destructive" onSelect={() => change(rules.filter((_, j) => j !== i))}>
                          <Trash2 />
                          Remove
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      {isAdmin && draft && (
        <CardFooter className="justify-end gap-2">
          <Button variant="ghost" onClick={() => setDraft(null)}>
            Discard changes
          </Button>
          <Button disabled={save.isPending} onClick={() => save.mutate(draft)}>
            {save.isPending && <Loader2 className="animate-spin" />}
            Save rules
          </Button>
        </CardFooter>
      )}
      {editing && rules && (
        <RuleDialog
          rule={editing.rule}
          staff={staffList}
          companies={companyList}
          onClose={() => setEditing(null)}
          onDone={(rule) => {
            change(editing.index === null ? [...rules, rule] : rules.map((x, j) => (j === editing.index ? rule : x)));
            setEditing(null);
          }}
        />
      )}
    </Card>
  );
}

function RuleDialog({
  rule,
  staff,
  companies,
  onClose,
  onDone,
}: {
  rule: EscalationRule;
  staff: StaffMember[];
  companies: Company[];
  onClose: () => void;
  onDone: (r: EscalationRule) => void;
}) {
  const [r, setR] = useState(rule);
  const set = <K extends keyof EscalationRule>(k: K, v: EscalationRule[K]) => setR((x) => ({ ...x, [k]: v }));
  // An empty list means every priority; at least one must stay ticked.
  const togglePriority = (p: Priority) => {
    const current = r.priorities.length ? r.priorities : PRIORITIES;
    const next = current.includes(p) ? current.filter((x) => x !== p) : [...current, p];
    if (next.length) set('priorities', next.length === PRIORITIES.length ? [] : next);
  };
  const toggleUser = (id: number) => set('notify_users', r.notify_users.includes(id) ? r.notify_users.filter((x) => x !== id) : [...r.notify_users, id]);
  const problem = !r.name.trim()
    ? 'Give the rule a name'
    : r.when === 'idle' && r.after < 15
      ? 'Set at least 15 minutes without activity'
      : !r.notify_admins && !r.notify_assignee && !r.notify_users.length
        ? 'Choose who to alert'
        : null;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{rule.id ? 'Edit escalation rule' : 'Add an escalation rule'}</DialogTitle>
          <DialogDescription>Changes take effect once you save the rules.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="esc-name">Name *</Label>
            <Input id="esc-name" maxLength={80} placeholder="For example: Still not resolved a day later" value={r.name} onChange={(e) => set('name', e.target.value)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
            <div className="grid gap-2">
              <Label>When</Label>
              <Select value={r.when} onValueChange={(v) => set('when', v as EscalationRule['when'])}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(WHEN_LABELS) as EscalationRule['when'][]).map((w) => (
                    <SelectItem key={w} value={w}>
                      {WHEN_LABELS[w]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Escalate to</Label>
              <Select value={String(r.level)} onValueChange={(v) => set('level', Number(v))}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[1, 2, 3].map((l) => (
                    <SelectItem key={l} value={String(l)}>
                      Level {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-2">
            <Label>{r.when === 'idle' ? 'After this long without activity' : 'Wait after the time runs out'}</Label>
            <DurationInput key={r.when} value={r.after || null} onChange={(v) => set('after', v ?? 0)} placeholder={r.when === 'idle' ? 1440 : undefined} />
            <p className="text-xs text-muted-foreground">
              {r.when === 'idle' ? 'Paused while the ticket is waiting on the client.' : 'Leave empty to escalate as soon as the time runs out.'}
              {r.when === 'resolution' && ' The time to resolve comes from the company SLA and the fault category.'}
            </p>
          </div>
          <div className="grid gap-2">
            <Label>Applies to priorities</Label>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {PRIORITIES.map((p) => (
                <label key={p} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={!r.priorities.length || r.priorities.includes(p)} onCheckedChange={() => togglePriority(p)} />
                  {PRIORITY_LABELS[p]}
                </label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">All ticked means every priority.</p>
          </div>
          <div className="grid gap-2">
            <Label>Applies to</Label>
            <Select value={r.company_id ? String(r.company_id) : ANY} onValueChange={(v) => set('company_id', v === ANY ? null : Number(v))}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>All companies</SelectItem>
                {companies.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">Alert *</legend>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={r.notify_admins} onCheckedChange={(v) => set('notify_admins', !!v)} />
              All admins
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={r.notify_assignee} onCheckedChange={(v) => set('notify_assignee', !!v)} />
              Whoever the ticket is assigned to
            </label>
            {staff.length > 0 && (
              <div className="max-h-36 overflow-y-auto rounded-md border p-2">
                {staff.map((s) => (
                  <label key={s.id} className="flex items-center gap-2 py-1 text-sm">
                    <Checkbox checked={r.notify_users.includes(s.id)} onCheckedChange={() => toggleUser(s.id)} />
                    {s.name}
                  </label>
                ))}
              </div>
            )}
            <p className="text-xs text-muted-foreground">They get a bell notification, and an email if their notifications are on.</p>
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label>Also raise priority to</Label>
              <Select value={r.set_priority ?? NONE} onValueChange={(v) => set('set_priority', v === NONE ? null : (v as 'urgent' | 'high'))}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Leave as it is</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Assign to, if nobody has it</Label>
              <Select value={r.assign_to ? String(r.assign_to) : NONE} onValueChange={(v) => set('assign_to', v === NONE ? null : Number(v))}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Nobody</SelectItem>
                  {staff.map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter>
          {problem && <p className="mr-auto self-center text-xs text-destructive">{problem}</p>}
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button disabled={!!problem} onClick={() => onDone({ ...r, name: r.name.trim() })}>
            {rule.id || rule.name ? 'Update rule' : 'Add rule'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
