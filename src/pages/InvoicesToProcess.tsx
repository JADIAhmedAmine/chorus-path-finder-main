import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Clock3, Euro, ExternalLink, Loader2, RefreshCw, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SyncRunProgress, SyncRunSummary } from '@/components/common/SyncRunSummary';
import { PageHeader } from '@/components/common/PageHeader';
import { KpiCard } from '@/components/common/KpiCard';
import { ApiErrorCard } from '@/components/common/ApiErrorCard';
import { EmptyState } from '@/components/common/EmptyState';
import { InvoiceDownloadMenu } from '@/components/chorus/InvoiceDownloadMenu';
import { InvoiceContextBadge } from '@/components/chorus/InvoiceContextBadge';
import { InvoiceOverviewDrawer } from '@/components/chorus/InvoiceOverviewDrawer';
import { cn } from '@/lib/utils';
import {
  getInvoiceChorusStatus,
  isActionableInvoice,
  isRejectedChorusStatus,
} from '@/lib/chorus/actionableInvoices';
import { loadChorusConfig } from '@/lib/chorus/storage';
import {
  type SyncRunResult,
  useInvoicesQuery,
  usePublicCustomersQuery,
  useSuppliersQuery,
  useSyncInvoicesMutation,
  useSyncSuppliersMutation,
} from '@/lib/queries/db';
import { toDisplayInvoiceFromInvoice } from '@/lib/chorus/invoiceDisplay';
import { formatCurrency, formatDateTime, getChorusRawStatusConfig } from '@/lib/status-utils';
import type { Invoice } from '@/types';

const ALL_VALUE = '__all__';
type TreatmentFilter = 'all' | 'pending';
type ReasonFilter = 'all' | 'with-reason' | 'without-reason';

function parseConfiguredSupplierId(value: string): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : undefined;
}

function matchesTreatmentFilter(invoice: Invoice, filter: TreatmentFilter): boolean {
  if (filter === 'all') {
    return true;
  }

  const status = getInvoiceChorusStatus(invoice).toUpperCase();
  return status.includes('SUSPEND')
    || status.includes('RECYCL')
    || status.includes('A_VALIDER');
}

function includesNormalized(value: string | undefined, searchValue: string): boolean {
  return !!value && value.toLowerCase().includes(searchValue);
}

function parseAmount(value: string): number | null {
  if (!value.trim()) {
    return null;
  }

  const parsed = Number(value.replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function dateBoundaryTimestamp(value: string, endOfDay = false): number | null {
  if (!value) {
    return null;
  }

  const suffix = endOfDay ? 'T23:59:59.999' : 'T00:00:00.000';
  const timestamp = new Date(`${value}${value.includes('T') ? '' : suffix}`).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function invoiceStatusTimestamp(invoice: Invoice): number | null {
  const value = invoice.lastStatusSyncAt || invoice.statusChangedAt || invoice.updatedAt;
  if (!value) {
    return null;
  }

  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function invoiceHasReason(invoice: Invoice): boolean {
  return !!(invoice.statusReasonLabel?.trim() || invoice.statusReasonCode?.trim());
}

function ChorusStatusPill({ value }: { value: string }) {
  const config = getChorusRawStatusConfig(value);

  return (
    <span
      className={cn(
        'inline-flex max-w-[220px] items-center rounded-full px-2 py-0.5 text-[11px] font-medium',
        config.bgClass,
        config.textClass,
      )}
    >
      <span className="mr-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: config.color }} />
      <span className="truncate">{config.label}</span>
    </span>
  );
}

function actionForStatus(invoice: Invoice): { label: string; helper: string; href: string } {
  const status = getInvoiceChorusStatus(invoice).toUpperCase();
  if (status.includes('SUSPEND')) {
    return {
      label: 'Compléter',
      helper: 'Répondre à la suspension côté émission avec commentaire ou pièces.',
      href: `/invoices/chorus/${encodeURIComponent(invoice.id)}`,
    };
  }
  if (status.includes('RECYCL')) {
    return {
      label: 'Recycler',
      helper: 'Corriger puis relancer selon le motif Chorus.',
      href: `/invoices/chorus/${encodeURIComponent(invoice.id)}`,
    };
  }
  if (status.includes('A_VALIDER')) {
    return {
      label: 'Valider',
      helper: 'Contrôler la facture avant action de validation.',
      href: `/invoices/chorus/${encodeURIComponent(invoice.id)}`,
    };
  }
  if (status.includes('ERREUR') || status.includes('NON_CONFORME')) {
    return {
      label: 'Analyser',
      helper: 'Lire le motif technique et corriger les données.',
      href: `/invoices/chorus/${encodeURIComponent(invoice.id)}`,
    };
  }
  return {
    label: 'Voir détail',
    helper: 'Consulter la fiche pour choisir la prochaine action.',
    href: `/invoices/chorus/${encodeURIComponent(invoice.id)}`,
  };
}

export default function InvoicesToProcess() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<TreatmentFilter>('all');
  const [supplierFilter, setSupplierFilter] = useState(ALL_VALUE);
  const [customerFilter, setCustomerFilter] = useState(ALL_VALUE);
  const [chorusStatusFilter, setChorusStatusFilter] = useState(ALL_VALUE);
  const [reasonFilter, setReasonFilter] = useState<ReasonFilter>('all');
  const [statusDateFrom, setStatusDateFrom] = useState('');
  const [statusDateTo, setStatusDateTo] = useState('');
  const [amountMin, setAmountMin] = useState('');
  const [amountMax, setAmountMax] = useState('');
  const [syncError, setSyncError] = useState<string | null>(null);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const invoicesQuery = useInvoicesQuery({ pageSize: 500 });
  const suppliersQuery = useSuppliersQuery();
  const customersQuery = usePublicCustomersQuery();
  const syncInvoices = useSyncInvoicesMutation();
  const syncSuppliers = useSyncSuppliersMutation();

  const invoices = invoicesQuery.data?.items ?? [];
  const suppliers = suppliersQuery.data ?? [];
  const customers = customersQuery.data ?? [];
  const lastSyncRuns: SyncRunResult[] = syncInvoices.data ?? [];

  const supplierById = useMemo(
    () => new Map(suppliers.map((supplier) => [supplier.id, supplier])),
    [suppliers],
  );
  const customerById = useMemo(
    () => new Map(customers.map((customer) => [customer.id, customer])),
    [customers],
  );
  const selectedDisplayInvoice = useMemo(
    () => selectedInvoice
      ? toDisplayInvoiceFromInvoice(
          selectedInvoice,
          supplierById.get(selectedInvoice.supplierOrganizationId),
          customerById.get(selectedInvoice.publicCustomerId),
          {
            context: 'emission',
            source: 'Émissions à traiter',
            detailHref: `/invoices/chorus/${encodeURIComponent(selectedInvoice.id)}`,
          },
        )
      : null,
    [customerById, selectedInvoice, supplierById],
  );

  const actionableInvoices = useMemo(
    () => invoices.filter((invoice) =>
      isActionableInvoice(invoice)
      && !isRejectedChorusStatus(getInvoiceChorusStatus(invoice)),
    ),
    [invoices],
  );

  const availableStatuses = useMemo(
    () => [...new Set(actionableInvoices.map(getInvoiceChorusStatus).filter(Boolean))].sort(),
    [actionableInvoices],
  );

  const visibleSuppliers = useMemo(
    () => suppliers
      .filter((supplier) => actionableInvoices.some((invoice) => invoice.supplierOrganizationId === supplier.id))
      .sort((left, right) => left.legalName.localeCompare(right.legalName, 'fr')),
    [actionableInvoices, suppliers],
  );

  const visibleCustomers = useMemo(
    () => customers
      .filter((customer) => actionableInvoices.some((invoice) => invoice.publicCustomerId === customer.id))
      .sort((left, right) => left.legalName.localeCompare(right.legalName, 'fr')),
    [actionableInvoices, customers],
  );

  const filteredInvoices = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    const minAmount = parseAmount(amountMin);
    const maxAmount = parseAmount(amountMax);
    const fromTimestamp = dateBoundaryTimestamp(statusDateFrom);
    const toTimestamp = dateBoundaryTimestamp(statusDateTo, true);

    return actionableInvoices
      .filter((invoice) => matchesTreatmentFilter(invoice, statusFilter))
      .filter((invoice) => supplierFilter === ALL_VALUE || invoice.supplierOrganizationId === supplierFilter)
      .filter((invoice) => customerFilter === ALL_VALUE || invoice.publicCustomerId === customerFilter)
      .filter((invoice) => chorusStatusFilter === ALL_VALUE || getInvoiceChorusStatus(invoice) === chorusStatusFilter)
      .filter((invoice) => {
        if (reasonFilter === 'with-reason') {
          return invoiceHasReason(invoice);
        }
        if (reasonFilter === 'without-reason') {
          return !invoiceHasReason(invoice);
        }
        return true;
      })
      .filter((invoice) => minAmount === null || invoice.totalTtc >= minAmount)
      .filter((invoice) => maxAmount === null || invoice.totalTtc <= maxAmount)
      .filter((invoice) => {
        if (fromTimestamp === null && toTimestamp === null) {
          return true;
        }

        const timestamp = invoiceStatusTimestamp(invoice);
        if (timestamp === null) {
          return false;
        }

        return (fromTimestamp === null || timestamp >= fromTimestamp)
          && (toTimestamp === null || timestamp <= toTimestamp);
      })
      .filter((invoice) => {
        if (!normalizedSearch) {
          return true;
        }

        const supplier = supplierById.get(invoice.supplierOrganizationId);
        const customer = customerById.get(invoice.publicCustomerId);
        return [
          invoice.supplierInvoiceNumber,
          invoice.chorusInvoiceNumber,
          invoice.statusChorus,
          invoice.statusReasonCode,
          invoice.statusReasonLabel,
          supplier?.legalName,
          supplier?.siret,
          customer?.legalName,
          customer?.siret,
          customer?.codeDestinataire,
        ].some((value) => includesNormalized(value, normalizedSearch));
      })
      .sort((left, right) =>
        new Date(right.lastStatusSyncAt || right.updatedAt).getTime()
        - new Date(left.lastStatusSyncAt || left.updatedAt).getTime(),
      );
  }, [
    actionableInvoices,
    amountMax,
    amountMin,
    chorusStatusFilter,
    customerById,
    customerFilter,
    reasonFilter,
    search,
    statusDateFrom,
    statusDateTo,
    statusFilter,
    supplierById,
    supplierFilter,
  ]);

  const actionableTotalTtc = useMemo(
    () => actionableInvoices.reduce((sum, invoice) => sum + invoice.totalTtc, 0),
    [actionableInvoices],
  );
  const pendingCount = useMemo(
    () => actionableInvoices.filter((invoice) => matchesTreatmentFilter(invoice, 'pending')).length,
    [actionableInvoices],
  );

  const loading = invoicesQuery.isLoading || suppliersQuery.isLoading || customersQuery.isLoading;
  const syncing = syncInvoices.isPending || syncSuppliers.isPending;
  const error =
    syncError
    || invoicesQuery.error?.message
    || suppliersQuery.error?.message
    || customersQuery.error?.message
    || null;

  async function handleRefresh() {
    setSyncError(null);
    try {
      const config = loadChorusConfig();
      const supplierId = parseConfiguredSupplierId(config.submissionSupplierId);
      const syncInput = {
        environment: config.environment,
        ...(supplierId !== undefined ? { supplierId } : {}),
      };

      await syncSuppliers.mutateAsync(syncInput).catch((supplierSyncError) => {
        console.warn('[to-process] sync suppliers skipped', supplierSyncError);
      });
      await syncInvoices.mutateAsync({ ...syncInput, mode: 'full' });
    } catch (refreshError) {
      setSyncError(
        refreshError instanceof Error
          ? refreshError.message
          : 'Actualisation Chorus impossible.',
      );
    }
  }

  function resetFilters() {
    setSearch('');
    setStatusFilter('all');
    setSupplierFilter(ALL_VALUE);
    setCustomerFilter(ALL_VALUE);
    setChorusStatusFilter(ALL_VALUE);
    setReasonFilter('all');
    setStatusDateFrom('');
    setStatusDateTo('');
    setAmountMin('');
    setAmountMax('');
  }

  const activeFiltersCount = [
    search.trim(),
    statusFilter !== 'all' ? statusFilter : '',
    supplierFilter !== ALL_VALUE ? supplierFilter : '',
    customerFilter !== ALL_VALUE ? customerFilter : '',
    chorusStatusFilter !== ALL_VALUE ? chorusStatusFilter : '',
    reasonFilter !== 'all' ? reasonFilter : '',
    statusDateFrom,
    statusDateTo,
    amountMin,
    amountMax,
  ].filter(Boolean).length;

  return (
    <div className="space-y-7 animate-fade-in">
      <PageHeader
        eyebrow={
          <>
            <AlertTriangle className="h-3 w-3" />
            Émission · actions
          </>
        }
        title="Émissions à traiter"
        description="Factures émises actionnables : suspendues, en attente de validation ou à recycler. Hors rejets/refus définitifs."
        meta={
          loading
            ? 'Chargement depuis le cache local…'
            : `${filteredInvoices.length} émission${filteredInvoices.length > 1 ? 's' : ''} affichée${filteredInvoices.length > 1 ? 's' : ''} sur ${actionableInvoices.length}`
        }
        actions={
          <Button variant="outline" onClick={handleRefresh} disabled={syncing || loading}>
            {syncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Actualiser Chorus
          </Button>
        }
      />

      {error && (
        <ApiErrorCard
          severity="error"
          title="Actualisation Chorus indisponible"
          explanation="Impossible de rafraîchir le cache local depuis Chorus Pro."
          technicalDetails={error}
          onRetry={handleRefresh}
        />
      )}

      {syncing && <SyncRunProgress />}
      {lastSyncRuns.length > 0 && <SyncRunSummary runs={lastSyncRuns} />}

      <section className="grid grid-cols-1 gap-4 md:grid-cols-3 stagger-children">
        <KpiCard
          label="À traiter"
          value={loading ? '—' : actionableInvoices.length.toLocaleString('fr-FR')}
          hint="Total actionnable (hors refus)"
          icon={AlertTriangle}
          tone="warning"
          loading={loading}
        />
        <KpiCard
          label="En attente"
          value={loading ? '—' : pendingCount.toLocaleString('fr-FR')}
          hint="Suspendues, à valider, à recycler"
          icon={Clock3}
          tone="info"
          loading={loading}
        />
        <KpiCard
          label="Montant TTC"
          value={loading ? '—' : formatCurrency(actionableTotalTtc)}
          hint="Volume actionnable cumulé"
          icon={Euro}
          tone="primary"
          loading={loading}
        />
      </section>

      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Filtrer : facture, client, fournisseur, statut, motif..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as TreatmentFilter)}>
              <SelectTrigger className="w-full lg:w-[220px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Toutes à traiter</SelectItem>
                <SelectItem value="pending">En attente</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="ghost" onClick={resetFilters} disabled={activeFiltersCount === 0}>
              <X className="mr-2 h-4 w-4" />
              Réinitialiser
            </Button>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Fournisseur</Label>
              <Select value={supplierFilter} onValueChange={setSupplierFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_VALUE}>Tous les fournisseurs</SelectItem>
                  {visibleSuppliers.map((supplier) => (
                    <SelectItem key={supplier.id} value={supplier.id}>{supplier.legalName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Client public</Label>
              <Select value={customerFilter} onValueChange={setCustomerFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_VALUE}>Tous les clients</SelectItem>
                  {visibleCustomers.map((customer) => (
                    <SelectItem key={customer.id} value={customer.id}>{customer.legalName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Statut Chorus</Label>
              <Select value={chorusStatusFilter} onValueChange={setChorusStatusFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_VALUE}>Tous les statuts</SelectItem>
                  {availableStatuses.map((status) => (
                    <SelectItem key={status} value={status}>{getChorusRawStatusConfig(status).label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Motif</Label>
              <Select value={reasonFilter} onValueChange={(value) => setReasonFilter(value as ReasonFilter)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous</SelectItem>
                  <SelectItem value="with-reason">Avec motif</SelectItem>
                  <SelectItem value="without-reason">Sans motif</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Dernier statut du</Label>
              <Input type="date" value={statusDateFrom} onChange={(event) => setStatusDateFrom(event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Dernier statut au</Label>
              <Input type="date" value={statusDateTo} onChange={(event) => setStatusDateTo(event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">TTC min</Label>
              <Input inputMode="decimal" value={amountMin} onChange={(event) => setAmountMin(event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">TTC max</Label>
              <Input inputMode="decimal" value={amountMax} onChange={(event) => setAmountMax(event.target.value)} />
            </div>
          </div>
          <div className="mt-3 text-xs text-muted-foreground">
            {activeFiltersCount > 0 ? `${activeFiltersCount} filtre(s) actif(s)` : 'Aucun filtre actif'}
          </div>
        </CardContent>
      </Card>

      <Card className="card-elevated overflow-hidden">
        <CardContent className="p-0">
          <div className="flex items-center justify-between border-b bg-muted/30 px-4 py-2.5 text-[12px] text-muted-foreground">
            <span>
              <span className="font-semibold text-foreground">{filteredInvoices.length}</span> émission{filteredInvoices.length > 1 ? 's' : ''}
              {filteredInvoices.length !== actionableInvoices.length && ` sur ${actionableInvoices.length}`}
            </span>
            {activeFiltersCount > 0 && (
              <span>{activeFiltersCount} filtre{activeFiltersCount > 1 ? 's' : ''} actif{activeFiltersCount > 1 ? 's' : ''}</span>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b bg-muted/20 text-left">
                  <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">N° facture</th>
                  <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Fournisseur</th>
                  <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Client public</th>
                  <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Statut</th>
                  <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Motif</th>
                  <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">TTC</th>
                  <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Dernier statut</th>
                  <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Action</th>
                  <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Fiche</th>
                </tr>
              </thead>
              <tbody>
                {filteredInvoices.map((invoice) => {
                  const supplier = supplierById.get(invoice.supplierOrganizationId);
                  const customer = customerById.get(invoice.publicCustomerId);
                  const action = actionForStatus(invoice);
                  return (
                    <tr
                      key={invoice.id}
                      role="button"
                      tabIndex={0}
                      aria-label={`Aperçu émission à traiter ${invoice.supplierInvoiceNumber}`}
                      onClick={() => {
                        setSelectedInvoice(invoice);
                        setDrawerOpen(true);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          setSelectedInvoice(invoice);
                          setDrawerOpen(true);
                        }
                      }}
                      className="cursor-pointer border-b border-border/70 transition-colors last:border-0 hover:bg-primary/[0.025] focus-visible:bg-primary/[0.025] focus-visible:outline-none"
                    >
                      <td className="px-4 py-2.5 font-medium">
                        <div className="flex flex-col gap-1">
                          <span className="text-primary">{invoice.supplierInvoiceNumber}</span>
                          <InvoiceContextBadge context="emission" />
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="font-medium text-foreground">{supplier?.legalName || invoice.supplierChorusName || '—'}</div>
                        <div className="text-[11.5px] font-mono text-muted-foreground">{supplier?.siret || invoice.supplierChorusCode || '—'}</div>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="font-medium text-foreground">{customer?.legalName || invoice.recipientChorusName || '—'}</div>
                        <div className="text-[11.5px] font-mono text-muted-foreground">{customer?.siret || invoice.recipientChorusCode || '—'}</div>
                      </td>
                      <td className="px-4 py-2.5"><ChorusStatusPill value={getInvoiceChorusStatus(invoice)} /></td>
                      <td className="max-w-[320px] px-4 py-2.5 text-[12px] text-muted-foreground">
                        <span className="line-clamp-2">{invoice.statusReasonLabel || invoice.statusReasonCode || '—'}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{formatCurrency(invoice.totalTtc)}</td>
                      <td className="px-4 py-2.5 text-[11.5px] text-muted-foreground">
                        {invoice.lastStatusSyncAt ? formatDateTime(invoice.lastStatusSyncAt) : '—'}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="max-w-[260px]">
                          <div className="text-[12.5px] font-semibold">{action.label}</div>
                          <div className="line-clamp-2 text-[11.5px] leading-snug text-muted-foreground">{action.helper}</div>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right" onClick={(event) => event.stopPropagation()}>
                        <div className="flex justify-end gap-1.5">
                          <InvoiceDownloadMenu invoice={invoice} compact />
                          <Button variant="outline" size="sm" asChild className="h-8 px-2.5">
                            <Link to={action.href}>
                              <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                              {action.label}
                            </Link>
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filteredInvoices.length === 0 && !loading && (
                  <tr>
                    <td colSpan={9} className="p-0">
                      <EmptyState
                        icon={AlertTriangle}
                        title={actionableInvoices.length === 0 ? 'Aucune émission à traiter' : 'Aucun résultat'}
                        description={
                          actionableInvoices.length === 0
                            ? 'Toutes les émissions sont en bon état ou définitivement rejetées. Bravo.'
                            : 'Ajuste tes filtres pour retrouver des émissions actionnables.'
                        }
                        action={
                          activeFiltersCount > 0 ? (
                            <Button variant="outline" size="sm" onClick={resetFilters}>
                              <X className="mr-1.5 h-3.5 w-3.5" /> Effacer les filtres
                            </Button>
                          ) : undefined
                        }
                      />
                    </td>
                  </tr>
                )}
                {loading && (
                  <tr>
                    <td colSpan={9} className="p-12 text-center text-muted-foreground">
                      <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                      <p className="mt-2 text-sm">Chargement des émissions…</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
      <InvoiceOverviewDrawer
        invoice={selectedDisplayInvoice}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
      />
    </div>
  );
}
