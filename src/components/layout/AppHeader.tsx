import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { getCurrentUser, getTenant } from '@/data/mock-data';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { clearAuthSession, loadAuthSession } from '@/lib/auth/session';
import { useAsyncResource } from '@/hooks/use-async-resource';
import { loadChorusConfig } from '@/lib/chorus/storage';
import { cn } from '@/lib/utils';
import {
  Bell,
  Building2,
  ChevronDown,
  LogOut,
  Plus,
  Search,
  Settings as SettingsIcon,
  Sparkles,
  UserCircle2,
} from 'lucide-react';

export function AppHeader() {
  const navigate = useNavigate();
  const session = useMemo(() => loadAuthSession(), []);
  const config = useMemo(() => loadChorusConfig(), []);
  const env = (config?.environment ?? 'qualif').toString().toLowerCase();
  const isProd = env === 'production' || env === 'prod';

  const { data } = useAsyncResource(
    async () => {
      const [tenant, currentUser] = await Promise.all([getTenant(), getCurrentUser()]);
      return { tenant, currentUser };
    },
    [],
    {
      tenant: {
        id: 'tenant-unresolved',
        code: 'UNRESOLVED',
        name: 'Chargement du tenant...',
        active: false,
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      },
      currentUser: {
        id: 'user-unresolved',
        tenantId: 'tenant-unresolved',
        email: session?.email ?? '',
        firstName: session?.firstName ?? 'Utilisateur',
        lastName: session?.lastName ?? 'local',
        roleCode: session?.roleCode === 'DEPOSANT' || session?.roleCode === 'ADMINISTRATEUR' || session?.roleCode === 'AUDITEUR'
          ? session.roleCode
          : 'GESTIONNAIRE',
        active: true,
        createdAt: session?.createdAt ?? new Date(0).toISOString(),
        updatedAt: session?.createdAt ?? new Date(0).toISOString(),
      },
    },
  );

  const profile = session
    ? {
        ...data.currentUser,
        email: session.email,
        firstName: session.firstName || data.currentUser.firstName,
        lastName: session.lastName || data.currentUser.lastName,
        roleCode: session.roleCode === 'DEPOSANT' || session.roleCode === 'ADMINISTRATEUR' || session.roleCode === 'AUDITEUR'
          ? session.roleCode
          : 'GESTIONNAIRE',
      }
    : data.currentUser;

  const initials = `${(profile.firstName?.[0] ?? 'U').toUpperCase()}${(profile.lastName?.[0] ?? '').toUpperCase()}`;

  const handleLogout = () => {
    clearAuthSession();
    navigate('/login', { replace: true });
  };

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border/70 bg-card/85 px-4 backdrop-blur-md supports-[backdrop-filter]:bg-card/70">
      {/* Left: trigger + tenant context */}
      <div className="flex items-center gap-2">
        <SidebarTrigger className="text-muted-foreground hover:text-foreground" />
        <Separator orientation="vertical" className="h-6" />
        <button
          type="button"
          className="flex items-center gap-2 rounded-md px-2 py-1 text-sm text-foreground/85 transition-colors hover:bg-muted/60"
          onClick={() => navigate('/settings')}
        >
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Building2 className="h-3.5 w-3.5" />
          </div>
          <span className="max-w-[180px] truncate font-medium">{data.tenant.name}</span>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </div>

      {/* Center: global search */}
      <div className="ml-2 hidden flex-1 md:flex md:max-w-xl">
        <button
          type="button"
          onClick={() => navigate('/invoices')}
          className="group flex h-9 w-full items-center gap-2 rounded-lg border border-border/80 bg-muted/40 px-3 text-left text-sm text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Search className="h-4 w-4 shrink-0" />
          <span className="flex-1 truncate">
            Rechercher une facture, un SIRET, un destinataire…
          </span>
          <kbd className="hidden items-center gap-0.5 rounded border border-border/80 bg-card px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground sm:inline-flex">
            <span>⌘</span>K
          </kbd>
        </button>
      </div>

      {/* Right: env, alerts, CTA, user */}
      <div className="ml-auto flex items-center gap-2">
        <span
          className={cn(
            'hidden h-7 select-none items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-semibold uppercase tracking-wider lg:inline-flex',
            isProd
              ? 'border-success/30 bg-success-soft text-success'
              : 'border-warning/30 bg-warning-soft text-warning',
          )}
          title={`Environnement Chorus actuel : ${isProd ? 'production' : 'sandbox'}`}
        >
          <span className={cn('h-1.5 w-1.5 rounded-full', isProd ? 'bg-success' : 'bg-warning')} />
          {isProd ? 'Prod' : 'Sandbox'}
        </span>

        <Button
          variant="ghost"
          size="icon"
          className="relative h-9 w-9 text-muted-foreground hover:text-foreground"
          aria-label="Notifications"
          onClick={() => navigate('/invoices/notifications')}
        >
          <Bell className="h-[18px] w-[18px]" />
          <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-destructive ring-2 ring-card" />
        </Button>

        <Separator orientation="vertical" className="mx-1 hidden h-6 sm:block" />

        <Button asChild className="hidden h-9 gap-1.5 px-3 shadow-soft sm:inline-flex">
          <Link to="/invoices/new">
            <Plus className="h-4 w-4" />
            Nouvelle émission
          </Link>
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-2 rounded-lg p-1 pr-2 transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Avatar className="h-8 w-8 ring-1 ring-border">
                <AvatarFallback className="bg-gradient-to-br from-primary to-[hsl(262_83%_58%)] text-[11.5px] font-semibold text-white">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="hidden text-left leading-tight lg:block">
                <div className="text-[12.5px] font-semibold text-foreground">
                  {profile.firstName} {profile.lastName}
                </div>
                <div className="text-[10.5px] capitalize text-muted-foreground">
                  {profile.roleCode.toLowerCase()}
                </div>
              </div>
              <ChevronDown className="hidden h-3.5 w-3.5 text-muted-foreground lg:block" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuLabel className="flex flex-col gap-0.5 py-2">
              <span className="text-sm font-semibold">
                {profile.firstName} {profile.lastName}
              </span>
              <span className="text-xs font-normal text-muted-foreground">
                {profile.email}
              </span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate('/settings')}>
              <SettingsIcon className="mr-2 h-4 w-4" />
              Paramètres
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate('/chorus-pilot')}>
              <Sparkles className="mr-2 h-4 w-4" />
              Onboarding Chorus
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate('/login')}>
              <UserCircle2 className="mr-2 h-4 w-4" />
              Compte
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={handleLogout}
              className="text-destructive focus:bg-destructive-soft focus:text-destructive"
            >
              <LogOut className="mr-2 h-4 w-4" />
              Se déconnecter
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
