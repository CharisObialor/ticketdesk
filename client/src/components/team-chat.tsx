import { useEffect, useState, type KeyboardEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCheck, Loader2, LogOut, Pencil, Send, ShieldCheck, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { Bubble, BubbleContent } from '@/components/ui/bubble';
import { Marker, MarkerContent } from '@/components/ui/marker';
import { Message as UiMessage, MessageAvatar, MessageContent, MessageFooter, MessageHeader } from '@/components/ui/message';
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '@/components/ui/message-scroller';
import { EmptyState, UserAvatar } from '@/components/common';
import { useSession } from '@/hooks/use-session';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime, formatTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { EditBox } from '@/pages/ticket-detail';

export interface TeamMessage {
  id: number;
  chat_id: number;
  user_id: number | null;
  body: string;
  kind: 'message' | 'system';
  created_at: string;
  edited_at: string | null;
  user_name: string | null;
  user_avatar_url: string | null;
}
export interface TeamChatData {
  chat: { id: number; name: string; is_direct: boolean; created_by: number | null };
  members: { id: number; name: string; job_title: string | null; avatar_url: string | null; last_read_id: number }[];
  messages: TeamMessage[];
}
interface AdminOption {
  id: number;
  name: string;
  job_title: string | null;
  avatar_url: string | null;
}

// Admin chat: direct messages and groups between admins. No emails or bell notices; messages arrive live.
export function TeamPane({ chatId }: { chatId: number }) {
  const qc = useQueryClient();
  const { user } = useSession();
  const [adding, setAdding] = useState(false);
  const query = useQuery({ queryKey: ['team', chatId], queryFn: () => api.get<TeamChatData>(`/team/chats/${chatId}`), retry: false });
  const messages = query.data?.messages ?? [];

  // Keep the chat marked as read while it is open.
  useEffect(() => {
    if (!messages.length) return;
    api.post(`/team/chats/${chatId}/read`).then(
      () => qc.invalidateQueries({ queryKey: ['chats'] }),
      () => {}
    );
  }, [chatId, messages.length, qc]);

  if (query.isPending) {
    return (
      <div className="flex flex-1 flex-col gap-4 p-4">
        <Skeleton className="h-12 w-1/2" />
        <Skeleton className="h-16 w-2/3" />
      </div>
    );
  }
  if (query.isError || !query.data) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <EmptyState icon={ShieldCheck} title="Conversation not found" description="You may have left this chat." />
      </div>
    );
  }
  const { chat, members } = query.data;
  const others = members.filter((m) => m.id !== user?.id);
  const lastMine = [...messages].reverse().find((m) => m.kind === 'message' && m.user_id === user?.id);
  const seen = lastMine ? others.filter((m) => m.last_read_id >= lastMine.id) : [];
  const seenBy = seen.length && seen.length === others.length && others.length > 1 ? ['everyone'] : seen.map((m) => m.name.split(' ')[0]);

  async function leave() {
    try {
      await api.post(`/team/chats/${chatId}/leave`);
      qc.invalidateQueries({ queryKey: ['chats'] });
      window.history.back();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <>
      <div className="flex items-center gap-3 border-b px-4 py-3">
        <Button variant="ghost" size="icon-sm" className="md:hidden" asChild>
          <Link to="/messages" aria-label="Back to conversations">
            <ArrowLeft />
          </Link>
        </Button>
        <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <ShieldCheck className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{chat.name}</div>
          <div className="truncate text-xs text-muted-foreground">
            {chat.is_direct ? 'Admin chat · only the two of you' : `Admin group · ${members.map((m) => (m.id === user?.id ? 'You' : m.name.split(' ')[0])).join(', ')}`}
          </div>
        </div>
        {!chat.is_direct && (
          <div className="flex shrink-0 items-center gap-1">
            <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
              <UserPlus />
              <span className="hidden sm:inline">Add admins</span>
            </Button>
            <Button variant="ghost" size="sm" onClick={leave}>
              <LogOut />
              <span className="hidden sm:inline">Leave</span>
            </Button>
          </div>
        )}
      </div>
      <MessageScrollerProvider key={chatId} autoScroll defaultScrollPosition="end">
        <MessageScroller className="min-h-0 flex-1">
          <MessageScrollerViewport>
            <MessageScrollerContent className="gap-1 px-4 py-4">
              {messages.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No messages yet. Say hello.</p>}
              {messages.map((m, i) => (
                <MessageScrollerItem key={m.id} messageId={String(m.id)} scrollAnchor={m.user_id === user?.id}>
                  <TeamBubble message={m} prev={messages[i - 1]} own={m.user_id === user?.id} seenBy={m.id === lastMine?.id ? seenBy : undefined} chatId={chatId} />
                </MessageScrollerItem>
              ))}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>
      <TeamComposer chatId={chatId} />
      {adding && <AddAdminsDialog chatId={chatId} memberIds={members.map((m) => m.id)} onClose={() => setAdding(false)} />}
    </>
  );
}

const sameBlock = (a: TeamMessage | undefined, b: TeamMessage) =>
  !!a && a.kind === 'message' && b.kind === 'message' && a.user_id === b.user_id && new Date(b.created_at.replace(' ', 'T')).getTime() - new Date(a.created_at.replace(' ', 'T')).getTime() < 5 * 60000;

function TeamBubble({ message: m, prev, own, seenBy, chatId }: { message: TeamMessage; prev?: TeamMessage; own: boolean; seenBy?: string[]; chatId: number }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  if (m.kind === 'system') {
    return (
      <Marker variant="separator" className="py-2 text-xs" title={formatDateTime(m.created_at)}>
        <MarkerContent>{m.body}</MarkerContent>
      </Marker>
    );
  }
  async function save(body: string) {
    setBusy(true);
    try {
      const { message } = await api.patch<{ message: TeamMessage }>(`/team/chats/${chatId}/messages/${m.id}`, { body });
      qc.setQueryData<TeamChatData>(['team', chatId], (p) => (p ? { ...p, messages: p.messages.map((x) => (x.id === message.id ? message : x)) } : p));
      setEditing(false);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  const grouped = sameBlock(prev, m);
  return (
    <UiMessage align={own ? 'end' : 'start'} className={cn(!grouped && 'pt-3')}>
      <MessageAvatar className={cn('self-start', (grouped || own) && 'invisible')}>
        {!grouped && !own && <UserAvatar name={m.user_name} userId={m.user_id} src={m.user_avatar_url} />}
      </MessageAvatar>
      <MessageContent className="max-w-[75%] gap-1">
        {!grouped && (
          <MessageHeader className={cn('gap-2 px-0 font-normal text-foreground', own && 'flex-row-reverse')}>
            <span className="font-medium">{own ? 'You' : (m.user_name ?? 'Former admin')}</span>
            <span className="text-muted-foreground" title={formatDateTime(m.created_at)}>
              {formatTime(m.created_at)}
            </span>
          </MessageHeader>
        )}
        {editing ? (
          <div className="w-72 max-w-full">
            <EditBox initial={m.body} busy={busy} onCancel={() => setEditing(false)} onSave={save} />
          </div>
        ) : (
          <div className={cn('group/bubble flex items-center gap-1', own && 'flex-row-reverse')}>
            <Bubble variant={own ? 'default' : 'muted'} align={own ? 'end' : 'start'} className="max-w-full">
              <BubbleContent className={cn('rounded-2xl whitespace-pre-wrap', own ? 'rounded-tr-sm' : 'rounded-tl-sm')}>{m.body}</BubbleContent>
            </Bubble>
            {own && (
              <Button
                variant="ghost"
                size="icon-xs"
                className="shrink-0 opacity-100 sm:opacity-0 sm:group-hover/bubble:opacity-100 focus-visible:opacity-100"
                onClick={() => setEditing(true)}
                aria-label="Edit message"
              >
                <Pencil />
              </Button>
            )}
          </div>
        )}
        {m.edited_at && !editing && <span className="text-[10px] text-muted-foreground italic">edited</span>}
        {seenBy && seenBy.length > 0 && (
          <MessageFooter className="gap-1 px-0 text-[11px] font-normal">
            <CheckCheck className="size-3.5 text-primary" />
            Seen by {seenBy.join(', ')}
          </MessageFooter>
        )}
      </MessageContent>
    </UiMessage>
  );
}

function TeamComposer({ chatId }: { chatId: number }) {
  const qc = useQueryClient();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  async function send() {
    const text = body.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      const { message } = await api.post<{ message: TeamMessage }>(`/team/chats/${chatId}/messages`, { body: text });
      qc.setQueryData<TeamChatData>(['team', chatId], (p) => (p && !p.messages.some((x) => x.id === message.id) ? { ...p, messages: [...p.messages, message] } : p));
      qc.invalidateQueries({ queryKey: ['chats'] });
      setBody('');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };
  return (
    <div className="flex items-end gap-2 border-t p-3">
      <Textarea rows={1} maxLength={10000} placeholder="Message the admins (Enter to send)" className="max-h-40 min-h-10 resize-none" value={body} onChange={(e) => setBody(e.target.value)} onKeyDown={onKey} />
      <Button onClick={send} disabled={busy || !body.trim()} aria-label="Send">
        {busy ? <Loader2 className="animate-spin" /> : <Send />}
      </Button>
    </div>
  );
}

function useAdmins(enabled: boolean) {
  return useQuery({ queryKey: ['team-admins'], queryFn: () => api.get<{ admins: AdminOption[] }>('/team/admins'), enabled, staleTime: 60_000 });
}

function AdminPicker({ admins, chosen, onToggle, disabled = [] }: { admins: AdminOption[]; chosen: number[]; onToggle: (id: number) => void; disabled?: number[] }) {
  if (!admins.length) return <p className="text-sm text-muted-foreground">There are no other admins yet.</p>;
  return (
    <ul className="max-h-64 divide-y overflow-y-auto rounded-md border">
      {admins.map((a) => (
        <li key={a.id}>
          <label className={cn('flex items-center gap-3 px-3 py-2 text-sm', disabled.includes(a.id) ? 'opacity-50' : 'cursor-pointer hover:bg-muted/50')}>
            <Checkbox checked={chosen.includes(a.id) || disabled.includes(a.id)} disabled={disabled.includes(a.id)} onCheckedChange={() => onToggle(a.id)} />
            <UserAvatar name={a.name} userId={a.id} src={a.avatar_url} className="size-7" />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{a.name}</span>
              {a.job_title && <span className="block truncate text-xs text-muted-foreground">{a.job_title}</span>}
            </span>
          </label>
        </li>
      ))}
    </ul>
  );
}

// Start an admin chat: one admin makes a direct chat; two or more make a group.
export function NewTeamChatDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const admins = useAdmins(true);
  const [chosen, setChosen] = useState<number[]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const toggle = (id: number) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  async function start() {
    setBusy(true);
    try {
      const { chat } = await api.post<{ chat: { id: number } }>('/team/chats', { user_ids: chosen, name: chosen.length > 1 ? name : '' });
      qc.invalidateQueries({ queryKey: ['chats'] });
      onClose();
      navigate(`/messages/team/${chat.id}`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New admin chat</DialogTitle>
          <DialogDescription>Chat privately with other admins. Clients and agents never see these chats, and no emails are sent.</DialogDescription>
        </DialogHeader>
        {admins.isPending ? <Skeleton className="h-32" /> : <AdminPicker admins={admins.data?.admins ?? []} chosen={chosen} onToggle={toggle} />}
        {chosen.length > 1 && (
          <div className="grid gap-2">
            <Label htmlFor="team-name">Group name (optional)</Label>
            <Input id="team-name" maxLength={120} placeholder="For example: Escalations desk" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button onClick={start} disabled={busy || !chosen.length}>
            {busy && <Loader2 className="animate-spin" />}
            {chosen.length > 1 ? 'Start group' : 'Start chat'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddAdminsDialog({ chatId, memberIds, onClose }: { chatId: number; memberIds: number[]; onClose: () => void }) {
  const qc = useQueryClient();
  const admins = useAdmins(true);
  const [chosen, setChosen] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const toggle = (id: number) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  async function add() {
    setBusy(true);
    try {
      await api.post(`/team/chats/${chatId}/members`, { user_ids: chosen });
      qc.invalidateQueries({ queryKey: ['team', chatId] });
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add admins</DialogTitle>
          <DialogDescription>They will see the whole conversation.</DialogDescription>
        </DialogHeader>
        {admins.isPending ? <Skeleton className="h-32" /> : <AdminPicker admins={admins.data?.admins ?? []} chosen={chosen} onToggle={toggle} disabled={memberIds} />}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button onClick={add} disabled={busy || !chosen.length}>
            {busy && <Loader2 className="animate-spin" />}
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
