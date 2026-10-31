import { useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ImagePlus, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useSession } from '@/hooks/use-session';
import { api, errorMessage } from '@/lib/api';
import { duration, fileSize } from '@/lib/format';
import type { Attachment, Ticket } from '@/lib/types';
import { apiHref } from '@/lib/api';

type PhotoLabel = 'before' | 'after';
const UNITS = { minutes: 1, hours: 60, days: 1440 } as const;
type Unit = keyof typeof UNITS;

// Phone photos are often 4-8 MB. They are scaled to at most 2000 px and saved as JPEG before upload, which keeps
// them clear enough to read labels and meters while a full set of before and after photos uploads quickly.
const MAX_SIDE = 2000;
async function shrink(file: File): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 400 * 1024) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    return file;
  }
}

// The engineer's report on the work: what was done, how long it took, and photos from before and after.
export function WorkUpdateDialog({ ticket: t, open, onOpenChange }: { ticket: Ticket; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const { app } = useSession();
  const [body, setBody] = useState('');
  const [amount, setAmount] = useState('');
  const [unit, setUnit] = useState<Unit>('hours');
  const [photos, setPhotos] = useState<{ file: File; label: PhotoLabel }[]>([]);
  const [resolve, setResolve] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preparing, setPreparing] = useState(0);
  const maxFiles = app?.workUpload?.maxFiles ?? 40;
  const maxMb = app?.workUpload?.maxMb ?? 10;
  const maxTotalMb = app?.workUpload?.maxTotalMb ?? 200;
  const totalBytes = photos.reduce((n, p) => n + p.file.size, 0);
  const minutes = amount ? Math.round(Number(amount) * UNITS[unit]) : null;

  async function add(files: File[], label: PhotoLabel) {
    const picked = files.filter((f) => f.type.startsWith('image/'));
    if (picked.length < files.length) toast.error('Only photos can be added here');
    setPreparing((n) => n + picked.length);
    const images = await Promise.all(picked.map(shrink));
    setPreparing((n) => n - picked.length);
    const tooBig = images.filter((f) => f.size > maxMb * 1024 * 1024);
    if (tooBig.length) toast.error(`Photos must be ${maxMb} MB or smaller`);
    const ok = images.filter((f) => !tooBig.includes(f));
    setPhotos((prev) => {
      const next = [...prev, ...ok.map((file) => ({ file, label }))];
      if (next.length > maxFiles) toast.error(`Up to ${maxFiles} photos per update`);
      const kept = next.slice(0, maxFiles);
      // Keep within the total size allowed per update.
      let bytes = 0;
      const fits = kept.filter((p) => (bytes += p.file.size) <= maxTotalMb * 1024 * 1024);
      if (fits.length < kept.length) toast.error(`Photos on one update can total ${maxTotalMb} MB. Post the rest in another update.`);
      return fits;
    });
  }

  function reset() {
    setBody('');
    setAmount('');
    setPhotos([]);
    setResolve(false);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (minutes !== null && (!Number.isFinite(minutes) || minutes < 1)) return toast.error('Enter the time spent, or leave it blank');
    setBusy(true);
    const fd = new FormData();
    fd.set('body', body.trim());
    if (minutes) fd.set('time_spent_min', String(minutes));
    for (const p of photos) fd.append('files', p.file);
    fd.set('labels', JSON.stringify(photos.map((p) => p.label)));
    try {
      await api.post(`/tickets/${t.id}/work-updates`, fd);
      if (resolve) await api.patch(`/tickets/${t.id}`, { status: 'resolved' });
      toast.success(resolve ? 'Work update posted and ticket marked as resolved' : 'Work update posted');
      qc.invalidateQueries({ queryKey: ['ticket', t.id] });
      qc.invalidateQueries({ queryKey: ['tickets'] });
      reset();
      onOpenChange(false);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="sm:max-w-xl">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Work update</DialogTitle>
            <DialogDescription>Record the work carried out on ticket #{t.id}. The client sees this update and gets an email about it.</DialogDescription>
          </DialogHeader>

          <div className="grid gap-2">
            <Label htmlFor="work-body">Work carried out *</Label>
            <Textarea
              id="work-body"
              required
              rows={5}
              maxLength={20000}
              placeholder="What was found, what was done, parts replaced, tests carried out, and anything still outstanding."
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="work-time">Time spent</Label>
            <div className="flex gap-2">
              <Input
                id="work-time"
                type="number"
                min="0"
                step="any"
                inputMode="decimal"
                placeholder="e.g. 3"
                className="w-32"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <Select value={unit} onValueChange={(v) => setUnit(v as Unit)}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="minutes">Minutes</SelectItem>
                  <SelectItem value="hours">Hours</SelectItem>
                  <SelectItem value="days">Days</SelectItem>
                </SelectContent>
              </Select>
              {!!minutes && minutes > 0 && <span className="self-center text-sm text-muted-foreground">{duration(minutes)}</span>}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <PhotoPicker label="Before" photos={photos.filter((p) => p.label === 'before')} onAdd={(f) => add(f, 'before')} onRemove={(file) => setPhotos((prev) => prev.filter((p) => p.file !== file))} />
            <PhotoPicker label="After" photos={photos.filter((p) => p.label === 'after')} onAdd={(f) => add(f, 'after')} onRemove={(file) => setPhotos((prev) => prev.filter((p) => p.file !== file))} />
          </div>
          <p className="-mt-2 text-xs text-muted-foreground">
            {photos.length} of up to {maxFiles} photos ({fileSize(totalBytes)}).{preparing > 0 && ` Preparing ${preparing} photo${preparing === 1 ? '' : 's'}...`}
          </p>

          {t.status !== 'resolved' && (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={resolve} onCheckedChange={(v) => setResolve(v === true)} />
              The work is complete. Mark the ticket as resolved.
            </label>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || preparing > 0 || !body.trim()}>
              {busy && <Loader2 className="animate-spin" />}
              Post update
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PhotoPicker({ label, photos, onAdd, onRemove }: { label: string; photos: { file: File }[]; onAdd: (files: File[]) => void; onRemove: (file: File) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="grid content-start gap-2 rounded-md border p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{label} photos</span>
        <Button type="button" size="sm" variant="outline" onClick={() => input.current?.click()}>
          <ImagePlus />
          Add
        </Button>
        <input
          ref={input}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            onAdd(Array.from(e.target.files ?? []));
            e.target.value = '';
          }}
        />
      </div>
      {photos.length === 0 ? (
        <p className="text-xs text-muted-foreground">No photos added.</p>
      ) : (
        <div className="grid max-h-64 grid-cols-4 gap-2 overflow-y-auto">
          {photos.map(({ file }, i) => (
            <Thumb key={`${file.name}-${i}`} file={file} onRemove={() => onRemove(file)} />
          ))}
        </div>
      )}
    </div>
  );
}

function Thumb({ file, onRemove }: { file: File; onRemove: () => void }) {
  const [url] = useState(() => URL.createObjectURL(file));
  return (
    <div className="group relative overflow-hidden rounded border" title={`${file.name} (${fileSize(file.size)})`}>
      <img src={url} alt={file.name} className="aspect-square w-full object-cover" />
      <button
        type="button"
        onClick={() => {
          URL.revokeObjectURL(url);
          onRemove();
        }}
        className="absolute top-1 right-1 rounded-full bg-background/90 p-0.5 shadow-sm"
        aria-label={`Remove ${file.name}`}
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

// Photos on a work update, shown side by side under Before and After headings.
export function BeforeAfterPhotos({ items, base = apiHref('/api/files') }: { items: Attachment[]; base?: string }) {
  const groups = (['before', 'after'] as const).map((l) => ({ label: l, items: items.filter((a) => a.label === l) })).filter((g) => g.items.length);
  if (!groups.length) return null;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {groups.map((g) => (
        <div key={g.label} className="space-y-1.5">
          <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{g.label === 'before' ? 'Before' : 'After'}</div>
          <div className="flex flex-wrap gap-2">
            {g.items.map((a) => (
              <a key={a.id} href={`${base}/${a.id}`} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-md border hover:opacity-90">
                <img src={`${base}/${a.id}`} alt={a.original_name} className="h-28 max-w-56 object-cover" loading="lazy" />
              </a>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
