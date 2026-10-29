import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleAlert, CircleCheck, DatabaseBackup, Download, Loader2, Mail, MailOpen, Timer } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/common';
import { api, errorMessage } from '@/lib/api';
import { fileSize, timeAgo } from '@/lib/format';

interface SystemInfo {
  backups: { name: string; size: number; created_at: string }[];
  lastBackup: { ok: boolean; reason: string; name?: string; error?: string; finished_at: string; filesCopied?: number } | null;
  backupHour: number;
  backupKeep: number;
  email: { outgoing: boolean; inbound: { enabled: boolean; address: string | null; lastRunAt: string | null; lastError: string | null; processed: number } };
  autoCloseDays: number;
  chatDigestMinutes: number;
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
          lines={[s.email.outgoing ? 'Sending through your SMTP server' : 'SMTP not configured: emails are only logged', 'Set SMTP_HOST and related settings in .env']}
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
              : ['Off. Set IMAP_HOST in .env to let people reply to notification emails.']
          }
        />
      </div>

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
                        <a href={`/api/system/backups/${b.name}`} aria-label={`Download ${b.name}`}>
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
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
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
        <CardTitle className="flex items-center gap-2 text-sm">
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
