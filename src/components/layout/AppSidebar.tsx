import { useLocation, Link } from 'react-router-dom';
import {
  LayoutDashboard, FileText, Upload, Building2, Settings,
  ClipboardList, UserCircle2, Activity
} from 'lucide-react';
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar,
} from '@/components/ui/sidebar';
import { APP_NAME, AppSymbol } from '@/components/common/AppSymbol';
import { loadAuthSession } from '@/lib/auth/session';

const mainItems = [
  { title: 'Tableau de bord', url: '/', icon: LayoutDashboard },
  { title: 'Factures', url: '/invoices', icon: FileText },
  { title: 'Nouvelle facture', url: '/invoices/new', icon: Upload },
];

const refItems = [
  { title: 'Clients publics', url: '/references/customers', icon: Building2 },
  { title: 'Services destinataires', url: '/references/services', icon: ClipboardList },
];

const baseAdminItems = [
  { title: 'Paramètres', url: '/settings', icon: Settings },
  { title: 'Connexion / Profil', url: '/login', icon: UserCircle2 },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === 'collapsed';
  const location = useLocation();
  const session = loadAuthSession();
  const adminItems = session?.roleCode === 'ADMINISTRATEUR'
    ? [
        { title: 'Monitoring', url: '/monitoring', icon: Activity },
        ...baseAdminItems,
      ]
    : baseAdminItems;
  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  const renderGroup = (label: string, items: typeof mainItems) => (
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
        {renderGroup('Référentiels', refItems)}
        {renderGroup('Administration', adminItems)}
      </SidebarContent>
    </Sidebar>
  );
}
