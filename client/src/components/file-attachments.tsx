import { useRef, useState, type ReactNode } from 'react';
import { FileText, Paperclip, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useSession } from '@/hooks/use-session';
import { fileSize } from '@/lib/format';
import { optimiseImage } from '@/lib/image';
import { cn } from '@/lib/utils';

// Adds files while enforcing the server's count and size limits. `kind: 'mail'` uses the Mail page's larger,
// per-email total limit instead of the per-file limit for portal uploads.
export function useFileList({ kind = 'portal' }: { kind?: 'portal' | 'mail' } = {}) {
  const { app } = useSession();
  const [files, setFiles] = useState<File[]>([]);
  const mail = kind === 'mail';
  const maxFiles = (mail ? app?.mailUpload?.maxFiles : app?.upload.maxFiles) ?? 5;
  const maxMb = (mail ? app?.mailUpload?.maxTotalMb : app?.upload.maxMb) ?? 10;
  const totalBytes = files.reduce((n, f) => n + f.size, 0);

  const add = async (incoming: FileList | File[] | null) => {
    if (!incoming) return;
    // Large photos are resized and re-encoded first, so uploads are faster and storage stays small.
    const list = await Promise.all(Array.from(incoming).map(optimiseImage));
    const limit = maxMb * 1024 * 1024;
    setFiles((cur) => {
      const next = [...cur];
      const rejected: string[] = [];
      let total = cur.reduce((n, f) => n + f.size, 0);
      for (const f of list) {
        // Portal uploads: each file within the limit. Email: all attachments together within the limit.
        const fits = mail ? total + f.size <= limit : f.size <= limit;
        if (!fits) rejected.push(f.name);
        else {
          next.push(f);
          total += f.size;
        }
      }
      if (rejected.length) {
        toast.error(
          mail
            ? `${rejected.join(', ')} would take this email over ${maxMb} MB of attachments`
            : `${rejected.join(', ')} ${rejected.length === 1 ? 'is' : 'are'} larger than ${maxMb} MB`
        );
      }
      if (next.length > maxFiles) toast.error(`You can attach up to ${maxFiles} files`);
      return next.slice(0, maxFiles);
    });
  };
  const remove = (i: number) => setFiles((cur) => cur.filter((_, j) => j !== i));
  const clear = () => setFiles([]);
  return { files, add, remove, clear, maxFiles, maxMb, totalBytes, kind };
}

export type FileListState = ReturnType<typeof useFileList>;

export function FileChips({ list }: { list: FileListState }) {
  if (!list.files.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {list.files.map((f, i) => (
        <div key={`${f.name}-${i}`} className="flex max-w-64 items-center gap-2 rounded-md border bg-muted/40 py-1 pr-1 pl-2 text-xs">
          <FileText className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{f.name}</span>
          <span className="shrink-0 text-muted-foreground">{fileSize(f.size)}</span>
          <Button type="button" variant="ghost" size="icon-xs" onClick={() => list.remove(i)} aria-label={`Remove ${f.name}`}>
            <X />
          </Button>
        </div>
      ))}
    </div>
  );
}

export function AttachButton({ list, children }: { list: FileListState; children?: ReactNode }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          list.add(e.target.files);
          e.target.value = '';
        }}
      />
      <Button type="button" variant="ghost" size={children ? 'sm' : 'icon-sm'} onClick={() => input.current?.click()} aria-label="Attach files">
        <Paperclip />
        {children}
      </Button>
    </>
  );
}

export function DropZone({ list }: { list: FileListState }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => input.current?.click()}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        list.add(e.dataTransfer.files);
      }}
      className={cn(
        'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-8 text-center transition-colors outline-none hover:bg-muted/40 focus-visible:ring-[3px] focus-visible:ring-ring/50',
        over && 'border-primary bg-primary/5'
      )}
    >
      <input
        ref={input}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          list.add(e.target.files);
          e.target.value = '';
        }}
      />
      <div className="flex size-10 items-center justify-center rounded-full bg-muted">
        <Upload className="size-4 text-muted-foreground" />
      </div>
      <div className="text-sm">
        <span className="font-medium">Click to upload</span> <span className="text-muted-foreground">or drag and drop</span>
      </div>
      <p className="text-xs text-muted-foreground">
        Up to {list.maxFiles} files, {list.maxMb} MB each. Screenshots can be pasted into the description.
      </p>
    </div>
  );
}
