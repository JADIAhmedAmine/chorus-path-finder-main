import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { getCurrentUser, getTenant } from '@/data/mock-data';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { clearAuthSession, loadAuthSession } from '@/lib/auth/session';
import { useAsyncResource } from '@/hooks/use-async-resource';
import { Building2, LogOut, UserCircle2 } from 'lucide-react';

export function AppHeader() {
  const navigate = useNavigate();
  const session = useMemo(() => loadAuthSession(), []);
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

  const handleLogout = () => {
    clearAuthSession();
    navigate('/login', { replace: true });
  };

  return (
    <header className="h-14 flex items-center justify-between border-b px-4 bg-card">
      <div className="flex items-center gap-2">
        <SidebarTrigger />
        <Separator orientation="vertical" className="h-6" />
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Building2 className="h-3.5 w-3.5" />
          <span>{data.tenant.name}</span>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="text-right">
          <div className="text-sm font-medium">{profile.firstName} {profile.lastName}</div>
          <div className="text-xs text-muted-foreground capitalize">{profile.roleCode.toLowerCase()}</div>
        </div>
        <Avatar className="h-8 w-8">
          <AvatarFallback className="bg-primary text-primary-foreground text-xs">
            {profile.firstName[0]}{profile.lastName[0]}
          </AvatarFallback>
        </Avatar>
        <Button variant="outline" size="sm" onClick={() => navigate('/login')}>
          <UserCircle2 className="mr-2 h-4 w-4" />
          Compte
        </Button>
        <Button variant="ghost" size="icon" onClick={handleLogout} title="Se déconnecter">
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
    </header>
  );
}
