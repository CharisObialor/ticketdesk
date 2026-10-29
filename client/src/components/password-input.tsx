import { useState, type ComponentProps, type KeyboardEvent } from 'react';
import { ArrowBigUp, Check, Circle, Eye, EyeOff } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { passwordChecks } from '@/lib/password';
import { cn } from '@/lib/utils';

// Live list of the password rules, ticked as they are met.
export function PasswordChecklist({ password, email, name }: { password: string; email?: string | null; name?: string | null }) {
  const checks = passwordChecks(password, { email, name });
  const met = checks.filter((c) => c.met).length;
  return (
    <div className="grid gap-2">
      <div className="flex gap-1" aria-hidden>
        {checks.map((_, i) => (
          <span
            key={i}
            className={cn(
              'h-1 flex-1 rounded-full bg-muted transition-colors',
              i < met && (met === checks.length ? 'bg-emerald-500' : met >= 3 ? 'bg-amber-500' : 'bg-red-500')
            )}
          />
        ))}
      </div>
      <ul className="grid gap-1 text-xs">
        {checks.map((c) => (
          <li key={c.label} className={cn('flex items-center gap-1.5', c.met ? 'text-emerald-700 dark:text-emerald-400' : 'text-muted-foreground')}>
            {c.met ? <Check className="size-3.5" /> : <Circle className="size-3" />}
            {c.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

// Password field with a show/hide toggle and a Caps Lock warning.
export function PasswordInput({ className, onKeyDown, onKeyUp, onBlur, ...props }: Omit<ComponentProps<'input'>, 'type'>) {
  const [visible, setVisible] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const checkCaps = (e: KeyboardEvent<HTMLInputElement>) => setCapsLock(e.getModifierState?.('CapsLock') ?? false);

  return (
    <div className="grid gap-1.5">
      <div className="relative">
        <Input
          {...props}
          type={visible ? 'text' : 'password'}
          className={cn('pr-10', className)}
          onKeyDown={(e) => {
            checkCaps(e);
            onKeyDown?.(e);
          }}
          onKeyUp={(e) => {
            checkCaps(e);
            onKeyUp?.(e);
          }}
          onBlur={(e) => {
            setCapsLock(false);
            onBlur?.(e);
          }}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none"
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
          disabled={props.disabled}
        >
          {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
      {capsLock && (
        <p className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400" role="status">
          <ArrowBigUp className="size-3.5" />
          Caps Lock is on
        </p>
      )}
    </div>
  );
}
