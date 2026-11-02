import { useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useSession } from '@/hooks/use-session';
import { api, errorMessage } from '@/lib/api';
import { initials } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { User } from '@/lib/types';

const GROUPS = [
  { label: 'Male', keys: Array.from({ length: 30 }, (_, i) => `m${i + 1}`) },
  { label: 'Female', keys: Array.from({ length: 30 }, (_, i) => `f${i + 1}`) },
];

// Lets anyone pick one of the preset cartoon avatars (or go back to initials).
export function AvatarPickerCard({ user }: { user: User }) {
  const { setUser } = useSession();
  const qc = useQueryClient();
  const [saving, setSaving] = useState<string | null>(null);

  async function choose(key: string | null) {
    if (key === user.avatar) return;
    setSaving(key ?? 'none');
    try {
      const res = await api.put<{ user: User }>('/auth/avatar', { avatar: key });
      setUser(res.user);
      qc.invalidateQueries({ queryKey: ['avatars'] });
      toast.success(key ? 'Avatar updated' : 'Showing your initials');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(null);
    }
  }

  const tile = (key: string | null, content: ReactNode, label: string) => {
    const selected = (user.avatar ?? null) === key;
    return (
      <button
        key={key ?? 'none'}
        type="button"
        onClick={() => choose(key)}
        disabled={!!saving}
        aria-label={label}
        aria-pressed={selected}
        className={cn(
          'relative rounded-full p-1 outline-none transition-transform hover:scale-105 focus-visible:ring-[3px] focus-visible:ring-ring/50',
          selected ? 'ring-2 ring-primary' : 'ring-1 ring-transparent hover:ring-border'
        )}
      >
        {content}
        {selected && (
          <span className="absolute -right-0.5 -bottom-0.5 flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground ring-2 ring-background">
            <Check className="size-3.5" />
          </span>
        )}
        {saving === (key ?? 'none') && (
          <span className="absolute inset-0 flex items-center justify-center rounded-full bg-background/60">
            <Loader2 className="size-5 animate-spin" />
          </span>
        )}
      </button>
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Avatar</CardTitle>
        <CardDescription>Choose how you appear next to your name across the portal{user.role === 'admin' ? ' and in your email signature' : ''}.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {GROUPS.map((g) => (
          <div key={g.label} className="space-y-2">
            <div className="type-h6 text-muted-foreground">{g.label}</div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(4rem,1fr))] justify-items-center gap-2">
              {g.keys.map((k) => tile(k, <img src={`/avatars/${k}.png`} alt="" className="size-14 rounded-full" loading="lazy" />, `Avatar ${k}`))}
            </div>
          </div>
        ))}
        <div className="space-y-2">
          <div className="type-h6 text-muted-foreground">No avatar</div>
          {tile(
            null,
            <span className="flex size-14 items-center justify-center rounded-full bg-muted text-lg font-semibold text-muted-foreground">{initials(user.name)}</span>,
            'Use my initials'
          )}
        </div>
      </CardContent>
    </Card>
  );
}
