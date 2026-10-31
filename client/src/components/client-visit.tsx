import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CircleCheck, Loader2, MapPinCheck, PenLine } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { SignaturePad } from '@/components/visits';
import { useSession } from '@/hooks/use-session';
import { api, errorMessage } from '@/lib/api';

export interface ClientVisit {
  id: number;
  ticket_id: number;
  status: string;
  location: string | null;
  scheduled_at: string;
  completed_at?: string | null;
  client_confirmed_at?: string | null;
  client_signed_at?: string | null;
  client_signed_name?: string | null;
  subject?: string;
}

const refresh = (qc: ReturnType<typeof useQueryClient>, ticketId: number) => {
  qc.invalidateQueries({ queryKey: ['ticket', ticketId] });
  qc.invalidateQueries({ queryKey: ['client-home'] });
};

// What a client can do with a visit: confirm the engineer arrived, then sign the job completion certificate.
export function ClientVisitActions({ visit: v }: { visit: ClientVisit }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [signing, setSigning] = useState(false);

  async function arrived() {
    setBusy(true);
    try {
      await api.post(`/client/visits/${v.id}/arrived`);
      toast.success('Thank you. We have noted that the engineer arrived.');
      refresh(qc, v.ticket_id);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (v.client_signed_at) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400">
        <CircleCheck className="size-3.5" />
        Job signed off by {v.client_signed_name}
      </p>
    );
  }
  return (
    <div className="flex flex-wrap gap-2">
      {['scheduled', 'in_progress'].includes(v.status) &&
        (v.client_confirmed_at ? (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <MapPinCheck className="size-3.5" />
            You confirmed the engineer arrived
          </span>
        ) : (
          <Button size="xs" variant="outline" onClick={arrived} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <MapPinCheck />}
            Engineer has arrived
          </Button>
        ))}
      {v.status === 'completed' && (
        <Button size="xs" onClick={() => setSigning(true)}>
          <PenLine />
          Sign job completion
        </Button>
      )}
      {signing && <SignJccDialog visit={v} onClose={() => setSigning(false)} />}
    </div>
  );
}

// Job completion certificate (JCC): the client confirms the work and signs on screen.
function SignJccDialog({ visit: v, onClose }: { visit: ClientVisit; onClose: () => void }) {
  const qc = useQueryClient();
  const { user } = useSession();
  const [name, setName] = useState(user?.name ?? '');
  const [satisfied, setSatisfied] = useState(true);
  const [comment, setComment] = useState('');
  const [signature, setSignature] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!name.trim()) return toast.error('Enter your name');
    if (!signature) return toast.error('Sign in the box');
    setBusy(true);
    try {
      await api.post(`/client/visits/${v.id}/sign`, { name, satisfied, comment, signature });
      toast.success('Job signed off. Thank you.');
      refresh(qc, v.ticket_id);
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Sign job completion</DialogTitle>
          <DialogDescription>
            Confirm the work done at {v.location || 'your site'}
            {v.subject ? ` for "${v.subject}"` : ''}. Your signature is added to the ticket as the job completion certificate (JCC).
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label>Was the work done satisfactorily?</Label>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant={satisfied ? 'default' : 'outline'} onClick={() => setSatisfied(true)}>
                Yes
              </Button>
              <Button type="button" size="sm" variant={!satisfied ? 'default' : 'outline'} onClick={() => setSatisfied(false)}>
                No
              </Button>
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="jcc-comment">{satisfied ? 'Comments (optional)' : 'What is still not right?'}</Label>
            <Textarea id="jcc-comment" rows={3} maxLength={2000} value={comment} onChange={(e) => setComment(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="jcc-name">Your name *</Label>
            <Input id="jcc-name" maxLength={190} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label>Signature *</Label>
            <SignaturePad onChange={setSignature} />
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button onClick={submit} disabled={busy}>
            {busy && <Loader2 className="animate-spin" />}
            Sign off
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
