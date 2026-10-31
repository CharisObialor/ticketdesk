import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Download,
  FileText,
  Flag,
  FolderInput,
  Forward,
  Inbox,
  Loader2,
  Mail,
  MailOpen,
  Maximize2,
  Minimize2,
  Paperclip,
  Pencil,
  Printer,
  RefreshCw,
  Reply,
  ReplyAll,
  Search,
  Send,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut, ContextMenuTrigger } from '@/components/ui/context-menu';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { EmptyState, UserAvatar } from '@/components/common';
import { AttachButton, FileChips, FileTypeIcon, useFileList } from '@/components/file-attachments';
import { AttachmentPreviewDialog, type PreviewFile } from '@/components/attachment-preview';
import { Attachment, AttachmentContent, AttachmentDescription, AttachmentMedia, AttachmentTitle, AttachmentTrigger } from '@/components/ui/attachment';
import { RecipientInput } from '@/components/recipient-input';
import { RichEditor } from '@/components/rich-editor';
import { useMailboxes, type Mailbox } from '@/hooks/use-mailboxes';
import { useSession } from '@/hooks/use-session';
import { api, ApiError, errorMessage, uploadWithProgress } from '@/lib/api';
import { fileSize } from '@/lib/format';
import { cn } from '@/lib/utils';

interface Address {
  emailAddress: { name?: string; address?: string };
}
interface MailFolder {
  key: string;
  id: string;
  name: string;
  unread: number;
  total: number;
}
interface MailSummary {
  id: string;
  subject: string | null;
  from?: Address;
  toRecipients?: Address[];
  receivedDateTime: string;
  sentDateTime?: string;
  isRead: boolean;
  hasAttachments: boolean;
  bodyPreview: string;
  importance: string;
  isDraft: boolean;
  flag?: { flagStatus: 'flagged' | 'notFlagged' | 'complete' };
}
interface MailMessage extends MailSummary {
  ccRecipients?: Address[];
  bccRecipients?: Address[];
  body: { contentType: 'html' | 'text'; content: string };
  attachments: { id: string; name: string; contentType: string; size: number }[];
}

const FOLDER_ICONS: Record<string, LucideIcon> = {
  inbox: Inbox,
  sentitems: Send,
  drafts: FileText,
  archive: Archive,
  junkemail: ShieldAlert,
  deleteditems: Trash2,
};

const who = (a?: Address) => a?.emailAddress?.name || a?.emailAddress?.address || 'Unknown';
const addr = (a?: Address) => (a?.emailAddress?.address || '').toLowerCase();
const flagged = (m: MailSummary) => m.flag?.flagStatus === 'flagged';
// Every Mail request names the mailbox it is for: the admin's own, or a shared one they were given access to.
const boxUrl = (url: string, box: string) => `${url}${url.includes('?') ? '&' : '?'}mailbox=${encodeURIComponent(box)}`;

const sameDay = (d: Date) => d.toDateString() === new Date().toDateString();
function listDate(iso: string) {
  const d = new Date(iso);
  if (sameDay(d)) return d.toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase();
  const days = (Date.now() - d.getTime()) / 864e5;
  if (days < 7) return d.toLocaleDateString('en-GB', { weekday: 'short' });
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) });
}
const fullDate = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

interface ComposeState {
  mode: 'new' | 'reply' | 'replyAll' | 'forward';
  ref?: MailMessage;
  from: string;
}

const typingTarget = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || /^(input|textarea|select)$/i.test(el.tagName) || !!el.closest('[role="dialog"],[role="menu"],[role="listbox"]'));
};

export default function MailPage() {
  const { app } = useSession();
  const qc = useQueryClient();
  const mailboxes = useMailboxes(!!app?.mailbox);
  const [box, setBox] = useState(app?.mailbox ?? '');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [folder, setFolder] = useState('inbox');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [compose, setCompose] = useState<ComposeState | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [params, setParams] = useSearchParams();

  // Opened from a new-mail notice: show that email in the admin's own inbox.
  useEffect(() => {
    const open = params.get('open');
    if (!open || !app?.mailbox) return;
    setBox(app.mailbox);
    setFolder('inbox');
    setSearch('');
    setSelected(open);
    setParams({}, { replace: true });
  }, [params, setParams, app?.mailbox]);

  useEffect(() => {
    const id = setTimeout(() => setQuery(search.trim()), 400);
    return () => clearTimeout(id);
  }, [search]);

  const folders = useQuery({
    queryKey: ['mail-folders', box],
    queryFn: () => api.get<{ mailbox: string; folders: MailFolder[] }>(boxUrl('/mail/folders', box)),
    refetchInterval: 60_000,
    retry: false,
    enabled: !!box,
  });
  const list = useInfiniteQuery({
    queryKey: ['mail-list', box, folder, query],
    queryFn: ({ pageParam }) =>
      api.get<{ messages: MailSummary[]; hasMore: boolean }>(
        boxUrl(`/mail/messages?folder=${folder}&skip=${pageParam}${query ? `&q=${encodeURIComponent(query)}` : ''}`, box)
      ),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => (last.hasMore ? pages.reduce((n, p) => n + p.messages.length, 0) : undefined),
    refetchInterval: 60_000,
    enabled: !!box && !folders.isError,
  });
  const messages = useMemo(() => list.data?.pages.flatMap((p) => p.messages) ?? [], [list.data]);

  const refreshAll = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['mail-list'] });
    qc.invalidateQueries({ queryKey: ['mail-folders'] });
    qc.invalidateQueries({ queryKey: ['mail-mailboxes'] });
  }, [qc]);

  // Quick actions shared by the list rows, the reading pane and keyboard shortcuts.
  const act = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: 'read' | 'unread' | 'flag' | 'unflag' | 'archive' | 'delete' | 'purge' | 'junk' | 'inbox' }) => {
      const u = (p: string) => boxUrl(`/mail/messages/${encodeURIComponent(id)}${p}`, box);
      if (action === 'read' || action === 'unread') return api.patch(u(''), { isRead: action === 'read' });
      if (action === 'flag' || action === 'unflag') return api.patch(u(''), { flagged: action === 'flag' });
      if (action === 'delete') return api.delete(u(''));
      if (action === 'purge') return api.delete(u('?permanent=1'));
      return api.post(u('/move'), { folder: { archive: 'archive', junk: 'junkemail', inbox: 'inbox' }[action] });
    },
    onSuccess: (_d, { id, action }) => {
      const label = { archive: 'Archived', delete: 'Moved to Deleted Items', purge: 'Deleted permanently', junk: 'Moved to Junk', inbox: 'Moved to Inbox' }[
        action as string
      ];
      if (label) {
        toast.success(label);
        if (selected === id) setSelected(null);
      }
      refreshAll();
      qc.invalidateQueries({ queryKey: ['mail-message', box, id] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  // Reply, reply all or forward straight from the list (right-click), loading the full email first.
  const composeFrom = useCallback(
    async (id: string, mode: 'reply' | 'replyAll' | 'forward') => {
      try {
        const { message } = await qc.fetchQuery({
          queryKey: ['mail-message', box, id],
          queryFn: () => api.get<{ message: MailMessage }>(boxUrl(`/mail/messages/${encodeURIComponent(id)}`, box)),
        });
        setCompose({ mode, ref: message, from: box });
      } catch (err) {
        toast.error(errorMessage(err));
      }
    },
    [qc, box]
  );

  // Gmail/Outlook style keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (compose || e.ctrlKey || e.metaKey || e.altKey || typingTarget(e.target)) return;
      const idx = messages.findIndex((m) => m.id === selected);
      const cur = messages[idx];
      const k = e.key;
      if (k === 'c' || k === 'n') setCompose({ mode: 'new', from: box });
      else if (k === '/') {
        e.preventDefault();
        searchRef.current?.focus();
      } else if ((k === 'j' || k === 'ArrowDown') && messages.length) setSelected(messages[Math.min(idx + 1, messages.length - 1)]?.id ?? messages[0].id);
      else if ((k === 'k' || k === 'ArrowUp') && messages.length) setSelected(messages[Math.max(idx - 1, 0)]?.id ?? messages[0].id);
      else if (k === 'Escape') setSelected(null);
      else if (cur && k === 'e') act.mutate({ id: cur.id, action: 'archive' });
      else if (cur && (k === '#' || k === 'Delete')) act.mutate({ id: cur.id, action: folder === 'deleteditems' ? 'purge' : 'delete' });
      else if (cur && k === 'u') act.mutate({ id: cur.id, action: cur.isRead ? 'unread' : 'read' });
      else if (cur && k === 's') act.mutate({ id: cur.id, action: flagged(cur) ? 'unflag' : 'flag' });
      else if (cur && (k === 'r' || k === 'a' || k === 'f')) {
        const m = qc.getQueryData<{ message: MailMessage }>(['mail-message', box, cur.id])?.message;
        if (m) setCompose({ mode: k === 'r' ? 'reply' : k === 'a' ? 'replyAll' : 'forward', ref: m, from: box });
      } else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [messages, selected, compose, box, folder, act, qc]);

  if (!app?.mailbox || (folders.error && box === app.mailbox)) {
    const msg = folders.error instanceof ApiError ? folders.error.message : 'The Mail page needs your portal account to use your Microsoft 365 email address.';
    return (
      <Card>
        <EmptyState icon={Mail} title="Mailbox not available" description={msg} />
      </Card>
    );
  }

  const boxes = mailboxes.data?.mailboxes ?? [{ address: app.mailbox, name: 'My mailbox', own: true, unread: 0 }];
  const current = folders.data?.folders.find((f) => f.key === folder);
  const currentBox = boxes.find((b) => b.address === box);
  const openFolder = (b: string, f: string) => {
    setBox(b);
    setFolder(f);
    setSelected(null);
    setExpanded((x) => ({ ...x, [b]: true }));
  };

  return (
    <>
      <Card className="h-[calc(100svh-9.5rem)] min-h-[520px] gap-0 overflow-hidden py-0">
        {/* Toolbar */}
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <Button onClick={() => setCompose({ mode: 'new', from: box })}>
            <Pencil />
            <span className="hidden sm:inline">New email</span>
          </Button>
          <div className="relative ml-auto w-full max-w-md">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchRef}
              placeholder={`Search ${current?.name ?? 'mail'}${currentBox && !currentBox.own ? ` in ${currentBox.address}` : ''}`}
              className="pl-8"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                type="button"
                aria-label="Clear search"
                className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setSearch('')}
              >
                <X className="size-4" />
              </button>
            )}
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" onClick={refreshAll} aria-label="Refresh">
                <RefreshCw className={cn(list.isFetching && 'animate-spin')} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Refresh</TooltipContent>
          </Tooltip>
        </div>

        <div className="grid min-h-0 flex-1 md:grid-cols-[230px_360px_minmax(0,1fr)]">
          {/* Mailboxes and folders */}
          <nav className="hidden min-h-0 overflow-y-auto border-r bg-muted/20 p-2 md:block" aria-label="Mailboxes">
            {boxes.map((b) => {
              const open = expanded[b.address] ?? b.address === box;
              return (
                <div key={b.address} className="mb-1">
                  <button
                    type="button"
                    onClick={() => setExpanded((x) => ({ ...x, [b.address]: !open }))}
                    className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left hover:bg-muted"
                    title={b.address}
                  >
                    {open ? <ChevronDown className="size-3.5 shrink-0" /> : <ChevronRight className="size-3.5 shrink-0" />}
                    {b.own ? <Mail className="size-4 shrink-0 text-primary" /> : <Users className="size-4 shrink-0 text-muted-foreground" />}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{b.own ? 'My mailbox' : b.name}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">{b.address}</span>
                    </span>
                    {!open && b.unread > 0 && <span className="text-xs font-semibold text-primary tabular-nums">{b.unread}</span>}
                  </button>
                  {open && (
                    <div className="mt-0.5 ml-3 border-l pl-1.5">
                      {(b.address === box && folders.data ? folders.data.folders : DEFAULT_FOLDERS).map((f) => {
                        const Icon = FOLDER_ICONS[f.key] ?? Inbox;
                        const active = box === b.address && folder === f.key;
                        const unread = b.address === box ? f.unread : f.key === 'inbox' ? b.unread : 0;
                        return (
                          <button
                            key={f.key}
                            type="button"
                            onClick={() => openFolder(b.address, f.key)}
                            className={cn(
                              'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted',
                              active && 'bg-primary/10 font-medium text-primary'
                            )}
                          >
                            <Icon className="size-4 shrink-0" />
                            <span className="flex-1 truncate text-left">{f.name}</span>
                            {unread > 0 && f.key !== 'sentitems' && f.key !== 'drafts' && <span className="text-xs font-semibold tabular-nums">{unread}</span>}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </nav>

          {/* Message list */}
          <div className={cn('flex min-h-0 flex-col border-r', selected ? 'hidden md:flex' : 'flex')}>
            {/* Mailbox and folder pickers on phones */}
            <div className="flex gap-2 border-b px-2 py-1.5 md:hidden">
              {boxes.length > 1 && (
                <Select value={box} onValueChange={(v) => openFolder(v, 'inbox')}>
                  <SelectTrigger size="sm" className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {boxes.map((b) => (
                      <SelectItem key={b.address} value={b.address}>
                        {b.own ? 'My mailbox' : b.address}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Select value={folder} onValueChange={(v) => openFolder(box, v)}>
                <SelectTrigger size="sm" className="flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(folders.data?.folders ?? DEFAULT_FOLDERS).map((f) => (
                    <SelectItem key={f.key} value={f.key}>
                      {f.name}
                      {f.unread ? ` (${f.unread})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-baseline justify-between gap-2 px-4 pt-3 pb-2">
              <h2 className="type-h4 truncate">{query ? `Results in ${current?.name ?? ''}` : (current?.name ?? 'Inbox')}</h2>
              {current && !query && (
                <span className="shrink-0 text-xs text-muted-foreground">
                  {current.unread > 0 && folder !== 'sentitems' ? `${current.unread} unread · ` : ''}
                  {current.total} items
                </span>
              )}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {list.isPending ? (
                <div className="space-y-2 p-3">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <Skeleton key={i} className="h-16" />
                  ))}
                </div>
              ) : list.isError ? (
                <EmptyState icon={Mail} title="Could not load this folder" description={errorMessage(list.error)} />
              ) : messages.length === 0 ? (
                <EmptyState icon={query ? Search : Inbox} title={query ? 'No results' : 'Nothing here'} />
              ) : (
                <ul>
                  {messages.map((m) => (
                    <MessageRow
                      key={m.id}
                      m={m}
                      box={box}
                      folder={folder}
                      selected={selected === m.id}
                      onOpen={() => setSelected(m.id)}
                      onAction={(action) => act.mutate({ id: m.id, action })}
                      onCompose={(mode) => composeFrom(m.id, mode)}
                    />
                  ))}
                </ul>
              )}
              {list.hasNextPage && (
                <div className="p-3 text-center">
                  <Button variant="outline" size="sm" onClick={() => list.fetchNextPage()} disabled={list.isFetchingNextPage}>
                    {list.isFetchingNextPage && <Loader2 className="animate-spin" />}
                    Load more
                  </Button>
                </div>
              )}
            </div>
          </div>

          {/* Reading pane */}
          <div className={cn('min-h-0 flex-col', selected ? 'flex' : 'hidden md:flex')}>
            {selected ? (
              <Reader
                key={`${box}:${selected}`}
                id={selected}
                box={box}
                folder={folder}
                onBack={() => setSelected(null)}
                onCompose={(s) => setCompose({ ...s, from: box })}
                onAction={(action) => act.mutate({ id: selected, action })}
                busy={act.isPending}
              />
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-4">
                <EmptyState icon={MailOpen} title="Select an email to read" description="Choose a message from the list." />
                <p className="hidden text-xs text-muted-foreground lg:block">
                  Shortcuts: <Kbd>c</Kbd> new · <Kbd>j</Kbd>/<Kbd>k</Kbd> next/previous · <Kbd>r</Kbd> reply · <Kbd>a</Kbd> reply all · <Kbd>f</Kbd> forward ·{' '}
                  <Kbd>e</Kbd> archive · <Kbd>#</Kbd> delete · <Kbd>u</Kbd> unread · <Kbd>s</Kbd> flag · <Kbd>/</Kbd> search
                </p>
              </div>
            )}
          </div>
        </div>
      </Card>
      {compose && <ComposeDialog state={compose} boxes={boxes} onClose={() => setCompose(null)} onSent={refreshAll} />}
    </>
  );
}

const DEFAULT_FOLDERS: MailFolder[] = [
  { key: 'inbox', id: 'inbox', name: 'Inbox', unread: 0, total: 0 },
  { key: 'sentitems', id: 'sentitems', name: 'Sent Items', unread: 0, total: 0 },
  { key: 'drafts', id: 'drafts', name: 'Drafts', unread: 0, total: 0 },
  { key: 'archive', id: 'archive', name: 'Archive', unread: 0, total: 0 },
  { key: 'junkemail', id: 'junkemail', name: 'Junk Email', unread: 0, total: 0 },
  { key: 'deleteditems', id: 'deleteditems', name: 'Deleted Items', unread: 0, total: 0 },
];

const Kbd = ({ children }: { children: ReactNode }) => <kbd className="rounded border bg-muted px-1 font-mono text-[11px]">{children}</kbd>;

type RowAction = 'read' | 'unread' | 'flag' | 'unflag' | 'archive' | 'delete' | 'purge' | 'junk' | 'inbox';

function IconAction({
  label,
  icon: Icon,
  onClick,
  disabled,
  active,
}: {
  label: string;
  icon: LucideIcon;
  onClick: (e: MouseEvent) => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onClick}
          disabled={disabled}
          aria-label={label}
          className={cn(active && 'text-red-600 dark:text-red-400')}
        >
          <Icon className={cn(active && 'fill-current')} />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function MessageRow({
  m,
  box,
  folder,
  selected,
  onOpen,
  onAction,
  onCompose,
}: {
  m: MailSummary;
  box: string;
  folder: string;
  selected: boolean;
  onOpen: () => void;
  onAction: (a: RowAction) => void;
  onCompose: (mode: 'reply' | 'replyAll' | 'forward') => void;
}) {
  const sentFolder = folder === 'sentitems' || folder === 'drafts';
  const person = sentFolder ? (m.toRecipients ?? []).map(who).join(', ') || '(no recipients)' : who(m.from);
  const stop = (fn: () => void) => (e: MouseEvent) => {
    e.stopPropagation();
    fn();
  };
  const msgUrl = (p: string) => boxUrl(`/api/mail/messages/${encodeURIComponent(m.id)}${p}`, box);
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <li
          role="button"
          tabIndex={0}
          onClick={onOpen}
          onKeyDown={(e) => e.key === 'Enter' && onOpen()}
          className={cn(
            'group relative flex cursor-pointer gap-3 border-b px-3 py-2.5 transition-colors outline-none hover:bg-muted/50 focus-visible:bg-muted/60',
            selected && 'bg-primary/10 hover:bg-primary/10',
            !m.isRead && 'bg-primary/[0.03]'
          )}
        >
          {!m.isRead && <span className="absolute top-0 bottom-0 left-0 w-[3px] bg-primary" aria-hidden />}
          <UserAvatar name={person} className="mt-0.5 size-8 text-xs" />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className={cn('min-w-0 flex-1 truncate text-sm', !m.isRead ? 'font-semibold' : 'font-medium text-foreground/90')}>
                {m.isDraft && <span className="mr-1 text-red-600 dark:text-red-400">[Draft]</span>}
                {person}
              </span>
              <span className={cn('shrink-0 text-xs group-hover:invisible', !m.isRead ? 'font-semibold text-primary' : 'text-muted-foreground')}>
                {listDate(m.receivedDateTime)}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className={cn('min-w-0 flex-1 truncate text-sm', !m.isRead ? 'font-medium text-foreground' : 'text-foreground/80')}>
                {m.subject || '(no subject)'}
              </span>
              {m.importance === 'high' && (
                <span className="text-xs font-bold text-red-600" title="High importance">
                  !
                </span>
              )}
              {m.hasAttachments && <Paperclip className="size-3.5 shrink-0 text-muted-foreground" />}
              {flagged(m) && <Flag className="size-3.5 shrink-0 fill-red-600 text-red-600" />}
            </div>
            <div className="truncate text-xs text-muted-foreground">{m.bodyPreview}</div>
          </div>
          {/* Quick actions appear on hover, like Gmail and Outlook. */}
          <div className="absolute top-1.5 right-2 hidden items-center gap-0.5 rounded-md border bg-background shadow-sm group-hover:flex">
            {folder !== 'archive' && <IconAction label="Archive" icon={Archive} onClick={stop(() => onAction('archive'))} />}
            <IconAction
              label={folder === 'deleteditems' ? 'Delete permanently' : 'Delete'}
              icon={Trash2}
              onClick={stop(() => onAction(folder === 'deleteditems' ? 'purge' : 'delete'))}
            />
            <IconAction
              label={m.isRead ? 'Mark as unread' : 'Mark as read'}
              icon={m.isRead ? Mail : MailOpen}
              onClick={stop(() => onAction(m.isRead ? 'unread' : 'read'))}
            />
            <IconAction
              label={flagged(m) ? 'Remove flag' : 'Flag'}
              icon={Flag}
              active={flagged(m)}
              onClick={stop(() => onAction(flagged(m) ? 'unflag' : 'flag'))}
            />
          </div>
        </li>
      </ContextMenuTrigger>
      {/* Right-click menu: everything you can do with an email, without opening it. */}
      <ContextMenuContent className="w-56">
        <ContextMenuItem onClick={onOpen}>
          <MailOpen />
          Open
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => onCompose('reply')}>
          <Reply />
          Reply
          <ContextMenuShortcut>R</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onClick={() => onCompose('replyAll')}>
          <ReplyAll />
          Reply all
          <ContextMenuShortcut>A</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onClick={() => onCompose('forward')}>
          <Forward />
          Forward
          <ContextMenuShortcut>F</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => onAction(m.isRead ? 'unread' : 'read')}>
          {m.isRead ? <Mail /> : <MailOpen />}
          {m.isRead ? 'Mark as unread' : 'Mark as read'}
          <ContextMenuShortcut>U</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onClick={() => onAction(flagged(m) ? 'unflag' : 'flag')}>
          <Flag />
          {flagged(m) ? 'Remove flag' : 'Flag'}
          <ContextMenuShortcut>S</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
        {folder !== 'archive' && (
          <ContextMenuItem onClick={() => onAction('archive')}>
            <Archive />
            Archive
            <ContextMenuShortcut>E</ContextMenuShortcut>
          </ContextMenuItem>
        )}
        {folder !== 'inbox' && (
          <ContextMenuItem onClick={() => onAction('inbox')}>
            <Inbox />
            Move to Inbox
          </ContextMenuItem>
        )}
        {folder === 'junkemail' ? (
          <ContextMenuItem onClick={() => onAction('inbox')}>
            <ShieldCheck />
            Not junk
          </ContextMenuItem>
        ) : (
          <ContextMenuItem onClick={() => onAction('junk')}>
            <ShieldAlert />
            Move to Junk
          </ContextMenuItem>
        )}
        <ContextMenuItem variant="destructive" onClick={() => onAction(folder === 'deleteditems' ? 'purge' : 'delete')}>
          <Trash2 />
          {folder === 'deleteditems' ? 'Delete permanently' : 'Delete'}
          <ContextMenuShortcut>#</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => window.open(msgUrl('/print'), '_blank', 'noopener')}>
          <Printer />
          Print
        </ContextMenuItem>
        <ContextMenuItem asChild>
          <a href={msgUrl(`/eml?name=${encodeURIComponent(m.subject || 'email')}`)}>
            <Download />
            Download (.eml)
          </a>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

// Email HTML is shown in a locked-down frame: no scripts, no access to the portal, links open in a new tab.
// Remote pictures arrive through the portal's image proxy (the server rewrites their links); embedded ones are inline.
function MailBody({ body }: { body: MailMessage['body'] }) {
  const doc = useMemo(() => {
    const base =
      '<base target="_blank"><style>body{font:14px/1.6 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#111827;margin:16px;word-wrap:break-word}img{max-width:100%;height:auto}pre{white-space:pre-wrap}blockquote{margin:0 0 0 .8ex;border-left:2px solid #d1d5db;padding-left:1ex;color:#4b5563}</style>';
    if (body.contentType === 'text') {
      const esc = body.content.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
      return `<!doctype html><html><head><meta charset="utf-8">${base}</head><body><pre>${esc}</pre></body></html>`;
    }
    return `<!doctype html><html><head><meta charset="utf-8">${base}</head><body>${body.content}</body></html>`;
  }, [body]);
  return (
    <iframe
      title="Email content"
      sandbox="allow-popups allow-popups-to-escape-sandbox"
      srcDoc={doc}
      className="h-full w-full flex-1 rounded-md border bg-white"
    />
  );
}

function Reader({
  id,
  box,
  folder,
  onBack,
  onCompose,
  onAction,
  busy,
}: {
  id: string;
  box: string;
  folder: string;
  onBack: () => void;
  onCompose: (s: Omit<ComposeState, 'from'>) => void;
  onAction: (a: RowAction) => void;
  busy: boolean;
}) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['mail-message', box, id],
    queryFn: () => api.get<{ message: MailMessage }>(boxUrl(`/mail/messages/${encodeURIComponent(id)}`, box)),
  });
  const [showDetails, setShowDetails] = useState(false);
  const [preview, setPreview] = useState<PreviewFile | null>(null);

  // Opening marks the message read; refresh counts and the list.
  useEffect(() => {
    if (query.data) {
      qc.invalidateQueries({ queryKey: ['mail-folders'] });
      qc.invalidateQueries({ queryKey: ['mail-list'] });
      qc.invalidateQueries({ queryKey: ['mail-mailboxes'] });
    }
  }, [query.data, qc]);

  if (query.isPending) {
    return (
      <div className="space-y-3 p-5">
        <Skeleton className="h-7 w-2/3" />
        <Skeleton className="h-12 w-1/2" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (query.isError) return <EmptyState icon={Mail} title="Could not open this email" description={errorMessage(query.error)} />;
  const m = query.data.message;
  const recipients = (label: string, list?: Address[]) =>
    list && list.length ? (
      <div className={cn(!showDetails && 'truncate')}>
        <span className="text-muted-foreground">{label}: </span>
        {list.map((a) => (addr(a) === box ? 'You' : showDetails ? `${who(a)} <${addr(a)}>` : who(a))).join('; ')}
      </div>
    ) : null;
  const msgUrl = (p: string) => boxUrl(`/api/mail/messages/${encodeURIComponent(m.id)}${p}`, box);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-0.5 border-b px-2 py-1.5">
        <Button variant="ghost" size="icon-sm" className="md:hidden" onClick={onBack} aria-label="Back to list">
          <ArrowLeft />
        </Button>
        <Button variant="ghost" size="sm" onClick={() => onCompose({ mode: 'reply', ref: m })}>
          <Reply />
          Reply
        </Button>
        <Button variant="ghost" size="sm" onClick={() => onCompose({ mode: 'replyAll', ref: m })}>
          <ReplyAll />
          <span className="hidden lg:inline">Reply all</span>
        </Button>
        <Button variant="ghost" size="sm" onClick={() => onCompose({ mode: 'forward', ref: m })}>
          <Forward />
          <span className="hidden lg:inline">Forward</span>
        </Button>
        <Separator orientation="vertical" className="mx-1 data-[orientation=vertical]:h-5" />
        {folder !== 'archive' && <IconAction label="Archive (e)" icon={Archive} onClick={() => onAction('archive')} disabled={busy} />}
        <IconAction
          label={folder === 'deleteditems' ? 'Delete permanently' : 'Delete (#)'}
          icon={Trash2}
          onClick={() => onAction(folder === 'deleteditems' ? 'purge' : 'delete')}
          disabled={busy}
        />
        {folder === 'junkemail' ? (
          <IconAction label="Not junk" icon={ShieldCheck} onClick={() => onAction('inbox')} disabled={busy} />
        ) : (
          <IconAction label="Move to Junk" icon={ShieldAlert} onClick={() => onAction('junk')} disabled={busy} />
        )}
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Move to">
                  <FolderInput />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>Move to</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="start">
            {folder !== 'inbox' && (
              <DropdownMenuItem onClick={() => onAction('inbox')}>
                <Inbox />
                Inbox
              </DropdownMenuItem>
            )}
            {folder !== 'archive' && (
              <DropdownMenuItem onClick={() => onAction('archive')}>
                <Archive />
                Archive
              </DropdownMenuItem>
            )}
            {folder !== 'junkemail' && (
              <DropdownMenuItem onClick={() => onAction('junk')}>
                <ShieldAlert />
                Junk Email
              </DropdownMenuItem>
            )}
            {folder !== 'deleteditems' && (
              <DropdownMenuItem onClick={() => onAction('delete')}>
                <Trash2 />
                Deleted Items
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="ml-auto flex items-center gap-0.5">
          <IconAction label="Mark as unread (u)" icon={Mail} onClick={() => (onAction('unread'), onBack())} disabled={busy} />
          <IconAction
            label={flagged(m) ? 'Remove flag (s)' : 'Flag (s)'}
            icon={Flag}
            active={flagged(m)}
            onClick={() => onAction(flagged(m) ? 'unflag' : 'flag')}
            disabled={busy}
          />
          <IconAction label="Print" icon={Printer} onClick={() => window.open(msgUrl('/print'), '_blank', 'noopener')} />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" asChild aria-label="Download (.eml)">
                <a href={msgUrl(`/eml?name=${encodeURIComponent(m.subject || 'email')}`)}>
                  <Download />
                </a>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Download (.eml)</TooltipContent>
          </Tooltip>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
        <div className="flex items-start gap-2">
          <h2 className="type-h3 min-w-0 flex-1 break-words">{m.subject || '(no subject)'}</h2>
          {m.importance === 'high' && (
            <span className="mt-1 shrink-0 rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-700 dark:bg-red-950 dark:text-red-300">
              High importance
            </span>
          )}
        </div>
        <div className="flex items-start gap-3">
          <UserAvatar name={who(m.from)} className="size-10" />
          <div className="min-w-0 flex-1 text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <span className="font-semibold">
                {who(m.from)} <span className="font-normal text-muted-foreground">&lt;{addr(m.from)}&gt;</span>
              </span>
              <span className="text-xs text-muted-foreground">{fullDate(m.receivedDateTime)}</span>
            </div>
            {recipients('To', m.toRecipients)}
            {recipients('Cc', m.ccRecipients)}
            {recipients('Bcc', m.bccRecipients)}
            <button type="button" className="text-xs text-primary hover:underline" onClick={() => setShowDetails((v) => !v)}>
              {showDetails ? 'Hide details' : 'Show details'}
            </button>
          </div>
        </div>
        {preview && <AttachmentPreviewDialog file={preview} onClose={() => setPreview(null)} />}
        {m.attachments.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {m.attachments.map((a) => (
              <Attachment key={a.id} size="sm" className="max-w-64">
                <AttachmentMedia>
                  <FileTypeIcon mime={a.contentType} name={a.name} />
                </AttachmentMedia>
                <AttachmentContent>
                  <AttachmentTitle title={a.name}>{a.name}</AttachmentTitle>
                  <AttachmentDescription>{fileSize(a.size)}</AttachmentDescription>
                </AttachmentContent>
                <AttachmentTrigger
                  aria-label={`Preview ${a.name}`}
                  onClick={() => {
                    const url = msgUrl(`/attachments/${encodeURIComponent(a.id)}?name=${encodeURIComponent(a.name)}`);
                    setPreview({ name: a.name, contentType: a.contentType, size: a.size, viewUrl: `${url}&inline=1`, downloadUrl: url });
                  }}
                />
              </Attachment>
            ))}
          </div>
        )}
        <Separator />
        <div className="flex min-h-[360px] flex-1 flex-col">
          <MailBody body={m.body} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => onCompose({ mode: 'reply', ref: m })}>
            <Reply />
            Reply
          </Button>
          <Button variant="outline" size="sm" onClick={() => onCompose({ mode: 'replyAll', ref: m })}>
            <ReplyAll />
            Reply all
          </Button>
          <Button variant="outline" size="sm" onClick={() => onCompose({ mode: 'forward', ref: m })}>
            <Forward />
            Forward
          </Button>
        </div>
      </div>
    </div>
  );
}

function ComposeDialog({ state, boxes, onClose, onSent }: { state: ComposeState; boxes: Mailbox[]; onClose: () => void; onSent: () => void }) {
  const ref = state.ref;
  const [from, setFrom] = useState(state.from);
  const signature = useQuery({ queryKey: ['mail-signature'], queryFn: () => api.get<{ html: string }>('/mail/signature'), staleTime: Infinity });
  const initial = useMemo(() => {
    const me = from.toLowerCase();
    if (!ref || state.mode === 'new') return { to: [] as string[], cc: [] as string[], subject: '' };
    const prefix = state.mode === 'forward' ? 'FW: ' : 'RE: ';
    const subject = /^(re|fw|fwd):/i.test(ref.subject ?? '') ? (ref.subject ?? '') : prefix + (ref.subject ?? '');
    if (state.mode === 'forward') return { to: [], cc: [], subject };
    const sender = addr(ref.from);
    if (state.mode === 'reply') return { to: sender ? [sender] : [], cc: [], subject };
    const others = (list?: Address[]) => (list ?? []).map(addr).filter((a) => a && a !== me);
    return { to: [...new Set([sender, ...others(ref.toRecipients)].filter((a) => a && a !== me))], cc: others(ref.ccRecipients), subject };
    // Recipients are worked out once, when the window opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, state.mode]);

  const [to, setTo] = useState<string[]>(initial.to);
  const [cc, setCc] = useState<string[]>(initial.cc);
  const [bcc, setBcc] = useState<string[]>([]);
  const [showCc, setShowCc] = useState(initial.cc.length > 0);
  const [showBcc, setShowBcc] = useState(false);
  const [subject, setSubject] = useState(initial.subject);
  const [html, setHtml] = useState('');
  const [empty, setEmpty] = useState(true);
  const [importance, setImportance] = useState<'normal' | 'high' | 'low'>('normal');
  const [maximized, setMaximized] = useState(false);
  const files = useFileList({ kind: 'mail' });
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);

  async function send() {
    if (busy) return;
    if (!to.length && !cc.length && !bcc.length) return toast.error('Add at least one recipient');
    if (!subject.trim() && state.mode === 'new') return toast.error('Add a subject');
    if (empty && !files.files.length && state.mode !== 'forward' && !window.confirm('Send this email without any text?')) return;
    setBusy(true);
    const fd = new FormData();
    fd.set('to', to.join(','));
    fd.set('cc', cc.join(','));
    fd.set('bcc', bcc.join(','));
    fd.set('subject', subject);
    fd.set('html', html);
    fd.set('importance', importance);
    if (ref && state.mode !== 'new') {
      fd.set('mode', state.mode);
      fd.set('refId', ref.id);
    }
    for (const f of files.files) fd.append('files', f);
    try {
      setProgress(files.files.length ? 0 : null);
      await uploadWithProgress(boxUrl('/mail/send', from), fd, setProgress);
      toast.success(`Email sent${from !== boxes.find((b) => b.own)?.address ? ` from ${from}` : ''}`);
      onSent();
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  function discard() {
    if (!empty || files.files.length || (state.mode === 'new' && subject)) {
      if (!window.confirm('Discard this email?')) return;
    }
    onClose();
  }

  const title = { new: 'New email', reply: 'Reply', replyAll: 'Reply all', forward: 'Forward' }[state.mode];
  const row = 'grid grid-cols-[4rem_1fr] items-center gap-2 border-b py-1.5';
  // New emails start with the signature; replies and forwards too (above the original, which Microsoft adds).
  const startHtml = signature.data ? `<p></p><p></p>${signature.data.html}` : '<p></p>';

  return (
    <Dialog open onOpenChange={(o) => !o && discard()}>
      <DialogContent
        showCloseButton={false}
        className={cn('gap-0 p-0', maximized ? 'h-[96svh] max-w-[96vw] sm:max-w-[96vw]' : 'sm:max-w-4xl')}
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <div className={cn('flex flex-col', maximized ? 'h-[96svh]' : 'max-h-[92svh]')}>
          <DialogHeader className="flex-row items-center gap-2 border-b px-4 py-2.5">
            <DialogTitle className="flex-1 text-base">{subject.trim() || title}</DialogTitle>
            <DialogDescription className="sr-only">Write and send an email</DialogDescription>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => setMaximized((v) => !v)}
              aria-label={maximized ? 'Restore size' : 'Full screen'}
            >
              {maximized ? <Minimize2 /> : <Maximize2 />}
            </Button>
            <Button type="button" variant="ghost" size="icon-sm" onClick={discard} aria-label="Close">
              <X />
            </Button>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-4">
            <div className={row}>
              <span className="text-sm text-muted-foreground">From</span>
              {boxes.length > 1 ? (
                <Select value={from} onValueChange={setFrom}>
                  <SelectTrigger size="sm" className="h-8 w-fit max-w-full border-0 px-1 shadow-none">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {boxes.map((b) => (
                      <SelectItem key={b.address} value={b.address}>
                        {b.own ? b.address : `${b.name} <${b.address}>`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <span className="truncate px-1 text-sm">{from}</span>
              )}
            </div>
            <div className={row}>
              <label htmlFor="mail-to" className="text-sm text-muted-foreground">
                To
              </label>
              <div className="flex items-center gap-1">
                <RecipientInput id="mail-to" value={to} onChange={setTo} className="border-0 shadow-none focus-within:ring-0 dark:bg-transparent" />
                {!showCc && (
                  <Button type="button" variant="ghost" size="xs" onClick={() => setShowCc(true)}>
                    Cc
                  </Button>
                )}
                {!showBcc && (
                  <Button type="button" variant="ghost" size="xs" onClick={() => setShowBcc(true)}>
                    Bcc
                  </Button>
                )}
              </div>
            </div>
            {showCc && (
              <div className={row}>
                <label htmlFor="mail-cc" className="text-sm text-muted-foreground">
                  Cc
                </label>
                <RecipientInput id="mail-cc" value={cc} onChange={setCc} className="border-0 shadow-none focus-within:ring-0 dark:bg-transparent" />
              </div>
            )}
            {showBcc && (
              <div className={row}>
                <label htmlFor="mail-bcc" className="text-sm text-muted-foreground">
                  Bcc
                </label>
                <RecipientInput id="mail-bcc" value={bcc} onChange={setBcc} className="border-0 shadow-none focus-within:ring-0 dark:bg-transparent" />
              </div>
            )}
            <div className={row}>
              <label htmlFor="mail-subject" className="text-sm text-muted-foreground">
                Subject
              </label>
              <Input
                id="mail-subject"
                maxLength={255}
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="border-0 px-1 shadow-none focus-visible:ring-0 dark:bg-transparent"
              />
            </div>
            <div className="py-3">
              {signature.isPending ? (
                <Skeleton className="h-72" />
              ) : (
                <RichEditor
                  key={from}
                  initialHtml={startHtml}
                  autoFocus
                  placeholder={state.mode === 'forward' ? 'Add a message (optional)' : 'Write your message'}
                  onChange={(h, isEmpty) => {
                    setHtml(h);
                    // Only the signature counts as empty.
                    setEmpty(
                      isEmpty ||
                        h
                          .replace(signature.data?.html ?? '', '')
                          .replace(/<p><\/p>/g, '')
                          .trim() === ''
                    );
                  }}
                  onFiles={(f) => files.add(f)}
                  onSubmitShortcut={send}
                  className={cn(maximized ? 'h-[calc(96svh-20rem)]' : 'h-[min(48svh,460px)]')}
                />
              )}
            </div>
            {ref && state.mode !== 'new' && (
              <p className="mb-3 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                The original message from {who(ref.from)} is included below your text
                {state.mode === 'forward' && ref.attachments.length ? ', with its attachments' : ''}.
              </p>
            )}
            <div className="mb-3 space-y-1.5">
              <FileChips list={files} />
              {files.files.length > 0 && (
                <p
                  className={cn(
                    'text-xs',
                    files.totalBytes > files.maxMb * 0.35 * 1024 * 1024 ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground'
                  )}
                >
                  {fileSize(files.totalBytes)} of {files.maxMb} MB attached
                  {files.totalBytes > 25 * 1024 * 1024 && '. Some recipients (e.g. Gmail) refuse emails over 25 MB.'}
                </p>
              )}
            </div>
          </div>
          {busy && progress !== null && (
            <div className="h-1 w-full bg-muted">
              <div className="h-full bg-primary transition-[width]" style={{ width: `${progress}%` }} />
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 border-t px-4 py-2.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button type="button" onClick={send} disabled={busy}>
                  {busy ? <Loader2 className="animate-spin" /> : <Send />}
                  {busy && progress !== null ? (progress < 100 ? `Uploading ${progress}%` : 'Sending...') : 'Send'}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Ctrl+Enter</TooltipContent>
            </Tooltip>
            <AttachButton list={files}>Attach</AttachButton>
            <Select value={importance} onValueChange={(v) => setImportance(v as typeof importance)}>
              <SelectTrigger size="sm" className="w-40" aria-label="Importance">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="normal">Normal importance</SelectItem>
                <SelectItem value="high">High importance</SelectItem>
                <SelectItem value="low">Low importance</SelectItem>
              </SelectContent>
            </Select>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button type="button" variant="ghost" size="icon-sm" className="ml-auto" onClick={discard} aria-label="Discard">
                  <Trash2 />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Discard</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
