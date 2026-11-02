import { useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Ban, ChevronDown, Copy, Forward, Loader2, Pencil, Pin, PinOff, Reply, Search, ShieldCheck, Trash2, Users, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Bubble, BubbleContent } from '@/components/ui/bubble';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { ConversationPicture } from '@/components/conversation-image';
import { useInbox } from '@/hooks/use-inbox';
import { useSession } from '@/hooks/use-session';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime, parseTs } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Attachment, PinnedMessage, Reaction, ReplyPreview } from '@/lib/types';

// Group chats ("group") and admin chats ("team") share these message actions.
export type ChatScope = 'group' | 'team';
export const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

export interface ActionMessage {
  id: number;
  user_id: number | null;
  user_name: string | null;
  body: string;
  kind: 'message' | 'system';
  created_at: string;
  attachments: Attachment[];
  reply_to?: ReplyPreview | null;
  reactions?: Reaction[];
  pinned?: boolean;
  forwarded?: boolean;
  deleted?: boolean;
}
type ConversationData = { messages: ActionMessage[]; pins?: PinnedMessage[] };

const conversationKey = (scope: ChatScope, id: number) => [scope === 'group' ? 'group' : 'team', id];
const minutesSince = (ts: string) => (Date.now() - (parseTs(ts)?.getTime() ?? Date.now())) / 60000;
const fileOnly = (m: Pick<ActionMessage, 'body' | 'attachments'>) => m.body === '(attachment)' && m.attachments.length > 0;

// A one-line description of a message, for the reply bar.
export const messageSummary = (m: Pick<ActionMessage, 'body' | 'attachments'>) =>
  fileOnly(m) ? (m.attachments.length === 1 ? m.attachments[0].original_name : `${m.attachments.length} attachments`) : m.body;

// Scrolls to a message in the open chat and briefly highlights it.
export function jumpToMessage(scope: ChatScope, id: number) {
  const el = document.getElementById(`msg-${scope}-${id}`);
  if (!el) {
    toast.info('That message is further back than this chat shows');
    return;
  }
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.animate([{ backgroundColor: 'color-mix(in oklab, var(--primary) 16%, transparent)' }, { backgroundColor: 'transparent' }], { duration: 1800, easing: 'ease-out' });
}

export function useMessageActions(scope: ChatScope, conversationId: number) {
  const qc = useQueryClient();
  const key = conversationKey(scope, conversationId);
  const base = `/chat-messages/${scope}`;
  const put = (message: ActionMessage, pins?: PinnedMessage[]) =>
    qc.setQueryData<ConversationData>(key, (p) =>
      p ? { ...p, messages: p.messages.map((m) => (m.id === message.id ? { ...m, ...message } : m)), ...(pins ? { pins } : {}) } : p
    );
  const run = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  return {
    react: (id: number, emoji: string) =>
      run(async () => {
        put((await api.post<{ message: ActionMessage }>(`${base}/${id}/react`, { emoji })).message);
      }),
    pin: (id: number, pinned: boolean) =>
      run(async () => {
        const r = await api.post<{ message: ActionMessage; pins: PinnedMessage[] }>(`${base}/${id}/pin`, { pinned });
        put(r.message, r.pins);
        toast.success(pinned ? 'Message pinned' : 'Message unpinned');
      }),
    hide: (id: number) =>
      run(async () => {
        await api.post(`${base}/${id}/hide`);
        qc.setQueryData<ConversationData>(key, (p) => (p ? { ...p, messages: p.messages.filter((m) => m.id !== id) } : p));
      }),
    deleteForEveryone: (id: number) =>
      run(async () => {
        const r = await api.delete<{ message: ActionMessage; pins: PinnedMessage[] }>(`${base}/${id}`);
        put(r.message, r.pins);
        qc.invalidateQueries({ queryKey: ['chats'] });
      }),
  };
}

// The options menu beside a message: reactions, reply, copy, forward, pin, edit and delete.
export function MessageMenu({
  message: m,
  own,
  scope,
  conversationId,
  onReply,
  onEdit,
}: {
  message: ActionMessage;
  own: boolean;
  scope: ChatScope;
  conversationId: number;
  onReply: () => void;
  onEdit: () => void;
}) {
  const { app, user } = useSession();
  const actions = useMessageActions(scope, conversationId);
  const [forwarding, setForwarding] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const age = minutesSince(m.created_at);
  const editable = own && !m.deleted && !fileOnly(m) && age <= (app?.chat?.editMinutes ?? 15);
  const mine = m.reactions?.find((r) => user && r.user_ids.includes(user.id))?.emoji;

  async function copy() {
    try {
      await navigator.clipboard.writeText(m.body);
      toast.success('Copied');
    } catch {
      toast.error('Could not copy. Select the text and copy it instead.');
    }
  }

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            className="shrink-0 self-center opacity-100 data-[state=open]:opacity-100 sm:opacity-0 sm:group-hover/bubble:opacity-100 focus-visible:opacity-100"
            aria-label="Message options"
          >
            <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align={own ? 'end' : 'start'} className="w-56">
          {!m.deleted && (
            <>
              <div className="flex items-center justify-between gap-0.5 p-1" role="group" aria-label="React">
                {REACTIONS.map((e) => (
                  <DropdownMenuItem
                    key={e}
                    aria-label={`React ${e}`}
                    className={cn('size-8 justify-center p-0 text-lg leading-none', mine === e && 'bg-accent ring-1 ring-primary/40')}
                    onSelect={() => actions.react(m.id, e)}
                  >
                    {e}
                  </DropdownMenuItem>
                ))}
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onReply}>
                <Reply />
                Reply
              </DropdownMenuItem>
              {!fileOnly(m) && (
                <DropdownMenuItem onSelect={copy}>
                  <Copy />
                  Copy
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={() => setForwarding(true)}>
                <Forward />
                Forward
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => actions.pin(m.id, !m.pinned)}>
                {m.pinned ? <PinOff /> : <Pin />}
                {m.pinned ? 'Unpin' : 'Pin'}
              </DropdownMenuItem>
              {editable && (
                <DropdownMenuItem onSelect={onEdit}>
                  <Pencil />
                  Edit
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(true)}>
            <Trash2 />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {forwarding && <ForwardDialog scope={scope} conversationId={conversationId} message={m} onClose={() => setForwarding(false)} />}
      <DeleteDialog
        open={deleting}
        onOpenChange={setDeleting}
        canDeleteForEveryone={own && !m.deleted && age <= (app?.chat?.deleteMinutes ?? 60)}
        tooLate={own && !m.deleted && age > (app?.chat?.deleteMinutes ?? 60)}
        deleteMinutes={app?.chat?.deleteMinutes ?? 60}
        onForMe={() => actions.hide(m.id)}
        onForEveryone={() => actions.deleteForEveryone(m.id)}
      />
    </>
  );
}

function DeleteDialog({
  open,
  onOpenChange,
  canDeleteForEveryone,
  tooLate,
  deleteMinutes,
  onForMe,
  onForEveryone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canDeleteForEveryone: boolean;
  tooLate: boolean;
  deleteMinutes: number;
  onForMe: () => void;
  onForEveryone: () => void;
}) {
  const done = (fn: () => void) => () => {
    onOpenChange(false);
    fn();
  };
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete message?</AlertDialogTitle>
          <AlertDialogDescription>
            {canDeleteForEveryone
              ? 'Delete it for everyone, or only remove it from your own view of this chat.'
              : tooLate
                ? `Messages can be deleted for everyone within ${deleteMinutes} minutes of sending. This one can only be removed from your own view.`
                : 'This removes it from your own view of this chat. Everyone else still sees it.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button variant="outline" onClick={done(onForMe)}>
            Delete for me
          </Button>
          {canDeleteForEveryone && (
            <Button variant="destructive" onClick={done(onForEveryone)}>
              Delete for everyone
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

const MAX_FORWARD = 10;

function ForwardDialog({ scope, conversationId, message, onClose }: { scope: ChatScope; conversationId: number; message: ActionMessage; onClose: () => void }) {
  const qc = useQueryClient();
  const inbox = useInbox();
  const [q, setQ] = useState('');
  const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  // Chats this person can post in, other than this one: groups they belong to, and admin chats (which only admins have).
  const options = useMemo(
    () =>
      (inbox.data?.items ?? [])
        .filter((i) => ((i.type === 'group' && i.is_member) || i.type === 'team') && !(i.type === scope && i.id === conversationId))
        .filter((i) => !q.trim() || `${i.title} ${i.subtitle}`.toLowerCase().includes(q.trim().toLowerCase())),
    [inbox.data, q, scope, conversationId]
  );
  const toggle = (k: string) =>
    setChosen((c) => (c.includes(k) ? c.filter((x) => x !== k) : c.length >= MAX_FORWARD ? (toast.error(`Up to ${MAX_FORWARD} chats at a time`), c) : [...c, k]));

  async function send() {
    setBusy(true);
    try {
      const to = chosen.map((k) => ({ type: k.split(':')[0], id: Number(k.split(':')[1]) }));
      const r = await api.post<{ sent: number }>(`/chat-messages/${scope}/${message.id}/forward`, { to });
      qc.invalidateQueries({ queryKey: ['chats'] });
      for (const t of to) qc.invalidateQueries({ queryKey: [t.type, t.id] });
      toast.success(r.sent === 1 ? 'Message forwarded' : `Forwarded to ${r.sent} chats`);
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Forward message</DialogTitle>
          <DialogDescription className="line-clamp-2">{messageSummary(message)}</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search chats" className="pl-8" />
        </div>
        <div className="-mx-1 max-h-72 space-y-0.5 overflow-y-auto px-1">
          {options.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No chats to forward to</p>}
          {options.map((i) => {
            const k = `${i.type}:${i.id}`;
            return (
              <label key={k} className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 hover:bg-accent">
                <Checkbox checked={chosen.includes(k)} onCheckedChange={() => toggle(k)} />
                <ConversationPicture image={i.image ?? null} name={i.title} icon={i.type === 'team' ? ShieldCheck : Users} className="size-8" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{i.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">{i.subtitle}</span>
                </span>
              </label>
            );
          })}
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button onClick={send} disabled={!chosen.length || busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Forward />}
            Forward{chosen.length > 1 ? ` to ${chosen.length}` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// The message a reply answers, shown at the top of the reply. Clicking it jumps to that message.
export function ReplyQuote({ reply, own, scope, meId }: { reply: ReplyPreview; own: boolean; scope: ChatScope; meId?: number }) {
  return (
    <button
      type="button"
      onClick={() => jumpToMessage(scope, reply.id)}
      className={cn(
        'mb-1.5 block w-full min-w-0 rounded-md border-l-[3px] px-2 py-1 text-left text-xs whitespace-normal',
        own ? 'border-primary-foreground/70 bg-primary-foreground/15' : 'border-primary bg-background/70'
      )}
    >
      <span className="block font-semibold">{reply.user_id && reply.user_id === meId ? 'You' : (reply.user_name ?? 'Someone')}</span>
      <span className={cn('line-clamp-2 opacity-85', reply.deleted && 'italic')}>{reply.body}</span>
    </button>
  );
}

export function ForwardedLabel({ className }: { className?: string }) {
  return (
    <span className={cn('flex items-center gap-1 text-[11px] text-muted-foreground italic', className)}>
      <Forward className="size-3" />
      Forwarded
    </span>
  );
}

export function DeletedBubble() {
  return (
    <span className="flex items-center gap-1.5 rounded-2xl border border-dashed px-3 py-2 text-sm text-muted-foreground italic">
      <Ban className="size-3.5" />
      This message was deleted
    </span>
  );
}

// Reaction counts under a message. Clicking one adds or removes your reaction.
export function ReactionChips({ message: m, own, scope, conversationId }: { message: ActionMessage; own: boolean; scope: ChatScope; conversationId: number }) {
  const { user } = useSession();
  const actions = useMessageActions(scope, conversationId);
  if (!m.reactions?.length || m.deleted) return null;
  return (
    <div className={cn('flex flex-wrap gap-1', own && 'justify-end')}>
      {m.reactions.map((r) => {
        const mine = !!user && r.user_ids.includes(user.id);
        return (
          <button
            key={r.emoji}
            type="button"
            title={r.names.join(', ')}
            aria-label={`${r.emoji} ${r.user_ids.length}: ${r.names.join(', ')}`}
            onClick={() => actions.react(m.id, r.emoji)}
            className={cn(
              'inline-flex h-6 items-center gap-1 rounded-full border bg-background px-2 text-xs shadow-xs',
              mine ? 'border-primary/60 bg-primary/10 text-primary' : 'hover:bg-accent'
            )}
          >
            <span className="text-sm leading-none">{r.emoji}</span>
            {r.user_ids.length}
          </button>
        );
      })}
    </div>
  );
}

// Above the message box while replying: who and what is being answered.
export function ReplyBar({ message, meId, onCancel }: { message: ActionMessage; meId?: number; onCancel: () => void }) {
  return (
    <div className="flex items-start gap-2 rounded-md border-l-[3px] border-primary bg-muted/60 py-1.5 pr-1 pl-2.5 text-xs">
      <Reply className="mt-0.5 size-3.5 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <div className="font-semibold text-primary">Replying to {message.user_id === meId ? 'yourself' : (message.user_name ?? 'Someone')}</div>
        <div className="truncate text-muted-foreground">{messageSummary(message)}</div>
      </div>
      <Button type="button" variant="ghost" size="icon-xs" onClick={onCancel} aria-label="Cancel reply">
        <X />
      </Button>
    </div>
  );
}

// Pinned messages at the top of a chat. Clicking jumps to the pin and moves on to the next one.
export function PinnedBar({ pins, scope, conversationId }: { pins?: PinnedMessage[]; scope: ChatScope; conversationId: number }) {
  const actions = useMessageActions(scope, conversationId);
  const [index, setIndex] = useState(0);
  if (!pins?.length) return null;
  const i = index % pins.length;
  const p = pins[i];
  return (
    <div className="flex items-center gap-2 border-b bg-muted/40 px-4 py-1.5">
      <Pin className="size-4 shrink-0 text-muted-foreground" />
      <button
        type="button"
        className="min-w-0 flex-1 text-left"
        onClick={() => {
          jumpToMessage(scope, p.id);
          setIndex(i + 1);
        }}
      >
        <span className="block text-[11px] text-muted-foreground">
          Pinned message{pins.length > 1 ? ` ${i + 1} of ${pins.length}` : ''}
          {p.user_name ? ` · ${p.user_name}` : ''}
        </span>
        <span className="block truncate text-sm">{p.body}</span>
      </button>
      <Button variant="ghost" size="icon-xs" aria-label="Unpin" onClick={() => actions.pin(p.id, false)}>
        <PinOff />
      </Button>
    </div>
  );
}

// The body of a chat message: forwarded label, reply quote, text bubble (or files, or "deleted"), the options menu,
// the edited mark, files and reactions. `text` is the rendered message text, `attachments` its file list.
export function MessageBody({
  message: m,
  own,
  scope,
  conversationId,
  editing,
  editor,
  text,
  attachments,
  onReply,
  onEdit,
}: {
  message: ActionMessage & { edited_at?: string | null };
  own: boolean;
  scope: ChatScope;
  conversationId: number;
  editing: boolean;
  editor: ReactNode;
  text: ReactNode;
  attachments: ReactNode;
  onReply: () => void;
  onEdit: () => void;
}) {
  const { user } = useSession();
  const files = fileOnly(m);
  const menu = <MessageMenu message={m} own={own} scope={scope} conversationId={conversationId} onReply={onReply} onEdit={onEdit} />;
  const row = (content: ReactNode) => (
    <div className={cn('flex max-w-full items-center gap-1', own && 'flex-row-reverse')}>
      {content}
      {menu}
    </div>
  );
  return (
    <>
      {m.forwarded && !m.deleted && <ForwardedLabel className={cn(own && 'self-end')} />}
      {editing ? (
        editor
      ) : m.deleted ? (
        row(<DeletedBubble />)
      ) : files ? (
        <div className={cn('flex max-w-full items-start gap-1', own && 'flex-row-reverse')}>
          <div className={cn('flex min-w-0 flex-col gap-1', own && 'items-end')}>
            {m.reply_to && <ReplyQuote reply={m.reply_to} own={false} scope={scope} meId={user?.id} />}
            {attachments}
          </div>
          {menu}
        </div>
      ) : (
        row(
          <Bubble variant={own ? 'default' : 'muted'} align={own ? 'end' : 'start'} className="max-w-full min-w-0">
            <BubbleContent className={cn('rounded-2xl whitespace-pre-wrap', own ? 'rounded-tr-sm' : 'rounded-tl-sm')}>
              {m.reply_to && <ReplyQuote reply={m.reply_to} own={own} scope={scope} meId={user?.id} />}
              {text}
            </BubbleContent>
          </Bubble>
        )
      )}
      {m.edited_at && !editing && !m.deleted && (
        <span className={cn('text-[10px] text-muted-foreground italic', own && 'self-end')} title={`Edited ${formatDateTime(m.edited_at)}`}>
          edited
        </span>
      )}
      {!editing && !m.deleted && !files && m.attachments.length > 0 && attachments}
      <ReactionChips message={m} own={own} scope={scope} conversationId={conversationId} />
    </>
  );
}
