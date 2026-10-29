import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  ArrowLeft,
  CheckCheck,
  CircleCheck,
  Download,
  FileText,
  Info,
  Loader2,
  Lock,
  MessageSquareText,
  Pencil,
  RotateCcw,
  Send,
  ShieldOff,
  TriangleAlert,
} from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { EmptyState, UserAvatar } from '@/components/common';
import { AttachButton, FileChips, useFileList } from '@/components/file-attachments';
import { EscalatedBadge, PriorityBadge, SlaBadge, StatusBadge } from '@/components/ticket-badges';
import { RatingCard, StaffRatingCard } from '@/components/rating';
import { VisitsCard } from '@/components/visits';
import { useRealtime } from '@/hooks/use-realtime';
import { useSession } from '@/hooks/use-session';
import { api, ApiError, errorMessage } from '@/lib/api';
import { isStaffRole, OPEN_STATUSES, PRIORITY_LABELS, STATUS_LABELS, fileSize, formatDateTime, timeAgo } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Attachment, Message, Priority, Rating, ReadReceipt, SavedReply, StaffMember, Status, Ticket, Transcript, Visit } from '@/lib/types';
import { fillPlaceholders } from '@/lib/placeholders';

export interface TicketData {
  ticket: Ticket;
  messages: Message[];
  transcripts: Transcript[];
  reads: ReadReceipt[];
  rating: Rating | null;
  visits: Visit[];
}

const UNASSIGNED = 'none';

export default function TicketDetailPage() {
  const id = Number(useParams().id);
  const { isStaff } = useSession();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['ticket', id],
    queryFn: () => api.get<TicketData>(`/tickets/${id}`),
    retry: (count, err) => !(err instanceof ApiError && err.status === 404) && count < 2,
  });

  const update = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch<{ ticket: Ticket }>(`/tickets/${id}`, body),
    onSuccess: ({ ticket }) => {
      qc.setQueryData<TicketData>(['ticket', id], (prev) => (prev ? { ...prev, ticket } : prev));
      qc.invalidateQueries({ queryKey: ['ticket', id] });
      qc.invalidateQueries({ queryKey: ['tickets'] });
      qc.invalidateQueries({ queryKey: ['counts'] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  // Messages that arrive live while the ticket is open count as read.
  const messageCount = query.data?.messages.length ?? 0;
  useEffect(() => {
    if (!messageCount) return;
    api.post(`/chats/tickets/${id}/read`).then(() => qc.invalidateQueries({ queryKey: ['chats'] }), () => {});
  }, [id, messageCount, qc]);

  if (query.isPending) {
    return (
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Skeleton className="h-[60vh]" />
        <Skeleton className="h-80" />
      </div>
    );
  }
  if (query.isError) {
    return (
      <Card>
        <EmptyState
          icon={TriangleAlert}
          title="Ticket not found"
          description="It may have been removed, or you may not have access to it."
          action={
            <Button variant="outline" asChild>
              <Link to="/tickets">Back to tickets</Link>
            </Button>
          }
        />
      </Card>
    );
  }

  const { ticket: t, messages, transcripts, reads, rating, visits } = query.data;
  const isOpen = OPEN_STATUSES.includes(t.status);
  const canRate = !isStaff && (t.status === 'resolved' || t.status === 'closed');

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Button variant="ghost" size="sm" className="-ml-2" asChild>
          <Link to="/tickets">
            <ArrowLeft />
            Back to tickets
          </Link>
        </Button>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span className="font-mono">#{t.id}</span>
              <span>·</span>
              <span>{t.company_name}</span>
              <span>·</span>
              <span>Opened {timeAgo(t.created_at)}</span>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight break-words">{t.subject}</h1>
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={t.status} />
              <Badge variant="secondary" className="font-normal">
                {t.category}
              </Badge>
              <PriorityBadge priority={t.priority} />
              {!!t.escalated && <EscalatedBadge level={t.escalation_level} />}
            </div>
          </div>
          <TicketActions ticket={t} isStaff={isStaff} onUpdate={(b) => update.mutate(b)} busy={update.isPending} />
        </div>
      </div>

      {canRate && <RatingCard ticket={t} rating={rating} />}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="gap-0 py-0">
          <Thread ticket={t} messages={messages} isStaff={isStaff} reads={reads} />
          <Separator />
          {t.status === 'closed' && !isStaff ? (
            <div className="p-4">
              <Alert>
                <Lock />
                <AlertTitle>This ticket is closed</AlertTitle>
                <AlertDescription>
                  <span>
                    It can no longer receive replies.{' '}
                    <Link to="/tickets/new" className="font-medium text-foreground underline underline-offset-4">
                      Raise a new ticket
                    </Link>{' '}
                    if you need more help.
                  </span>
                </AlertDescription>
              </Alert>
            </div>
          ) : (
            <Composer ticket={t} isStaff={isStaff} />
          )}
        </Card>

        <div className="space-y-6">
          <DetailsCard ticket={t} isStaff={isStaff} onUpdate={(b) => update.mutate(b)} />
          <VisitsCard ticket={t} visits={visits} />
          {isStaff && rating && <StaffRatingCard rating={rating} />}
          {isStaff && <TranscriptsCard transcripts={transcripts} />}
          {!isStaff && isOpen && (
            <Card className="gap-3">
              <CardHeader>
                <CardTitle className="text-sm">Need help faster?</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                If this issue is urgent or not progressing, you can request an escalation from the actions menu. A support manager will review it.
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function TicketActions({ ticket: t, isStaff, onUpdate, busy }: { ticket: Ticket; isStaff: boolean; onUpdate: (b: Record<string, unknown>) => void; busy: boolean }) {
  const qc = useQueryClient();
  const [escalateOpen, setEscalateOpen] = useState(false);
  const isOpen = OPEN_STATUSES.includes(t.status);

  const archive = useMutation({
    mutationFn: () => api.post(`/tickets/${t.id}/archive`),
    onSuccess: () => {
      toast.success('Transcript saved to the archive');
      qc.invalidateQueries({ queryKey: ['ticket', t.id] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const exportUrl = (format: string) => `/api/tickets/${t.id}/export?format=${format}`;

  return (
    <div className="flex shrink-0 flex-wrap gap-2">
      {!isStaff && isOpen && (
        <Button variant="outline" onClick={() => onUpdate({ status: 'resolved' })} disabled={busy}>
          <CircleCheck />
          Mark as resolved
        </Button>
      )}
      {!isStaff && t.status === 'resolved' && (
        <Button variant="outline" onClick={() => onUpdate({ status: 'open' })} disabled={busy}>
          <RotateCcw />
          Reopen ticket
        </Button>
      )}
      {(isStaff || (isOpen && !t.escalated)) && t.status !== 'closed' && (
        <Button variant="outline" onClick={() => (t.escalated && isStaff ? onUpdate({ escalate: false }) : setEscalateOpen(true))} disabled={busy}>
          {t.escalated && isStaff ? <ShieldOff /> : <TriangleAlert />}
          {t.escalated && isStaff ? 'Clear escalation' : isStaff ? 'Escalate' : 'Request escalation'}
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline">
            <Download />
            Export
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>Download conversation</DropdownMenuLabel>
          <DropdownMenuItem asChild>
            <a href={exportUrl('html')}>HTML (print to PDF)</a>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <a href={exportUrl('txt')}>Plain text</a>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <a href={exportUrl('json')}>JSON</a>
          </DropdownMenuItem>
          {isStaff && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <a href={`${exportUrl('html')}&internal=0`}>HTML without internal notes</a>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => archive.mutate()} disabled={archive.isPending}>
                <Archive />
                Save transcript to archive
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <EscalateDialog open={escalateOpen} onOpenChange={setEscalateOpen} isStaff={isStaff} onConfirm={(reason) => onUpdate({ escalate: true, reason })} />
    </div>
  );
}

function EscalateDialog({ open, onOpenChange, isStaff, onConfirm }: { open: boolean; onOpenChange: (o: boolean) => void; isStaff: boolean; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState('');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onConfirm(reason.trim());
            setReason('');
            onOpenChange(false);
          }}
          className="grid gap-4"
        >
          <DialogHeader>
            <DialogTitle>{isStaff ? 'Escalate ticket' : 'Request escalation'}</DialogTitle>
            <DialogDescription>
              {isStaff
                ? 'Escalating alerts the support managers by email and flags the ticket in the escalated queue.'
                : 'A support manager will be notified and will review this ticket as a priority.'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="reason">Reason</Label>
            <Textarea id="reason" rows={4} maxLength={500} placeholder="Explain why this needs escalating" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" variant="destructive">
              <TriangleAlert />
              Escalate
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function Thread({
  ticket,
  messages,
  isStaff,
  reads = [],
  className,
}: {
  ticket: Ticket;
  messages: Message[];
  isStaff: boolean;
  reads?: ReadReceipt[];
  className?: string;
}) {
  const { user } = useSession();
  const { typingFor } = useRealtime();
  const end = useRef<HTMLDivElement>(null);
  const typing = typingFor(ticket.id);

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' });
  }, [messages.length, typing.length]);

  // "Seen by" goes under my latest message: everyone else whose read marker has reached it.
  // Clients never see read markers on internal notes (they cannot see the notes at all).
  const lastMine = [...messages].reverse().find((m) => m.kind === 'message' && m.user_id === user?.id);
  const seenBy = lastMine
    ? reads.filter((r) => r.user_id !== user?.id && r.last_read_id >= lastMine.id && (!lastMine.is_internal || isStaffRole(r.role))).map((r) => r.name)
    : [];

  return (
    <div className={cn('max-h-[calc(100svh-22rem)] min-h-64 space-y-5 overflow-y-auto p-4 md:p-6', className)}>
      {messages.map((m) =>
        m.kind === 'system' ? (
          <div key={m.id} className="flex items-center gap-3 text-xs text-muted-foreground">
            <Separator className="flex-1" />
            <span className="flex max-w-[80%] items-center gap-1.5 text-center">
              <Info className="size-3.5 shrink-0" />
              <span>
                {m.body} <span className="opacity-70">· {formatDateTime(m.created_at)}</span>
              </span>
            </span>
            <Separator className="flex-1" />
          </div>
        ) : (
          <div key={m.id} className="space-y-1">
            <MessageItem message={m} ticket={ticket} own={m.user_id === user?.id} viewerIsStaff={isStaff} />
            {m.id === lastMine?.id && seenBy.length > 0 && (
              <div className="flex items-center justify-end gap-1 text-[11px] text-muted-foreground">
                <CheckCheck className="size-3.5 text-primary" />
                Seen by {seenBy.join(', ')}
              </div>
            )}
          </div>
        )
      )}
      {typing.length > 0 && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" />
          {typing.join(', ')} {typing.length === 1 ? 'is' : 'are'} typing
        </div>
      )}
      <div ref={end} />
    </div>
  );
}

function MessageItem({ message: m, ticket, own, viewerIsStaff }: { message: Message; ticket: Ticket; own: boolean; viewerIsStaff: boolean }) {
  const qc = useQueryClient();
  const fromStaff = isStaffRole(m.user_role);
  const internal = !!m.is_internal;
  const [editing, setEditing] = useState(false);
  const canEdit = own && ticket.status !== 'closed';
  const save = useMutation({
    mutationFn: (body: string) => api.patch<{ message: Message }>(`/tickets/${ticket.id}/messages/${m.id}`, { body }),
    onSuccess: ({ message }) => {
      qc.setQueryData<TicketData>(['ticket', ticket.id], (prev) =>
        prev ? { ...prev, messages: prev.messages.map((x) => (x.id === message.id ? message : x)) } : prev
      );
      setEditing(false);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <div className="group flex gap-3">
      <UserAvatar name={m.user_name} className="mt-0.5" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span className="font-medium">{m.user_name ?? 'Deleted user'}</span>
          {own && <span className="text-xs text-muted-foreground">(you)</span>}
          {fromStaff && !viewerIsStaff && (
            <Badge variant="secondary" className="font-normal">
              Support team
            </Badge>
          )}
          {internal && (
            <Badge variant="outline" className="border-amber-500/50 font-normal text-amber-700 dark:text-amber-400">
              <Lock />
              Internal note
            </Badge>
          )}
          <span className="text-xs text-muted-foreground" title={formatDateTime(m.created_at)}>
            {timeAgo(m.created_at)}
          </span>
          {m.edited_at && (
            <span className="text-xs text-muted-foreground italic" title={`Edited ${formatDateTime(m.edited_at)}`}>
              (edited)
            </span>
          )}
          {canEdit && !editing && (
            <Button
              variant="ghost"
              size="icon-xs"
              className="ml-auto opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100"
              onClick={() => setEditing(true)}
              aria-label="Edit message"
            >
              <Pencil />
            </Button>
          )}
        </div>
        {editing ? (
          <EditBox initial={m.body} busy={save.isPending} onCancel={() => setEditing(false)} onSave={(body) => save.mutate(body)} />
        ) : (
          <div
            className={cn(
              'rounded-lg border px-4 py-3 text-sm leading-relaxed break-words whitespace-pre-wrap',
              internal ? 'border-amber-500/30 bg-amber-50 dark:bg-amber-500/10' : fromStaff ? 'bg-muted/50' : 'bg-background'
            )}
          >
            {m.body}
          </div>
        )}
        {m.attachments.length > 0 && <Attachments items={m.attachments} />}
      </div>
    </div>
  );
}

// Inline editor shared by ticket messages and group chat messages.
export function EditBox({ initial, busy, onSave, onCancel }: { initial: string; busy: boolean; onSave: (body: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(initial);
  const changed = value.trim() && value.trim() !== initial.trim();
  return (
    <div className="space-y-2">
      <Textarea
        autoFocus
        rows={3}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel();
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && changed) onSave(value.trim());
        }}
      />
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" disabled={!changed || busy} onClick={() => onSave(value.trim())}>
          {busy && <Loader2 className="animate-spin" />}
          Save
        </Button>
      </div>
    </div>
  );
}

export function Attachments({ items, base = '/api/files' }: { items: Attachment[]; base?: string }) {
  const images = items.filter((a) => /^image\/(png|jpe?g|gif|webp)$/.test(a.mime));
  const others = items.filter((a) => !images.includes(a));
  return (
    <div className="space-y-2">
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map((a) => (
            <a key={a.id} href={`${base}/${a.id}`} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-md border hover:opacity-90">
              <img src={`${base}/${a.id}`} alt={a.original_name} className="h-28 max-w-56 object-cover" loading="lazy" />
            </a>
          ))}
        </div>
      )}
      {others.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {others.map((a) => (
            <a
              key={a.id}
              href={`${base}/${a.id}${a.mime === 'application/pdf' ? '' : '?download=1'}`}
              target="_blank"
              rel="noreferrer"
              className="flex max-w-64 items-center gap-2 rounded-md border px-3 py-2 text-xs hover:bg-muted/50"
            >
              <FileText className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate font-medium">{a.original_name}</span>
              <span className="shrink-0 text-muted-foreground">{fileSize(a.size)}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

// Lets staff insert one of their saved replies, with placeholders filled in from this ticket.
function SavedReplyPicker({ ticket, onPick }: { ticket: Ticket; onPick: (text: string) => void }) {
  const { user } = useSession();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const replies = useQuery({
    queryKey: ['saved-replies'],
    queryFn: () => api.get<{ replies: SavedReply[] }>('/saved-replies'),
    enabled: open,
  });
  const term = search.trim().toLowerCase();
  const list = (replies.data?.replies ?? []).filter((r) => !term || r.title.toLowerCase().includes(term) || r.body.toLowerCase().includes(term));
  return (
    <>
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <MessageSquareText />
        <span className="hidden sm:inline">Saved replies</span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Insert a saved reply</DialogTitle>
            <DialogDescription>Placeholders such as the client&apos;s name are filled in for this ticket. You can edit the text before sending.</DialogDescription>
          </DialogHeader>
          <Input placeholder="Search saved replies" value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
          <div className="max-h-80 space-y-1 overflow-y-auto">
            {replies.isPending ? (
              <Skeleton className="h-24" />
            ) : list.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {term ? 'No matches.' : 'No saved replies yet.'}{' '}
                <Link to="/saved-replies" className="font-medium text-foreground underline underline-offset-4">
                  Manage saved replies
                </Link>
              </p>
            ) : (
              list.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => {
                    onPick(fillPlaceholders(r.body, ticket, user));
                    setOpen(false);
                  }}
                  className="w-full rounded-md border px-3 py-2 text-left transition-colors hover:bg-muted/60"
                >
                  <div className="flex items-center gap-2 text-sm font-medium">
                    {r.title}
                    {!r.is_shared && (
                      <Badge variant="outline" className="font-normal">
                        Only me
                      </Badge>
                    )}
                  </div>
                  <div className="line-clamp-2 text-xs text-muted-foreground">{fillPlaceholders(r.body, ticket, user)}</div>
                </button>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function Composer({ ticket, isStaff }: { ticket: Ticket; isStaff: boolean }) {
  const qc = useQueryClient();
  const { sendTyping } = useRealtime();
  const files = useFileList();
  const [body, setBody] = useState('');
  const [mode, setMode] = useState<'reply' | 'note'>('reply');
  const [busy, setBusy] = useState(false);
  const typingTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const typingOn = useRef(false);
  const internal = isStaff && mode === 'note';

  const stopTyping = () => {
    clearTimeout(typingTimer.current);
    if (typingOn.current) sendTyping(ticket.id, false);
    typingOn.current = false;
  };
  useEffect(() => stopTyping, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onChange = (v: string) => {
    setBody(v);
    if (internal) return; // clients never see who is drafting an internal note
    if (!typingOn.current) sendTyping(ticket.id, true);
    typingOn.current = true;
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(stopTyping, 3000);
  };

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if (!body.trim() && !files.files.length) return;
    setBusy(true);
    stopTyping();
    const fd = new FormData();
    fd.set('body', body.trim());
    if (internal) fd.set('internal', '1');
    for (const f of files.files) fd.append('files', f);
    try {
      const { message, ticket: updated } = await api.post<{ message: Message; ticket: Ticket }>(`/tickets/${ticket.id}/messages`, fd);
      qc.setQueryData<TicketData>(['ticket', ticket.id], (prev) =>
        prev
          ? { ...prev, ticket: updated, messages: prev.messages.some((m) => m.id === message.id) ? prev.messages : [...prev.messages, message] }
          : prev
      );
      qc.invalidateQueries({ queryKey: ['ticket', ticket.id] });
      setBody('');
      files.clear();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit();
  };

  return (
    <form onSubmit={submit} className={cn('space-y-3 p-4', internal && 'bg-amber-50/60 dark:bg-amber-500/5')}>
      {isStaff && (
        <Tabs value={mode} onValueChange={(v) => setMode(v as 'reply' | 'note')}>
          <TabsList>
            <TabsTrigger value="reply">
              <Send />
              Reply to client
            </TabsTrigger>
            <TabsTrigger value="note">
              <Lock />
              Internal note
            </TabsTrigger>
          </TabsList>
        </Tabs>
      )}
      <Textarea
        rows={4}
        value={body}
        placeholder={internal ? 'Add a note for the support team. The client will not see this.' : 'Write your reply'}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onPaste={(e) => {
          const pasted = Array.from(e.clipboardData.files);
          if (pasted.length) {
            e.preventDefault();
            files.add(pasted);
          }
        }}
        className="resize-y bg-background"
      />
      <FileChips list={files} />
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <AttachButton list={files}>Attach</AttachButton>
          {isStaff && <SavedReplyPicker ticket={ticket} onPick={(text) => onChange(body.trim() ? `${body.trimEnd()}\n\n${text}` : text)} />}
          <span className="hidden text-xs text-muted-foreground lg:inline">Ctrl + Enter to send</span>
        </div>
        <Button type="submit" disabled={busy || (!body.trim() && !files.files.length)}>
          {busy ? <Loader2 className="animate-spin" /> : internal ? <Lock /> : <Send />}
          {internal ? 'Add note' : 'Send reply'}
        </Button>
      </div>
    </form>
  );
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_1fr] items-center gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function DetailsCard({ ticket: t, isStaff, onUpdate }: { ticket: Ticket; isStaff: boolean; onUpdate: (b: Record<string, unknown>) => void }) {
  const { app } = useSession();
  const staff = useQuery({
    queryKey: ['staff'],
    queryFn: () => api.get<{ staff: StaffMember[] }>('/staff'),
    enabled: isStaff,
    staleTime: 5 * 60_000,
  });

  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle className="text-sm">Details</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {isStaff ? (
          <>
            <DetailRow label="Status">
              <Select value={t.status} onValueChange={(v) => onUpdate({ status: v })}>
                <SelectTrigger size="sm" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(app?.statuses.map((s) => s.value) ?? (Object.keys(STATUS_LABELS) as Status[])).map((s) => (
                    <SelectItem key={s} value={s}>
                      {STATUS_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </DetailRow>
            <DetailRow label="Priority">
              <Select value={t.priority} onValueChange={(v) => onUpdate({ priority: v })}>
                <SelectTrigger size="sm" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(PRIORITY_LABELS) as Priority[]).map((p) => (
                    <SelectItem key={p} value={p}>
                      {PRIORITY_LABELS[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </DetailRow>
            <DetailRow label="Category">
              <Select value={t.category} onValueChange={(v) => onUpdate({ category: v })}>
                <SelectTrigger size="sm" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(app?.categories ?? [t.category]).map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </DetailRow>
            <DetailRow label="Assignee">
              <Select value={t.assigned_to ? String(t.assigned_to) : UNASSIGNED} onValueChange={(v) => onUpdate({ assigned_to: v === UNASSIGNED ? null : Number(v) })}>
                <SelectTrigger size="sm" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                  {staff.data?.staff.map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </DetailRow>
          </>
        ) : (
          <>
            <DetailRow label="Status">
              <StatusBadge status={t.status} />
            </DetailRow>
            <DetailRow label="Priority">
              <PriorityBadge priority={t.priority} />
            </DetailRow>
            <DetailRow label="Category">{t.category}</DetailRow>
            <DetailRow label="Handled by">{t.assignee_name ?? <span className="text-muted-foreground">Awaiting assignment</span>}</DetailRow>
          </>
        )}
        <Separator />
        <DetailRow label="Company">
          <span className="truncate">{t.company_name}</span>
        </DetailRow>
        <DetailRow label="Requester">
          <div className="truncate">{t.creator_name ?? '-'}</div>
          {isStaff && t.creator_email && <div className="truncate text-xs text-muted-foreground">{t.creator_email}</div>}
        </DetailRow>
        <Separator />
        <DetailRow label="Created">{formatDateTime(t.created_at)}</DetailRow>
        <DetailRow label="Last activity">{formatDateTime(t.last_activity_at)}</DetailRow>
        <DetailRow label="First response">
          <SlaBadge ticket={t} long />
        </DetailRow>
        {t.resolved_at && <DetailRow label="Resolved">{formatDateTime(t.resolved_at)}</DetailRow>}
        {!!t.escalated && t.escalated_at && <DetailRow label="Escalated">{formatDateTime(t.escalated_at)}</DetailRow>}
      </CardContent>
    </Card>
  );
}

function TranscriptsCard({ transcripts }: { transcripts: Transcript[] }) {
  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle className="text-sm">Archived transcripts</CardTitle>
      </CardHeader>
      <CardContent>
        {transcripts.length === 0 ? (
          <p className="text-sm text-muted-foreground">A transcript is saved automatically when the ticket is resolved or closed.</p>
        ) : (
          <ul className="space-y-2">
            {transcripts.map((tr) => (
              <li key={tr.id}>
                <a href={`/api/transcripts/${tr.id}/download`} className="flex items-center gap-3 rounded-md p-2 text-sm hover:bg-muted/50">
                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{formatDateTime(tr.created_at)}</div>
                    <div className="text-xs text-muted-foreground">
                      {tr.message_count} messages · {tr.reason}
                    </div>
                  </div>
                  <Download className="size-4 text-muted-foreground" />
                </a>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
