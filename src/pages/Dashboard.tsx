import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatCurrency, formatDate, formatDateTime, getChorusRawStatusConfig } from '@/lib/status-utils';
import { loadChorusConfig } from '@/lib/chorus/storage';
import {
  type SyncRunResult,
  useInvoicesQuery,
  usePublicCustomersQuery,
  useSuppliersQuery,
  useSyncInvoicesMutation,
  useSyncSuppliersMutation,
} from '@/lib/queries/db';
import type { Invoice } from '@/types';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle,
  Euro,
  FileText,
  Loader2,
  Plus,
  RefreshCw,
  TrendingUp,
  Wrench,
  X,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const ALL_VALUE = '__all__';

function isRejectedStatus(status: string): boolean {
  return status.toUpperCase().includes('REJET');
}

function isPaidStatus(status: string): boolean {
  const normalized = status.toUpperCase();
  return normalized.includes('PAY') || normalized.includes('PAIE') || normalized.includes('PAIEMENT');
}

function getInvoiceStatusLabel(invoice: Invoice): string {
  return invoice.statusChorus || invoice.statusInternal;
}

function parsePositiveInteger(value: string): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : undefined;
}

interface DashboardFilters {
  supplierId: string;
  status: string;
  customerId: string;
  fromDate: string;
  toDate: string;
}

const EMPTY_FILTERS: DashboardFilters = {
  supplierId: ALL_VALUE,
  status: ALL_VALUE,
  customerId: ALL_VALUE,
  fromDate: '',
  toDate: '',
};

export default function Dashboard() {
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [filters, setFilters] = useState<DashboardFilters>(EMPTY_FILTERS);

  const invoicesQuery = useInvoicesQuery({ pageSize: 500 });
  const suppliersQuery = useSuppliersQuery();
  const customersQuery = usePublicCustomersQuery();
  const syncInvoices = useSyncInvoicesMutation();
  const syncSuppliers = useSyncSuppliersMutation();

  const invoices = invoicesQuery.data?.items ?? [];
  const suppliers = suppliersQuery.data ?? [];
  const customers = customersQuery.data ?? [];
  const lastSyncRuns: SyncRunResult[] = (syncInvoices.data ?? []) as SyncRunResult[];

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
      const supplierId = parsePositiveInteger(config.submissionSupplierId);
      const syncInput = {
        environment: config.environment,
        ...(supplierId !== undefined ? { supplierId } : {}),
      };

      await syncSuppliers.mutateAsync(syncInput).catch((supplierSyncError) => {
        console.warn('[dashboard] sync suppliers skipped', supplierSyncError);
      });
      const runs = await syncInvoices.mutateAsync({ ...syncInput, mode: 'delta' });
      const lastRun = runs[runs.length - 1];
      if (lastRun) {
        setLastSyncAt(lastRun.finishedAt || lastRun.startedAt);
      }
    } catch (refreshError) {
      setSyncError(
        refreshError instanceof Error
          ? refreshError.message
          : 'Synchronisation Chorus impossible.',
      );
    }
  }

  const supplierById = useMemo(
    () => new Map(suppliers.map((supplier) => [supplier.id, supplier])),
    [suppliers],
  );

  const customerById = useMemo(
    () => new Map(customers.map((customer) => [customer.id, customer])),
    [customers],
  );

  const availableStatuses = useMemo(() => {
    const set = new Set<string>();
    for (const invoice of invoices) {
      const status = getInvoiceStatusLabel(invoice);
      if (status) set.add(status);
    }
    return [...set].sort();
  }, [invoices]);

  const filteredInvoices = useMemo(() => {
    return invoices.filter((invoice) => {
      if (filters.supplierId !== ALL_VALUE && invoice.supplierOrganizationId !== filters.supplierId) {
        return false;
      }
      if (filters.customerId !== ALL_VALUE && invoice.publicCustomerId !== filters.customerId) {
        return false;
      }
      if (filters.status !== ALL_VALUE && getInvoiceStatusLabel(invoice) !== filters.status) {
        return false;
      }
      if (filters.fromDate && (!invoice.invoiceDate || invoice.invoiceDate < filters.fromDate)) {
        return false;
      }
      if (filters.toDate && (!invoice.invoiceDate || invoice.invoiceDate > filters.toDate)) {
        return false;
      }
      return true;
    });
  }, [invoices, filters]);

  const filtersActive =
    filters.supplierId !== ALL_VALUE
    || filters.status !== ALL_VALUE
    || filters.customerId !== ALL_VALUE
    || filters.fromDate !== ''
    || filters.toDate !== '';

  const statusCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const invoice of filteredInvoices) {
      const status = getInvoiceStatusLabel(invoice);
      counts.set(status, (counts.get(status) ?? 0) + 1);
    }
    return counts;
  }, [filteredInvoices]);

  const pieData = useMemo(() => {
    return [...statusCounts.entries()]
      .sort((left, right) => right[1] - left[1])
      .map(([status, value]) => {
        const config = getChorusRawStatusConfig(status);
        return { name: config.label, value, color: config.color };
      });
  }, [statusCounts]);

  const statusAmounts = useMemo(() => {
    const amounts = new Map<string, number>();
    for (const invoice of filteredInvoices) {
      const status = getInvoiceStatusLabel(invoice);
      amounts.set(status, (amounts.get(status) ?? 0) + invoice.totalTtc);
    }
    return amounts;
  }, [filteredInvoices]);

  const amountPieData = useMemo(() => {
    return [...statusAmounts.entries()]
      .sort((left, right) => right[1] - left[1])
      .map(([status, value]) => {
        const config = getChorusRawStatusConfig(status);
        return {
          name: config.label,
          value,
          count: statusCounts.get(status) ?? 0,
          color: config.color,
        };
      });
  }, [statusAmounts, statusCounts]);

  const monthlyData = useMemo(() => {
    const buckets = new Map<string, { count: number; ttc: number }>();
    for (const invoice of filteredInvoices) {
      if (!invoice.invoiceDate) continue;
      const key = invoice.invoiceDate.slice(0, 7);
      const current = buckets.get(key) ?? { count: 0, ttc: 0 };
      current.count += 1;
      current.ttc += invoice.totalTtc;
      buckets.set(key, current);
    }
    return [...buckets.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([month, value]) => ({
        month: new Date(`${month}-01T00:00:00Z`).toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' }),
        count: value.count,
        ttc: Math.round(value.ttc * 100) / 100,
      }));
  }, [filteredInvoices]);

  const topCustomers = useMemo(() => {
    const buckets = new Map<string, { count: number; ttc: number; label: string }>();
    for (const invoice of filteredInvoices) {
      const id = invoice.publicCustomerId;
      if (!id) continue;
      const current = buckets.get(id) ?? {
        count: 0,
        ttc: 0,
        label: customerById.get(id)?.legalName || id,
      };
      current.count += 1;
      current.ttc += invoice.totalTtc;
      buckets.set(id, current);
    }
    return [...buckets.entries()]
      .map(([id, data]) => ({ id, ...data }))
      .sort((left, right) => right.ttc - left.ttc)
      .slice(0, 5);
  }, [filteredInvoices, customerById]);

  const recentInvoices = useMemo(
    () => [...filteredInvoices]
      .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
      .slice(0, 5),
    [filteredInvoices],
  );

  const rejectedInvoices = useMemo(
    () => filteredInvoices
      .filter((invoice) => isRejectedStatus(getInvoiceStatusLabel(invoice)))
      .sort((left, right) =>
        new Date(right.lastStatusSyncAt || right.updatedAt).getTime()
        - new Date(left.lastStatusSyncAt || left.updatedAt).getTime(),
      )
      .slice(0, 8),
    [filteredInvoices],
  );

  const recentStatuses = useMemo(
    () => [...filteredInvoices]
      .sort((left, right) =>
        new Date(right.lastStatusSyncAt || right.updatedAt).getTime()
        - new Date(left.lastStatusSyncAt || left.updatedAt).getTime(),
      )
      .slice(0, 5),
    [filteredInvoices],
  );

  const totalTtc = useMemo(
    () => filteredInvoices.reduce((sum, invoice) => sum + invoice.totalTtc, 0),
    [filteredInvoices],
  );

  const averageTtc = filteredInvoices.length > 0 ? totalTtc / filteredInvoices.length : 0;

  const rejectedCount = useMemo(
    () => filteredInvoices.filter((invoice) => isRejectedStatus(getInvoiceStatusLabel(invoice))).length,
    [filteredInvoices],
  );

  const paidCount = useMemo(
    () => filteredInvoices.filter((invoice) => isPaidStatus(getInvoiceStatusLabel(invoice))).length,
    [filteredInvoices],
  );

  const rejectionRate =
    filteredInvoices.length > 0
      ? Math.round((rejectedCount / filteredInvoices.length) * 1000) / 10
      : 0;

  const statCards = useMemo(() => [
    {
      label: filtersActive ? 'Factures (filtrées)' : 'Total factures (cache DB)',
      value: filteredInvoices.length,
      icon: FileText,
      color: 'text-foreground',
    },
    { label: 'Montant TTC cumulé', value: formatCurrency(totalTtc), icon: Euro, color: 'text-info' },
    {
      label: 'Montant moyen / facture',
      value: formatCurrency(averageTtc),
      icon: TrendingUp,
      color: 'text-primary',
    },
    { label: 'Paiement / payées', value: paidCount, icon: CheckCircle, color: 'text-success' },
    {
      label: `Rejets (${rejectionRate}%)`,
      value: rejectedCount,
      icon: AlertTriangle,
      color: 'text-destructive',
    },
  ], [averageTtc, filteredInvoices.length, filtersActive, paidCount, rejectedCount, rejectionRate, totalTtc]);

  function updateFilter<K extends keyof DashboardFilters>(key: K, value: DashboardFilters[K]) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Tableau de bord</h1>
          <p className="text-sm text-muted-foreground">
            {loading
              ? 'Chargement depuis la base locale...'
              : lastSyncAt
                ? `Dernière sync Chorus : ${formatDateTime(lastSyncAt)}`
                : 'Données depuis le cache local (DB)'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={handleRefresh} disabled={syncing || loading}>
            {syncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Actualiser Chorus
          </Button>
          <Button variant="outline" asChild>
            <Link to="/invoices">
              <Wrench className="mr-2 h-4 w-4" /> Rechercher
            </Link>
          </Button>
          <Button asChild>
            <Link to="/invoices/new">
              <Plus className="mr-2 h-4 w-4" /> Déposer une facture
            </Link>
          </Button>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {lastSyncRuns.length > 0 && (
        <Alert>
          <AlertDescription>
            Sync sur {lastSyncRuns.length} fournisseur(s) :{' '}
            {lastSyncRuns.reduce((sum, run) => sum + run.rowsFetched, 0)} ligne(s) reçues,{' '}
            {lastSyncRuns.reduce((sum, run) => sum + run.rowsUpserted, 0)} upsertée(s)
            {lastSyncRuns.some((run) => run.rowsFailed > 0)
              ? `, ${lastSyncRuns.reduce((sum, run) => sum + run.rowsFailed, 0)} échec(s)`
              : ''}.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <CardTitle className="text-base">Filtres</CardTitle>
            {filtersActive && (
              <Button variant="ghost" size="sm" onClick={() => setFilters(EMPTY_FILTERS)}>
                <X className="mr-1.5 h-3.5 w-3.5" /> Réinitialiser
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Fournisseur</Label>
              <Select value={filters.supplierId} onValueChange={(value) => updateFilter('supplierId', value)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_VALUE}>Tous les fournisseurs ({suppliers.length})</SelectItem>
                  {suppliers.map((supplier) => (
                    <SelectItem key={supplier.id} value={supplier.id}>
                      {supplier.legalName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Destinataire</Label>
              <Select value={filters.customerId} onValueChange={(value) => updateFilter('customerId', value)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_VALUE}>Tous les destinataires</SelectItem>
                  {customers.map((customer) => (
                    <SelectItem key={customer.id} value={customer.id}>
                      {customer.legalName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Statut Chorus</Label>
              <Select value={filters.status} onValueChange={(value) => updateFilter('status', value)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_VALUE}>Tous les statuts</SelectItem>
                  {availableStatuses.map((status) => (
                    <SelectItem key={status} value={status}>
                      {getChorusRawStatusConfig(status).label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Date facture du</Label>
              <Input
                type="date"
                value={filters.fromDate}
                onChange={(event) => updateFilter('fromDate', event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Date facture au</Label>
              <Input
                type="date"
                value={filters.toDate}
                onChange={(event) => updateFilter('toDate', event.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {statCards.map((stat) => (
          <Card key={stat.label}>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{stat.label}</p>
                  <p className={`text-2xl font-bold ${stat.color}`}>{stat.value}</p>
                </div>
                <stat.icon className={`h-8 w-8 ${stat.color} opacity-40`} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-base">Répartition par statut Chorus</CardTitle></CardHeader>
          <CardContent>
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={0} dataKey="value" stroke="none" strokeWidth={0}>
                    {pieData.map((entry, index) => (
                      <Cell key={index} fill={entry.color} stroke="none" strokeWidth={0} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value) => [`${value} facture(s)`, 'Factures']} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex flex-wrap gap-3 mt-2 justify-center">
              {pieData.map((item) => (
                <div key={item.name} className="flex items-center gap-1.5 text-xs">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                  {item.name} ({item.value})
                </div>
              ))}
              {pieData.length === 0 && <span className="text-sm text-muted-foreground">Aucun statut Chorus chargé</span>}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Montant TTC par statut Chorus</CardTitle></CardHeader>
          <CardContent>
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={amountPieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={0} dataKey="value" stroke="none" strokeWidth={0}>
                    {amountPieData.map((entry, index) => (
                      <Cell key={index} fill={entry.color} stroke="none" strokeWidth={0} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value) => [formatCurrency(Number(value)), 'Montant TTC']} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex flex-wrap gap-3 mt-2 justify-center">
              {amountPieData.map((item) => (
                <div key={item.name} className="flex items-center gap-1.5 text-xs">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                  {item.name} ({formatCurrency(item.value)})
                </div>
              ))}
              {amountPieData.length === 0 && <span className="text-sm text-muted-foreground">Aucun montant Chorus chargé</span>}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Top 5 destinataires par montant</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {topCustomers.map((customer) => {
                const ratio = totalTtc > 0 ? Math.min(100, (customer.ttc / totalTtc) * 100) : 0;
                return (
                  <div key={customer.id} className="space-y-1">
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="truncate" title={customer.label}>{customer.label}</span>
                      <span className="font-medium shrink-0">{formatCurrency(customer.ttc)}</span>
                    </div>
                    <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-primary rounded-full" style={{ width: `${ratio}%` }} />
                    </div>
                    <div className="text-xs text-muted-foreground">{customer.count} facture(s)</div>
                  </div>
                );
              })}
              {topCustomers.length === 0 && (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  Aucun destinataire dans le périmètre.
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Évolution mensuelle (nombre + montant TTC)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={monthlyData}>
                <XAxis dataKey="month" />
                <YAxis yAxisId="left" allowDecimals={false} />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tickFormatter={(value) => formatCurrency(Number(value))}
                  width={100}
                />
                <Tooltip
                  formatter={(value, name, item) => {
                    const isAmountSerie = item?.dataKey === 'ttc' || name === 'Montant TTC';
                    return isAmountSerie
                      ? [formatCurrency(Number(value)), 'Montant TTC']
                      : [`${value} facture(s)`, 'Factures'];
                  }}
                />
                <Legend />
                <Bar yAxisId="left" dataKey="count" name="Factures" fill="hsl(220, 60%, 60%)" radius={[4, 4, 0, 0]} />
                <Line yAxisId="right" type="monotone" dataKey="ttc" name="Montant TTC" stroke="hsl(160, 70%, 35%)" strokeWidth={2} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          {monthlyData.length === 0 && (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Aucune donnée mensuelle dans le périmètre.
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Dernières factures Chorus</CardTitle>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/invoices">Voir tout <ArrowRight className="ml-1 h-3.5 w-3.5" /></Link>
            </Button>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {recentInvoices.map((invoice) => {
                const supplier = supplierById.get(invoice.supplierOrganizationId);
                return (
                  <Link
                    key={invoice.id}
                    to={`/invoices/chorus/${encodeURIComponent(invoice.id)}`}
                    className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-muted/50 transition-colors"
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-sm">{invoice.supplierInvoiceNumber}</div>
                      <div className="text-xs text-muted-foreground truncate">{supplier?.legalName}</div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-sm font-medium">{formatCurrency(invoice.totalTtc)}</span>
                      <ChorusStatusPill value={getInvoiceStatusLabel(invoice)} />
                    </div>
                  </Link>
                );
              })}
              {recentInvoices.length === 0 && (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  {loading ? 'Chargement des factures...' : 'Aucune facture dans le périmètre'}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Derniers statuts Chorus</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-3">
              {recentStatuses.map((invoice) => {
                const customer = customerById.get(invoice.publicCustomerId);
                return (
                  <Link
                    key={invoice.id}
                    to={`/invoices/chorus/${encodeURIComponent(invoice.id)}`}
                    className="flex items-start gap-3 rounded-lg px-3 py-2 hover:bg-muted/50 transition-colors"
                  >
                    <StatusDot value={getInvoiceStatusLabel(invoice)} />
                    <div className="min-w-0">
                      <div className="text-sm">{getInvoiceStatusLabel(invoice)}</div>
                      <div className="text-xs text-muted-foreground">
                        {invoice.supplierInvoiceNumber} · {customer?.legalName || 'Destinataire Chorus'} · {formatDate(invoice.lastStatusSyncAt || invoice.updatedAt)}
                      </div>
                    </div>
                  </Link>
                );
              })}
              {recentStatuses.length === 0 && (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  {loading ? 'Chargement des statuts...' : 'Aucun statut dans le périmètre'}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {!loading && invoices.length === 0 && !error && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Aucune facture en cache local. Cliquez sur « Actualiser Chorus » pour synchroniser.
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ChorusStatusPill({ value }: { value: string }) {
  const config = getChorusRawStatusConfig(value);

  return (
    <span className={`inline-flex max-w-[180px] items-center rounded px-2 py-1 text-xs font-medium ${config.bgClass} ${config.textClass}`}>
      <span className="mr-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: config.color }} />
      <span className="truncate">{config.label}</span>
    </span>
  );
}

function StatusDot({ value }: { value: string }) {
  const config = getChorusRawStatusConfig(value);
  return (
    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: config.color }} />
  );
}
