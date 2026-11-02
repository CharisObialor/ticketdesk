import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, Send, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { PageHeader } from '@/components/common';
import { DropZone, FileChips, useFileList } from '@/components/file-attachments';
import { SitePicker, useSites } from '@/components/company-sites';
import { useSession } from '@/hooks/use-session';
import { api, errorMessage, qs } from '@/lib/api';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { PRIORITY_LABELS, STATUS_LABELS, duration, timeAgo } from '@/lib/format';
import { categoryOptions, faultCategory, resolutionLimit, targetsFor } from '@/lib/sla';
import type { Company, Priority, Status, Ticket, User } from '@/lib/types';

const PRIORITY_HINTS: Record<Priority, string> = {
  low: 'General question, no impact on work',
  normal: 'Minor issue with a workaround',
  high: 'Significant impact on work',
  urgent: 'Service down or business-critical',
};

const ANYONE = 'none';

export default function NewTicketPage() {
  const { app, user, isStaff } = useSession();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const files = useFileList();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [category, setCategory] = useState('General');
  const [priority, setPriority] = useState<Priority>('normal');
  const [companyId, setCompanyId] = useState('');
  const [requesterId, setRequesterId] = useState(ANYONE);
  const [siteId, setSiteId] = useState('');
  // The client's Operations Manager (OM) and Field Service Engineer (FSE) for the site.
  const [contacts, setContacts] = useState({
    om_name: '',
    om_phone: '',
    fse_name: '',
    fse_phone: '',
  });
  const setContact = (k: keyof typeof contacts) => (e: { target: { value: string } }) => setContacts((c) => ({ ...c, [k]: e.target.value }));
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

  // Companies with an SLA contract have their own fault categories; picking one sets its priority.
  const ticketCompany = isStaff ? (companyId ? Number(companyId) : null) : (user?.company_id ?? null);
  const categories = categoryOptions(app, ticketCompany);
  const faults = targetsFor(app?.sla, ticketCompany)?.categories ?? [];
  const faultList = faults.length > 0;
  // Staff choose the company first; until then the fault list is shown but locked.
  const needsCompany = isStaff && !companyId;
  // With fault categories the requester must pick one; otherwise the standard list starts on General.
  const shownCategory = categories.includes(category) ? category : faultList ? '' : categories[0];
  const fault = faultCategory(targetsFor(app?.sla, ticketCompany), shownCategory);
  const target = ticketCompany ? resolutionLimit({ company_id: ticketCompany, priority, category: shownCategory }, app?.sla) : null;
  const sites = useSites(ticketCompany);
  const siteList = sites.data?.sites ?? [];
  const site = siteList.find((x) => String(x.id) === siteId);
  // Clients must give the site, and both site contacts where their company asks for them (Pan African Towers).
  // Staff raising a ticket for a client may leave out the site; the OM and FSE are always required.
  const required = !isStaff;
  const showContacts = isStaff ? !!Number(companies.data?.companies.find((c) => String(c.id) === companyId)?.site_contacts) : !!app?.siteContacts;

  function chooseCategory(c: string) {
    const prev = faultCategory(targetsFor(app?.sla, ticketCompany), category);
    setCategory(c);
    const f = faultCategory(targetsFor(app?.sla, ticketCompany), c);
    if (f) setPriority(f.priority);
    // Prefill the fault's template unless the person has already written their own description.
    if (f?.template && (!body.trim() || body === prev?.template)) setBody(f.template);
  }
  // Photos this fault needs from the client (set by our team per fault category).
  const photosNeeded = !isStaff ? (fault?.photos_min ?? 0) : 0;
  const photosAttached = files.files.filter((f) => f.type.startsWith('image/')).length;

  // Open tickets that may be the same issue (same site, or the same fault), shown before submitting.
  const similar = useQuery({
    queryKey: ['tickets-similar', ticketCompany, siteId, shownCategory],
    queryFn: () =>
      api.get<{ tickets: { id: number; subject: string; status: Status; category: string; site_code: string | null; created_at: string }[] }>(
        `/tickets-similar${qs({ company_id: ticketCompany ?? '', site_id: siteId, category: faultList ? shownCategory : '' })}`
      ),
    enabled: !!ticketCompany && (!!siteId || (faultList && !!shownCategory)),
  });
  const duplicates = similar.data?.tickets ?? [];

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (isStaff && !companyId) return toast.error('Choose the client company for this ticket');
    if (!shownCategory) return toast.error('Choose the fault category');
    if (required && siteList.length && !siteId) return toast.error('Choose the site ID');
    if (showContacts && Object.values(contacts).some((v) => !v.trim())) return toast.error('Enter the name and phone number of the OM and the FSE');
    if (photosAttached < photosNeeded) return toast.error(`Attach at least ${photosNeeded} photo${photosNeeded === 1 ? '' : 's'} of the fault`);
    setBusy(true);
    const fd = new FormData();
    fd.set('subject', subject);
    fd.set('body', body);
    fd.set('category', shownCategory);
    fd.set('priority', priority);
    if (siteId) fd.set('site_id', siteId);
    if (showContacts) for (const [k, v] of Object.entries(contacts)) fd.set(k, v.trim());
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
                      setSiteId('');
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
              <Input
                id="subject"
                required
                maxLength={255}
                placeholder="A short summary of the issue"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </div>

            {(siteList.length > 0 || needsCompany) && (
              <div className="grid gap-2">
                <Label>Site ID{siteList.length && required ? ' *' : ''}</Label>
                <SitePicker
                  sites={siteList}
                  value={siteId}
                  onChange={setSiteId}
                  disabled={needsCompany}
                  placeholder={needsCompany ? 'Choose the company first' : 'Choose the site ID'}
                />
                {site && (site.location || site.details) && (
                  <p className="text-sm text-muted-foreground">{[site.location, site.details].filter(Boolean).join('. ')}</p>
                )}
              </div>
            )}

            {showContacts && (
              <fieldset className="grid gap-3">
                <legend className="mb-1 text-sm font-medium">
                  Site contacts
                  <span className="block text-xs font-normal text-muted-foreground">
                    The Operations Manager (OM) and Field Service Engineer (FSE) for this site.
                  </span>
                </legend>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Label htmlFor="om_name">OM name *</Label>
                    <Input id="om_name" required maxLength={120} autoComplete="off" value={contacts.om_name} onChange={setContact('om_name')} />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="om_phone">OM phone number *</Label>
                    <Input
                      id="om_phone"
                      type="tel"
                      required
                      maxLength={40}
                      autoComplete="off"
                      placeholder="0803 123 4567"
                      value={contacts.om_phone}
                      onChange={setContact('om_phone')}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="fse_name">FSE name *</Label>
                    <Input id="fse_name" required maxLength={120} autoComplete="off" value={contacts.fse_name} onChange={setContact('fse_name')} />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="fse_phone">FSE phone number *</Label>
                    <Input
                      id="fse_phone"
                      type="tel"
                      required
                      maxLength={40}
                      autoComplete="off"
                      placeholder="0803 123 4567"
                      value={contacts.fse_phone}
                      onChange={setContact('fse_phone')}
                    />
                  </div>
                </div>
              </fieldset>
            )}

            {(faultList || needsCompany) && (
              <div className="grid gap-2">
                <Label>Fault category *</Label>
                <Select value={needsCompany ? '' : shownCategory} onValueChange={chooseCategory} disabled={needsCompany}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={needsCompany ? 'Choose the company first' : 'Choose the fault'} />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((c) => {
                      const f = faults.find((x) => x.name === c);
                      return (
                        <SelectItem key={c} value={c}>
                          {c}
                          {f && (
                            <span className="text-muted-foreground">
                              {' '}
                              - {PRIORITY_LABELS[f.priority]}
                              {f.resolution ? `, ${duration(f.resolution)} to resolve` : ''}
                            </span>
                          )}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              {!faultList && !needsCompany && (
                <div className="grid gap-2">
                  <Label>Category</Label>
                  <Select value={shownCategory} onValueChange={chooseCategory}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {categories.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
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

            {(fault?.description || target) && (
              <p className="-mt-2 text-sm text-muted-foreground">
                {fault?.description ? `${fault.description}. ` : ''}
                {target ? `Target time to resolve: ${duration(target)}, from when the ticket is assigned.` : ''}
                {photosNeeded > 0 && ` Please attach at least ${photosNeeded} photo${photosNeeded === 1 ? '' : 's'} of the fault.`}
              </p>
            )}

            {duplicates.length > 0 && (
              <Alert>
                <TriangleAlert />
                <AlertTitle>There may already be a ticket for this</AlertTitle>
                <AlertDescription>
                  <p>These are still open{siteId ? ' for the same site' : ' for the same fault'}. Add to one of them instead of raising a new ticket, if it is the same issue.</p>
                  <ul className="mt-1 space-y-0.5">
                    {duplicates.map((d) => (
                      <li key={d.id}>
                        <Link to={`/tickets/${d.id}`} target="_blank" className="font-medium text-foreground underline underline-offset-4">
                          #{d.id} {d.subject}
                        </Link>{' '}
                        <span className="text-muted-foreground">
                          ({STATUS_LABELS[d.status]}
                          {d.site_code ? `, ${d.site_code}` : ''}, {timeAgo(d.created_at)})
                        </span>
                      </li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

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
