import { useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  ListTodo,
  CalendarClock,
  CheckCheck,
  CircleCheck,
  MessageSquare,
  Star,
  Ticket as TicketIcon,
  TriangleAlert,
  UserCheck,
  Users,
  type LucideIcon, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { api } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { AppNotification } from '@/lib/types';

const ICONS: Record<string, LucideIcon> = {
  ticket_created: TicketIcon,
  reply: MessageSquare,
  status: CircleCheck,
  escalated: TriangleAlert,
  assigned: UserCheck,
  rating: Star,
  visit: CalendarClock,
  group: Users,
  action: ListTodo,
  signoff: ShieldCheck,
};

export function NotificationBell() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const query = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get<{ items: AppNotification[]; unread: number }>('/notifications'),
    refetchInterval: 120_000,
  });
  const markRead = useMutation({
    mutationFn: (ids?: number[]) => api.post('/notifications/read', { ids }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const unread = query.data?.unread ?? 0;
  const items = query.data?.items ?? [];

  const open = (n: AppNotification) => {
    if (!n.is_read) markRead.mutate([n.id]);
    if (n.link) navigate(n.link);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="relative" aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}>
          <Bell />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] leading-none font-semibold text-white">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[min(24rem,calc(100vw-2rem))] p-0">
        <div className="flex items-center justify-between px-3 py-2">
          <DropdownMenuLabel className="p-0 text-sm">Notifications</DropdownMenuLabel>
          {unread > 0 && (
            <Button variant="ghost" size="xs" onClick={() => markRead.mutate(undefined)}>
              <CheckCheck />
              Mark all read
            </Button>
          )}
        </div>
        <DropdownMenuSeparator className="my-0" />
        <div className="max-h-[min(28rem,70vh)] overflow-y-auto">
          {items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-10 text-center text-sm text-muted-foreground">
              <Bell className="size-5" />
              You are all caught up
            </div>
          ) : (
            items.map((n) => {
              const Icon = ICONS[n.kind] ?? Bell;
              return (
                <DropdownMenuItem key={n.id} onSelect={() => open(n)} className={cn('items-start gap-3 rounded-none px-3 py-2.5', !n.is_read && 'bg-primary/5')}>
                  <div className={cn('mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full', n.is_read ? 'bg-muted text-muted-foreground' : 'bg-primary/15 text-primary')}>
                    <Icon className="size-3.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className={cn('line-clamp-2 text-sm', !n.is_read && 'font-medium')}>{n.title}</div>
                    {n.body && <div className="line-clamp-2 text-xs text-muted-foreground">{n.body}</div>}
                    <div className="mt-0.5 text-[11px] text-muted-foreground">{timeAgo(n.created_at)}</div>
                  </div>
                  {!n.is_read && <span className="mt-2 size-2 shrink-0 rounded-full bg-primary" aria-label="Unread" />}
                </DropdownMenuItem>
              );
            })
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
