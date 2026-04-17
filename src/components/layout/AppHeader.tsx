import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { currentUser, tenant } from '@/data/mock-data';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { clearAuthSession, loadAuthSession } from '@/lib/auth/session';
import { Building2, LogOut, UserCircle2 } from 'lucide-react';

export function AppHeader() {
  const navigate = useNavigate();
  const [session] = useState(() => loadAuthSession());
  const profile = session ?? currentUser;

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
          <span>{tenant.name}</span>
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
