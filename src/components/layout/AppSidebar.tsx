import { useLocation, Link } from 'react-router-dom';
import {
  LayoutDashboard, FileText, Upload, Building2, Settings, Shield,
  Archive, Cog, ClipboardList, History
} from 'lucide-react';
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar,
} from '@/components/ui/sidebar';

const mainItems = [
  { title: 'Tableau de bord', url: '/', icon: LayoutDashboard },
  { title: 'Factures', url: '/invoices', icon: FileText },
  { title: 'Nouvelle facture', url: '/invoices/new', icon: Upload },
];

const refItems = [
  { title: 'Clients publics', url: '/references/customers', icon: Building2 },
  { title: 'Services destinataires', url: '/references/services', icon: ClipboardList },
];

const adminItems = [
  { title: 'Jobs techniques', url: '/jobs', icon: Cog },
  { title: 'Audit', url: '/audit', icon: History },
  { title: 'Archives', url: '/archives', icon: Archive },
  { title: 'Paramètres', url: '/settings', icon: Settings },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === 'collapsed';
  const location = useLocation();
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
      <div className="flex h-14 items-center gap-2 px-4 border-b border-sidebar-border">
        <Shield className="h-6 w-6 text-sidebar-primary shrink-0" />
        {!collapsed && <span className="font-semibold text-sidebar-primary text-sm">FacturX Pro</span>}
      </div>
      <SidebarContent>
        {renderGroup('Principal', mainItems)}
        {renderGroup('Référentiels', refItems)}
        {renderGroup('Administration', adminItems)}
      </SidebarContent>
    </Sidebar>
  );
}
