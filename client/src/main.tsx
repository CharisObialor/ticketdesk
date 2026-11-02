import { StrictMode, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Link, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FileQuestion } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { basename, currentPath } from '@/lib/url-key';
import { EmptyState } from '@/components/common';
import { SessionProvider } from '@/hooks/use-session';
import { ThemeProvider } from '@/hooks/use-theme';
import { ApiError } from '@/lib/api';
import LoginPage from '@/pages/login';
import '@fontsource-variable/inter';
import './index.css';

// Older notification emails linked to hash routes such as /#/tickets/12.
if (window.location.hash.startsWith('#/')) {
  window.history.replaceState(null, '', window.location.hash.slice(1));
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: true,
      // Retry server errors and dropped connections (status 0), not answers such as "not found" or "sign in".
      retry: (count, err) => !(err instanceof ApiError && err.status > 0 && err.status < 500) && count < 2,
    },
  },
});

// A session that expires mid-use sends the user back to sign in.
queryClient.getQueryCache().subscribe((event) => {
  const err = event.query.state.error;
  if (event.type === 'updated' && err instanceof ApiError && err.status === 401 && event.query.queryKey[0] !== 'me') {
    if (/inactivity/i.test(err.message)) {
      window.location.href = `/login?reason=idle&next=${encodeURIComponent(currentPath())}`;
      return;
    }
    queryClient.setQueryData(['me'], null);
  }
});

function NotFound() {
  return (
    <Card>
      <EmptyState
        icon={FileQuestion}
        title="Page not found"
        description="The page you are looking for does not exist or has moved."
        action={
          <Button variant="outline" asChild>
            <Link to="/">Go to home</Link>
          </Button>
        }
      />
    </Card>
  );
}

// Pages load on demand, so the sign-in screen opens without waiting for the rest of the portal.
// After an update (or a dev server restart) an open tab can ask for a page file that no longer exists. Reload once
// to pick up the current version instead of showing an error; the stamp stops a reload loop if the server is down.
const RELOAD_KEY = 'page-load-retry';
function loadFresh<T>(load: () => Promise<T>): Promise<T> {
  return load().then(
    (m) => {
      try {
        sessionStorage.removeItem(RELOAD_KEY);
      } catch {
        // Storage may be unavailable; nothing to clear.
      }
      return m;
    },
    (err) => {
      let last = 0;
      try {
        last = Number(sessionStorage.getItem(RELOAD_KEY)) || 0;
        if (Date.now() - last > 30_000) sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
      } catch {
        last = Date.now(); // without storage, do not risk a loop
      }
      if (Date.now() - last > 30_000) {
        window.location.reload();
        return new Promise<T>(() => {}); // the page is reloading
      }
      throw err;
    }
  );
}

const page = (load: () => Promise<{ default: ComponentType }>) => () => loadFresh(load).then((m) => ({ Component: m.default }));

// The portal's frame (sidebar, header, live updates) and its page guards, loaded after the sign-in screen.
const layout = (pick: (m: typeof import('@/components/app-layout')) => ComponentType) => () =>
  loadFresh(() => import('@/components/app-layout')).then((m) => ({ Component: pick(m) }));

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    lazy: layout((m) => m.AppLayout),
    // Shown for a moment when the portal opens straight onto an on-demand page (such as /dashboard).
    hydrateFallbackElement: <div className="min-h-svh bg-background" />,
    children: [
      { index: true, lazy: layout((m) => m.HomeRedirect) },
      { path: 'tickets', lazy: page(() => import('@/pages/tickets')) },
      { path: 'tickets/new', lazy: page(() => import('@/pages/ticket-new')) },
      { path: 'tickets/:id', lazy: page(() => import('@/pages/ticket-detail')) },
      { path: 'messages', lazy: page(() => import('@/pages/messages')) },
      { path: 'messages/:type/:id', lazy: page(() => import('@/pages/messages')) },
      { path: 'profile', lazy: page(() => import('@/pages/profile')) },
      {
        lazy: layout((m) => m.ClientOnly),
        children: [
          { path: 'home', lazy: page(() => import('@/pages/client-home')) },
          { path: 'sites', lazy: page(() => import('@/pages/client-sites')) },
          { path: 'performance', lazy: page(() => import('@/pages/client-performance')) },
        ],
      },
      {
        lazy: layout((m) => m.StaffOnly),
        children: [
          { path: 'dashboard', lazy: page(() => import('@/pages/dashboard')) },
          { path: 'companies', lazy: page(() => import('@/pages/companies')) },
          { path: 'users', lazy: page(() => import('@/pages/users')) },
          { path: 'transcripts', lazy: page(() => import('@/pages/transcripts')) },
          { path: 'visits', lazy: page(() => import('@/pages/visits')) },
          { path: 'visits/:id', lazy: () => loadFresh(() => import('@/pages/visits')).then((m) => ({ Component: m.VisitDetailPage })) },
          { path: 'saved-replies', lazy: page(() => import('@/pages/saved-replies')) },
          { path: 'technicians', lazy: page(() => import('@/pages/technicians')) },
        ],
      },
      {
        lazy: layout((m) => m.AdminOnly),
        children: [
          { path: 'system', lazy: page(() => import('@/pages/system')) },
          { path: 'mail', lazy: page(() => import('@/pages/mail')) },
          { path: 'actions', lazy: page(() => import('@/pages/actions')) },
          { path: 'reports', lazy: page(() => import('@/pages/reports')) },
        ],
      },
      { path: '*', element: <NotFound /> },
    ],
  },
], { basename });

// Installable app: the service worker caches the app shell so it opens instantly (production builds only).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  // A tapped device notification opens its page inside the already-open portal.
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'open' && typeof e.data.link === 'string' && e.data.link.startsWith('/')) router.navigate(e.data.link);
  });
}

// While someone reads the sign-in screen (or the first page), fetch the everyday pages in the background so they
// open at once. Saved by the browser, so later visits skip the download.
const warmUp = () => {
  for (const load of [() => import('@/pages/tickets'), () => import('@/pages/ticket-detail'), () => import('@/pages/messages'), () => import('@/pages/ticket-new')]) {
    load().catch(() => {});
  }
};
window.addEventListener('load', () => ('requestIdleCallback' in window ? requestIdleCallback(warmUp, { timeout: 3000 }) : setTimeout(warmUp, 1500)));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <TooltipProvider delayDuration={200}>
            <RouterProvider router={router} />
            <Toaster position="top-right" richColors={false} closeButton />
          </TooltipProvider>
        </SessionProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>
);
