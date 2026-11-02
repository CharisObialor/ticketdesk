// Service worker for the installable app. It caches the app shell so the portal opens quickly,
// and never caches API calls or uploaded files, which always come from the server.
const CACHE = 'dateheight-shell-v2';
const SHELL = ['/', '/manifest.webmanifest', '/logo.png', '/logo-dark.png', '/logo-mark.png', '/favicon-32.png', '/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io/')) return;

  // Page loads: network first so people always get the latest app; fall back to the cached shell offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('/', copy));
          return res;
        })
        .catch(() => caches.match('/'))
    );
    return;
  }

  // Fingerprinted build files never change, so cache them on first use.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          })
      )
    );
  }
});

// ---- Device notifications ----
// Each bell notification is also pushed here. While the portal is open and in front, the bell already shows it,
// so desktop and Android skip the pop-up. iPhone and iPad always show it: Apple requires every push to be shown.

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'DateHeight Support', body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      const inFront = wins.some((w) => w.focused && w.visibilityState === 'visible');
      if (inFront && !/iPhone|iPad|iPod/.test(self.navigator.userAgent)) return undefined;
      return self.registration.showNotification(data.title || 'DateHeight Support', {
        body: data.body || '',
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        tag: data.tag,
        data: { link: data.link || '/' },
      });
    })
  );
});

// Tapping a notification opens the page it is about, in the portal window if one is open.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      const win = wins.find((w) => new URL(w.url).origin === self.location.origin);
      if (win) {
        win.postMessage({ type: 'open', link });
        return win.focus();
      }
      return self.clients.openWindow(link);
    })
  );
});
