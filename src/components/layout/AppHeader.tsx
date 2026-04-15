import { SidebarTrigger } from '@/components/ui/sidebar';
import { currentUser, tenant } from '@/data/mock-data';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import { Building2 } from 'lucide-react';

export function AppHeader() {
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
          <div className="text-sm font-medium">{currentUser.firstName} {currentUser.lastName}</div>
          <div className="text-xs text-muted-foreground capitalize">{currentUser.roleCode.toLowerCase()}</div>
        </div>
        <Avatar className="h-8 w-8">
          <AvatarFallback className="bg-primary text-primary-foreground text-xs">
            {currentUser.firstName[0]}{currentUser.lastName[0]}
          </AvatarFallback>
        </Avatar>
      </div>
    </header>
  );
}
