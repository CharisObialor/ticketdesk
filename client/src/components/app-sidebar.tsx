import { Link, useLocation, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  Archive,
  Building2,
  CalendarClock,
  Download,
  ChevronsUpDown,
  CircleCheck,
  Inbox,
  LayoutDashboard,
  LogOut,
  MessageSquareText,
  MessagesSquare,
  Monitor,
  Moon,
  Plus,
  Server,
  Sun,
  TriangleAlert,
  UserCheck,
  UserRound,
  UserX,
  Users,
  type LucideIcon,
} from 'lucide-react';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { BrandLockup, UserAvatar } from '@/components/common';
import { useSession } from '@/hooks/use-session';
import { useTheme, type Theme } from '@/hooks/use-theme';
import { api } from '@/lib/api';
import { ROLE_LABELS } from '@/lib/format';
import type { Counts } from '@/lib/types';
import { useInbox } from '@/pages/messages';
import { useInstallPrompt } from '@/hooks/use-install';

interface NavItem {
  label: string;
  icon: LucideIcon;
  to: string;
  view?: string;
  count?: keyof Counts;
}

export function AppSidebar() {
  const { user, isStaff, isAdmin, signOut } = useSession();
  const { theme, setTheme } = useTheme();
  const { isMobile, setOpenMobile } = useSidebar();
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const counts = useQuery({ queryKey: ['counts'], queryFn: () => api.get<Counts>('/tickets/counts'), refetchInterval: 60_000 });
  const inbox = useInbox();
  const { canInstall, install } = useInstallPrompt();
  const unreadMessages = inbox.data?.unread ?? 0;

  if (!user) return null;

  const ticketNav: NavItem[] = isStaff
    ? [
        { label: 'All open', icon: Inbox, to: '/tickets', view: 'open', count: 'open' },
        { label: 'Assigned to me', icon: UserCheck, to: '/tickets', view: 'mine', count: 'mine' },
        { label: 'Unassigned', icon: UserX, to: '/tickets', view: 'unassigned', count: 'unassigned' },
        { label: 'Escalated', icon: TriangleAlert, to: '/tickets', view: 'escalated', count: 'escalated' },
        { label: 'Resolved', icon: CircleCheck, to: '/tickets', view: 'resolved' },
      ]
    : [
        { label: 'Open tickets', icon: Inbox, to: '/tickets', view: 'open', count: 'open' },
        { label: 'Raised by me', icon: UserRound, to: '/tickets', view: 'mine', count: 'mine' },
        { label: 'Resolved', icon: CircleCheck, to: '/tickets', view: 'resolved' },
      ];

  const workNav: NavItem[] = [
    { label: 'Site visits', icon: CalendarClock, to: '/visits' },
    { label: 'Saved replies', icon: MessageSquareText, to: '/saved-replies' },
  ];

  const adminNav: NavItem[] = [
    { label: 'Companies', icon: Building2, to: '/companies' },
    { label: 'Users', icon: Users, to: '/users' },
    { label: 'Transcripts', icon: Archive, to: '/transcripts' },
    ...(isAdmin ? [{ label: 'System', icon: Server, to: '/system' }] : []),
  ];

  const isActive = (item: NavItem) =>
    item.view ? pathname === '/tickets' && (params.get('view') || 'open') === item.view : pathname.startsWith(item.to);
  const close = () => isMobile && setOpenMobile(false);
  const href = (item: NavItem) => (item.view ? `${item.to}?view=${item.view}` : item.to);

  const renderItems = (items: NavItem[]) =>
    items.map((item) => (
      <SidebarMenuItem key={item.label}>
        <SidebarMenuButton asChild isActive={isActive(item)} tooltip={item.label}>
          <Link to={href(item)} onClick={close}>
            <item.icon />
            <span>{item.label}</span>
          </Link>
        </SidebarMenuButton>
        {item.count && counts.data && counts.data[item.count] > 0 && <SidebarMenuBadge>{counts.data[item.count]}</SidebarMenuBadge>}
      </SidebarMenuItem>
    ));

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link to="/" onClick={close}>
                <BrandLockup />
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild tooltip="New ticket" className="bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground">
                  <Link to="/tickets/new" onClick={close}>
                    <Plus />
                    <span>New ticket</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={pathname.startsWith('/messages')} tooltip="Messages">
                  <Link to="/messages" onClick={close}>
                    <MessagesSquare />
                    <span>Messages</span>
                  </Link>
                </SidebarMenuButton>
                {unreadMessages > 0 && <SidebarMenuBadge className="bg-primary text-primary-foreground">{unreadMessages > 99 ? '99+' : unreadMessages}</SidebarMenuBadge>}
              </SidebarMenuItem>
              {isStaff && (
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={pathname === '/dashboard'} tooltip="Dashboard">
                    <Link to="/dashboard" onClick={close}>
                      <LayoutDashboard />
                      <span>Dashboard</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Tickets</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{renderItems(ticketNav)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {isStaff && (
          <SidebarGroup>
            <SidebarGroupLabel>Field and team</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>{renderItems(workNav)}</SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {isStaff && (
          <SidebarGroup>
            <SidebarGroupLabel>{isAdmin ? 'Administration' : 'Directory'}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>{renderItems(adminNav)}</SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground">
                  <UserAvatar name={user.name} className="rounded-lg" />
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">{user.name}</span>
                    <span className="truncate text-xs text-muted-foreground">{user.email}</span>
                  </div>
                  <ChevronsUpDown className="ml-auto size-4" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg" side={isMobile ? 'bottom' : 'right'} align="end" sideOffset={4}>
                <DropdownMenuLabel className="font-normal">
                  <div className="grid text-sm leading-tight">
                    <span className="truncate font-medium">{user.name}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {ROLE_LABELS[user.role]}
                      {user.company_name ? ` · ${user.company_name}` : ''}
                    </span>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem asChild>
                    <Link to="/profile" onClick={close}>
                      <UserRound />
                      Profile and settings
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      {theme === 'dark' ? <Moon /> : theme === 'light' ? <Sun /> : <Monitor />}
                      Theme
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as Theme)}>
                        <DropdownMenuRadioItem value="light">Light</DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="system">System</DropdownMenuRadioItem>
                      </DropdownMenuRadioGroup>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  {canInstall && (
                    <DropdownMenuItem onClick={install}>
                      <Download />
                      Install app
                    </DropdownMenuItem>
                  )}
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={signOut}>
                  <LogOut />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
