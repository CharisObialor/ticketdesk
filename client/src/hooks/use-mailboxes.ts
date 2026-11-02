import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface Mailbox {
  address: string;
  name: string;
  own: boolean;
  unread: number;
}

// Mailboxes this admin can open (their own, then shared ones), with inbox unread counts.
// Kept separate from the Mail page so the sidebar's unread bubble does not load the whole page.
export function useMailboxes(enabled = true) {
  return useQuery({
    queryKey: ['mail-mailboxes'],
    queryFn: () => api.get<{ mailboxes: Mailbox[] }>('/mail/mailboxes'),
    // Every 30 seconds, so new-mail notices and the unread bubble stay close to real time.
    refetchInterval: 30_000,
    retry: false,
    enabled,
  });
}
