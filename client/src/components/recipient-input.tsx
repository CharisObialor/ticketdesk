import { useState, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

const EMAIL_RE = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;

// Email address field that turns each address into a chip (Enter, comma, semicolon, space or leaving the field).
export function RecipientInput({
  id,
  value,
  onChange,
  placeholder,
  className,
}: {
  id?: string;
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  className?: string;
}) {
  const [draft, setDraft] = useState('');
  const [invalid, setInvalid] = useState(false);

  const commit = (text: string) => {
    const parts = text
      .split(/[,;\s]+/)
      .map((s) => s.trim().replace(/^<|>$/g, '').toLowerCase())
      .filter(Boolean);
    if (!parts.length) return true;
    const good = parts.filter((p) => EMAIL_RE.test(p));
    const bad = parts.filter((p) => !EMAIL_RE.test(p));
    if (good.length) onChange([...new Set([...value, ...good])]);
    setDraft(bad.join(' '));
    setInvalid(bad.length > 0);
    return bad.length === 0;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (['Enter', ',', ';', ' ', 'Tab'].includes(e.key) && draft.trim()) {
      if (e.key !== 'Tab') e.preventDefault();
      commit(draft);
    } else if (e.key === 'Backspace' && !draft && value.length) {
      onChange(value.slice(0, -1));
    }
  };

  return (
    <div
      className={cn(
        'flex min-h-9 w-full flex-wrap items-center gap-1 rounded-md border border-input bg-transparent px-2 py-1 text-sm shadow-xs focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 dark:bg-input/30',
        invalid && 'border-destructive',
        className
      )}
      onClick={(e) => (e.currentTarget.querySelector('input') as HTMLInputElement | null)?.focus()}
    >
      {value.map((addr) => (
        <span key={addr} className="flex items-center gap-1 rounded-full bg-secondary py-0.5 pr-1 pl-2.5 text-xs text-secondary-foreground">
          {addr}
          <button
            type="button"
            className="rounded-full p-0.5 hover:bg-foreground/10"
            onClick={() => onChange(value.filter((a) => a !== addr))}
            aria-label={`Remove ${addr}`}
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      <input
        id={id}
        type="email"
        multiple
        autoComplete="email"
        value={draft}
        placeholder={value.length ? '' : placeholder}
        onChange={(e) => {
          setDraft(e.target.value);
          setInvalid(false);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => draft.trim() && commit(draft)}
        onPaste={(e) => {
          const text = e.clipboardData.getData('text');
          if (/[,;\s]/.test(text)) {
            e.preventDefault();
            commit(draft + ' ' + text);
          }
        }}
        className="min-w-32 flex-1 bg-transparent py-0.5 outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
}
