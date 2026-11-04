import { SidebarProvider } from '@/components/ui/sidebar';
import { AppSidebar } from './AppSidebar';
import { AppHeader } from './AppHeader';

interface AppLayoutProps {
  children: React.ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar />
        <div className="relative flex flex-1 flex-col min-w-0">
          <AppHeader />
          <main className="surface-aurora flex-1 overflow-auto">
            <div className="mx-auto w-full max-w-[1480px] px-5 py-6 sm:px-8 sm:py-8">
              {children}
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
