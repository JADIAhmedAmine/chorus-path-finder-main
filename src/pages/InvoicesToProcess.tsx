import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Clock3, Euro, ExternalLink, Loader2, RefreshCw, Search, X } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SyncRunProgress, SyncRunSummary } from '@/components/common/SyncRunSummary';
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
    <span className={`inline-flex max-w-[220px] items-center rounded px-2 py-1 text-xs font-medium ${config.bgClass} ${config.textClass}`}>
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

  const statCards = [
    { label: 'À traiter', value: actionableInvoices.length, icon: AlertTriangle, color: 'text-destructive/60' },
    { label: 'En attente', value: pendingCount, icon: Clock3, color: 'text-warning/70' },
    { label: 'Montant TTC', value: formatCurrency(actionableTotalTtc), icon: Euro, color: 'text-info/70' },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Émissions à traiter</h1>
          <p className="text-sm text-muted-foreground">
            {loading ? 'Chargement depuis le cache local...' : `${filteredInvoices.length} émission(s) à traiter`}
          </p>
        </div>
        <Button variant="outline" onClick={handleRefresh} disabled={syncing || loading}>
          {syncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Actualiser Chorus
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {syncing && <SyncRunProgress />}
      {lastSyncRuns.length > 0 && <SyncRunSummary runs={lastSyncRuns} />}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {statCards.map((stat) => (
          <Card key={stat.label}>
            <CardContent className="flex items-center justify-between p-4">
              <div>
                <div className="text-xs font-medium text-muted-foreground">{stat.label}</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums">{stat.value}</div>
              </div>
              <stat.icon className={`h-5 w-5 ${stat.color}`} />
            </CardContent>
          </Card>
        ))}
      </div>

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

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="p-3 text-left font-medium">N° facture</th>
                  <th className="p-3 text-left font-medium">Fournisseur</th>
                  <th className="p-3 text-left font-medium">Client public</th>
                  <th className="p-3 text-left font-medium">Statut</th>
                  <th className="p-3 text-left font-medium">Motif</th>
                  <th className="p-3 text-right font-medium">Montant TTC</th>
                  <th className="p-3 text-left font-medium">Dernier statut</th>
                  <th className="p-3 text-left font-medium">Action possible</th>
                  <th className="p-3 text-right font-medium">Fiche</th>
                </tr>
              </thead>
              <tbody>
                {filteredInvoices.map((invoice) => {
                  const supplier = supplierById.get(invoice.supplierOrganizationId);
                  const customer = customerById.get(invoice.publicCustomerId);
                  const action = actionForStatus(invoice);
                  return (
                    <tr key={invoice.id} className="border-b hover:bg-muted/20">
                      <td className="p-3 font-medium">
                        <Link
                          to={`/invoices/chorus/${encodeURIComponent(invoice.id)}`}
                          className="inline-flex items-center gap-1 text-accent hover:underline"
                        >
                          {invoice.supplierInvoiceNumber}
                          <ExternalLink className="h-3.5 w-3.5" />
                        </Link>
                      </td>
                      <td className="p-3">
                        <div>{supplier?.legalName || invoice.supplierChorusName || '-'}</div>
                        <div className="text-xs text-muted-foreground">{supplier?.siret || invoice.supplierChorusCode || '-'}</div>
                      </td>
                      <td className="p-3">
                        <div>{customer?.legalName || invoice.recipientChorusName || '-'}</div>
                        <div className="text-xs text-muted-foreground">{customer?.siret || invoice.recipientChorusCode || '-'}</div>
                      </td>
                      <td className="p-3"><ChorusStatusPill value={getInvoiceChorusStatus(invoice)} /></td>
                      <td className="max-w-[360px] p-3 text-xs text-muted-foreground">
                        {invoice.statusReasonLabel || invoice.statusReasonCode || '-'}
                      </td>
                      <td className="p-3 text-right font-medium">{formatCurrency(invoice.totalTtc)}</td>
                      <td className="p-3 text-xs text-muted-foreground">
                        {invoice.lastStatusSyncAt ? formatDateTime(invoice.lastStatusSyncAt) : '-'}
                      </td>
                      <td className="p-3">
                        <div className="max-w-[260px]">
                          <div className="font-medium">{action.label}</div>
                          <div className="text-xs text-muted-foreground">{action.helper}</div>
                        </div>
                      </td>
                      <td className="p-3 text-right">
                        <Button variant="ghost" size="sm" asChild>
                          <Link to={action.href}>
                            <ExternalLink className="mr-1 h-4 w-4" />
                            {action.label}
                          </Link>
                        </Button>
                      </td>
                    </tr>
                  );
                })}
                {filteredInvoices.length === 0 && (
                  <tr>
                    <td colSpan={9} className="p-8 text-center text-muted-foreground">
                      {loading ? 'Chargement des émissions...' : 'Aucune émission à traiter'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
