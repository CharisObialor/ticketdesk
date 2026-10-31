import { useEffect, useMemo, useRef, useState, type FormEvent, type HTMLAttributes, type KeyboardEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  CheckCheck,
  Eye,
  ExternalLink,
  Link2,
  MessageSquare,
  Loader2,
  Lock,
  LogOut,
  MessagesSquare,
  Pencil,
  Plus,
  Search,
  Send,
  Ticket as TicketIcon,
  UserMinus,
  UserPlus,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { EmptyState, UserAvatar } from '@/components/common';
import { AttachButton, FileChips, useFileList } from '@/components/file-attachments';
import { Message as UiMessage, MessageAvatar, MessageContent, MessageFooter, MessageHeader } from '@/components/ui/message';
import { Bubble, BubbleContent } from '@/components/ui/bubble';
import { Marker, MarkerContent, MarkerIcon } from '@/components/ui/marker';
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '@/components/ui/message-scroller';
import { StatusBadge } from '@/components/ticket-badges';
import { useRealtime, type GroupData } from '@/hooks/use-realtime';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu';
import { useSession } from '@/hooks/use-session';
import { api, ApiError, errorMessage } from '@/lib/api';
import { ROLE_LABELS, formatDateTime, formatTime, isStaffRole, parseTs, timeAgo } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { ChatItem, ChatMessage, Company, Role } from '@/lib/types';
import { Attachments, Composer, EditBox, Thread, type TicketData } from '@/pages/ticket-detail';
import { basename } from '@/lib/url-key';
import { apiHref } from '@/lib/api';

type Filter = 'all' | 'group' | 'ticket';

export function useInbox() {
  return useQuery({
    queryKey: ['chats'],
    queryFn: () => api.get<{ items: ChatItem[]; unread: number }>('/chats'),
    refetchInterval: 60_000,
  });
}

export default function MessagesPage() {
  const { type, id } = useParams();
  const selected = type === 'group' || type === 'ticket' ? { type, id: Number(id) } : null;
  const [creating, setCreating] = useState(false);

  return (
    <Card className="h-[calc(100svh-9.5rem)] min-h-[480px] gap-0 overflow-hidden py-0 md:grid md:grid-cols-[340px_minmax(0,1fr)]">
      <div className={cn('flex min-h-0 flex-col border-r', selected ? 'hidden md:flex' : 'flex h-full')}>
        <ConversationList selected={selected} onNewGroup={() => setCreating(true)} />
      </div>
      <div className={cn('min-h-0 flex-col', selected ? 'flex h-full' : 'hidden md:flex')}>
        {selected?.type === 'group' ? (
          <GroupPane key={`g${selected.id}`} groupId={selected.id} />
        ) : selected?.type === 'ticket' ? (
          <TicketPane key={`t${selected.id}`} ticketId={selected.id} />
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <EmptyState
              icon={MessagesSquare}
              title="Select a conversation"
              description="Choose a group or ticket conversation from the list, or start a new group."
              action={
                <Button variant="outline" onClick={() => setCreating(true)}>
                  <Plus />
                  New group
                </Button>
              }
            />
          </div>
        )}
      </div>
      {creating && <NewGroupDialog onClose={() => setCreating(false)} />}
    </Card>
  );
}

interface SearchHit {
  type: 'group' | 'ticket';
  id: number;
  message_id: number;
  title: string;
  company_name: string;
  user_name: string | null;
  snippet: string;
  created_at: string;
  internal?: boolean;
}

function Highlight({ text, term }: { text: string; term: string }) {
  const i = text.toLowerCase().indexOf(term.toLowerCase());
  if (!term || i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded-sm bg-amber-200/70 px-0.5 text-foreground dark:bg-amber-500/30">{text.slice(i, i + term.length)}</mark>
      {text.slice(i + term.length)}
    </>
  );
}

function ConversationList({ selected, onNewGroup }: { selected: { type: string; id: number } | null; onNewGroup: () => void }) {
  const inbox = useInbox();
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const term = search.trim().toLowerCase();
  const items = (inbox.data?.items ?? []).filter(
    (i) => (filter === 'all' || i.type === filter) && (!term || i.title.toLowerCase().includes(term) || i.subtitle.toLowerCase().includes(term))
  );
  const unread = (t: Filter) => (inbox.data?.items ?? []).filter((i) => (t === 'all' || i.type === t) && i.unread > 0).length;

  // Searches inside message text too (server-side), after a short pause in typing.
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(id);
  }, [search]);
  const searchQuery = useQuery({
    queryKey: ['chat-search', debounced],
    queryFn: () => api.get<{ results: SearchHit[] }>(`/chats/search?q=${encodeURIComponent(debounced)}`),
    enabled: debounced.length >= 2,
  });
  const hits = term.length >= 2 ? (searchQuery.data?.results ?? []).filter((h) => filter === 'all' || h.type === filter) : [];
  const searching = term.length >= 2 && (searchQuery.isFetching || debounced !== search.trim());

  return (
    <>
      <div className="space-y-3 border-b p-4">
        <div className="flex items-center justify-between">
          <h1 className="type-h3">Messages</h1>
          <Button size="sm" onClick={onNewGroup}>
            <Plus />
            New group
          </Button>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search conversations" className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
          <TabsList className="w-full">
            {(['all', 'group', 'ticket'] as Filter[]).map((f) => (
              <TabsTrigger key={f} value={f}>
                {f === 'all' ? 'All' : f === 'group' ? 'Groups' : 'Tickets'}
                {unread(f) > 0 && <span className="ml-1 rounded-full bg-primary px-1.5 text-[10px] leading-4 text-primary-foreground">{unread(f)}</span>}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {inbox.isPending ? (
          <div className="space-y-2 p-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : items.length === 0 && !hits.length ? (
          <EmptyState
            icon={term ? Search : filter === 'ticket' ? TicketIcon : Users}
            title={term ? (searching ? 'Searching...' : 'No matches') : filter === 'group' ? 'No group conversations yet' : 'No conversations yet'}
            description={
              term ? undefined : filter === 'ticket' ? 'Ticket conversations appear here.' : 'Start a group to chat with your colleagues and our support team.'
            }
          />
        ) : (
          <>
            {term && items.length > 0 && <div className="px-4 pt-3 pb-1 text-xs font-medium text-muted-foreground">Conversations</div>}
            <ul className="divide-y">
              {items.map((i) => (
                <li key={`${i.type}-${i.id}`}>
                  <ConversationRow item={i} active={selected?.type === i.type && selected.id === i.id} />
                </li>
              ))}
            </ul>
            {hits.length > 0 && (
              <>
                <div className="border-t px-4 pt-3 pb-1 text-xs font-medium text-muted-foreground">In messages</div>
                <ul className="divide-y">
                  {hits.map((h) => (
                    <li key={`${h.type}-${h.message_id}`}>
                      <Link to={`/messages/${h.type}/${h.id}`} className="block px-4 py-2.5 transition-colors hover:bg-muted/50">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-sm font-medium">{h.title}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(h.created_at)}</span>
                        </div>
                        <p className="line-clamp-2 text-xs text-muted-foreground">
                          <span className="font-medium text-foreground">{h.user_name ?? 'Someone'}:</span> <Highlight text={h.snippet} term={term} />
                        </p>
                        {h.internal && <span className="text-[10px] text-amber-700 dark:text-amber-400">Internal note</span>}
                      </Link>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}

function ConversationRow({ item: i, active }: { item: ChatItem; active: boolean }) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <ConversationLink item={i} active={active} />
      </ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        <ContextMenuItem asChild>
          <Link to={`/messages/${i.type}/${i.id}`}>
            <MessageSquare />
            Open conversation
          </Link>
        </ContextMenuItem>
        {i.type === 'ticket' && (
          <ContextMenuItem asChild>
            <Link to={`/tickets/${i.id}`}>
              <TicketIcon />
              Open ticket page
            </Link>
          </ContextMenuItem>
        )}
        <ContextMenuItem onClick={() => window.open(`${basename ?? ''}/messages/${i.type}/${i.id}`, '_blank', 'noopener')}>
          <ExternalLink />
          Open in new tab
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onClick={() =>
            navigator.clipboard.writeText(`${window.location.origin}/messages/${i.type}/${i.id}`).then(
              () => toast.success('Link copied'),
              () => toast.error('Could not copy')
            )
          }
        >
          <Link2 />
          Copy link
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

// The right-click menu passes its event handlers through these props onto the link.
function ConversationLink({ item: i, active, ...rest }: { item: ChatItem; active: boolean } & HTMLAttributes<HTMLAnchorElement>) {
  const Icon = i.type === 'group' ? Users : TicketIcon;
  const preview = i.last_body ? (i.last_kind === 'system' || !i.last_user ? i.last_body : `${i.last_user}: ${i.last_body}`) : 'No messages yet';
  return (
    <Link {...rest} to={`/messages/${i.type}/${i.id}`} className={cn('flex gap-3 px-4 py-3 transition-colors hover:bg-muted/50', active && 'bg-muted')}>
      <div
        className={cn(
          'flex size-10 shrink-0 items-center justify-center rounded-full',
          i.type === 'group' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
        )}
      >
        <Icon className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className={cn('truncate text-sm', i.unread ? 'font-semibold' : 'font-medium')}>{i.title}</span>
          <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(i.last_at)}</span>
        </div>
        <div className="truncate text-xs text-muted-foreground">{i.subtitle}</div>
        <div className="mt-1 flex items-center gap-2">
          <span className={cn('min-w-0 flex-1 truncate text-xs', i.unread ? 'text-foreground' : 'text-muted-foreground')}>{preview}</span>
          {!i.is_member && (
            <Badge variant="outline" className="gap-1 px-1.5 py-0 text-[10px] font-normal">
              <Eye className="size-3" />
              Viewing
            </Badge>
          )}
          {i.status && <StatusBadge status={i.status} className="px-1.5 py-0 text-[10px]" />}
          {i.unread > 0 && <span className="rounded-full bg-primary px-1.5 text-[10px] leading-4 font-medium text-primary-foreground">{i.unread}</span>}
        </div>
      </div>
    </Link>
  );
}

function PaneHeader({ icon: Icon, title, subtitle, actions }: { icon: typeof Users; title: string; subtitle: string; actions?: ReactNode }) {
  return (
    <div className="flex items-center gap-3 border-b px-4 py-3">
      <Button variant="ghost" size="icon-sm" className="md:hidden" asChild>
        <Link to="/messages" aria-label="Back to conversations">
          <ArrowLeft />
        </Link>
      </Button>
      <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Icon className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold">{title}</div>
        <div className="truncate text-xs text-muted-foreground">{subtitle}</div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
    </div>
  );
}

// ---- Group conversation ----

function GroupPane({ groupId }: { groupId: number }) {
  const qc = useQueryClient();
  const { user } = useSession();
  const { groupTypingFor } = useRealtime();
  const [showMembers, setShowMembers] = useState(false);
  const query = useQuery({
    queryKey: ['group', groupId],
    queryFn: () => api.get<GroupData>(`/chats/groups/${groupId}`),
    retry: (count, err) => !(err instanceof ApiError && err.status === 404) && count < 2,
  });
  const messages = query.data?.messages ?? [];
  const typing = groupTypingFor(groupId);
  const isMember = query.data?.group.is_member;

  // Keep the conversation marked as read while it is open.
  useEffect(() => {
    if (!isMember || !messages.length) return;
    api.post(`/chats/groups/${groupId}/read`).then(
      () => qc.invalidateQueries({ queryKey: ['chats'] }),
      () => {}
    );
  }, [groupId, isMember, messages.length, qc]);

  if (query.isPending) return <PaneSkeleton />;
  if (query.isError) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <EmptyState icon={MessagesSquare} title="Conversation not found" description="You may have been removed from this group." />
      </div>
    );
  }

  const { group, members } = query.data;
  // "Seen by" sits under my latest message: other members whose read marker has reached it.
  const lastMine = [...messages].reverse().find((m) => m.kind === 'message' && m.user_id === user?.id);
  const others = members.filter((mem) => mem.id !== user?.id);
  const seen = lastMine ? others.filter((mem) => mem.last_read_id >= lastMine.id) : [];
  const seenBy = seen.length && seen.length === others.length && others.length > 1 ? ['everyone'] : seen.map((mem) => mem.name.split(' ')[0]);
  return (
    <>
      <PaneHeader
        icon={Users}
        title={group.name}
        subtitle={`${group.company_name} · ${members.map((m) => (m.id === user?.id ? 'You' : m.name.split(' ')[0])).join(', ')}`}
        actions={
          <Button variant="outline" size="sm" onClick={() => setShowMembers(true)}>
            <Users />
            <span className="hidden sm:inline">{members.length} members</span>
          </Button>
        }
      />
      {/* shadcn chat layout: opens at the newest message, follows new ones while you are at the bottom. */}
      <MessageScrollerProvider key={groupId} autoScroll defaultScrollPosition="end">
        <MessageScroller className="min-h-0 flex-1">
          <MessageScrollerViewport>
            <MessageScrollerContent className="gap-1 px-4 py-4">
              {messages.map((m, i) => (
                <MessageScrollerItem key={m.id} messageId={String(m.id)} scrollAnchor={m.user_id === user?.id}>
                  <ChatBubble message={m} prev={messages[i - 1]} own={m.user_id === user?.id} seenBy={m.id === lastMine?.id ? seenBy : undefined} />
                </MessageScrollerItem>
              ))}
              {typing.length > 0 && (
                <Marker className="pt-2 text-xs">
                  <MarkerIcon>
                    <Loader2 className="size-3 animate-spin" />
                  </MarkerIcon>
                  <MarkerContent>
                    {typing.join(', ')} {typing.length === 1 ? 'is' : 'are'} typing
                  </MarkerContent>
                </Marker>
              )}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>
      {!isMember && (
        <div className="px-4 pt-3">
          <Alert>
            <Eye />
            <AlertDescription>You are viewing this group as an admin. Sending a message will add you to the group.</AlertDescription>
          </Alert>
        </div>
      )}
      <GroupComposer groupId={groupId} />
      {showMembers && <MembersSheet data={query.data} onClose={() => setShowMembers(false)} />}
    </>
  );
}

function PaneSkeleton() {
  return (
    <div className="flex flex-1 flex-col gap-4 p-4">
      <Skeleton className="h-12 w-1/2" />
      <Skeleton className="h-16 w-2/3" />
      <Skeleton className="ml-auto h-16 w-1/2" />
      <Skeleton className="h-16 w-3/5" />
    </div>
  );
}

const sameBlock = (a: ChatMessage | undefined, b: ChatMessage) =>
  !!a && a.kind === 'message' && a.user_id === b.user_id && (parseTs(b.created_at)?.getTime() ?? 0) - (parseTs(a.created_at)?.getTime() ?? 0) < 5 * 60_000;

function ChatBubble({ message: m, prev, own, seenBy }: { message: ChatMessage; prev?: ChatMessage; own: boolean; seenBy?: string[] }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const save = useMutation({
    mutationFn: (body: string) => api.patch<{ message: ChatMessage }>(`/chats/groups/${m.group_id}/messages/${m.id}`, { body }),
    onSuccess: ({ message }) => {
      qc.setQueryData<GroupData>(['group', m.group_id], (prev) =>
        prev ? { ...prev, messages: prev.messages.map((x) => (x.id === message.id ? message : x)) } : prev
      );
      setEditing(false);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  if (m.kind === 'system') {
    return (
      <Marker variant="separator" className="py-2 text-xs" title={formatDateTime(m.created_at)}>
        <MarkerContent>{m.body}</MarkerContent>
      </Marker>
    );
  }
  const grouped = sameBlock(prev, m);
  const staff = isStaffRole(m.user_role);
  return (
    <UiMessage align={own ? 'end' : 'start'} className={cn(!grouped && 'pt-3')}>
      <MessageAvatar className={cn('self-start', (grouped || own) && 'invisible')}>
        {!grouped && !own && <UserAvatar name={m.user_name} userId={m.user_id} />}
      </MessageAvatar>
      <MessageContent className="max-w-[75%] gap-1">
        {!grouped && (
          <MessageHeader className={cn('gap-2 px-0 font-normal text-foreground', own && 'flex-row-reverse')}>
            <span className="font-medium">{own ? 'You' : (m.user_name ?? 'Deleted user')}</span>
            {staff && !own && (
              <Badge variant="secondary" className="px-1.5 py-0 text-[10px] font-normal">
                {m.user_role ? ROLE_LABELS[m.user_role] : 'Staff'}
              </Badge>
            )}
            <span className="text-muted-foreground" title={formatDateTime(m.created_at)}>
              {formatTime(m.created_at)}
            </span>
          </MessageHeader>
        )}
        {editing ? (
          <div className="w-72 max-w-full">
            <EditBox initial={m.body} busy={save.isPending} onCancel={() => setEditing(false)} onSave={(body) => save.mutate(body)} />
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
        {m.edited_at && !editing && (
          <span className="text-[10px] text-muted-foreground italic" title={`Edited ${formatDateTime(m.edited_at)}`}>
            edited
          </span>
        )}
        {m.attachments.length > 0 && <Attachments items={m.attachments} base={apiHref('/api/chats/files')} />}
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

function GroupComposer({ groupId }: { groupId: number }) {
  const qc = useQueryClient();
  const { sendGroupTyping } = useRealtime();
  const files = useFileList();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const typingTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const typingOn = useRef(false);

  const stopTyping = () => {
    clearTimeout(typingTimer.current);
    if (typingOn.current) sendGroupTyping(groupId, false);
    typingOn.current = false;
  };
  useEffect(() => stopTyping, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if (busy || (!body.trim() && !files.files.length)) return;
    setBusy(true);
    stopTyping();
    const fd = new FormData();
    fd.set('body', body.trim());
    for (const f of files.files) fd.append('files', f);
    try {
      const { message } = await api.post<{ message: ChatMessage }>(`/chats/groups/${groupId}/messages`, fd);
      qc.setQueryData<GroupData>(['group', groupId], (prev) =>
        prev && !prev.messages.some((m) => m.id === message.id) ? { ...prev, messages: [...prev.messages, message] } : prev
      );
      qc.invalidateQueries({ queryKey: ['group', groupId] });
      qc.invalidateQueries({ queryKey: ['chats'] });
      setBody('');
      files.clear();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <form onSubmit={submit} className="space-y-2 border-t p-3">
      <FileChips list={files} />
      <div className="flex items-end gap-2">
        <AttachButton list={files} />
        <Textarea
          rows={1}
          value={body}
          placeholder="Write a message"
          className="max-h-40 min-h-9 flex-1 resize-none py-2"
          onKeyDown={onKeyDown}
          onChange={(e) => {
            setBody(e.target.value);
            if (!typingOn.current) sendGroupTyping(groupId, true);
            typingOn.current = true;
            clearTimeout(typingTimer.current);
            typingTimer.current = setTimeout(stopTyping, 3000);
          }}
          onPaste={(e) => {
            const pasted = Array.from(e.clipboardData.files);
            if (pasted.length) {
              e.preventDefault();
              files.add(pasted);
            }
          }}
        />
        <Button type="submit" size="icon" disabled={busy || (!body.trim() && !files.files.length)} aria-label="Send message">
          {busy ? <Loader2 className="animate-spin" /> : <Send />}
        </Button>
      </div>
      <p className="hidden text-xs text-muted-foreground sm:block">Enter to send, Shift + Enter for a new line</p>
    </form>
  );
}

function MembersSheet({ data, onClose }: { data: GroupData; onClose: () => void }) {
  const { group, members } = data;
  const { user } = useSession();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(group.name);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['group', group.id] });
    qc.invalidateQueries({ queryKey: ['chats'] });
  };
  const remove = useMutation({
    mutationFn: (userId: number) => api.delete(`/chats/groups/${group.id}/members/${userId}`),
    onSuccess: (_, userId) => {
      if (userId === user?.id) {
        toast.success('You left the group');
        qc.invalidateQueries({ queryKey: ['chats'] });
        navigate('/messages');
      } else refresh();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const rename = useMutation({
    mutationFn: () => api.patch(`/chats/groups/${group.id}`, { name }),
    onSuccess: () => {
      setRenaming(false);
      refresh();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="flex flex-col gap-0">
        <SheetHeader>
          {renaming ? (
            <form
              className="flex gap-2 pr-6"
              onSubmit={(e) => {
                e.preventDefault();
                rename.mutate();
              }}
            >
              <Input value={name} maxLength={120} autoFocus onChange={(e) => setName(e.target.value)} />
              <Button type="submit" size="sm" disabled={rename.isPending}>
                Save
              </Button>
            </form>
          ) : (
            <SheetTitle className="flex items-center gap-2">
              {group.name}
              {group.can_manage && (
                <Button variant="ghost" size="icon-xs" onClick={() => setRenaming(true)} aria-label="Rename group">
                  <Pencil />
                </Button>
              )}
            </SheetTitle>
          )}
          <SheetDescription>
            {group.company_name} · created {timeAgo(group.created_at)}
          </SheetDescription>
        </SheetHeader>
        <Separator />
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <span className="text-sm font-medium">{members.length} members</span>
          {group.can_manage && (
            <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
              <UserPlus />
              Add people
            </Button>
          )}
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto px-2">
          {members.map((m) => (
            <li key={m.id} className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-muted/50">
              <UserAvatar name={m.name} userId={m.id} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">
                  {m.name}
                  {m.id === user?.id && <span className="ml-1 text-xs font-normal text-muted-foreground">(you)</span>}
                </div>
                <div className="truncate text-xs text-muted-foreground">{m.email}</div>
              </div>
              <Badge variant={m.role === 'client' ? 'outline' : 'secondary'}>{ROLE_LABELS[m.role]}</Badge>
              {group.can_manage && m.id !== user?.id && (
                <Button variant="ghost" size="icon-sm" onClick={() => remove.mutate(m.id)} disabled={remove.isPending} aria-label={`Remove ${m.name}`}>
                  <UserMinus />
                </Button>
              )}
            </li>
          ))}
        </ul>
        {group.is_member && (
          <SheetFooter className="border-t">
            <Button variant="outline" className="text-destructive" onClick={() => user && remove.mutate(user.id)} disabled={remove.isPending}>
              <LogOut />
              Leave group
            </Button>
          </SheetFooter>
        )}
        {adding && <AddMembersDialog data={data} onClose={() => setAdding(false)} onAdded={refresh} />}
      </SheetContent>
    </Sheet>
  );
}

// ---- People picker shared by "new group" and "add people" ----

interface Candidate {
  id: number;
  name: string;
  email: string;
  role: Role;
  company_id: number | null;
}

function useCandidates(companyId: number | null, enabled: boolean) {
  return useQuery({
    queryKey: ['chat-candidates', companyId],
    queryFn: () => api.get<{ users: Candidate[] }>(`/chats/candidates${companyId ? `?company_id=${companyId}` : ''}`),
    enabled,
  });
}

function PeoplePicker({
  people,
  selected,
  onToggle,
  exclude = [],
}: {
  people: Candidate[];
  selected: number[];
  onToggle: (id: number) => void;
  exclude?: number[];
}) {
  const [search, setSearch] = useState('');
  const term = search.trim().toLowerCase();
  const visible = people.filter((p) => !exclude.includes(p.id) && (!term || p.name.toLowerCase().includes(term) || p.email.toLowerCase().includes(term)));
  const sections: [string, Candidate[]][] = [
    ['Colleagues', visible.filter((p) => p.role === 'client')],
    ['Support team', visible.filter((p) => p.role !== 'client')],
  ];
  return (
    <div className="grid gap-2">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="Search people" className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <div className="max-h-64 overflow-y-auto rounded-md border">
        {sections.map(([label, list]) =>
          list.length ? (
            <div key={label}>
              <div className="sticky top-0 bg-muted/80 px-3 py-1.5 text-xs font-medium text-muted-foreground backdrop-blur">{label}</div>
              {list.map((p) => (
                <label key={p.id} className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-muted/50">
                  <Checkbox checked={selected.includes(p.id)} onCheckedChange={() => onToggle(p.id)} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">{p.name}</div>
                    <div className="truncate text-xs text-muted-foreground">{p.email}</div>
                  </div>
                  {p.role !== 'client' && <Badge variant={p.role === 'admin' ? 'default' : 'secondary'}>{ROLE_LABELS[p.role]}</Badge>}
                </label>
              ))}
            </div>
          ) : null
        )}
        {visible.length === 0 && <p className="p-4 text-center text-sm text-muted-foreground">No people found</p>}
      </div>
    </div>
  );
}

const toggle = (list: number[], id: number) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

function NewGroupDialog({ onClose }: { onClose: () => void }) {
  const { isStaff, user } = useSession();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [companyId, setCompanyId] = useState<number | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const companies = useQuery({ queryKey: ['companies'], queryFn: () => api.get<{ companies: Company[] }>('/companies'), enabled: isStaff });
  const candidates = useCandidates(isStaff ? companyId : null, !isStaff || !!companyId);
  const people = candidates.data?.users ?? [];
  const includesAdmin = user?.role === 'admin' || people.some((p) => p.role === 'admin' && selected.includes(p.id));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!includesAdmin) return toast.error('Add at least one admin to the group');
    setBusy(true);
    try {
      const { group } = await api.post<{ group: { id: number } }>('/chats/groups', { name, company_id: companyId, member_ids: selected });
      qc.invalidateQueries({ queryKey: ['chats'] });
      onClose();
      navigate(`/messages/group/${group.id}`);
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
            <DialogTitle>New group</DialogTitle>
            <DialogDescription>
              {isStaff
                ? 'Start a group conversation with a client company. Every group includes at least one admin.'
                : 'Chat with colleagues from your company and our support team. Every group includes at least one admin.'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="group-name">Group name *</Label>
            <Input id="group-name" required maxLength={120} placeholder="For example: Network upgrade" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          {isStaff && (
            <div className="grid gap-2">
              <Label>Company *</Label>
              <Select
                value={companyId ? String(companyId) : ''}
                onValueChange={(v) => {
                  setCompanyId(Number(v));
                  setSelected([]);
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a company" />
                </SelectTrigger>
                <SelectContent>
                  {companies.data?.companies
                    .filter((c) => c.is_active)
                    .map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {(!isStaff || companyId) && (
            <div className="grid gap-2">
              <Label>Members</Label>
              {candidates.isPending ? (
                <Skeleton className="h-40" />
              ) : (
                <PeoplePicker people={people} selected={selected} onToggle={(id) => setSelected((s) => toggle(s, id))} />
              )}
              <p className={cn('text-xs', includesAdmin ? 'text-muted-foreground' : 'text-amber-700 dark:text-amber-400')}>
                {selected.length} selected{includesAdmin ? '' : ' · include at least one admin'}
              </p>
            </div>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={busy || !selected.length || (isStaff && !companyId)}>
              {busy && <Loader2 className="animate-spin" />}
              Create group
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AddMembersDialog({ data, onClose, onAdded }: { data: GroupData; onClose: () => void; onAdded: () => void }) {
  const { isStaff } = useSession();
  const [selected, setSelected] = useState<number[]>([]);
  const candidates = useCandidates(isStaff ? data.group.company_id : null, true);
  const existing = useMemo(() => data.members.map((m) => m.id), [data.members]);
  const add = useMutation({
    mutationFn: () => api.post(`/chats/groups/${data.group.id}/members`, { user_ids: selected }),
    onSuccess: () => {
      toast.success(`Added ${selected.length} ${selected.length === 1 ? 'person' : 'people'}`);
      onAdded();
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add people</DialogTitle>
          <DialogDescription>Add colleagues from {data.group.company_name} or members of the support team, including technicians.</DialogDescription>
        </DialogHeader>
        {candidates.isPending ? (
          <Skeleton className="h-40" />
        ) : (
          <PeoplePicker people={candidates.data?.users ?? []} exclude={existing} selected={selected} onToggle={(id) => setSelected((s) => toggle(s, id))} />
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button onClick={() => add.mutate()} disabled={!selected.length || add.isPending}>
            {add.isPending && <Loader2 className="animate-spin" />}
            Add {selected.length || ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- Ticket conversation (same thread as the ticket page) ----

function TicketPane({ ticketId }: { ticketId: number }) {
  const { isStaff } = useSession();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['ticket', ticketId],
    queryFn: () => api.get<TicketData>(`/tickets/${ticketId}`),
    retry: (count, err) => !(err instanceof ApiError && err.status === 404) && count < 2,
  });
  const count = query.data?.messages.length ?? 0;

  useEffect(() => {
    if (!count) return;
    api.post(`/chats/tickets/${ticketId}/read`).then(
      () => qc.invalidateQueries({ queryKey: ['chats'] }),
      () => {}
    );
  }, [ticketId, count, qc]);

  if (query.isPending) return <PaneSkeleton />;
  if (query.isError) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <EmptyState icon={TicketIcon} title="Ticket not found" />
      </div>
    );
  }
  const { ticket: t, messages } = query.data;
  return (
    <>
      <PaneHeader
        icon={TicketIcon}
        title={t.subject}
        subtitle={`#${t.id} · ${t.company_name}`}
        actions={
          <>
            <StatusBadge status={t.status} className="hidden sm:inline-flex" />
            <Button variant="outline" size="sm" asChild>
              <Link to={`/tickets/${t.id}`}>
                <ExternalLink />
                <span className="hidden sm:inline">Open ticket</span>
              </Link>
            </Button>
          </>
        }
      />
      <Thread ticket={t} messages={messages} isStaff={isStaff} reads={query.data.reads} fill />
      <Separator />
      {t.status === 'closed' && !isStaff ? (
        <div className="p-4">
          <Alert>
            <Lock />
            <AlertDescription>This ticket is closed and can no longer receive replies.</AlertDescription>
          </Alert>
        </div>
      ) : (
        <Composer ticket={t} isStaff={isStaff} />
      )}
    </>
  );
}
