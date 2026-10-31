import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useSession } from '@/hooks/use-session';
import { api } from '@/lib/api';
import { stripKey } from '@/lib/url-key';

// Shared between tabs through localStorage, so activity in any tab keeps every tab signed in
// and signing out in one tab signs out the others.
const LAST_ACTIVITY = 'td:lastActivity';
const LAST_HEARTBEAT = 'td:lastHeartbeat';
const LOGOUT = 'td:logout';
const HEARTBEAT_EVERY = 60_000;
const EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll', 'mousemove'] as const;

const read = (key: string) => {
  try {
    return Number(localStorage.getItem(key)) || 0;
  } catch {
    return 0;
  }
};
const write = (key: string, value: number) => {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // Storage may be blocked; this tab still tracks its own activity.
  }
};

export function IdleTimeout() {
  const { app } = useSession();
  const qc = useQueryClient();
  const minutes = app?.sessionIdleMinutes ?? 0;
  const idleMs = minutes * 60_000;
  const warnMs = Math.min(60_000, idleMs / 4);
  const lastActivity = useRef(Date.now());
  const warningRef = useRef(false);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  const signOut = useCallback(
    async (broadcast = true) => {
      if (broadcast) write(LOGOUT, Date.now());
      await api.post('/auth/logout').catch(() => {});
      qc.clear();
      const next = window.location.pathname + window.location.search;
      window.location.href = `/login?reason=idle${next && next !== '/' ? `&next=${encodeURIComponent(stripKey(next))}` : ''}`;
    },
    [qc]
  );

  const heartbeat = useCallback((force = false) => {
    const now = Date.now();
    if (!force && now - read(LAST_HEARTBEAT) < HEARTBEAT_EVERY) return;
    write(LAST_HEARTBEAT, now);
    api.post('/auth/heartbeat').catch(() => {});
  }, []);

  const markActive = useCallback(() => {
    lastActivity.current = Date.now();
    write(LAST_ACTIVITY, lastActivity.current);
    heartbeat();
  }, [heartbeat]);

  useEffect(() => {
    if (!idleMs) return;
    markActive();

    // Mouse movement is noisy, so activity is recorded at most every few seconds.
    let throttle = 0;
    const onActivity = () => {
      if (warningRef.current) return; // once warned, only the button keeps the session
      const now = Date.now();
      if (now - throttle < 5000) return;
      throttle = now;
      markActive();
    };
    for (const e of EVENTS) window.addEventListener(e, onActivity, { passive: true, capture: true });

    const onStorage = (e: StorageEvent) => {
      if (e.key === LOGOUT && e.newValue) signOut(false);
    };
    window.addEventListener('storage', onStorage);

    // Compares timestamps rather than counting down, so it stays correct after the computer sleeps.
    const tick = setInterval(() => {
      const idleFor = Date.now() - Math.max(lastActivity.current, read(LAST_ACTIVITY));
      if (idleFor >= idleMs) {
        clearInterval(tick);
        signOut();
      } else if (idleFor >= idleMs - warnMs) {
        warningRef.current = true;
        setSecondsLeft(Math.ceil((idleMs - idleFor) / 1000));
      } else if (warningRef.current) {
        // Another tab was used: close the warning here too.
        warningRef.current = false;
        setSecondsLeft(null);
      }
    }, 1000);

    return () => {
      for (const e of EVENTS) window.removeEventListener(e, onActivity, { capture: true });
      window.removeEventListener('storage', onStorage);
      clearInterval(tick);
    };
  }, [idleMs, warnMs, markActive, signOut]);

  const stay = () => {
    warningRef.current = false;
    setSecondsLeft(null);
    lastActivity.current = Date.now();
    write(LAST_ACTIVITY, lastActivity.current);
    heartbeat(true);
  };

  if (!idleMs) return null;
  return (
    <Dialog open={secondsLeft !== null} onOpenChange={(open) => !open && stay()}>
      <DialogContent className="sm:max-w-md" onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <div className="mb-2 flex size-10 items-center justify-center rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-400">
            <Clock className="size-5" />
          </div>
          <DialogTitle>Are you still there?</DialogTitle>
          <DialogDescription>
            For your security, you will be signed out in{' '}
            <span className="font-semibold text-foreground tabular-nums">{secondsLeft} second{secondsLeft === 1 ? '' : 's'}</span> because there has been no
            activity for {minutes} minutes.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => signOut()}>
            Sign out now
          </Button>
          <Button onClick={stay} autoFocus>
            Stay signed in
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
