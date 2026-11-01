import { useEffect, useState } from 'react';
import { BellRing, Loader2, Smartphone } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { api, errorMessage } from '@/lib/api';

// What this browser can do: 'ios-browser' means an iPhone/iPad in Safari, where Apple only allows notifications
// once the portal is added to the Home Screen and opened from there.
type Support = 'checking' | 'ok' | 'ios-browser' | 'unsupported';

const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

function support(): Support {
  if (isIos() && !isStandalone()) return 'ios-browser';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  return 'ok';
}

// The server's public key arrives as base64url; the browser wants raw bytes.
function keyBytes(base64: string) {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function registration() {
  const existing = await navigator.serviceWorker.getRegistration();
  if (existing) return existing;
  // Development builds do not register the service worker on load; register it now.
  return navigator.serviceWorker.register('/sw.js');
}

// Profile card: turn notifications on or off for this device, and send a test.
export function DeviceNotificationsCard() {
  const [state, setState] = useState<Support>('checking');
  const [enabled, setEnabled] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const s = support();
    setState(s);
    if (s !== 'ok') return;
    setPermission(Notification.permission);
    navigator.serviceWorker
      .getRegistration()
      .then((reg) => reg?.pushManager.getSubscription())
      .then((sub) => setEnabled(!!sub))
      .catch(() => {});
  }, []);

  async function turnOn() {
    setBusy(true);
    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result !== 'granted') {
        toast.error('Notifications were not allowed', { description: 'Allow notifications for this site in your browser or phone settings, then try again.' });
        return;
      }
      const { publicKey } = await api.get<{ publicKey: string }>('/push/key');
      const reg = await registration();
      await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
      await api.post('/push/subscribe', { subscription: sub.toJSON() });
      setEnabled(true);
      toast.success('Notifications are on for this device');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await api.post('/push/unsubscribe', { endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
      setEnabled(false);
      toast.success('Notifications are off for this device');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    try {
      await api.post('/push/test');
      toast.success('Test sent', { description: 'It should appear in a few seconds. Switch to another app or tab to see it.' });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notifications on this device</CardTitle>
        <CardDescription>
          Get a pop-up on this computer or phone when something needs you, even when the portal is not open. Turn it on separately on each device you use.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {state === 'checking' && <p className="text-muted-foreground">Checking this device...</p>}
        {state === 'ios-browser' && (
          <div className="flex gap-3 rounded-lg border p-3">
            <Smartphone className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
            <div className="space-y-1">
              <p className="font-medium">On iPhone and iPad, add the portal to your Home Screen first</p>
              <p className="text-muted-foreground">
                In Safari, tap the Share button, then <span className="font-medium text-foreground">Add to Home Screen</span>. Open the portal from the new icon,
                come back to this page and turn notifications on. This needs iOS 16.4 or later.
              </p>
            </div>
          </div>
        )}
        {state === 'unsupported' && <p className="text-muted-foreground">This browser cannot show notifications. Try Chrome, Edge or Firefox, or the installed app.</p>}
        {state === 'ok' && (
          <div className="flex items-center gap-3 rounded-lg border p-3">
            <BellRing className={enabled ? 'size-5 text-primary' : 'size-5 text-muted-foreground'} />
            <div className="min-w-0 flex-1">
              <p className="font-medium">{enabled ? 'On for this device' : permission === 'denied' ? 'Blocked on this device' : 'Off for this device'}</p>
              <p className="text-xs text-muted-foreground">
                {permission === 'denied'
                  ? 'Notifications are blocked for this site. Allow them in your browser or phone settings, then turn them on here.'
                  : 'You get the same updates as the bell. Choose which ones under Notifications above.'}
              </p>
            </div>
          </div>
        )}
      </CardContent>
      {state === 'ok' && (
        <CardFooter className="justify-end gap-2 border-t">
          {enabled && (
            <Button variant="outline" onClick={test} disabled={busy}>
              Send a test
            </Button>
          )}
          {enabled ? (
            <Button variant="outline" onClick={turnOff} disabled={busy}>
              {busy && <Loader2 className="animate-spin" />}
              Turn off
            </Button>
          ) : (
            <Button onClick={turnOn} disabled={busy || permission === 'denied'}>
              {busy && <Loader2 className="animate-spin" />}
              Turn on notifications
            </Button>
          )}
        </CardFooter>
      )}
    </Card>
  );
}
