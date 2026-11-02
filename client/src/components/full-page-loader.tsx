import { Loader2 } from 'lucide-react';

// A centred spinner while the session or a page loads.
export function FullPageLoader() {
  return (
    <div className="flex min-h-svh items-center justify-center">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
    </div>
  );
}
