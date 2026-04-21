import { useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppLayout } from "@/components/layout/AppLayout";
import { loadAuthSession } from "@/lib/auth/session";
import { loadChorusConfig } from "@/lib/chorus/storage";
import { ReferenceCatalogClient } from "@/lib/references/client";
import Dashboard from "./pages/Dashboard";
import InvoiceList from "./pages/InvoiceList";
import InvoiceDetail from "./pages/InvoiceDetail";
import InvoiceCreate from "./pages/InvoiceCreate";
import References from "./pages/References";
import Jobs from "./pages/Jobs";
import AuditPage from "./pages/AuditPage";
import Archives from "./pages/Archives";
import SettingsPage from "./pages/SettingsPage";
import Login from "./pages/Login";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

function ReferenceCatalogWarmup() {
  const isAuthenticated = !!loadAuthSession();

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
  return loadAuthSession() ? <>{children}</> : <Navigate to="/login" replace />;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <ReferenceCatalogWarmup />
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<RequireAuth><AppLayout><Dashboard /></AppLayout></RequireAuth>} />
          <Route path="/invoices" element={<RequireAuth><AppLayout><InvoiceList /></AppLayout></RequireAuth>} />
          <Route path="/invoices/new" element={<RequireAuth><AppLayout><InvoiceCreate /></AppLayout></RequireAuth>} />
          <Route path="/invoices/:id" element={<RequireAuth><AppLayout><InvoiceDetail /></AppLayout></RequireAuth>} />
          <Route path="/references/customers" element={<RequireAuth><AppLayout><References /></AppLayout></RequireAuth>} />
          <Route path="/references/services" element={<RequireAuth><AppLayout><References /></AppLayout></RequireAuth>} />
          <Route path="/jobs" element={<RequireAuth><AppLayout><Jobs /></AppLayout></RequireAuth>} />
          <Route path="/audit" element={<RequireAuth><AppLayout><AuditPage /></AppLayout></RequireAuth>} />
          <Route path="/archives" element={<RequireAuth><AppLayout><Archives /></AppLayout></RequireAuth>} />
          <Route path="/settings" element={<RequireAuth><AppLayout><SettingsPage /></AppLayout></RequireAuth>} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
