import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppLayout } from "@/components/layout/AppLayout";
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

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<AppLayout><Dashboard /></AppLayout>} />
          <Route path="/invoices" element={<AppLayout><InvoiceList /></AppLayout>} />
          <Route path="/invoices/new" element={<AppLayout><InvoiceCreate /></AppLayout>} />
          <Route path="/invoices/:id" element={<AppLayout><InvoiceDetail /></AppLayout>} />
          <Route path="/references/customers" element={<AppLayout><References /></AppLayout>} />
          <Route path="/references/services" element={<AppLayout><References /></AppLayout>} />
          <Route path="/jobs" element={<AppLayout><Jobs /></AppLayout>} />
          <Route path="/audit" element={<AppLayout><AuditPage /></AppLayout>} />
          <Route path="/archives" element={<AppLayout><Archives /></AppLayout>} />
          <Route path="/settings" element={<AppLayout><SettingsPage /></AppLayout>} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
