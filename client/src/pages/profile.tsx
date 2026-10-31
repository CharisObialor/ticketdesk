import { useEffect, useState, type FormEvent } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PasswordChecklist, PasswordInput } from '@/components/password-input';
import { passwordOk } from '@/lib/password';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { CompanyLogo, PageHeader, UserAvatar } from '@/components/common';
import { AvatarPickerCard } from '@/components/avatar-upload';
import { useSession } from '@/hooks/use-session';
import { TEXT_SIZES, useTheme } from '@/hooks/use-theme';
import { cn } from '@/lib/utils';
import { api, errorMessage } from '@/lib/api';
import { BRAND } from '@/lib/brand';
import { ROLE_LABELS, formatDate } from '@/lib/format';
import type { SlaReminders, User } from '@/lib/types';

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

              <span>Member since {formatDate(user.created_at)}</span>
            </div>
          </div>
          {user.role === 'client' && user.company_name && (
            <div className="ml-auto hidden items-center gap-3 rounded-lg border px-3 py-2 sm:flex">
              <CompanyLogo src={user.company_logo_url} name={user.company_name} className="size-10" />
              <div className="min-w-0">
                <div className="text-xs text-muted-foreground">Your company</div>
                <div className="truncate font-medium">{user.company_name}</div>
                {user.job_title && <div className="truncate text-xs text-muted-foreground">{user.job_title}</div>}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      {user.role === 'client' && user.company_name && (
        <Card className="sm:hidden">
          <CardContent className="flex items-center gap-3">
            <CompanyLogo src={user.company_logo_url} name={user.company_name} className="size-10" />
            <div className="min-w-0">
              <div className="text-xs text-muted-foreground">Your company</div>
              <div className="truncate font-medium">{user.company_name}</div>
            </div>
          </CardContent>
        </Card>
      )}
      <DetailsForm user={user} />
      <NotificationPrefsForm user={user} />
      <AvatarPickerCard user={user} />
      <TextSizeCard />
      {user.role === 'admin' && user.sla_reminders && <SlaRemindersForm user={user} prefs={user.sla_reminders} />}
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

// What people can switch off. Account, security and one-time code emails always go.
const PREF_ROWS: { key: string; label: string; hint: string; staffOnly?: boolean }[] = [
  { key: 'created', label: 'New tickets', hint: 'Confirmation when a ticket is raised (for the team: new tickets in the queue).' },
  { key: 'replies', label: 'Replies and work updates', hint: 'Someone replies on a ticket you follow.' },
  { key: 'status', label: 'Status changes', hint: 'A ticket is in progress, waiting on you, resolved or closed.' },
  { key: 'visits', label: 'Site visits', hint: 'A visit is booked, moved or cancelled.' },
  { key: 'chats', label: 'Group chats', hint: 'Unread group chat messages.' },
  { key: 'assignments', label: 'Assignments', hint: 'A ticket is assigned to you.', staffOnly: true },
  { key: 'escalations', label: 'Escalations', hint: 'A ticket is escalated.', staffOnly: true },
  { key: 'ratings', label: 'Ratings', hint: 'A client rates a ticket or rates you.', staffOnly: true },
  { key: 'signoffs', label: 'Sign-offs', hint: 'A resolved ticket needs your sign-off.', staffOnly: true },
];

// Choose, per kind of notification, whether it comes by email, in the bell, or both.
function NotificationPrefsForm({ user }: { user: User }) {
  const { setUser } = useSession();
  const staff = user.role !== 'client';
  const rows = PREF_ROWS.filter((r) => staff || !r.staffOnly);
  const [prefs, setPrefs] = useState(() =>
    Object.fromEntries(rows.map((r) => [r.key, { email: user.notify_prefs?.[r.key]?.email !== false, inapp: user.notify_prefs?.[r.key]?.inapp !== false }]))
  );
  const [busy, setBusy] = useState(false);
  const toggle = (key: string, channel: 'email' | 'inapp') => setPrefs((p) => ({ ...p, [key]: { ...p[key], [channel]: !p[key][channel] } }));

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api.patch<{ user: User }>('/auth/me', { notify_prefs: prefs });
      setUser(res.user);
      toast.success('Notification choices saved');
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
          <CardTitle>Notifications</CardTitle>
          <CardDescription>
            Choose what you hear about, and how. Emails also need email notifications turned on above. Account and security emails always come.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="pb-2 text-left font-normal">Notification</th>
                  <th className="w-20 pb-2 text-center font-normal">Email</th>
                  <th className="w-20 pb-2 text-center font-normal">In the bell</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((r) => (
                  <tr key={r.key}>
                    <td className="py-2.5 pr-3">
                      <div className="font-medium">{r.label}</div>
                      <div className="text-xs text-muted-foreground">{r.hint}</div>
                    </td>
                    <td className="text-center">
                      <Checkbox checked={prefs[r.key].email} onCheckedChange={() => toggle(r.key, 'email')} aria-label={`${r.label} by email`} disabled={!user.notify_email} />
                    </td>
                    <td className="text-center">
                      <Checkbox checked={prefs[r.key].inapp} onCheckedChange={() => toggle(r.key, 'inapp')} aria-label={`${r.label} in the bell`} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
        <CardFooter className="justify-end border-t">
          <Button type="submit" disabled={busy}>
            {busy && <Loader2 className="animate-spin" />}
            Save choices
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}

const REMINDER_KINDS: { key: Exclude<keyof SlaReminders, 'email'>; label: string; hint: string }[] = [
  { key: 'response_due', label: 'First response due soon', hint: 'A ticket has used three quarters of its time for a first reply.' },
  { key: 'response_overdue', label: 'First response overdue', hint: 'No one has replied within the response time.' },
  { key: 'resolution_due', label: 'Resolution due soon', hint: 'A ticket is close to its time to resolve (the last day, or the last fifth).' },
  { key: 'resolution_overdue', label: 'Resolution overdue', hint: 'A ticket has passed its time to resolve.' },
];
const REMINDER_CHOICES: [number, string][] = [
  [0, 'No reminders'],
  [15, 'Every 15 minutes'],
  [30, 'Every 30 minutes'],
  [60, 'Every hour'],
  [120, 'Every 2 hours'],
  [240, 'Every 4 hours'],
  [480, 'Every 8 hours'],
  [1440, 'Once a day'],
];

// How often this admin hears about each kind of SLA breach (in the bell, and optionally by email).
function SlaRemindersForm({ user, prefs }: { user: User; prefs: SlaReminders }) {
  const { setUser } = useSession();
  const [value, setValue] = useState(prefs);
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api.patch<{ user: User }>('/auth/me', { sla_reminders: value });
      setUser(res.user);
      toast.success('Reminder settings saved');
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
          <CardTitle>SLA reminders</CardTitle>
          <CardDescription>
            How often you are reminded about each ticket at risk of breaching its SLA. You are told as soon as it happens, then at the interval you choose
            until it is dealt with. Tickets always stay on the Actions page.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {REMINDER_KINDS.map((k) => (
            <div key={k.key} className="grid gap-2 sm:grid-cols-[1fr_12rem] sm:items-center sm:gap-4">
              <div>
                <Label htmlFor={`remind-${k.key}`}>{k.label}</Label>
                <p className="text-xs text-muted-foreground">{k.hint}</p>
              </div>
              <Select value={String(value[k.key])} onValueChange={(v) => setValue((p) => ({ ...p, [k.key]: Number(v) }))}>
                <SelectTrigger id={`remind-${k.key}`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REMINDER_CHOICES.map(([min, label]) => (
                    <SelectItem key={min} value={String(min)}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
          <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
            <div className="space-y-0.5">
              <Label htmlFor="remind-email">Email me the reminders too</Label>
              <p className="text-sm text-muted-foreground">
                Off: reminders appear in the bell, and only the first notice of an urgent breach is emailed.
                {!user.notify_email && ' Turn on email notifications above for this to work.'}
              </p>
            </div>
            <Switch id="remind-email" checked={value.email} onCheckedChange={(email) => setValue((p) => ({ ...p, email }))} />
          </div>
        </CardContent>
        <CardFooter className="justify-end border-t">
          <Button type="submit" disabled={busy}>
            {busy && <Loader2 className="animate-spin" />}
            Save reminders
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

// Changing the password is confirmed with a one-time code emailed to the account, not the old password.
function PasswordForm() {
  const { user } = useSession();
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState<{ minutes: number; at: number } | null>(null);
  const [sending, setSending] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!codeSent) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [codeSent]);
  const resendIn = codeSent ? Math.max(0, 60 - Math.floor((now - codeSent.at) / 1000)) : 0;

  async function sendCode() {
    setSending(true);
    try {
      const r = await api.post<{ minutes: number }>('/auth/password/code');
      setCodeSent({ minutes: r.minutes, at: Date.now() });
      setNow(Date.now());
      toast.success('Code sent', { description: `Check ${user?.email} for a 6-digit code. It expires in ${r.minutes} minutes.` });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSending(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!/^\d{6}$/.test(code.replace(/\s+/g, ''))) return toast.error('Enter the 6-digit code from the email');
    if (!passwordOk(password, user ?? undefined)) return toast.error('Choose a password that meets all the requirements');
    if (password !== confirm) return toast.error('New passwords do not match');
    setBusy(true);
    try {
      await api.post('/auth/password', { code, password });
      toast.success('Password changed', { description: 'A confirmation has been sent to your email address.' });
      setCode('');
      setCodeSent(null);
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
            <Label htmlFor="pw-code">Code from your email</Label>
            <div className="flex flex-wrap gap-2">
              <Input
                id="pw-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={7}
                placeholder="123456"
                className="w-36 font-mono tracking-widest"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ''))}
              />
              <Button type="button" variant="outline" onClick={sendCode} disabled={sending || resendIn > 0}>
                {sending && <Loader2 className="animate-spin" />}
                {codeSent ? (resendIn > 0 ? `Resend in ${resendIn}s` : 'Send a new code') : 'Email me a code'}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {codeSent
                ? `We sent a 6-digit code to ${user?.email}. It expires in ${codeSent.minutes} minutes.`
                : `We email a one-time code to ${user?.email} to confirm it is you.`}
            </p>
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
