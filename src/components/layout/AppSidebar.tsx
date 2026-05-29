import { useLocation, Link } from 'react-router-dom';
import {
  LayoutDashboard, FileText, Upload, Building2, Settings,
  ClipboardList, UserCircle2, Activity, AlertTriangle, Inbox, CheckCircle2,
  Zap, Scale, MessageSquareWarning, Bell,
  type LucideIcon,
} from 'lucide-react';
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar,
} from '@/components/ui/sidebar';
import { APP_NAME, AppSymbol } from '@/components/common/AppSymbol';
import { loadAuthSession } from '@/lib/auth/session';

interface SidebarNavItem {
  title: string;
  url: string;
  icon: LucideIcon;
}

const mainItems: SidebarNavItem[] = [
  { title: 'Chorus Pilot', url: '/chorus-pilot', icon: Zap },
  { title: 'Tableau de bord', url: '/', icon: LayoutDashboard },
];

const receptionItems: SidebarNavItem[] = [
  { title: 'Factures reçues', url: '/invoices/reception', icon: Inbox },
  { title: 'Factures traitées', url: '/invoices/reception/processed', icon: CheckCircle2 },
];

const emissionItems: SidebarNavItem[] = [
  { title: 'Suivi des émissions', url: '/invoices', icon: FileText },
  { title: 'Notifications', url: '/invoices/notifications', icon: Bell },
  { title: 'Rejets / refus', url: '/invoices/rejections', icon: MessageSquareWarning },
  { title: 'Émissions à traiter', url: '/invoices/to-process', icon: AlertTriangle },
  { title: 'Nouvelle émission', url: '/invoices/new', icon: Upload },
];

const invoiceItems: SidebarNavItem[] = [...receptionItems, ...emissionItems];

const cguItem: SidebarNavItem = { title: 'CGU', url: '/cgu', icon: Scale };
const refItems: SidebarNavItem[] = [
  { title: 'Clients publics', url: '/references/customers', icon: Building2 },
  { title: 'Services destinataires', url: '/references/services', icon: ClipboardList },
];

const baseAdminItems: SidebarNavItem[] = [
  { title: 'CGU', url: '/cgu', icon: Scale },
  { title: 'Paramètres', url: '/settings', icon: Settings },
  { title: 'Connexion / Profil', url: '/login', icon: UserCircle2 },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === 'collapsed';
  const location = useLocation();
  const session = loadAuthSession();
  const adminItems: SidebarNavItem[] = session?.roleCode === 'ADMINISTRATEUR'
    ? [
        { title: 'Monitoring', url: '/monitoring', icon: Activity },
        ...baseAdminItems,
      ]
    : baseAdminItems;
  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    if (path === '/invoices') {
      return location.pathname === '/invoices'
        || location.pathname.startsWith('/invoices/chorus/')
        || (
          location.pathname.startsWith('/invoices/')
          && !invoiceItems.some((item) => item.url === location.pathname)
          && !location.pathname.startsWith('/invoices/reception/')
        );
    }
    if (
      path === '/invoices/reception/processed'
      || path === '/invoices/reception/responses'
      || path === '/invoices/notifications'
      || path === '/invoices/rejections'
    ) {
      return location.pathname === path;
    }
    if (path === '/invoices/reception') {
      return location.pathname === path
        || (
          location.pathname.startsWith('/invoices/reception/')
          && location.pathname !== '/invoices/reception/processed'
          && location.pathname !== '/invoices/reception/responses'
        );
    }
    if (invoiceItems.some((item) => item.url === path)) {
      return location.pathname === path;
    }
    return location.pathname.startsWith(path);
  };

  const renderGroup = (label: string, items: SidebarNavItem[]) => (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.url}>
              <SidebarMenuButton asChild isActive={isActive(item.url)}>
                <Link to={item.url} className="flex items-center gap-2">
                  <item.icon className="h-4 w-4 shrink-0" />
                  {!collapsed && <span>{item.title}</span>}
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );

  return (
    <Sidebar collapsible="icon">
      <div className="flex h-16 items-center gap-3 px-4 border-b border-sidebar-border">
        <AppSymbol className="h-10 w-10 rounded-lg shadow-sm ring-1 ring-sidebar-border/60 transition-transform hover:scale-105" />
        {!collapsed && (
          <span className="font-semibold text-sidebar-primary text-base tracking-tight">{APP_NAME}</span>
        )}
      </div>
      <SidebarContent>
        {renderGroup('Principal', mainItems)}
        {renderGroup('Réception', receptionItems)}
        {renderGroup('Émission', emissionItems)}
        {renderGroup('Référentiels', refItems)}
        {renderGroup('Administration', adminItems)}
      </SidebarContent>
    </Sidebar>
  );
}
