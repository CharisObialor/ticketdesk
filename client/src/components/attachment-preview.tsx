import { useEffect, useState } from 'react';
import { Download, ExternalLink, FileQuestion, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { fileSize } from '@/lib/format';

export interface PreviewFile {
  name: string;
  contentType?: string | null;
  size?: number;
  // Address that shows the file in the browser (images, PDFs, video, audio), and one that downloads it.
  viewUrl: string;
  downloadUrl: string;
}

export type PreviewKind = 'image' | 'pdf' | 'video' | 'audio' | 'text' | 'other';

const TEXT_EXT = ['txt', 'log', 'csv', 'tsv', 'json', 'xml', 'md', 'ini', 'conf', 'cfg', 'yaml', 'yml', 'sh', 'py', 'php', 'sql', 'env'];
// Text files larger than this show their beginning only.
const TEXT_LIMIT = 200 * 1024;

// What the portal can show for a file, from its type (or its extension when the type is missing or generic).
export function previewKind(contentType: string | null | undefined, name: string): PreviewKind {
  const type = (contentType || '').toLowerCase();
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (/^image\/(png|jpe?g|gif|webp)$/.test(type) || ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) return 'image';
  if (type === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (/^video\/(mp4|webm|ogg|quicktime)$/.test(type) || ['mp4', 'webm', 'mov', 'm4v'].includes(ext)) return 'video';
  if (/^audio\//.test(type) || ['mp3', 'm4a', 'wav', 'ogg', 'aac', 'oga'].includes(ext)) return 'audio';
  if (/^text\//.test(type) || type === 'application/json' || TEXT_EXT.includes(ext)) return 'text';
  return 'other';
}

// The start of a text file, fetched with the person's session.
function useTextFile(url: string, enabled: boolean) {
  const [state, setState] = useState<{ text?: string; cut?: boolean; failed?: boolean }>({});
  useEffect(() => {
    if (!enabled) return;
    const ctrl = new AbortController();
    fetch(url, { credentials: 'include', signal: ctrl.signal })
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
      .then(async (b) => setState({ text: await b.slice(0, TEXT_LIMIT).text(), cut: b.size > TEXT_LIMIT }))
      .catch((e) => e.name !== 'AbortError' && setState({ failed: true }));
    return () => ctrl.abort();
  }, [url, enabled]);
  return state;
}

// Preview of an attachment: pictures, PDFs, video, audio and text files are shown here, with buttons to open it in a
// new tab or download it.
export function AttachmentPreviewDialog({ file, onClose }: { file: PreviewFile; onClose: () => void }) {
  const kind = previewKind(file.contentType, file.name);
  const [loading, setLoading] = useState(kind === 'image' || kind === 'pdf');
  const [mediaFailed, setMediaFailed] = useState(false);
  const text = useTextFile(file.downloadUrl, kind === 'text');
  const failed = mediaFailed || !!text.failed;
  const fail = () => {
    setLoading(false);
    setMediaFailed(true);
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[92svh] flex-col gap-4 sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="truncate pr-6">{file.name}</DialogTitle>
          <DialogDescription>{[file.contentType, file.size ? fileSize(file.size) : null].filter(Boolean).join(' · ') || 'Attachment'}</DialogDescription>
        </DialogHeader>
        <div className="relative flex min-h-64 min-w-0 flex-1 items-center justify-center overflow-auto rounded-md border bg-muted/30">
          {((loading && !failed) || (kind === 'text' && text.text === undefined && !failed)) && <Loader2 className="absolute size-6 animate-spin text-muted-foreground" />}
          {kind === 'image' && !failed && (
            <img src={file.viewUrl} alt={file.name} className="max-h-[70svh] max-w-full object-contain" onLoad={() => setLoading(false)} onError={fail} />
          )}
          {kind === 'pdf' && <iframe src={file.viewUrl} title={file.name} className="h-[70svh] w-full rounded-md bg-background" onLoad={() => setLoading(false)} />}
          {kind === 'video' && !failed && <video src={file.viewUrl} controls playsInline autoPlay className="max-h-[70svh] max-w-full bg-black" onError={fail} />}
          {kind === 'audio' && !failed && <audio src={file.viewUrl} controls autoPlay className="w-full max-w-md" onError={fail} />}
          {kind === 'text' && text.text !== undefined && (
            <pre className="h-full max-h-[70svh] w-full self-stretch overflow-auto bg-background p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words">
              {text.text}
              {text.cut && <span className="mt-3 block text-muted-foreground">Showing the first {fileSize(TEXT_LIMIT)}. Download the file to see all of it.</span>}
            </pre>
          )}
          {(kind === 'other' || failed) && (
            <div className="flex flex-col items-center gap-2 p-8 text-center text-sm text-muted-foreground">
              <FileQuestion className="size-8" />
              {failed ? 'This file could not be shown here. Download it to open it.' : 'There is no preview for this type of file. Download it to open it.'}
            </div>
          )}
        </div>
        <DialogFooter className="gap-2">
          {kind !== 'other' && kind !== 'text' && !failed && (
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
