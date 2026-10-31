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
  Mail,
  MessageSquareText,
  Pencil,
  RotateCcw,
  Save,
  ShieldCheck,
  Undo2,
  Send,
  ShieldOff,
  TriangleAlert,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
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
import { RecipientInput } from '@/components/recipient-input';
import { AiAssistantCard } from '@/components/ai-assistant';
import { EscalatedBadge, PriorityBadge, SlaBadge, StatusBadge } from '@/components/ticket-badges';
import { RatingCard, StaffRatingCard } from '@/components/rating';
import { VisitsCard } from '@/components/visits';
import { useRealtime } from '@/hooks/use-realtime';
import { useSession } from '@/hooks/use-session';
import { api, ApiError, errorMessage } from '@/lib/api';
import { isStaffRole, OPEN_STATUSES, PRIORITY_LABELS, STATUS_LABELS, fileSize, formatDateTime, timeAgo } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Attachment, Message, Priority, Rating, ReadReceipt, SavedReply, SignoffState, StaffMember, Status, Ticket, Transcript, Visit } from '@/lib/types';
import { fillPlaceholders } from '@/lib/placeholders';

export interface TicketData {
  ticket: Ticket;
  messages: Message[];
  transcripts: Transcript[];
  reads: ReadReceipt[];
  rating: Rating | null;
  visits: Visit[];
  signoff: SignoffState;
}

const UNASSIGNED = 'none';

export default function TicketDetailPage() {
  const id = Number(useParams().id);
  const { isStaff, isAdmin, app } = useSession();
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

  const { ticket: t, messages, transcripts, reads, rating, visits, signoff } = query.data;
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
            <h1 className="type-h1 break-words">{t.subject}</h1>
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
          {isAdmin && app?.ai && <AiAssistantCard ticketId={t.id} />}
          {signoff?.active && <SignoffCard ticket={t} signoff={signoff} isStaff={isStaff} />}
          <DetailsCard ticket={t} isStaff={isStaff} onUpdate={(b) => update.mutate(b)} busy={update.isPending} />
          <VisitsCard ticket={t} visits={visits} />
          {isStaff && rating && <StaffRatingCard rating={rating} />}
          {isStaff && <TranscriptsCard transcripts={transcripts} />}
          {!isStaff && isOpen && (
            <Card className="gap-3">
              <CardHeader>
                <CardTitle className="type-h5">Need help faster?</CardTitle>
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
  const { isAdmin } = useSession();
  const [escalateOpen, setEscalateOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
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
      {isAdmin && (
        <Button variant="outline" onClick={() => setEmailOpen(true)}>
          <Mail />
          Email ticket
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
      {emailOpen && <EmailTicketDialog ticket={t} onClose={() => setEmailOpen(false)} />}
    </div>
  );
}

// Sends the ticket (details, recent conversation, full transcript attached) to anyone, from the admin's mailbox.
function EmailTicketDialog({ ticket: t, onClose }: { ticket: Ticket; onClose: () => void }) {
  const qc = useQueryClient();
  const [to, setTo] = useState<string[]>([]);
  const [cc, setCc] = useState<string[]>([]);
  const [showCc, setShowCc] = useState(false);
  const [note, setNote] = useState('');
  const send = useMutation({
    mutationFn: () => api.post<{ sentTo: string[] }>(`/tickets/${t.id}/email`, { to, cc, note }),
    onSuccess: (r) => {
      toast.success(`Ticket #${t.id} sent to ${r.sentTo.length} ${r.sentTo.length === 1 ? 'person' : 'people'}`);
      qc.invalidateQueries({ queryKey: ['ticket', t.id] });
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!to.length) return toast.error('Add at least one recipient');
            send.mutate();
          }}
        >
          <DialogHeader>
            <DialogTitle>Email ticket #{t.id}</DialogTitle>
            <DialogDescription>
              Sends the ticket details and the conversation, with the full transcript attached, from your mailbox. Internal notes are never included.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="share-to">To</Label>
              {!showCc && (
                <Button type="button" variant="ghost" size="xs" onClick={() => setShowCc(true)}>
                  Add Cc
                </Button>
              )}
            </div>
            <RecipientInput id="share-to" value={to} onChange={setTo} placeholder="name@company.com" />
          </div>
          {showCc && (
            <div className="grid gap-2">
              <Label htmlFor="share-cc">Cc</Label>
              <RecipientInput id="share-cc" value={cc} onChange={setCc} />
            </div>
          )}
          <div className="grid gap-2">
            <Label htmlFor="share-note">Message (optional)</Label>
            <Textarea id="share-note" rows={4} maxLength={5000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="For example: Can you check the router logs for this site?" />
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={send.isPending}>
              {send.isPending ? <Loader2 className="animate-spin" /> : <Send />}
              Send
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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
      <UserAvatar name={m.user_name ?? m.sender_name} userId={m.user_id} className="mt-0.5" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span className="font-medium">{m.user_name ?? m.sender_name ?? 'Deleted user'}</span>
          {own && <span className="text-xs text-muted-foreground">(you)</span>}
          {m.sender_email && (
            <Badge variant="outline" className="font-normal" title={m.sender_email}>
              <Mail />
              External, by email
            </Badge>
          )}
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
        {(m.cc || m.bcc) && (
          <div className="space-y-0.5 text-xs text-muted-foreground">
            {m.cc && <div className="break-all">Cc: {m.cc.join(', ')}</div>}
            {m.bcc && <div className="break-all">Bcc: {m.bcc.join(', ')}</div>}
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
  const { isAdmin, app } = useSession();
  const [showCopies, setShowCopies] = useState(false);
  const [cc, setCc] = useState<string[]>([]);
  const [bcc, setBcc] = useState<string[]>([]);
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

  // "Use this draft" from the AI assistant drops the text into this reply box.
  useEffect(() => {
    const onDraft = (e: Event) => {
      const { ticketId, text } = (e as CustomEvent<{ ticketId: number; text: string }>).detail;
      if (ticketId !== ticket.id) return;
      setMode('reply');
      setBody(text);
      document.getElementById(`composer-${ticket.id}`)?.focus();
      toast.success('Draft added to the reply box. Review it before sending.');
    };
    window.addEventListener('ticket-draft', onDraft);
    return () => window.removeEventListener('ticket-draft', onDraft);
  }, [ticket.id]);

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
    if (!internal && cc.length) fd.set('cc', cc.join(','));
    if (!internal && bcc.length) fd.set('bcc', bcc.join(','));
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
      setCc([]);
      setBcc([]);
      setShowCopies(false);
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
        id={`composer-${ticket.id}`}
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
      {isAdmin && !internal && showCopies && (
        <div className="grid gap-2 rounded-md border bg-background p-3">
          <div className="grid grid-cols-[2.5rem_1fr] items-center gap-2">
            <label htmlFor="reply-cc" className="text-sm text-muted-foreground">
              Cc
            </label>
            <RecipientInput id="reply-cc" value={cc} onChange={setCc} placeholder="name@company.com" />
          </div>
          <div className="grid grid-cols-[2.5rem_1fr] items-center gap-2">
            <label htmlFor="reply-bcc" className="text-sm text-muted-foreground">
              Bcc
            </label>
            <RecipientInput id="reply-bcc" value={bcc} onChange={setBcc} placeholder="name@company.com" />
          </div>
          <p className="text-xs text-muted-foreground">
            This reply will be emailed from {app?.mailbox ?? 'your mailbox'} to the client and these people, with any attachments. Their replies come back to this ticket.
            Bcc addresses are only visible to staff.
          </p>
        </div>
      )}
      <FileChips list={files} />
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <AttachButton list={files}>Attach</AttachButton>
          {isAdmin && !internal && (
            <Button type="button" variant={showCopies ? 'secondary' : 'ghost'} size="sm" onClick={() => setShowCopies((v) => !v)}>
              <Users />
              Cc / Bcc
            </Button>
          )}
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

// Resolved tickets close only after other admins sign off. Shows progress, and lets admins approve or send back.
function SignoffCard({ ticket: t, signoff, isStaff }: { ticket: Ticket; signoff: SignoffState; isStaff: boolean }) {
  const { user, isAdmin } = useSession();
  const qc = useQueryClient();
  const [comment, setComment] = useState('');
  const [sendingBack, setSendingBack] = useState(false);
  const decide = useMutation({
    mutationFn: (decision: 'approve' | 'reject') => api.post<{ closed: boolean }>(`/tickets/${t.id}/signoff`, { decision, comment }),
    onSuccess: (r, decision) => {
      toast.success(decision === 'reject' ? 'Sent back. The ticket is in progress again.' : r.closed ? 'Signed off. The ticket is now closed.' : 'Signed off. Waiting for another admin.');
      setComment('');
      setSendingBack(false);
      qc.invalidateQueries({ queryKey: ['ticket', t.id] });
      qc.invalidateQueries({ queryKey: ['tickets'] });
      qc.invalidateQueries({ queryKey: ['actions'] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  // Clients only learn that the resolution is being reviewed.
  if (!isStaff) {
    return (
      <Alert>
        <ShieldCheck />
        <AlertTitle>Being reviewed</AlertTitle>
        <AlertDescription>Our team is checking the resolution before closing this ticket. If the problem comes back, just reply.</AlertDescription>
      </Alert>
    );
  }

  const approvals = signoff.approvals ?? [];
  const required = signoff.required ?? 2;
  const mine = signoff.requestedBy?.id === user?.id;
  const done = approvals.some((a) => a.user_id === user?.id);
  const canDecide = isAdmin && !mine && !done;

  return (
    <Card className="gap-3 border-amber-500/40 bg-amber-50/60 dark:bg-amber-950/20">
      <CardHeader>
        <CardTitle className="type-h5 flex items-center gap-2">
          <ShieldCheck className="size-4 text-amber-700 dark:text-amber-400" />
          Waiting for sign-off
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          {signoff.requestedBy ? `${signoff.requestedBy.name} marked this resolved` : 'Marked resolved'}
          {signoff.requestedAt ? ` ${timeAgo(signoff.requestedAt)}` : ''}. It closes once {required === 1 ? 'another admin approves' : `${required} other admins approve`}.
        </p>
        <div className="flex items-center gap-2">
          {Array.from({ length: required }).map((_, i) => (
            <span key={i} className={cn('h-1.5 flex-1 rounded-full', i < approvals.length ? 'bg-emerald-500' : 'bg-muted-foreground/20')} />
          ))}
          <span className="shrink-0 text-xs font-medium tabular-nums">
            {approvals.length} of {required}
          </span>
        </div>
        {approvals.length > 0 && (
          <ul className="space-y-1.5">
            {approvals.map((a) => (
              <li key={a.user_id} className="flex gap-2">
                <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                <span>
                  <span className="font-medium">{a.name}</span> <span className="text-muted-foreground">approved {timeAgo(a.created_at)}</span>
                  {a.comment && <span className="block text-muted-foreground">&ldquo;{a.comment}&rdquo;</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
        {canDecide ? (
          <div className="space-y-2">
            <Textarea
              rows={2}
              maxLength={2000}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={sendingBack ? 'Why is it being sent back? (required)' : 'Comment (optional)'}
            />
            {sendingBack ? (
              <div className="flex flex-wrap justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setSendingBack(false)} disabled={decide.isPending}>
                  Cancel
                </Button>
                <Button size="sm" variant="destructive" onClick={() => decide.mutate('reject')} disabled={decide.isPending || !comment.trim()}>
                  {decide.isPending ? <Loader2 className="animate-spin" /> : <Undo2 />}
                  Send back to In progress
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap justify-end gap-2">
                <Button size="sm" variant="outline" onClick={() => setSendingBack(true)} disabled={decide.isPending}>
                  <Undo2 />
                  Send back
                </Button>
                <Button size="sm" onClick={() => decide.mutate('approve')} disabled={decide.isPending}>
                  {decide.isPending ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
                  {approvals.length + 1 >= required ? 'Approve and close' : 'Approve'}
                </Button>
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            {!isAdmin
              ? 'Admins sign off resolved tickets.'
              : mine
                ? 'You resolved this ticket, so other admins sign it off. They have been emailed.'
                : 'You have approved this ticket. Waiting for another admin.'}
          </p>
        )}
      </CardContent>
    </Card>
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

interface DetailDraft {
  status: Status;
  priority: Priority;
  category: string;
  assigned_to: number | null;
}

function DetailsCard({ ticket: t, isStaff, onUpdate, busy }: { ticket: Ticket; isStaff: boolean; onUpdate: (b: Record<string, unknown>) => void; busy: boolean }) {
  const { app } = useSession();
  const staff = useQuery({
    queryKey: ['staff'],
    queryFn: () => api.get<{ staff: StaffMember[] }>('/staff'),
    enabled: isStaff,
    staleTime: 5 * 60_000,
  });

  // Changes are a draft until Save (and a confirmation), so nothing changes on the ticket by accident.
  const saved: DetailDraft = { status: t.status, priority: t.priority, category: t.category, assigned_to: t.assigned_to ?? null };
  const [draft, setDraft] = useState<DetailDraft>(saved);
  const [confirming, setConfirming] = useState(false);
  const savedKey = JSON.stringify(saved);
  // When someone else updates the ticket (or after saving), start again from what is stored.
  useEffect(() => setDraft(JSON.parse(savedKey)), [savedKey]);
  const set = <K extends keyof DetailDraft>(k: K, v: DetailDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const staffName = (id: number | null) => (id ? (staff.data?.staff.find((s) => s.id === id)?.name ?? t.assignee_name ?? `#${id}`) : 'Unassigned');
  const changes = [
    draft.status !== saved.status && { label: 'Status', from: STATUS_LABELS[saved.status], to: STATUS_LABELS[draft.status] },
    draft.priority !== saved.priority && { label: 'Priority', from: PRIORITY_LABELS[saved.priority], to: PRIORITY_LABELS[draft.priority] },
    draft.category !== saved.category && { label: 'Category', from: saved.category, to: draft.category },
    draft.assigned_to !== saved.assigned_to && { label: 'Assignee', from: staffName(saved.assigned_to), to: staffName(draft.assigned_to) },
  ].filter(Boolean) as { label: string; from: string; to: string }[];
  const dirty = changes.length > 0;

  function save() {
    const body: Record<string, unknown> = {};
    for (const k of Object.keys(draft) as (keyof DetailDraft)[]) if (draft[k] !== saved[k]) body[k] = draft[k];
    onUpdate(body);
    setConfirming(false);
  }

  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle className="type-h5">Details</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {isStaff ? (
          <>
            <DetailRow label="Status">
              <Select value={draft.status} onValueChange={(v) => set('status', v as Status)}>
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
              <Select value={draft.priority} onValueChange={(v) => set('priority', v as Priority)}>
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
              <Select value={draft.category} onValueChange={(v) => set('category', v)}>
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
              <Select value={draft.assigned_to ? String(draft.assigned_to) : UNASSIGNED} onValueChange={(v) => set('assigned_to', v === UNASSIGNED ? null : Number(v))}>
                <SelectTrigger size="sm" className="h-auto min-h-8 w-full py-1 [&_[data-slot=select-value]]:flex-col [&_[data-slot=select-value]]:items-start [&_[data-slot=select-value]]:gap-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                  {staff.data?.staff.map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      <span className="flex min-w-0 flex-col text-left leading-tight">
                        <span className="truncate">{s.name}</span>
                        <span className="truncate text-xs text-muted-foreground">{s.email}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </DetailRow>
            {dirty && (
              <div className="flex items-center justify-end gap-2 rounded-md bg-muted/50 p-2">
                <span className="mr-auto text-xs text-muted-foreground">
                  {changes.length} unsaved change{changes.length === 1 ? '' : 's'}
                </span>
                <Button size="sm" variant="ghost" onClick={() => setDraft(saved)} disabled={busy}>
                  Reset
                </Button>
                <Button size="sm" onClick={() => setConfirming(true)} disabled={busy}>
                  {busy ? <Loader2 className="animate-spin" /> : <Save />}
                  Save
                </Button>
              </div>
            )}
            <AlertDialog open={confirming} onOpenChange={setConfirming}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Save changes to ticket #{t.id}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    The client is told about status changes, and a new assignee is notified. Are you sure you want to make these changes?
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <ul className="space-y-1.5 rounded-md border p-3 text-sm">
                  {changes.map((c) => (
                    <li key={c.label} className="grid grid-cols-[5.5rem_1fr] gap-2">
                      <span className="text-muted-foreground">{c.label}</span>
                      <span>
                        <span className="text-muted-foreground line-through">{c.from}</span> <span className="font-medium">{c.to}</span>
                      </span>
                    </li>
                  ))}
                </ul>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={save}>Yes, save changes</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
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
        <CardTitle className="type-h5">Archived transcripts</CardTitle>
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
