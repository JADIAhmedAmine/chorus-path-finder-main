import { Component, type ErrorInfo, type ReactNode, useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppLayout } from "@/components/layout/AppLayout";
import { hasValidAuthSession } from "@/lib/auth/session";
import { loadChorusConfig } from "@/lib/chorus/storage";
import { useSyncInvoicesMutation, useSyncSuppliersMutation } from "@/lib/queries/db";
import { ReferenceCatalogClient } from "@/lib/references/client";
import Dashboard from "./pages/Dashboard";
import InvoiceList from "./pages/InvoiceList";
import InvoiceDetail from "./pages/InvoiceDetail";
import ChorusInvoiceDetail from "./pages/ChorusInvoiceDetail";
import InvoiceCreate from "./pages/InvoiceCreate";
import References from "./pages/References";
import SettingsPage from "./pages/SettingsPage";
import Login from "./pages/Login";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 30 * 60 * 1000,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
      refetchOnReconnect: false,
      retry: 1,
    },
  },
});

class AppErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[app] React render error', error, errorInfo);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-background p-6 text-foreground">
          <div className="mx-auto max-w-3xl rounded-lg border bg-card p-6 shadow-sm">
            <h1 className="text-xl font-semibold">Erreur d&apos;affichage</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              L&apos;interface a rencontré une erreur pendant le rendu.
            </p>
            <pre className="mt-4 whitespace-pre-wrap break-words rounded-md border bg-muted/30 p-4 text-xs">
              {this.state.error.message}
            </pre>
            <button
              className="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
              onClick={() => {
                window.localStorage.removeItem('chorus.connector.config');
                window.location.href = '/login';
              }}
            >
              Réinitialiser la config locale
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

function ReferenceCatalogWarmup() {
  const isAuthenticated = hasValidAuthSession();

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    const config = loadChorusConfig();
    const client = new ReferenceCatalogClient(config);

    void client.fetchCatalog({
      includeAnnuaire: false,
    }).catch(() => {
      // Silent warmup: the dedicated screens already handle and display errors.
    });
  }, [isAuthenticated]);

  return null;
}

function parsePositiveInteger(value: string): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : undefined;
}

function DbStartupFullSync() {
  const isAuthenticated = hasValidAuthSession();
  const syncInvoices = useSyncInvoicesMutation();
  const syncSuppliers = useSyncSuppliersMutation();

  useEffect(() => {
    if (!import.meta.env.DEV || !isAuthenticated) {
      return;
    }

    const config = loadChorusConfig();
    const supplierId = parsePositiveInteger(config.submissionSupplierId);
    const syncInput = {
      environment: config.environment,
      ...(supplierId !== undefined ? { supplierId } : {}),
    };
    const sessionKey = `chorus.dbStartupFullSync.${config.environment}.${supplierId ?? 'default'}`;
    if (window.sessionStorage.getItem(sessionKey)) {
      return;
    }

    window.sessionStorage.setItem(sessionKey, new Date().toISOString());
    void (async () => {
      await syncSuppliers.mutateAsync(syncInput).catch((supplierSyncError) => {
        console.warn('[startup] sync suppliers skipped', supplierSyncError);
      });
      await syncInvoices.mutateAsync({ ...syncInput, mode: 'full' }).catch((invoiceSyncError) => {
        console.warn('[startup] full invoice sync failed', invoiceSyncError);
        window.sessionStorage.removeItem(sessionKey);
      });
    })();
  }, [isAuthenticated, syncInvoices, syncSuppliers]);

  return null;
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  return hasValidAuthSession() ? <>{children}</> : <Navigate to="/login" replace />;
}

const App = () => (
  <AppErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <ReferenceCatalogWarmup />
          <DbStartupFullSync />
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={<RequireAuth><AppLayout><Dashboard /></AppLayout></RequireAuth>} />
            <Route path="/invoices" element={<RequireAuth><AppLayout><InvoiceList /></AppLayout></RequireAuth>} />
            <Route path="/invoices/new" element={<RequireAuth><AppLayout><InvoiceCreate /></AppLayout></RequireAuth>} />
            <Route path="/invoices/chorus/:id" element={<RequireAuth><AppLayout><ChorusInvoiceDetail /></AppLayout></RequireAuth>} />
            <Route path="/invoices/:id" element={<RequireAuth><AppLayout><InvoiceDetail /></AppLayout></RequireAuth>} />
            <Route path="/references/customers" element={<RequireAuth><AppLayout><References /></AppLayout></RequireAuth>} />
            <Route path="/references/services" element={<RequireAuth><AppLayout><References /></AppLayout></RequireAuth>} />
            <Route path="/settings" element={<RequireAuth><AppLayout><SettingsPage /></AppLayout></RequireAuth>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </AppErrorBoundary>
);

export default App;
