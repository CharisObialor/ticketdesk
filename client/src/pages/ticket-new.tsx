import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, Send } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { PageHeader } from '@/components/common';
import { DropZone, FileChips, useFileList } from '@/components/file-attachments';
import { useSession } from '@/hooks/use-session';
import { api, errorMessage } from '@/lib/api';
import { PRIORITY_LABELS } from '@/lib/format';
import type { Company, Priority, Ticket, User } from '@/lib/types';

const PRIORITY_HINTS: Record<Priority, string> = {
  low: 'General question, no impact on work',
  normal: 'Minor issue with a workaround',
  high: 'Significant impact on work',
  urgent: 'Service down or business-critical',
};

const ANYONE = 'none';

export default function NewTicketPage() {
  const { app, isStaff } = useSession();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const files = useFileList();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [category, setCategory] = useState('General');
  const [priority, setPriority] = useState<Priority>('normal');
  const [companyId, setCompanyId] = useState('');
  const [requesterId, setRequesterId] = useState(ANYONE);
  const [busy, setBusy] = useState(false);

  const companies = useQuery({
    queryKey: ['companies'],
    queryFn: () => api.get<{ companies: Company[] }>('/companies'),
    enabled: isStaff,
  });
  const requesters = useQuery({
    queryKey: ['users', { companyId }],
    queryFn: () => api.get<{ users: User[] }>(`/users?company_id=${companyId}`),
    enabled: isStaff && !!companyId,
  });

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (isStaff && !companyId) return toast.error('Choose the client company for this ticket');
    setBusy(true);
    const fd = new FormData();
    fd.set('subject', subject);
    fd.set('body', body);
    fd.set('category', category);
    fd.set('priority', priority);
    if (isStaff) {
      fd.set('company_id', companyId);
      if (requesterId !== ANYONE) fd.set('requester_id', requesterId);
    }
    for (const f of files.files) fd.append('files', f);
    try {
      const { ticket } = await api.post<{ ticket: Ticket }>('/tickets', fd);
      qc.invalidateQueries({ queryKey: ['tickets'] });
      qc.invalidateQueries({ queryKey: ['counts'] });
      toast.success(`Ticket #${ticket.id} created`, {
        description: isStaff ? undefined : 'We have emailed you a confirmation and will be in touch shortly.',
      });
      navigate(`/tickets/${ticket.id}`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <Button variant="ghost" size="sm" className="-ml-2" asChild>
        <Link to="/tickets">
          <ArrowLeft />
          Back to tickets
        </Link>
      </Button>
      <PageHeader
        title="New ticket"
        description={isStaff ? 'Raise a ticket on behalf of a client.' : 'Describe your issue and our support team will get back to you.'}
      />

      <form onSubmit={submit}>
        <Card>
          <CardHeader>
            <CardTitle>Ticket details</CardTitle>
            <CardDescription>Fields marked * are required.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6">
            {isStaff && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label>Company *</Label>
                  <Select
                    value={companyId}
                    onValueChange={(v) => {
                      setCompanyId(v);
                      setRequesterId(ANYONE);
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
                <div className="grid gap-2">
                  <Label>Requester</Label>
                  <Select value={requesterId} onValueChange={setRequesterId} disabled={!companyId}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ANYONE}>Me (no client contact)</SelectItem>
                      {requesters.data?.users
                        .filter((u) => u.is_active)
                        .map((u) => (
                          <SelectItem key={u.id} value={String(u.id)}>
                            {u.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            <div className="grid gap-2">
              <Label htmlFor="subject">Subject *</Label>
              <Input id="subject" required maxLength={255} placeholder="A short summary of the issue" value={subject} onChange={(e) => setSubject(e.target.value)} />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>Category</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(app?.categories ?? ['General']).map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Priority</Label>
                <Select value={priority} onValueChange={(v) => setPriority(v as Priority)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(PRIORITY_LABELS) as Priority[]).map((p) => (
                      <SelectItem key={p} value={p}>
                        {PRIORITY_LABELS[p]}
                        <span className="text-muted-foreground"> - {PRIORITY_HINTS[p]}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="body">Description *</Label>
              <Textarea
                id="body"
                required
                rows={8}
                placeholder="What happened, what did you expect, and the steps to reproduce it."
                value={body}
                onChange={(e) => setBody(e.target.value)}
                onPaste={(e) => {
                  const pasted = Array.from(e.clipboardData.files);
                  if (pasted.length) {
                    e.preventDefault();
                    files.add(pasted);
                  }
                }}
              />
            </div>

            <div className="grid gap-2">
              <Label>Attachments</Label>
              <DropZone list={files} />
              <FileChips list={files} />
            </div>
          </CardContent>
          <CardFooter className="justify-end gap-2 border-t">
            <Button type="button" variant="outline" asChild>
              <Link to="/tickets">Cancel</Link>
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <Send />}
              Submit ticket
            </Button>
          </CardFooter>
        </Card>
      </form>
    </div>
  );
}
