import { useState, type FormEvent } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PasswordChecklist, PasswordInput } from '@/components/password-input';
import { passwordOk } from '@/lib/password';
import { Switch } from '@/components/ui/switch';
import { PageHeader, UserAvatar } from '@/components/common';
import { useSession } from '@/hooks/use-session';
import { api, errorMessage } from '@/lib/api';
import { ROLE_LABELS, formatDate } from '@/lib/format';
import type { User } from '@/lib/types';

export default function ProfilePage() {
  const { user } = useSession();
  if (!user) return null;
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <PageHeader title="Profile and settings" description="Manage your personal details, notifications and password." />
      <Card>
        <CardContent className="flex items-center gap-4">
          <UserAvatar name={user.name} className="size-14 text-base" />
          <div className="min-w-0 space-y-1">
            <div className="truncate text-lg font-semibold">{user.name}</div>
            <div className="truncate text-sm text-muted-foreground">{user.email}</div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="secondary">{ROLE_LABELS[user.role]}</Badge>
              {user.company_name && <span>{user.company_name}</span>}
              <span>Member since {formatDate(user.created_at)}</span>
            </div>
          </div>
        </CardContent>
      </Card>
      <DetailsForm user={user} />
      <PasswordForm />
    </div>
  );
}

function DetailsForm({ user }: { user: User }) {
  const { setUser } = useSession();
  const [name, setName] = useState(user.name);
  const [phone, setPhone] = useState(user.phone ?? '');
  const [notify, setNotify] = useState(user.notify_email);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api.patch<{ user: User }>('/auth/me', { name, phone, notify_email: notify });
      setUser(res.user);
      toast.success('Profile updated');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <Card>
        <CardHeader>
          <CardTitle>Personal details</CardTitle>
          <CardDescription>Your name is shown to the people you correspond with on tickets.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="profile-name">Full name</Label>
              <Input id="profile-name" required maxLength={190} value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="profile-phone">Phone</Label>
              <Input id="profile-phone" type="tel" maxLength={40} value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="profile-email">Email address</Label>
            <Input id="profile-email" value={user.email} disabled />
            <p className="text-xs text-muted-foreground">Contact an administrator to change your sign-in email.</p>
          </div>
          <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
            <div className="space-y-0.5">
              <Label htmlFor="profile-notify">Email notifications</Label>
              <p className="text-sm text-muted-foreground">
                Receive an email when tickets you follow are updated. Account and security emails are always sent.
              </p>
            </div>
            <Switch id="profile-notify" checked={notify} onCheckedChange={setNotify} />
          </div>
        </CardContent>
        <CardFooter className="justify-end border-t">
          <Button type="submit" disabled={busy}>
            {busy && <Loader2 className="animate-spin" />}
            Save changes
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}

function PasswordForm() {
  const { user } = useSession();
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!passwordOk(password, user ?? undefined)) return toast.error('Choose a password that meets all the requirements');
    if (password !== confirm) return toast.error('New passwords do not match');
    setBusy(true);
    try {
      await api.post('/auth/password', { current, password });
      toast.success('Password changed', { description: 'A confirmation has been sent to your email address.' });
      setCurrent('');
      setPassword('');
      setConfirm('');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <Card>
        <CardHeader>
          <CardTitle>Password</CardTitle>
          <CardDescription>Changing your password signs you out of other devices. Use at least 10 characters with upper and lowercase letters, a number and a symbol.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="pw-current">Current password</Label>
            <PasswordInput id="pw-current" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="pw-new">New password</Label>
              <PasswordInput id="pw-new" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="pw-confirm">Confirm new password</Label>
              <PasswordInput id="pw-confirm" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </div>
          </div>
          {password && <PasswordChecklist password={password} email={user?.email} name={user?.name} />}
        </CardContent>
        <CardFooter className="justify-end border-t">
          <Button type="submit" disabled={busy}>
            {busy && <Loader2 className="animate-spin" />}
            Update password
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
