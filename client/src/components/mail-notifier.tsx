import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Mail } from 'lucide-react';
import { toast } from 'sonner';
import { useMailboxes } from '@/hooks/use-mailboxes';
import { useSession } from '@/hooks/use-session';
import { api } from '@/lib/api';

interface Incoming {
  id: string;
  subject: string | null;
  from?: { emailAddress: { name?: string; address?: string } };
  receivedDateTime: string;
  isRead: boolean;
  bodyPreview: string;
}

// Pops up a notice on any page when a new email lands in the admin's own inbox, with a button to open it.
// It rides on the unread count the sidebar already polls, and only fetches messages when that count goes up.
export function MailNotifier() {
  const { isAdmin, app } = useSession();
  const own = app?.mailbox ?? '';
  const mailboxes = useMailboxes(isAdmin && !!own);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const lastUnread = useRef<number | null>(null);
  // Only mail that arrives after the portal was opened is announced.
  const seenUntil = useRef(Date.now());
  const shown = useRef(new Set<string>());

  const unread = mailboxes.data?.mailboxes.find((m) => m.own)?.unread;

  useEffect(() => {
    if (unread === undefined || !own) return;
    const before = lastUnread.current;
    lastUnread.current = unread;
    if (before === null || unread <= before) return;

    let cancelled = false;
    api
      .get<{ messages: Incoming[] }>(`/mail/messages?folder=inbox&top=10&mailbox=${encodeURIComponent(own)}`)
      .then(({ messages }) => {
        if (cancelled) return;
        const fresh = messages.filter((m) => !m.isRead && new Date(m.receivedDateTime).getTime() > seenUntil.current - 60_000 && !shown.current.has(m.id));
        if (!fresh.length) return;
        seenUntil.current = Math.max(seenUntil.current, ...fresh.map((m) => new Date(m.receivedDateTime).getTime()));
        fresh.forEach((m) => shown.current.add(m.id));
        // Keep any open Mail page in step with what was just announced.
        qc.invalidateQueries({ queryKey: ['mail-list'] });
        qc.invalidateQueries({ queryKey: ['mail-folders'] });

        const open = (id?: string) => navigate(id ? `/mail?open=${encodeURIComponent(id)}` : '/mail');
        for (const m of fresh.slice(0, 3)) {
          const sender = m.from?.emailAddress?.name || m.from?.emailAddress?.address || 'Unknown sender';
          toast(`New email from ${sender}`, {
            id: `mail-${m.id}`,
            icon: <Mail className="size-4 text-primary" />,
            description: (
              <span className="block">
                <span className="block truncate font-medium text-foreground">{m.subject || '(no subject)'}</span>
                <span className="line-clamp-2">{m.bodyPreview}</span>
              </span>
            ),
            duration: 10_000,
            action: { label: 'Open', onClick: () => open(m.id) },
          });
        }
        if (fresh.length > 3) {
          toast(`${fresh.length - 3} more new email${fresh.length - 3 === 1 ? '' : 's'}`, {
            icon: <Mail className="size-4 text-primary" />,
            duration: 10_000,
            action: { label: 'Inbox', onClick: () => open() },
          });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [unread, own, navigate, qc]);

  return null;
}
