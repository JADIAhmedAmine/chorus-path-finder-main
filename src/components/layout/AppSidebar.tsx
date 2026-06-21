import { useMemo } from 'react';
import { useLocation, Link } from 'react-router-dom';
import {
  LayoutDashboard, FileText, Upload, Building2, Settings,
  ClipboardList, UserCircle2, Activity, AlertTriangle, Inbox, CheckCircle2,
  Zap, Scale, MessageSquareWarning, Bell, UploadCloud, Sparkles, Network,
  Workflow, Wand2,
  type LucideIcon,
} from 'lucide-react';
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar,
} from '@/components/ui/sidebar';
import { APP_NAME, AppSymbol } from '@/components/common/AppSymbol';
import { loadAuthSession } from '@/lib/auth/session';
import { loadChorusConfig } from '@/lib/chorus/storage';
import { cn } from '@/lib/utils';

interface SidebarNavItem {
  title: string;
  url: string;
  icon: LucideIcon;
  badge?: string;
}

const mainItems: SidebarNavItem[] = [
  { title: 'Chorus Pilot', url: '/chorus-pilot', icon: Zap },
  { title: 'Tableau de bord', url: '/', icon: LayoutDashboard },
];

// Parcours « Flux » : nouvelle entrée principale qui relie les fonctionnalités
// existantes (aucune route nouvelle hormis la vue d'ensemble /flux).
const fluxItems: SidebarNavItem[] = [
  { title: "Vue d'ensemble", url: '/flux', icon: Network },
  { title: 'Déposer', url: '/invoices/flux', icon: UploadCloud },
  { title: 'Préparer / Corriger', url: '/invoices/pdf-to-flux', icon: Wand2 },
  { title: 'Suivi', url: '/invoices/g2b-flux', icon: Workflow },
  { title: 'Erreurs', url: '/invoices/rejections', icon: MessageSquareWarning },
  { title: 'Factures liées', url: '/invoices', icon: FileText },
  { title: 'Annuaire', url: '/references/customers', icon: Building2 },
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
  { title: 'Dépôt de flux', url: '/invoices/flux', icon: UploadCloud },
  { title: 'PDF facture → flux', url: '/invoices/pdf-to-flux', icon: Sparkles },
  { title: 'Dépôt de flux G2B', url: '/invoices/g2b-flux', icon: Network },
];

const providerItems: SidebarNavItem[] = [
  { title: 'Iopole (PDP)', url: '/providers/iopole', icon: Workflow },
];

const invoiceItems: SidebarNavItem[] = [...receptionItems, ...emissionItems];

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
  const config = useMemo(() => loadChorusConfig(), []);
  const env = (config?.environment ?? 'qualif').toString().toLowerCase();
  const isProd = env === 'production' || env === 'prod';

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
    <SidebarGroup className="px-2">
      {!collapsed && (
        <SidebarGroupLabel className="px-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-sidebar-foreground/45">
          {label}
        </SidebarGroupLabel>
      )}
      <SidebarGroupContent>
        <SidebarMenu className="gap-0.5">
          {items.map((item) => {
            const active = isActive(item.url);
            return (
              <SidebarMenuItem key={item.url}>
                <SidebarMenuButton
                  asChild
                  isActive={active}
                  tooltip={collapsed ? item.title : undefined}
                  className={cn(
                    'group/nav relative h-9 rounded-lg px-2.5 text-[13.5px] text-sidebar-foreground/80',
                    'hover:bg-sidebar-accent/70 hover:text-white',
                    'data-[active=true]:bg-sidebar-accent data-[active=true]:text-white data-[active=true]:shadow-[inset_0_1px_0_0_hsl(var(--sidebar-border))]',
                  )}
                >
                  <Link to={item.url} className="flex items-center gap-2.5">
                    <span
                      aria-hidden
                      className={cn(
                        'absolute left-0 top-1/2 h-5 w-[2.5px] -translate-y-1/2 rounded-r-full bg-primary opacity-0 transition-opacity duration-200',
                        active && 'opacity-100',
                      )}
                    />
                    <item.icon
                      className={cn(
                        'h-[16.5px] w-[16.5px] shrink-0 transition-colors',
                        active ? 'text-white' : 'text-sidebar-foreground/55 group-hover/nav:text-white/90',
                      )}
                    />
                    {!collapsed && <span className="truncate">{item.title}</span>}
                    {!collapsed && item.badge && (
                      <span className="ml-auto rounded-full bg-primary/15 px-1.5 py-0.5 text-[10.5px] font-semibold text-primary-foreground/90 ring-1 ring-primary/30">
                        {item.badge}
                      </span>
                    )}
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      {/* Brand */}
      <div className={cn(
        'flex h-16 items-center gap-3 border-b border-sidebar-border px-4',
        collapsed && 'justify-center px-0',
      )}>
        <AppSymbol className="h-10 w-10 shrink-0 rounded-xl bg-white/5 ring-1 ring-white/10 transition-transform hover:scale-105" />
        {!collapsed && (
          <div className="flex min-w-0 flex-col leading-tight">
            <span className="truncate text-[15px] font-semibold tracking-tight text-white">{APP_NAME}</span>
            <span className="mt-0.5 flex items-center gap-1.5 text-[10.5px] font-medium uppercase tracking-[0.08em] text-sidebar-foreground/55">
              <span
                className={cn(
                  'inline-block h-1.5 w-1.5 rounded-full',
                  isProd ? 'bg-success' : 'bg-warning',
                )}
              />
              {isProd ? 'Production' : 'Sandbox'}
            </span>
          </div>
        )}
      </div>

      <SidebarContent className="gap-1 py-3">
        {renderGroup('Principal', mainItems)}
        {renderGroup('Flux', fluxItems)}
        {renderGroup('Réception', receptionItems)}
        {renderGroup('Émission', emissionItems)}
        {renderGroup('Plateformes', providerItems)}
        {renderGroup('Référentiels', refItems)}
        {renderGroup('Administration', adminItems)}
      </SidebarContent>

      {/* Footer — user mini-card */}
      {session && !collapsed && (
        <div className="mt-auto border-t border-sidebar-border p-3">
          <div className="flex items-center gap-2.5 rounded-lg bg-sidebar-accent/40 p-2 ring-1 ring-sidebar-border/60">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-primary/80 to-[hsl(262_83%_58%)/_0.8] text-[12px] font-semibold text-white">
              {(session.firstName?.[0] ?? 'U').toUpperCase()}{(session.lastName?.[0] ?? '').toUpperCase()}
            </div>
            <div className="min-w-0 leading-tight">
              <p className="truncate text-[12.5px] font-medium text-white">
                {session.firstName} {session.lastName}
              </p>
              <p className="truncate text-[10.5px] capitalize text-sidebar-foreground/60">
                {(session.roleCode ?? 'gestionnaire').toLowerCase()}
              </p>
            </div>
          </div>
        </div>
      )}
    </Sidebar>
  );
}
