import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Mail, MoreHorizontal, Pencil, Plus, Search, Users as UsersIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState, PageHeader, UserAvatar } from '@/components/common';
import { useSession } from '@/hooks/use-session';
import { api, errorMessage, qs } from '@/lib/api';
import { ROLE_LABELS, timeAgo } from '@/lib/format';
import type { Company, Role, User } from '@/lib/types';

const ALL = 'all';

export default function UsersPage() {
  const { isAdmin, user: me } = useSession();
  const [params, setParams] = useSearchParams();
  const companyId = params.get('company_id') || '';
  const [role, setRole] = useState(ALL);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<User | 'new' | null>(null);

  const users = useQuery({
    queryKey: ['users', { companyId }],
    queryFn: () => api.get<{ users: User[] }>(`/users${qs({ company_id: companyId })}`),
  });
  const companies = useQuery({ queryKey: ['companies'], queryFn: () => api.get<{ companies: Company[] }>('/companies') });

  const invite = async (u: User) => {
    try {
      await api.post(`/users/${u.id}/invite`);
      toast.success(`Invitation sent to ${u.email}`);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const term = search.trim().toLowerCase();
  const rows = (users.data?.users ?? []).filter(
    (u) => (role === ALL || u.role === role) && (!term || u.name.toLowerCase().includes(term) || u.email.toLowerCase().includes(term))
  );

  return (
    <>
      <PageHeader
        title="Users"
        description="Support staff and client contacts who can sign in to the portal."
        actions={
          isAdmin && (
            <Button onClick={() => setEditing('new')}>
              <Plus />
              Add user
            </Button>
          )
        }
      />
      <div className="flex flex-col gap-2 md:flex-row md:items-center">
        <div className="relative md:max-w-xs md:flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search name or email" className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Select value={role} onValueChange={setRole}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All roles</SelectItem>
              {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
                <SelectItem key={r} value={r}>
                  {ROLE_LABELS[r]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={companyId || ALL} onValueChange={(v) => setParams(v === ALL ? {} : { company_id: v })}>
            <SelectTrigger className="w-48">
              <SelectValue />
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
        </div>
      </div>

      <Card className="gap-0 overflow-hidden py-0">
        {users.isPending ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon={UsersIcon} title="No users found" description="Try changing the filters." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead className="pl-4">Name</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="hidden md:table-cell">Company</TableHead>
                <TableHead className="hidden lg:table-cell">Last sign-in</TableHead>
                <TableHead className="hidden sm:table-cell">Status</TableHead>
                {isAdmin && <TableHead className="w-12 pr-4" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="pl-4">
                    <div className="flex items-center gap-3">
                      <UserAvatar name={u.name} />
                      <div className="min-w-0">
                        <div className="truncate font-medium">
                          {u.name}
                          {u.id === me?.id && <span className="ml-1 text-xs font-normal text-muted-foreground">(you)</span>}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">{u.email}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={u.role === 'client' ? 'outline' : 'secondary'}>{ROLE_LABELS[u.role]}</Badge>
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground md:table-cell">{u.company_name ?? '-'}</TableCell>
                  <TableCell className="hidden text-muted-foreground lg:table-cell">{u.last_login_at ? timeAgo(u.last_login_at) : 'Never'}</TableCell>
                  <TableCell className="hidden sm:table-cell">
                    {!u.is_active ? (
                      <Badge variant="outline">Disabled</Badge>
                    ) : !u.has_password ? (
                      <Badge variant="outline" className="border-amber-500/50 text-amber-700 dark:text-amber-400">
                        Invited
                      </Badge>
                    ) : (
                      <Badge variant="secondary">Active</Badge>
                    )}
                  </TableCell>
                  {isAdmin && (
                    <TableCell className="pr-4">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${u.name}`}>
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setEditing(u)}>
                            <Pencil />
                            Edit user
                          </DropdownMenuItem>
                          {u.is_active && (
                            <DropdownMenuItem onClick={() => invite(u)}>
                              <Mail />
                              {u.has_password ? 'Send password setup link' : 'Resend invitation'}
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
      {editing && (
        <UserDialog user={editing === 'new' ? null : editing} companies={companies.data?.companies ?? []} defaultCompanyId={companyId} onClose={() => setEditing(null)} />
      )}
    </>
  );
}

function UserDialog({ user, companies, defaultCompanyId, onClose }: { user: User | null; companies: Company[]; defaultCompanyId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [role, setRole] = useState<Role>(user?.role ?? 'client');
  const [companyId, setCompanyId] = useState(user?.company_id ? String(user.company_id) : defaultCompanyId);
  const [active, setActive] = useState(user ? user.is_active : true);
  const [notify, setNotify] = useState(user ? user.notify_email : true);
  const [sendInvite, setSendInvite] = useState(true);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (role === 'client' && !companyId) return toast.error('Client users must belong to a company');
    setBusy(true);
    const body = { name, phone, role, company_id: role === 'client' ? Number(companyId) : null, is_active: active, notify_email: notify };
    try {
      if (user) await api.patch(`/users/${user.id}`, body);
      else await api.post('/users', { ...body, email, send_invite: sendInvite });
      toast.success(user ? 'User updated' : sendInvite ? `User added and invitation sent to ${email}` : 'User added');
      qc.invalidateQueries({ queryKey: ['users'] });
      qc.invalidateQueries({ queryKey: ['companies'] });
      qc.invalidateQueries({ queryKey: ['staff'] });
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{user ? 'Edit user' : 'Add user'}</DialogTitle>
            <DialogDescription>
              {user ? 'Update account details and access.' : 'New users receive an email invitation to set their password.'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="user-name">Full name *</Label>
              <Input id="user-name" required maxLength={190} value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="user-phone">Phone</Label>
              <Input id="user-phone" type="tel" maxLength={40} value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="user-email">Email address *</Label>
            <Input id="user-email" type="email" required disabled={!!user} value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label>Role</Label>
              <Select value={role} onValueChange={(v) => setRole(v as Role)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="client">Client</SelectItem>
                  <SelectItem value="agent">Agent</SelectItem>
                  <SelectItem value="technician">Technician</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Company {role === 'client' && '*'}</Label>
              <Select value={role === 'client' ? companyId : ''} onValueChange={setCompanyId} disabled={role !== 'client'}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={role === 'client' ? 'Select a company' : 'Staff (no company)'} />
                </SelectTrigger>
                <SelectContent>
                  {companies.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-3 rounded-lg border p-3">
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <Label htmlFor="user-active">Active</Label>
                <p className="text-xs text-muted-foreground">Disabled users cannot sign in.</p>
              </div>
              <Switch id="user-active" checked={active} onCheckedChange={setActive} />
            </div>
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <Label htmlFor="user-notify">Email notifications</Label>
                <p className="text-xs text-muted-foreground">Ticket updates are sent by email.</p>
              </div>
              <Switch id="user-notify" checked={notify} onCheckedChange={setNotify} />
            </div>
          </div>
          {!user && (
            <div className="flex items-center gap-2">
              <Checkbox id="user-invite" checked={sendInvite} onCheckedChange={(v) => setSendInvite(v === true)} />
              <Label htmlFor="user-invite" className="font-normal">
                Send an invitation email now
              </Label>
            </div>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="animate-spin" />}
              {user ? 'Save changes' : 'Add user'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
