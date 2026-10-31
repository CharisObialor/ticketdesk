import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleAlert, CircleCheck, DatabaseBackup, Download, Loader2, Lock, Mail, MailOpen, Timer } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/common';
import { DefaultSlaCard } from '@/components/sla-editor';
import { EscalationRulesCard } from '@/components/escalation-rules';
import { api, errorMessage } from '@/lib/api';
import { fileSize, timeAgo } from '@/lib/format';
import { apiHref } from '@/lib/api';

interface SystemInfo {
  backups: { name: string; size: number; created_at: string }[];
  lastBackup: { ok: boolean; reason: string; name?: string; error?: string; finished_at: string; filesCopied?: number } | null;
  backupHour: number;
  backupKeep: number;
  email: { outgoing: boolean; provider: 'microsoft365' | 'smtp' | 'none'; mailbox: string | null; sendAsStaff: string[] | null; inbound: { enabled: boolean; address: string | null; lastRunAt: string | null; lastError: string | null; processed: number } };
  autoCloseDays: number;
  chatDigestMinutes: number;
  sessionIdleMinutes: number;
  outbox: { pending: number; oldestPending: string | null; failedCount: number; failed: { id: number; recipient: string; subject: string | null; attempts: number; last_error: string | null; created_at: string }[] };
}

const isoAgo = (iso: string) => timeAgo(iso.slice(0, 19).replace('T', ' '));

export default function SystemPage() {
  const qc = useQueryClient();
  const info = useQuery({ queryKey: ['system'], queryFn: () => api.get<SystemInfo>('/system'), refetchInterval: 60_000 });
  const backupNow = useMutation({
    mutationFn: () => api.post<{ name: string }>('/system/backups'),
    onSuccess: (r) => {
      toast.success('Backup complete', { description: r.name });
      qc.invalidateQueries({ queryKey: ['system'] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const retry = useMutation({
    mutationFn: () => api.post('/system/outbox/retry', {}),
    onSuccess: () => {
      toast.success('Failed emails queued again');
      qc.invalidateQueries({ queryKey: ['system'] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  if (!info.data) return <Skeleton className="h-96" />;
  const s = info.data;
  const inbound = s.email.inbound;

  return (
    <>
      <PageHeader title="System" description="Backups, email delivery and automatic housekeeping." />
      <div className="grid gap-4 lg:grid-cols-3">
        <StatusCard
          icon={DatabaseBackup}
          title="Nightly backup"
          ok={s.lastBackup ? s.lastBackup.ok : null}
          lines={[
            s.lastBackup ? (s.lastBackup.ok ? `Last backup ${isoAgo(s.lastBackup.finished_at)}` : `Last backup failed: ${s.lastBackup.error}`) : 'No backup yet',
            `Runs daily after ${String(s.backupHour).padStart(2, '0')}:00 (server time), keeps ${s.backupKeep} copies`,
          ]}
        />
        <StatusCard
          icon={Mail}
          title="Outgoing email"
          ok={s.email.outgoing}
          lines={
            s.email.provider === 'microsoft365'
              ? [
                  `Sending through Microsoft 365${s.email.mailbox ? ` as ${s.email.mailbox}` : ''}`,
                  s.email.sendAsStaff?.length
                    ? `Staff on ${s.email.sendAsStaff.join(', ')} send from their own mailbox`
                    : 'All email is sent from the support mailbox',
                ]
              : s.email.provider === 'smtp'
                ? [`Sending through SMTP${s.email.mailbox ? ` as ${s.email.mailbox}` : ''}`, 'Set with SMTP_* settings in .env']
                : ['Not configured: emails are only logged', 'For Microsoft 365, set MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET and MS_MAILBOX in .env']
          }
        />
        <StatusCard
          icon={MailOpen}
          title="Reply by email"
          ok={inbound.enabled ? !inbound.lastError : null}
          lines={
            inbound.enabled
              ? [
                  `Checking ${inbound.address ?? 'the support mailbox'}`,
                  inbound.lastError ? `Last check failed: ${inbound.lastError}` : inbound.lastRunAt ? `Last checked ${isoAgo(inbound.lastRunAt)}, ${inbound.processed} emails processed` : 'Waiting for first check',
                ]
              : ['Off. With Microsoft 365 it turns on automatically once the MS_* settings are in .env.']
          }
        />
      </div>

      <DefaultSlaCard />
      <EscalationRulesCard />

      <Card>
        <CardHeader>
          <CardTitle>Email outbox</CardTitle>
          <CardDescription>
            Every email is saved here first and retried automatically for up to a day if the internet or Microsoft is unavailable.
          </CardDescription>
          {s.outbox.failedCount > 0 && (
            <CardAction>
              <Button variant="outline" onClick={() => retry.mutate()} disabled={retry.isPending}>
                {retry.isPending ? <Loader2 className="animate-spin" /> : <Mail />}
                Retry failed
              </Button>
            </CardAction>
          )}
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            {s.outbox.pending ? `${s.outbox.pending} waiting to be sent${s.outbox.oldestPending ? ` (oldest from ${timeAgo(s.outbox.oldestPending)})` : ''}.` : 'Nothing waiting.'}{' '}
            {s.outbox.failedCount ? `${s.outbox.failedCount} failed.` : 'No failures.'}
          </p>
          {s.outbox.failed.length > 0 && (
            <ul className="divide-y rounded-md border">
              {s.outbox.failed.map((f) => (
                <li key={f.id} className="px-3 py-2">
                  <div className="truncate font-medium">{f.subject || '(no subject)'}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    To {f.recipient} · {timeAgo(f.created_at)} · {f.attempts} attempts
                  </div>
                  {f.last_error && <div className="mt-0.5 text-xs break-words text-red-700 dark:text-red-400">{f.last_error}</div>}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Backups</CardTitle>
          <CardDescription>
            Compressed copies of the database. Uploaded files are copied to storage/backups/files. Download copies regularly and keep them somewhere other than this server.
          </CardDescription>
          <CardAction>
            <Button onClick={() => backupNow.mutate()} disabled={backupNow.isPending}>
              {backupNow.isPending ? <Loader2 className="animate-spin" /> : <DatabaseBackup />}
              Back up now
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="px-0">
          {s.backups.length === 0 ? (
            <p className="px-6 py-6 text-sm text-muted-foreground">No backups yet. The first one runs tonight, or click Back up now.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">File</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Size</TableHead>
                  <TableHead className="w-16 pr-6" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {s.backups.map((b) => (
                  <TableRow key={b.name}>
                    <TableCell className="pl-6 font-mono text-xs">{b.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{isoAgo(b.created_at)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fileSize(b.size)}</TableCell>
                    <TableCell className="pr-6">
                      <Button variant="ghost" size="icon-sm" asChild>
                        <a href={apiHref(`/api/system/backups/${b.name}`)} aria-label={`Download ${b.name}`}>
                          <Download />
                        </a>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Automatic housekeeping</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm sm:grid-cols-3">
          <div className="flex gap-3">
            <Lock className="mt-0.5 size-4 text-muted-foreground" />
            <div>
              <div className="font-medium">Inactivity sign-out</div>
              <div className="text-muted-foreground">
                {s.sessionIdleMinutes > 0 ? `People are signed out after ${s.sessionIdleMinutes} minutes without activity (SESSION_IDLE_MINUTES).` : 'Off (SESSION_IDLE_MINUTES=0).'}
              </div>
            </div>
          </div>
          <div className="flex gap-3">
            <Timer className="mt-0.5 size-4 text-muted-foreground" />
            <div>
              <div className="font-medium">Auto-close</div>
              <div className="text-muted-foreground">
                {s.autoCloseDays > 0 ? `Resolved tickets close after ${s.autoCloseDays} days without a reply (AUTO_CLOSE_DAYS).` : 'Off (AUTO_CLOSE_DAYS=0).'}
              </div>
            </div>
          </div>
          <div className="flex gap-3">
            <Mail className="mt-0.5 size-4 text-muted-foreground" />
            <div>
              <div className="font-medium">Unread message summary</div>
              <div className="text-muted-foreground">
                {s.chatDigestMinutes > 0 ? `Group messages unread for ${s.chatDigestMinutes} minutes are emailed (CHAT_DIGEST_MINUTES).` : 'Off (CHAT_DIGEST_MINUTES=0).'}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </>
  );
}

function StatusCard({ icon: Icon, title, ok, lines }: { icon: typeof Mail; title: string; ok: boolean | null; lines: string[] }) {
  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle className="type-h5 flex items-center gap-2">
          <Icon className="size-4 text-muted-foreground" />
          {title}
        </CardTitle>
        <CardAction>
          {ok === null ? (
            <Badge variant="outline">Off</Badge>
          ) : ok ? (
            <Badge variant="outline" className="border-emerald-500/40 text-emerald-700 dark:text-emerald-400">
              <CircleCheck />
              OK
            </Badge>
          ) : (
            <Badge variant="destructive">
              <CircleAlert />
              Attention
            </Badge>
          )}
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-1 text-sm text-muted-foreground">
        {lines.map((l) => (
          <p key={l}>{l}</p>
        ))}
      </CardContent>
    </Card>
  );
}
