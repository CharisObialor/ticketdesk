import { Navigate, Outlet, useLocation } from 'react-router';
import { Loader2 } from 'lucide-react';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { AppSidebar } from '@/components/app-sidebar';
import { Footer } from '@/components/common';
import { NotificationBell } from '@/components/notification-bell';
import { IdleTimeout } from '@/components/idle-timeout';
import { AdminTour } from '@/components/admin-tour';
import { MailNotifier } from '@/components/mail-notifier';
import { useSession } from '@/hooks/use-session';
import { useNow } from '@/hooks/use-now';
import { RealtimeProvider, useRealtime } from '@/hooks/use-realtime';
import { BRAND } from '@/lib/brand';
import { cn } from '@/lib/utils';

export function FullPageLoader() {
  return (
    <div className="flex min-h-svh items-center justify-center">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
    </div>
  );
}

function ConnectionStatus() {
  const { connected, presence } = useRealtime();
  const { isStaff } = useSession();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center gap-2 rounded-md px-2 py-1 text-xs text-muted-foreground">
          <span className={cn('size-2 rounded-full', connected ? 'bg-emerald-500' : 'bg-zinc-400')} />
          <span className="hidden sm:inline">
            {connected ? (isStaff && presence ? `${presence.total} online` : 'Live') : 'Connecting'}
          </span>
        </div>
      </TooltipTrigger>
      <TooltipContent>
        {connected
          ? isStaff && presence
            ? `${presence.staff} staff and ${presence.clients} clients online`
            : 'Updates appear in real time'
          : 'Reconnecting to live updates'}
      </TooltipContent>
    </Tooltip>
  );
}

const dateFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('en-GB', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });

function HeaderClock() {
  const now = useNow();
  return (
    <time dateTime={now.toISOString()} className="flex items-center gap-2 px-2 text-xs text-muted-foreground tabular-nums sm:text-sm">
      <span className="hidden md:inline">{dateFmt.format(now)}</span>
      <span className="hidden h-3.5 w-px bg-border md:inline-block" />
      <span className="font-medium text-foreground">{timeFmt.format(now).toUpperCase()}</span>
    </time>
  );
}

export function AppLayout() {
  const { user, loading } = useSession();
  const location = useLocation();

  if (loading) return <FullPageLoader />;
  if (!user) {
    const next = location.pathname + location.search;
    return <Navigate to={next === '/' ? '/login' : `/login?next=${encodeURIComponent(next)}`} replace />;
  }

  return (
    <RealtimeProvider>
      <SidebarProvider>
        <AppSidebar />
        <IdleTimeout />
        <AdminTour />
        <MailNotifier />
        <SidebarInset>
          <header className="sticky top-0 z-10 print:hidden flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
            <span className="truncate text-sm font-medium">{BRAND.company}</span>
            <div className="ml-auto flex items-center gap-1">
              <HeaderClock />
              <ConnectionStatus />
              <div data-tour="bell">
                <NotificationBell />
              </div>
            </div>
          </header>
          <div className="flex flex-1 flex-col gap-6 p-4 md:p-6 lg:p-8">
            <Outlet />
          </div>
          <div className="px-4 pb-6 print:hidden">
            <Footer />
          </div>
        </SidebarInset>
      </SidebarProvider>
    </RealtimeProvider>
  );
}

// Staff land on the dashboard; clients on their ticket list.
export function HomeRedirect() {
  const { isStaff } = useSession();
  return <Navigate to={isStaff ? '/dashboard' : '/tickets'} replace />;
}

export function StaffOnly({ admin = false }: { admin?: boolean }) {
  const { isStaff, isAdmin } = useSession();
  if (admin ? !isAdmin : !isStaff) return <Navigate to="/" replace />;
  return <Outlet />;
}
