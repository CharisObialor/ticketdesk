import { useState } from 'react';
import { Download, ExternalLink, FileQuestion, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { fileSize } from '@/lib/format';

export interface PreviewFile {
  name: string;
  contentType?: string | null;
  size?: number;
  // Address that shows the file in the browser (images and PDFs), and one that downloads it.
  viewUrl: string;
  downloadUrl: string;
}

const kindOf = (f: PreviewFile) => {
  const type = (f.contentType || '').toLowerCase();
  const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
  if (/^image\/(png|jpe?g|gif|webp)$/.test(type) || ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) return 'image';
  if (type === 'application/pdf' || ext === 'pdf') return 'pdf';
  return 'other';
};

// Preview of an attachment: images and PDFs are shown here, with buttons to open it in a new tab or download it.
export function AttachmentPreviewDialog({ file, onClose }: { file: PreviewFile; onClose: () => void }) {
  const kind = kindOf(file);
  const [loading, setLoading] = useState(kind !== 'other');
  const [failed, setFailed] = useState(false);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[92svh] flex-col gap-4 sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="truncate pr-6">{file.name}</DialogTitle>
          <DialogDescription>{[file.contentType, file.size ? fileSize(file.size) : null].filter(Boolean).join(' · ') || 'Attachment'}</DialogDescription>
        </DialogHeader>
        <div className="relative flex min-h-64 flex-1 items-center justify-center overflow-auto rounded-md border bg-muted/30">
          {kind !== 'other' && loading && !failed && <Loader2 className="absolute size-6 animate-spin text-muted-foreground" />}
          {kind === 'image' && !failed && (
            <img
              src={file.viewUrl}
              alt={file.name}
              className="max-h-[70svh] max-w-full object-contain"
              onLoad={() => setLoading(false)}
              onError={() => {
                setLoading(false);
                setFailed(true);
              }}
            />
          )}
          {kind === 'pdf' && <iframe src={file.viewUrl} title={file.name} className="h-[70svh] w-full rounded-md bg-background" onLoad={() => setLoading(false)} />}
          {(kind === 'other' || failed) && (
            <div className="flex flex-col items-center gap-2 p-8 text-center text-sm text-muted-foreground">
              <FileQuestion className="size-8" />
              {failed ? 'This file could not be shown here. Download it to open it.' : 'There is no preview for this type of file. Download it to open it.'}
            </div>
          )}
        </div>
        <DialogFooter className="gap-2">
          {kind !== 'other' && !failed && (
            <Button variant="outline" asChild>
              <a href={file.viewUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink />
                Open in new tab
              </a>
            </Button>
          )}
          <Button asChild>
            <a href={file.downloadUrl}>
              <Download />
              Download
            </a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
