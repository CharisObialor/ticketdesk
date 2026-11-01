import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { ChatItem } from '@/lib/types';

// Group chats, admin chats and ticket conversations in one list, with the unread count (sidebar and Messages page).
export function useInbox() {
  return useQuery({
    queryKey: ['chats'],
    queryFn: () => api.get<{ items: ChatItem[]; unread: number }>('/chats'),
    refetchInterval: 60_000,
  });
}
