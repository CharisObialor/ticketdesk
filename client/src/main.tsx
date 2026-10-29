import { StrictMode, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Link, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FileQuestion } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AppLayout, HomeRedirect, StaffOnly } from '@/components/app-layout';
import { EmptyState } from '@/components/common';
import { SessionProvider } from '@/hooks/use-session';
import { ThemeProvider } from '@/hooks/use-theme';
import { ApiError } from '@/lib/api';
import LoginPage from '@/pages/login';
import TicketsPage from '@/pages/tickets';
import NewTicketPage from '@/pages/ticket-new';
import TicketDetailPage from '@/pages/ticket-detail';
import ProfilePage from '@/pages/profile';
import MessagesPage from '@/pages/messages';
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
      retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
    },
  },
});

// A session that expires mid-use sends the user back to sign in.
queryClient.getQueryCache().subscribe((event) => {
  const err = event.query.state.error;
  if (event.type === 'updated' && err instanceof ApiError && err.status === 401 && event.query.queryKey[0] !== 'me') {
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

// Staff-only pages (and the chart library) load on demand, keeping the client bundle small.
const page = (load: () => Promise<{ default: ComponentType }>) => () => load().then((m) => ({ Component: m.default }));

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <AppLayout />,
    children: [
      { index: true, element: <HomeRedirect /> },
      { path: 'tickets', element: <TicketsPage /> },
      { path: 'tickets/new', element: <NewTicketPage /> },
      { path: 'tickets/:id', element: <TicketDetailPage /> },
      { path: 'messages', element: <MessagesPage /> },
      { path: 'messages/:type/:id', element: <MessagesPage /> },
      { path: 'profile', element: <ProfilePage /> },
      {
        element: <StaffOnly />,
        children: [
          { path: 'dashboard', lazy: page(() => import('@/pages/dashboard')) },
          { path: 'companies', lazy: page(() => import('@/pages/companies')) },
          { path: 'users', lazy: page(() => import('@/pages/users')) },
          { path: 'transcripts', lazy: page(() => import('@/pages/transcripts')) },
          { path: 'visits', lazy: page(() => import('@/pages/visits')) },
          { path: 'visits/:id', lazy: () => import('@/pages/visits').then((m) => ({ Component: m.VisitDetailPage })) },
          { path: 'saved-replies', lazy: page(() => import('@/pages/saved-replies')) },
        ],
      },
      {
        element: <StaffOnly admin />,
        children: [{ path: 'system', lazy: page(() => import('@/pages/system')) }],
      },
      { path: '*', element: <NotFound /> },
    ],
  },
]);

// Installable app: the service worker caches the app shell so it opens instantly (production builds only).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

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
