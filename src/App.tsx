import { Component, type ErrorInfo, type ReactNode, useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppLayout } from "@/components/layout/AppLayout";
import { hasValidAuthSession } from "@/lib/auth/session";
import { loadChorusConfig } from "@/lib/chorus/storage";
import { ReferenceCatalogClient } from "@/lib/references/client";
import Dashboard from "./pages/Dashboard";
import InvoiceList from "./pages/InvoiceList";
import InvoicesToProcess from "./pages/InvoicesToProcess";
import InvoiceDetail from "./pages/InvoiceDetail";
import ChorusInvoiceDetail from "./pages/ChorusInvoiceDetail";
import InvoiceCreate from "./pages/InvoiceCreate";
import References from "./pages/References";
import SettingsPage from "./pages/SettingsPage";
import Monitoring from "./pages/Monitoring";
import ChorusPilotPage from "./pages/ChorusPilotPage";
import FluxHub from "./pages/FluxHub";
import FluxDepositPage from "./pages/FluxDepositPage";
import PdfToFluxPage from "./pages/PdfToFluxPage";
import G2BFluxDepositPage from "./pages/G2BFluxDepositPage";
import IopolePage from "./pages/IopolePage";
import IopoleReceptionPage from "./pages/IopoleReceptionPage";
import IopoleDirectoryPage from "./pages/IopoleDirectoryPage";
import IopolePdfToInvoicePage from "./pages/IopolePdfToInvoicePage";
import CGUPage from "./pages/CGUPage";
import ReceptionInvoiceDetail from "./pages/ReceptionInvoiceDetail";
import ReceptionProcessing, { ProcessedReceptionInvoices } from "./pages/ReceptionProcessing";
import EmissionRejectionsPage from "./pages/EmissionRejections";
import InvoiceNotificationsPage from "./pages/InvoiceNotifications";
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
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={<RequireAuth><AppLayout><Dashboard /></AppLayout></RequireAuth>} />
            <Route path="/chorus-pilot" element={<RequireAuth><AppLayout><ChorusPilotPage /></AppLayout></RequireAuth>} />
            <Route path="/flux" element={<RequireAuth><AppLayout><FluxHub /></AppLayout></RequireAuth>} />
            <Route path="/invoices" element={<RequireAuth><AppLayout><InvoiceList /></AppLayout></RequireAuth>} />
            <Route path="/invoices/notifications" element={<RequireAuth><AppLayout><InvoiceNotificationsPage /></AppLayout></RequireAuth>} />
            <Route path="/invoices/rejections" element={<RequireAuth><AppLayout><EmissionRejectionsPage /></AppLayout></RequireAuth>} />
            <Route path="/invoices/reception" element={<RequireAuth><AppLayout><ReceptionProcessing /></AppLayout></RequireAuth>} />
            <Route path="/invoices/reception/responses" element={<RequireAuth><Navigate to="/invoices/rejections" replace /></RequireAuth>} />
            <Route path="/invoices/reception/notifications" element={<RequireAuth><Navigate to="/invoices/notifications" replace /></RequireAuth>} />
            <Route path="/invoices/reception/processed" element={<RequireAuth><AppLayout><ProcessedReceptionInvoices /></AppLayout></RequireAuth>} />
            <Route path="/invoices/reception/:id" element={<RequireAuth><AppLayout><ReceptionInvoiceDetail /></AppLayout></RequireAuth>} />
            <Route path="/invoices/to-process" element={<RequireAuth><AppLayout><InvoicesToProcess /></AppLayout></RequireAuth>} />
            <Route path="/reception" element={<RequireAuth><Navigate to="/invoices/reception" replace /></RequireAuth>} />
            <Route path="/invoices/new" element={<RequireAuth><AppLayout><InvoiceCreate /></AppLayout></RequireAuth>} />
            <Route path="/invoices/flux" element={<RequireAuth><AppLayout><FluxDepositPage /></AppLayout></RequireAuth>} />
            <Route path="/invoices/pdf-to-flux" element={<RequireAuth><AppLayout><PdfToFluxPage /></AppLayout></RequireAuth>} />
            <Route path="/invoices/g2b-flux" element={<RequireAuth><AppLayout><G2BFluxDepositPage /></AppLayout></RequireAuth>} />
            <Route path="/providers/iopole" element={<RequireAuth><AppLayout><IopolePage /></AppLayout></RequireAuth>} />
            <Route path="/providers/iopole/reception" element={<RequireAuth><AppLayout><IopoleReceptionPage /></AppLayout></RequireAuth>} />
            <Route path="/providers/iopole/annuaire" element={<RequireAuth><AppLayout><IopoleDirectoryPage /></AppLayout></RequireAuth>} />
            <Route path="/providers/iopole/pdf" element={<RequireAuth><AppLayout><IopolePdfToInvoicePage /></AppLayout></RequireAuth>} />
            <Route path="/invoices/chorus/:id" element={<RequireAuth><AppLayout><ChorusInvoiceDetail /></AppLayout></RequireAuth>} />
            <Route path="/invoices/:id" element={<RequireAuth><AppLayout><InvoiceDetail /></AppLayout></RequireAuth>} />
            <Route path="/references/customers" element={<RequireAuth><AppLayout><References /></AppLayout></RequireAuth>} />
            <Route path="/references/services" element={<RequireAuth><AppLayout><References /></AppLayout></RequireAuth>} />
            <Route path="/monitoring" element={<RequireAuth><AppLayout><Monitoring /></AppLayout></RequireAuth>} />
            <Route path="/settings" element={<RequireAuth><AppLayout><SettingsPage /></AppLayout></RequireAuth>} />
            <Route path="/cgu" element={<RequireAuth><AppLayout><CGUPage /></AppLayout></RequireAuth>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </AppErrorBoundary>
);

export default App;
