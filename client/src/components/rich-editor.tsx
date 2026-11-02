import { useEffect, useRef, useState, type ReactNode } from 'react';
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import { TextStyleKit } from '@tiptap/extension-text-style';
import Highlight from '@tiptap/extension-highlight';
import Image from '@tiptap/extension-image';
import { Placeholder } from '@tiptap/extension-placeholder';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Baseline,
  Bold,
  Highlighter,
  ImagePlus,
  IndentDecrease,
  IndentIncrease,
  Italic,
  Link2,
  Link2Off,
  List,
  ListOrdered,
  Minus,
  Quote,
  Redo2,
  RemoveFormatting,
  Strikethrough,
  Underline,
  Undo2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

// Fonts that exist on (or fall back cleanly on) every common mail app.
const FONTS = [
  { label: 'Default', value: '' },
  { label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Calibri', value: 'Calibri, Carlito, sans-serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Segoe UI', value: "'Segoe UI', Roboto, sans-serif" },
  { label: 'Tahoma', value: 'Tahoma, Verdana, sans-serif' },
  { label: 'Times New Roman', value: "'Times New Roman', Times, serif" },
  { label: 'Trebuchet MS', value: "'Trebuchet MS', sans-serif" },
  { label: 'Verdana', value: 'Verdana, Geneva, sans-serif' },
  { label: 'Courier New', value: "'Courier New', monospace" },
];
const SIZES = ['10px', '12px', '14px', '15px', '16px', '18px', '20px', '24px', '28px', '32px', '40px'];
const COLORS = [
  '#000000', '#434343', '#666666', '#999999', '#cccccc', '#ffffff',
  '#b91c1c', '#c2410c', '#a16207', '#15803d', '#0e7490', '#1d4ed8',
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6',
  '#7c3aed', '#be185d', '#6d28d9', '#0f766e', '#1e3a8a', '#7f1d1d',
];
const HIGHLIGHTS = ['#fef08a', '#bbf7d0', '#bae6fd', '#fbcfe8', '#fed7aa', '#ddd6fe', '#e5e7eb'];

const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

function readAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

// Pictures go into the email itself; the server turns them into inline attachments when it is sent.
async function insertImages(editor: Editor, files: File[]) {
  for (const f of files) {
    if (!/^image\/(png|jpeg|gif|webp)$/.test(f.type)) continue;
    if (f.size > MAX_IMAGE_BYTES) {
      toast.error(`${f.name} is larger than 3 MB. Attach it instead.`);
      continue;
    }
    editor.chain().focus().setImage({ src: await readAsDataUrl(f), alt: f.name }).run();
  }
}

function ToolButton({ label, shortcut, active, disabled, onClick, children }: { label: string; shortcut?: string; active?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          aria-pressed={active}
          disabled={disabled}
          onMouseDown={(e) => e.preventDefault()} // keep the text selection
          onClick={onClick}
          className={cn('size-8', active && 'bg-accent text-accent-foreground')}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {label}
        {shortcut && <span className="ml-2 text-muted-foreground">{shortcut}</span>}
      </TooltipContent>
    </Tooltip>
  );
}

function Swatches({ colors, onPick, onClear, clearLabel }: { colors: string[]; onPick: (c: string) => void; onClear: () => void; clearLabel: string }) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-6 gap-1.5">
        {colors.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={c}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(c)}
            className="size-6 rounded-md border shadow-xs transition-transform hover:scale-110"
            style={{ background: c }}
          />
        ))}
      </div>
      <Button type="button" variant="ghost" size="sm" className="w-full" onMouseDown={(e) => e.preventDefault()} onClick={onClear}>
        {clearLabel}
      </Button>
    </div>
  );
}

function LinkButton({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const active = editor.isActive('link');
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setUrl(editor.getAttributes('link').href ?? '');
      }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Insert link" className={cn('size-8', active && 'bg-accent')} onMouseDown={(e) => e.preventDefault()}>
              <Link2 />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>
          Insert link <span className="ml-2 text-muted-foreground">Ctrl+K</span>
        </TooltipContent>
      </Tooltip>
      <PopoverContent className="w-80 space-y-2" align="start">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const href = url.trim();
            if (!href) return;
            const full = /^(https?:|mailto:|tel:)/i.test(href) ? href : href.includes('@') && !href.includes('/') ? `mailto:${href}` : `https://${href}`;
            const chain = editor.chain().focus().extendMarkRange('link');
            if (editor.state.selection.empty && !active) chain.insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href: full } }] }).run();
            else chain.setLink({ href: full }).run();
            setOpen(false);
          }}
        >
          <Input autoFocus placeholder="https://example.com or name@company.com" value={url} onChange={(e) => setUrl(e.target.value)} />
          <Button type="submit" size="sm">
            Apply
          </Button>
        </form>
        {active && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full"
            onClick={() => {
              editor.chain().focus().extendMarkRange('link').unsetLink().run();
              setOpen(false);
            }}
          >
            <Link2Off />
            Remove link
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const fileRef = useRef<HTMLInputElement>(null);
  // Re-render the toolbar as the selection moves so active states stay right.
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      strike: e.isActive('strike'),
      bullet: e.isActive('bulletList'),
      ordered: e.isActive('orderedList'),
      quote: e.isActive('blockquote'),
      align: (['left', 'center', 'right', 'justify'] as const).find((a) => e.isActive({ textAlign: a })) ?? 'left',
      font: (e.getAttributes('textStyle').fontFamily as string) ?? '',
      size: (e.getAttributes('textStyle').fontSize as string) ?? '',
      color: (e.getAttributes('textStyle').color as string) ?? '',
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
      inList: e.isActive('listItem'),
    }),
  });
  const sep = <Separator orientation="vertical" className="mx-0.5 data-[orientation=vertical]:h-5" />;
  const c = () => editor.chain().focus();

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b bg-muted/30 px-1.5 py-1" role="toolbar" aria-label="Formatting">
      <ToolButton label="Undo" shortcut="Ctrl+Z" disabled={!s.canUndo} onClick={() => c().undo().run()}>
        <Undo2 />
      </ToolButton>
      <ToolButton label="Redo" shortcut="Ctrl+Y" disabled={!s.canRedo} onClick={() => c().redo().run()}>
        <Redo2 />
      </ToolButton>
      {sep}
      <Select value={s.font || 'default'} onValueChange={(v) => (v === 'default' ? c().unsetFontFamily().run() : c().setFontFamily(v).run())}>
        <SelectTrigger size="sm" className="h-8 w-32 border-0 bg-transparent shadow-none" aria-label="Font">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {FONTS.map((f) => (
            <SelectItem key={f.label} value={f.value || 'default'} style={{ fontFamily: f.value || undefined }}>
              {f.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={s.size || 'default'} onValueChange={(v) => (v === 'default' ? c().unsetFontSize().run() : c().setFontSize(v).run())}>
        <SelectTrigger size="sm" className="h-8 w-20 border-0 bg-transparent shadow-none" aria-label="Font size">
          <SelectValue placeholder="Size" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="default">Size</SelectItem>
          {SIZES.map((z) => (
            <SelectItem key={z} value={z}>
              {parseInt(z, 10)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {sep}
      <ToolButton label="Bold" shortcut="Ctrl+B" active={s.bold} onClick={() => c().toggleBold().run()}>
        <Bold />
      </ToolButton>
      <ToolButton label="Italic" shortcut="Ctrl+I" active={s.italic} onClick={() => c().toggleItalic().run()}>
        <Italic />
      </ToolButton>
      <ToolButton label="Underline" shortcut="Ctrl+U" active={s.underline} onClick={() => c().toggleUnderline().run()}>
        <Underline />
      </ToolButton>
      <ToolButton label="Strikethrough" active={s.strike} onClick={() => c().toggleStrike().run()}>
        <Strikethrough />
      </ToolButton>
      <Popover>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button type="button" variant="ghost" size="icon-sm" className="size-8" aria-label="Text colour" onMouseDown={(e) => e.preventDefault()}>
                <span className="flex flex-col items-center">
                  <Baseline className="size-4" />
                  <span className="-mt-0.5 h-0.5 w-4 rounded" style={{ background: s.color || 'currentColor' }} />
                </span>
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>Text colour</TooltipContent>
        </Tooltip>
        <PopoverContent className="w-auto">
          <Swatches colors={COLORS} onPick={(col) => c().setColor(col).run()} onClear={() => c().unsetColor().run()} clearLabel="Automatic" />
        </PopoverContent>
      </Popover>
      <Popover>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button type="button" variant="ghost" size="icon-sm" className="size-8" aria-label="Highlight" onMouseDown={(e) => e.preventDefault()}>
                <Highlighter />
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>Highlight</TooltipContent>
        </Tooltip>
        <PopoverContent className="w-auto">
          <Swatches colors={HIGHLIGHTS} onPick={(col) => c().setHighlight({ color: col }).run()} onClear={() => c().unsetHighlight().run()} clearLabel="No highlight" />
        </PopoverContent>
      </Popover>
      {sep}
      <ToolButton label="Bulleted list" active={s.bullet} onClick={() => c().toggleBulletList().run()}>
        <List />
      </ToolButton>
      <ToolButton label="Numbered list" active={s.ordered} onClick={() => c().toggleOrderedList().run()}>
        <ListOrdered />
      </ToolButton>
      <ToolButton label="Decrease indent" disabled={!s.inList} onClick={() => c().liftListItem('listItem').run()}>
        <IndentDecrease />
      </ToolButton>
      <ToolButton label="Increase indent" disabled={!s.inList} onClick={() => c().sinkListItem('listItem').run()}>
        <IndentIncrease />
      </ToolButton>
      {sep}
      <ToolButton label="Align left" active={s.align === 'left'} onClick={() => c().setTextAlign('left').run()}>
        <AlignLeft />
      </ToolButton>
      <ToolButton label="Centre" active={s.align === 'center'} onClick={() => c().setTextAlign('center').run()}>
        <AlignCenter />
      </ToolButton>
      <ToolButton label="Align right" active={s.align === 'right'} onClick={() => c().setTextAlign('right').run()}>
        <AlignRight />
      </ToolButton>
      <ToolButton label="Justify" active={s.align === 'justify'} onClick={() => c().setTextAlign('justify').run()}>
        <AlignJustify />
      </ToolButton>
      {sep}
      <LinkButton editor={editor} />
      <ToolButton label="Insert picture" onClick={() => fileRef.current?.click()}>
        <ImagePlus />
      </ToolButton>
      <ToolButton label="Quote" active={s.quote} onClick={() => c().toggleBlockquote().run()}>
        <Quote />
      </ToolButton>
      <ToolButton label="Horizontal line" onClick={() => c().setHorizontalRule().run()}>
        <Minus />
      </ToolButton>
      <ToolButton label="Clear formatting" onClick={() => c().unsetAllMarks().clearNodes().unsetTextAlign().run()}>
        <RemoveFormatting />
      </ToolButton>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        multiple
        className="hidden"
        onChange={(e) => {
          insertImages(editor, Array.from(e.target.files ?? []));
          e.target.value = '';
        }}
      />
    </div>
  );
}

// A word-processor style editor: formatting toolbar, pictures, links, lists and alignment. Produces email-safe HTML.
export function RichEditor({
  initialHtml = '',
  placeholder,
  autoFocus,
  onChange,
  onFiles,
  onSubmitShortcut,
  className,
}: {
  initialHtml?: string;
  placeholder?: string;
  autoFocus?: boolean;
  onChange: (html: string, isEmpty: boolean) => void;
  // Non-image files pasted or dropped into the editor become attachments.
  onFiles?: (files: File[]) => void;
  onSubmitShortcut?: () => void;
  className?: string;
}) {
  const submitRef = useRef(onSubmitShortcut);
  submitRef.current = onSubmitShortcut;
  const filesRef = useRef(onFiles);
  filesRef.current = onFiles;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false, autolink: true, defaultProtocol: 'https' } }),
      TextStyleKit,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Image.configure({ inline: false, allowBase64: true }),
      Placeholder.configure({ placeholder: placeholder ?? 'Write your message' }),
    ],
    content: initialHtml,
    autofocus: autoFocus ? 'start' : false,
    immediatelyRender: true,
    editorProps: {
      attributes: { class: 'mail-editor prose-email min-h-60 px-4 py-3 outline-none', 'aria-label': 'Message body' },
      handleKeyDown: (_view, event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
          submitRef.current?.();
          return true;
        }
        return false;
      },
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []);
        if (!files.length) return false;
        const images = files.filter((f) => f.type.startsWith('image/'));
        const others = files.filter((f) => !f.type.startsWith('image/'));
        if (images.length && editorRef.current) insertImages(editorRef.current, images);
        if (others.length) filesRef.current?.(others);
        return true;
      },
      handleDrop: (_view, event) => {
        const files = Array.from((event as DragEvent).dataTransfer?.files ?? []);
        if (!files.length) return false;
        event.preventDefault();
        const images = files.filter((f) => f.type.startsWith('image/'));
        const others = files.filter((f) => !f.type.startsWith('image/'));
        if (images.length && editorRef.current) insertImages(editorRef.current, images);
        if (others.length) filesRef.current?.(others);
        return true;
      },
    },
    onUpdate: ({ editor: e }) => onChange(e.getHTML(), e.isEmpty),
  });
  const editorRef = useRef<Editor | null>(null);
  editorRef.current = editor;

  useEffect(() => {
    if (editor) onChange(editor.getHTML(), editor.isEmpty);
    // Report the starting content (for example the signature) once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  // Ctrl+K opens the link box, like Outlook and Gmail.
  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        (dom.closest('.rich-editor')?.querySelector('[aria-label="Insert link"]') as HTMLButtonElement | null)?.click();
      }
    };
    dom.addEventListener('keydown', onKey);
    return () => dom.removeEventListener('keydown', onKey);
  }, [editor]);

  if (!editor) return null;
  return (
    <div className={cn('rich-editor flex min-h-0 flex-col rounded-md border bg-background', className)}>
      <Toolbar editor={editor} />
      <EditorContent editor={editor} className="min-h-0 flex-1 cursor-text overflow-y-auto" onClick={() => editor.chain().focus().run()} />
    </div>
  );
}
