import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api, errorMessage } from '@/lib/api';

interface MailboxOptions {
  default: string | null;
  options: { address: string; name: string }[];
}

const DEFAULT = '__default';

// Mailboxes the signed-in admin can send client emails from (the support mailbox and shared mailboxes they have
// Full Access to in Exchange), and the portal-wide default.
export function useMailboxOptions(enabled = true) {
  return useQuery({ queryKey: ['mailbox-options'], queryFn: () => api.get<MailboxOptions>('/tickets/mailbox-options'), staleTime: 5 * 60_000, enabled });
}

// Picks a mailbox. `defaultLabel` names the "use the default" choice; leave it out to offer only real mailboxes
// and "the admin who acts".
export function MailboxSelect({
  value,
  onChange,
  defaultLabel,
  busy,
}: {
  value: string | null;
  onChange: (address: string | null) => void;
  defaultLabel: string;
  busy?: boolean;
}) {
  const opts = useMailboxOptions();
  const list = opts.data?.options ?? [];
  // The current choice stays listed even if this admin cannot pick it themselves.
  const items = value && !list.some((m) => m.address === value) ? [{ address: value, name: value }, ...list] : list;
  return (
    <Select value={value ?? DEFAULT} onValueChange={(v) => onChange(v === DEFAULT ? null : v)} disabled={busy || opts.isPending}>
      <SelectTrigger size="sm" className="w-full">
        {busy ? <Loader2 className="animate-spin" /> : null}
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={DEFAULT}>{defaultLabel}</SelectItem>
        {items.map((m) => (
          <SelectItem key={m.address} value={m.address}>
            <span className="flex min-w-0 flex-col text-left leading-tight">
              <span className="truncate">{m.address}</span>
              {m.name !== m.address && <span className="truncate text-xs text-muted-foreground">{m.name}</span>}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// On a ticket: which mailbox the client's emails about it come from. Saved as soon as it is changed.
export function TicketMailbox({ ticketId, value }: { ticketId: number; value: string | null }) {
  const qc = useQueryClient();
  const opts = useMailboxOptions();
  const [busy, setBusy] = useState(false);
  const fallback = opts.data?.default;
  async function change(address: string | null) {
    setBusy(true);
    try {
      await api.put(`/tickets/${ticketId}/mailbox`, { address });
      await qc.invalidateQueries({ queryKey: ['ticket', ticketId] });
      toast.success(`Emails to the client now come from ${address ?? fallback ?? 'the admin who replies'}`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return <MailboxSelect value={value} onChange={change} busy={busy} defaultLabel={fallback ? `Default (${fallback})` : 'The admin who replies'} />;
}
