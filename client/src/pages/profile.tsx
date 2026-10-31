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
import { Textarea } from '@/components/ui/textarea';
import { PageHeader, UserAvatar } from '@/components/common';
import { AvatarPickerCard } from '@/components/avatar-upload';
import { useSession } from '@/hooks/use-session';
import { TEXT_SIZES, useTheme } from '@/hooks/use-theme';
import { cn } from '@/lib/utils';
import { api, errorMessage } from '@/lib/api';
import { BRAND } from '@/lib/brand';
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
          <UserAvatar name={user.name} src={user.avatar_url} className="size-14 text-base" />
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
      <AvatarPickerCard user={user} />
      <TextSizeCard />
      {user.role === 'admin' && <SignatureForm user={user} />}
      <PasswordForm />
    </div>
  );
}

function DetailsForm({ user }: { user: User }) {
  const { setUser } = useSession();
  const [name, setName] = useState(user.name);
  const [phone, setPhone] = useState(user.phone ?? '');
  const [jobTitle, setJobTitle] = useState(user.job_title ?? '');
  const [notify, setNotify] = useState(user.notify_email);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api.patch<{ user: User }>('/auth/me', { name, phone, job_title: jobTitle, notify_email: notify });
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
            <Label htmlFor="profile-title">Position</Label>
            <Input id="profile-title" maxLength={120} placeholder="For example: IT Manager" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
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

// Admins' emails go out from their own mailbox and end with this signature.
function SignatureForm({ user }: { user: User }) {
  const { setUser } = useSession();
  const fallback = [user.name, BRAND.company, user.email].join('\n');
  const [text, setText] = useState(user.signature ?? fallback);
  const [busy, setBusy] = useState(false);
  const lines = text.trim().split(/\r?\n/).filter((l, i) => i === 0 || l.trim());

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api.patch<{ user: User }>('/auth/me', { signature: text.trim() === fallback ? '' : text });
      setUser(res.user);
      toast.success('Signature saved');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save}>
      <Card>
        <CardHeader>
          <CardTitle>Email signature</CardTitle>
          <CardDescription>Added to emails you send from the Mail page and to ticket emails sent from your mailbox. The first line appears in bold.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="signature">Signature</Label>
            <Textarea id="signature" rows={6} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} placeholder={fallback} />
            <div className="flex gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setText(fallback)}>
                Reset to default
              </Button>
            </div>
          </div>
          <div className="grid content-start gap-2">
            <span className="text-sm font-medium">Preview</span>
            <div className="rounded-md border bg-white px-4 py-3 text-zinc-900">
              {lines.length ? (
                <>
                  <p className="text-[15px] leading-snug font-semibold">{lines[0]}</p>
                  {lines.slice(1).map((l, i) => (
                    <p key={i} className="text-[13px] leading-5 text-zinc-500">
                      {l}
                    </p>
                  ))}
                </>
              ) : (
                <p className="text-sm text-zinc-400">No signature</p>
              )}
            </div>
          </div>
        </CardContent>
        <CardFooter className="justify-end border-t">
          <Button type="submit" disabled={busy}>
            {busy && <Loader2 className="animate-spin" />}
            Save signature
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

function TextSizeCard() {
  const { textSize, setTextSize } = useTheme();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Text size</CardTitle>
        <CardDescription>Make everything smaller to fit more on screen, or larger to make it easier to read. This is saved on this device.</CardDescription>
      </CardHeader>
      <CardContent>
        <div role="radiogroup" aria-label="Text size" className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {TEXT_SIZES.map((s) => (
            <button
              key={s.value}
              type="button"
              role="radio"
              aria-checked={textSize === s.value}
              onClick={() => setTextSize(s.value)}
              className={cn(
                'flex flex-col items-center gap-1 rounded-lg border p-3 outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50',
                textSize === s.value && 'border-primary bg-primary/5'
              )}
            >
              <span className="font-semibold leading-none" style={{ fontSize: `${(s.percent / 100) * 20}px` }}>
                Aa
              </span>
              <span className="text-sm">{s.label}</span>
              <span className="text-xs text-muted-foreground">{s.percent}%</span>
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
