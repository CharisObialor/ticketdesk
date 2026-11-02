import type { LucideIcon } from 'lucide-react';
import { UserAvatar } from '@/components/common';
import { apiHref } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { ConversationImage } from '@/lib/types';

// A conversation's picture: the other admin's avatar, a company's (or our) logo, or an icon when there is none.
export function ConversationPicture({ image, name, icon: Icon, className, muted }: { image?: ConversationImage | null; name: string; icon: LucideIcon; className?: string; muted?: boolean }) {
  if (image && image.kind === 'avatar') return <UserAvatar name={name} userId={image.user_id ?? undefined} src={image.url} className={cn('size-10 shrink-0', className)} />;
  if (image && image.url) {
    return (
      <span className={cn('flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full border bg-white p-1', className)}>
        <img src={apiHref(image.url)} alt="" className="size-full object-contain" loading="lazy" />
      </span>
    );
  }
  return (
    <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-full', muted ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary', className)}>
      <Icon className="size-4" />
    </span>
  );
}
