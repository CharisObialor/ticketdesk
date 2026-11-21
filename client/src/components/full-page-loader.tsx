import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

// Shown while the portal opens: the logo and a spinner (the same as the page shows before any code runs, see
// index.html). If it takes a while, usually because the server is starting up after a quiet spell, it says so.
export function FullPageLoader() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 4000);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 bg-background" role="status" aria-live="polite">
      <img src="/logo-mark.png" alt="" width={48} height={48} className="size-12" />
      <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
      <p className="h-5 text-sm text-muted-foreground">{slow ? 'Starting up, this can take a few seconds...' : <span className="sr-only">Loading</span>}</p>
    </div>
  );
}
