import { useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, MessageSquareText, MoreHorizontal, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { EmptyState, PageHeader } from '@/components/common';
import { useSession } from '@/hooks/use-session';
import { api, errorMessage } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { PLACEHOLDERS } from '@/lib/placeholders';
import type { SavedReply } from '@/lib/types';

export default function SavedRepliesPage() {
  const { user, isAdmin } = useSession();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<SavedReply | 'new' | null>(null);
  const replies = useQuery({ queryKey: ['saved-replies'], queryFn: () => api.get<{ replies: SavedReply[] }>('/saved-replies') });
  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`/saved-replies/${id}`),
    onSuccess: () => {
      toast.success('Saved reply deleted');
      qc.invalidateQueries({ queryKey: ['saved-replies'] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const term = search.trim().toLowerCase();
  const list = (replies.data?.replies ?? []).filter((r) => !term || r.title.toLowerCase().includes(term) || r.body.toLowerCase().includes(term));

  return (
    <>
      <PageHeader
        title="Saved replies"
        description="Reusable answers for common questions. Insert them from the reply box on any ticket."
        actions={
          <Button onClick={() => setEditing('new')}>
            <Plus />
            New saved reply
          </Button>
        }
      />
      <div className="relative max-w-xs">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="Search saved replies" className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {replies.isPending ? (
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-36" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <Card>
          <EmptyState
            icon={MessageSquareText}
            title={term ? 'No matching saved replies' : 'No saved replies yet'}
            description={term ? undefined : 'Create replies for questions you answer often, such as password resets or opening hours.'}
            action={
              !term && (
                <Button variant="outline" onClick={() => setEditing('new')}>
                  <Plus />
                  New saved reply
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {list.map((r) => {
            const canEdit = r.created_by === user?.id || isAdmin;
            return (
              <Card key={r.id} className="gap-3">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    {r.title}
                    <Badge variant={r.is_shared ? 'secondary' : 'outline'} className="font-normal">
                      {r.is_shared ? 'Team' : 'Only me'}
                    </Badge>
                  </CardTitle>
                  <CardDescription>
                    {r.created_by === user?.id ? 'You' : (r.created_by_name ?? 'Unknown')} · updated {timeAgo(r.updated_at)}
                  </CardDescription>
                  {canEdit && (
                    <CardAction>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${r.title}`}>
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setEditing(r)}>
                            <Pencil />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem className="text-destructive" onClick={() => confirm(`Delete "${r.title}"?`) && remove.mutate(r.id)}>
                            <Trash2 />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </CardAction>
                  )}
                </CardHeader>
                <CardContent>
                  <p className="line-clamp-4 text-sm whitespace-pre-wrap text-muted-foreground">{r.body}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
      {editing && <SavedReplyDialog reply={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function SavedReplyDialog({ reply, onClose }: { reply: SavedReply | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState(reply?.title ?? '');
  const [body, setBody] = useState(reply?.body ?? '');
  const [shared, setShared] = useState(reply ? !!reply.is_shared : true);
  const [busy, setBusy] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);

  // Inserts a placeholder at the cursor.
  const insert = (key: string) => {
    const el = textarea.current;
    const token = `{{${key}}}`;
    if (!el) return setBody((b) => b + token);
    const { selectionStart: s, selectionEnd: e } = el;
    setBody(body.slice(0, s) + token + body.slice(e));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(s + token.length, s + token.length);
    });
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (reply) await api.patch(`/saved-replies/${reply.id}`, { title, body, is_shared: shared });
      else await api.post('/saved-replies', { title, body, is_shared: shared });
      toast.success(reply ? 'Saved reply updated' : 'Saved reply created');
      qc.invalidateQueries({ queryKey: ['saved-replies'] });
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{reply ? 'Edit saved reply' : 'New saved reply'}</DialogTitle>
            <DialogDescription>Placeholders are replaced with the ticket's details when you insert the reply.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="sr-title">Title *</Label>
            <Input id="sr-title" required maxLength={120} placeholder="For example: Password reset instructions" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="sr-body">Reply text *</Label>
            <Textarea id="sr-body" ref={textarea} required rows={8} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Hello {{client_first_name}}, ..." />
            <div className="flex flex-wrap gap-1.5">
              {PLACEHOLDERS.map((p) => (
                <Button key={p.key} type="button" variant="outline" size="xs" onClick={() => insert(p.key)} title={`Insert {{${p.key}}}`}>
                  + {p.label}
                </Button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
            <div className="space-y-0.5">
              <Label htmlFor="sr-shared">Share with the team</Label>
              <p className="text-xs text-muted-foreground">Turn off to keep this reply for yourself.</p>
            </div>
            <Switch id="sr-shared" checked={shared} onCheckedChange={setShared} />
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="animate-spin" />}
              {reply ? 'Save changes' : 'Create saved reply'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
