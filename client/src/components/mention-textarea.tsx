import { useMemo, useRef, useState, type ComponentProps, type KeyboardEvent, type ReactNode } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { UserAvatar } from '@/components/common';
import { cn } from '@/lib/utils';

export interface MentionPerson {
  id: number;
  name: string;
  detail?: string | null;
  avatarUrl?: string | null;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The "@text" being typed just before the caret, if any (an @ at the start or after a space, up to 40 characters).
function typedMention(value: string, caret: number) {
  const m = /(^|\s)@([^@\n]{0,40})$/.exec(value.slice(0, caret));
  return m ? { start: caret - m[2].length - 1, text: m[2] } : null;
}

function matches(people: MentionPerson[], text: string) {
  const q = text.toLowerCase();
  return people
    .filter((p) => {
      const name = p.name.toLowerCase();
      return name.startsWith(q) || name.split(/\s+/).some((w) => w.startsWith(q));
    })
    .slice(0, 6);
}

/**
 * A message box where typing @ lists the people in the conversation. Picking one (click, Enter or Tab) writes
 * "@Full Name"; the server tells the people named. Enter still sends when the list is closed.
 */
export function MentionTextarea({
  people,
  value,
  onValueChange,
  onKeyDown,
  ...rest
}: Omit<ComponentProps<typeof Textarea>, 'value' | 'onChange'> & { people: MentionPerson[]; value: string; onValueChange: (value: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const [typed, setTyped] = useState<{ start: number; text: string } | null>(null);
  const [active, setActive] = useState(0);
  const options = useMemo(() => (typed ? matches(people, typed.text) : []), [people, typed]);
  const open = options.length > 0;

  const track = (el: HTMLTextAreaElement) => {
    const next = el.selectionStart === el.selectionEnd ? typedMention(el.value, el.selectionStart) : null;
    setTyped((prev) => (prev?.start === next?.start && prev?.text === next?.text ? prev : next));
    if (next?.text !== typed?.text) setActive(0);
  };

  function pick(p: MentionPerson) {
    const el = ref.current;
    if (!el || !typed) return;
    const caret = el.selectionStart;
    const insert = `@${p.name} `;
    onValueChange(value.slice(0, typed.start) + insert + value.slice(caret).replace(/^ /, ''));
    setTyped(null);
    const at = typed.start + insert.length;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(at, at);
    });
  }

  const keyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        pick(options[Math.min(active, options.length - 1)]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setTyped(null);
        return;
      }
    }
    onKeyDown?.(e);
  };

  return (
    <div className="relative min-w-0 flex-1">
      {open && (
        <div role="listbox" aria-label="Mention someone" className="absolute bottom-full left-0 z-20 mb-1 w-64 max-w-full overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
          {options.map((p, i) => (
            <button
              key={p.id}
              type="button"
              role="option"
              aria-selected={i === active}
              className={cn('flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm', i === active ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60')}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(p)}
            >
              <UserAvatar name={p.name} userId={p.id} src={p.avatarUrl} className="size-6 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
              {p.detail && <span className="shrink-0 text-xs text-muted-foreground">{p.detail}</span>}
            </button>
          ))}
        </div>
      )}
      {/* The same text drawn behind the box with tags in blue. The box's own text is transparent (the caret is not),
          so both layers must keep identical font, padding, border and wrapping. */}
      <div
        ref={backdrop}
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-0 overflow-hidden rounded-md border border-transparent px-3 py-2 text-base break-words whitespace-pre-wrap text-foreground md:text-sm dark:bg-input/30',
          rest.className
        )}
      >
        {withMentions(value, people.map((p) => p.name), () => 'rounded-sm bg-blue-100 text-blue-700 dark:bg-blue-500/25 dark:text-blue-300')}
        {value.endsWith('\n') ? ' ' : null}
      </div>
      <Textarea
        {...rest}
        ref={ref}
        value={value}
        className={cn(rest.className, 'relative bg-transparent text-transparent caret-foreground [scrollbar-width:none] selection:bg-blue-200/60 dark:bg-transparent')}
        aria-autocomplete="list"
        aria-expanded={open}
        onChange={(e) => {
          onValueChange(e.target.value);
          track(e.target);
        }}
        onScroll={(e) => {
          if (backdrop.current) backdrop.current.scrollTop = e.currentTarget.scrollTop;
        }}
        onSelect={(e) => track(e.currentTarget)}
        onBlur={(e) => {
          setTyped(null);
          rest.onBlur?.(e);
        }}
        onKeyDown={keyDown}
      />
    </div>
  );
}

// Text with each "@Full Name" tag (for the names given) wrapped in a span styled by `style(name)`.
function withMentions(text: string, names: string[], style: (name: string) => string) {
  const list = [...new Set(names.map((n) => n.trim()).filter(Boolean))].sort((a, b) => b.length - a.length);
  if (!list.length || !text.includes('@')) return text;
  const re = new RegExp(`(^|[^\\w@])@(${list.map(escape).join('|')})(?!\\w)`, 'gi');
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const at = (m.index ?? 0) + m[1].length;
    out.push(text.slice(last, at));
    out.push(
      <span key={at} className={style(m[2])}>
        @{m[2]}
      </span>
    );
    last = at + m[2].length + 1;
  }
  out.push(text.slice(last));
  return out;
}

// A message with "@Full Name" tags in bold; tags of the signed-in person are highlighted.
export function MentionText({ text, names, me }: { text: string; names: string[]; me?: string | null }) {
  const mine = (name: string) => !!me && name.toLowerCase() === me.trim().toLowerCase();
  return <>{withMentions(text, names, (name) => cn('font-semibold', mine(name) && 'rounded-sm bg-primary/15 px-0.5 text-primary'))}</>;
}
