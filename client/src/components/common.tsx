import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { BRAND } from '@/lib/brand';
import { initials } from '@/lib/format';
import { cn } from '@/lib/utils';

// The circular emblem from the DateHeight logo, for small spaces.
export function Logo({ className }: { className?: string }) {
  return <img src="/logo-mark.png" alt={BRAND.short} className={cn('size-8 shrink-0 object-contain', className)} />;
}

// Full DateHeight logo. Its dark text is swapped for a light version in dark mode.
export function BrandLogo({ className }: { className?: string }) {
  return (
    <>
      <img src="/logo.png" alt={BRAND.company} className={cn('h-9 w-auto object-contain dark:hidden', className)} />
      <img src="/logo-dark.png" alt={BRAND.company} className={cn('hidden h-9 w-auto object-contain dark:block', className)} />
    </>
  );
}

// Sidebar header: full logo when expanded, emblem only when the sidebar is collapsed to icons.
export function BrandLockup({ className }: { className?: string }) {
  return (
    <div className={cn('flex min-w-0 items-center', className)}>
      <div className="flex min-w-0 group-data-[collapsible=icon]:hidden">
        <BrandLogo className="h-9" />
      </div>
      <Logo className="hidden group-data-[collapsible=icon]:block" />
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, description, action }: { icon: LucideIcon; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      <div className="flex size-11 items-center justify-center rounded-full bg-muted">
        <Icon className="size-5 text-muted-foreground" />
      </div>
      <div className="space-y-1">
        <p className="font-medium">{title}</p>
        {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function UserAvatar({ name, className }: { name: string | null | undefined; className?: string }) {
  return (
    <Avatar className={cn('size-8', className)}>
      <AvatarFallback className="text-xs font-medium">{initials(name)}</AvatarFallback>
    </Avatar>
  );
}

export function Footer() {
  return (
    <div className="space-y-1 text-center text-xs text-muted-foreground">
      <p>
        &copy; {new Date().getFullYear()} {BRAND.company}. All rights reserved.
      </p>
      <p>
        This platform is developed and maintained by{' '}
        <a href="mailto:charisobialor@gmail.com" className="font-medium text-foreground/80 underline-offset-4 hover:text-foreground hover:underline">
          charisobialor@gmail.com
        </a>
      </p>
    </div>
  );
}
