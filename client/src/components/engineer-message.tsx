import { useState } from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Copy, MessageCircle, MessageSquareText } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useSession } from '@/hooks/use-session';
import { useTechnicians } from '@/hooks/use-technicians';
import { api, errorMessage } from '@/lib/api';
import { PRIORITY_LABELS, duration, formatDateTime, parseTs } from '@/lib/format';
import { international } from '@/lib/phone';
import { faultCategory, resolutionLimit, targetsFor } from '@/lib/sla';
import type { Message, Technician, Ticket, Visit } from '@/lib/types';

const firstName = (name: string) => name.split(/\s+/)[0];
const excerpt = (s: string, n: number) => (s.length > n ? `${s.slice(0, n).trimEnd()}...` : s);

// The job message: everything the engineer needs on site, short enough to read on a phone.
function draft(t: Ticket, engineer: Technician | undefined, messages: Message[], visits: Visit[], sla: ReturnType<typeof useSession>['app'], me: string) {
  const description = messages.find((m) => m.kind === 'message' && !m.is_internal)?.body ?? '';
  const visit = visits.find((v) => v.status === 'scheduled' || v.status === 'in_progress');
  const limit = resolutionLimit(t, sla?.sla);
  // The time to resolve counts from assignment; before that, from now (the job is being handed out).
  const from = t.assigned_at ? parseTs(t.assigned_at) : new Date();
  const due = limit && from ? new Date(from.getTime() + limit * 60000) : null;
  const fault = faultCategory(targetsFor(sla?.sla, t.company_id), t.category);
  const lines = [
    `Hello ${engineer ? firstName(engineer.name) : ''},`.replace(' ,', ','),
    '',
    `New job: Ticket #${t.id} - ${t.subject}`,
    `Client: ${t.company_name}`,
    `Fault: ${t.category}${fault?.description ? ` (${fault.description})` : ''}`,
    `Priority: ${PRIORITY_LABELS[t.priority]}`,
    due ? `Resolve by: ${formatDateTime(due.toISOString().slice(0, 19).replace('T', ' '))} (${duration(limit)} SLA)` : null,
    visit ? `Site visit: ${formatDateTime(visit.scheduled_at)}${visit.location ? `, ${visit.location}` : ''}` : null,
    t.site_code ? `Site: ${t.site_code}${t.site_location ? `, ${t.site_location}` : ''}` : null,
    t.om_name || t.om_phone ? `OM: ${[t.om_name, t.om_phone].filter(Boolean).join(', ')}` : null,
    t.fse_name || t.fse_phone ? `FSE: ${[t.fse_name, t.fse_phone].filter(Boolean).join(', ')}` : null,
    t.creator_name ? `Reported by: ${t.creator_name}` : null,
    '',
    description ? `Details: ${excerpt(description.replace(/\s+/g, ' ').trim(), 400)}` : null,
    description ? '' : null,
    'When the work is done, please send me what was done, the time spent, and pictures from before and after the work.',
    '',
    `${me}, DateHeight Support`,
  ];
  return lines.filter((l) => l !== null).join('\n');
}

export function EngineerMessageDialog({
  ticket: t,
  messages,
  visits,
  open,
  onOpenChange,
}: {
  ticket: Ticket;
  messages: Message[];
  visits: Visit[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const session = useSession();
  // Technicians come from their own contact list; they do not have portal accounts.
  const techs = useTechnicians(open);
  const list = (techs.data?.technicians ?? []).filter((x) => x.is_active);
  const [engineerId, setEngineerId] = useState<number | null>(null);
  const engineer = list.find((s) => s.id === engineerId);
  const [phone, setPhone] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const shownPhone = phone ?? engineer?.phone ?? '';
  const shownText = text ?? draft(t, engineer, messages, visits, session.app, session.user?.name ?? 'The support team');

  // The draft follows the chosen engineer until the message is edited by hand.
  function choose(id: string) {
    setEngineerId(Number(id));
    setPhone(null);
  }

  // Records on the ticket who the job went to, and on what number (saved to their contact if new).
  function log(channel: 'whatsapp' | 'sms' | 'copy') {
    if (!engineer) return;
    api
      .post(`/tickets/${t.id}/dispatch`, { technician_id: engineer.id, phone: shownPhone, channel })
      .then(() => {
        qc.invalidateQueries({ queryKey: ['ticket', t.id] });
        if (shownPhone && shownPhone !== engineer.phone) qc.invalidateQueries({ queryKey: ['technicians'] });
      })
      .catch((err) => toast.error(errorMessage(err)));
  }

  const digits = shownPhone ? international(shownPhone) : '';
  const ready = !!engineer && digits.length >= 7;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Message engineer</DialogTitle>
          <DialogDescription>A job message drafted from this ticket. Edit it if needed, then send it by WhatsApp or text, or copy it.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label>Technician</Label>
            <Select value={engineerId ? String(engineerId) : ''} onValueChange={choose} disabled={!list.length}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={techs.isPending ? 'Loading...' : list.length ? 'Choose a technician' : 'No technicians yet'} />
              </SelectTrigger>
              <SelectContent>
                {list.map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    {s.name}
                    {s.area && <span className="text-muted-foreground"> - {s.area}</span>}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!techs.isPending && !list.length && (
              <p className="text-xs text-muted-foreground">
                Add technicians on the{' '}
                <Link to="/technicians" className="text-primary hover:underline">
                  Technicians
                </Link>{' '}
                page.
              </p>
            )}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="engineer-phone">Phone number</Label>
            <Input id="engineer-phone" type="tel" inputMode="tel" placeholder="e.g. 0803 123 4567" value={shownPhone} onChange={(e) => setPhone(e.target.value)} />
            {engineer && !engineer.phone && <p className="text-xs text-muted-foreground">No number on file. It is saved to {firstName(engineer.name)}'s contact when you send.</p>}
          </div>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="engineer-text">Message</Label>
          <Textarea id="engineer-text" rows={14} className="font-mono text-xs" value={shownText} onChange={(e) => setText(e.target.value)} />
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            variant="outline"
            disabled={!engineer}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(shownText);
                toast.success('Message copied');
                log('copy');
              } catch {
                toast.error('Could not copy. Select the text and copy it manually.');
              }
            }}
          >
            <Copy />
            Copy
          </Button>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={!ready}
              onClick={() => {
                window.location.href = `sms:+${digits}?body=${encodeURIComponent(shownText)}`;
                log('sms');
              }}
            >
              <MessageSquareText />
              Text message
            </Button>
            <Button
              disabled={!ready}
              onClick={() => {
                window.open(`https://wa.me/${digits}?text=${encodeURIComponent(shownText)}`, '_blank', 'noopener');
                log('whatsapp');
              }}
            >
              <MessageCircle />
              WhatsApp
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
