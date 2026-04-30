import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { formatCurrency, formatDate, formatDateTime, getChorusRawStatusConfig } from '@/lib/status-utils';
import { ChorusBackendAutomationClient, type ChorusSupplierInvoicesSearchResult } from '@/lib/chorus/backendAutomation';
import { normalizeChorusInvoiceSearch } from '@/lib/chorus/invoiceRecords';
import { loadChorusConfig } from '@/lib/chorus/storage';
import type { Invoice, PublicCustomer, SupplierOrganization } from '@/types';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle,
  Euro,
  FileText,
  Loader2,
  Plus,
  RefreshCw,
  Wrench,
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

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

export default function Dashboard() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierOrganization[]>([]);
  const [customers, setCustomers] = useState<PublicCustomer[]>([]);
  const [searchResult, setSearchResult] = useState<ChorusSupplierInvoicesSearchResult | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);

  async function loadDashboardInvoices() {
    setLoading(true);
    setError(null);

    try {
      const config = loadChorusConfig();
      const idFournisseur = parsePositiveInteger(config.submissionSupplierId);
      const client = new ChorusBackendAutomationClient(config);
      const result = await client.searchSupplierInvoices({
        ...(idFournisseur !== undefined ? { idFournisseur } : {}),
        typeFacture: 'FACTURE',
        rechercheFactureParFournisseur: {
          triColonne: 'TypeDemandePaiement',
          triSens: 'Descendant',
        },
      });
      const normalized = normalizeChorusInvoiceSearch(result, result.idFournisseur || idFournisseur || 0);

      setInvoices(normalized.invoices);
      setSuppliers([normalized.supplier]);
      setCustomers(normalized.customers);
      setSearchResult(result);
      setLastSyncAt(normalized.fetchedAt);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Chargement du tableau de bord Chorus impossible.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadDashboardInvoices();
  }, []);

  const supplierById = useMemo(
    () => new Map(suppliers.map((supplier) => [supplier.id, supplier])),
    [suppliers],
  );

  const customerById = useMemo(
    () => new Map(customers.map((customer) => [customer.id, customer])),
    [customers],
  );

  const statusCounts = useMemo(() => {
    const counts = new Map<string, number>();

    for (const invoice of invoices) {
      const status = getInvoiceStatusLabel(invoice);
      counts.set(status, (counts.get(status) ?? 0) + 1);
    }

    return counts;
  }, [invoices]);

  const pieData = useMemo(() => {
    return [...statusCounts.entries()]
      .sort((left, right) => right[1] - left[1])
      .map(([status, value]) => {
        const config = getChorusRawStatusConfig(status);
        return {
          name: config.label,
          value,
          color: config.color,
        };
      });
  }, [statusCounts]);

  const statusAmounts = useMemo(() => {
    const amounts = new Map<string, number>();

    for (const invoice of invoices) {
      const status = getInvoiceStatusLabel(invoice);
      amounts.set(status, (amounts.get(status) ?? 0) + invoice.totalTtc);
    }

    return amounts;
  }, [invoices]);

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

  const barData = useMemo(() => {
    const counts = new Map<string, number>();

    for (const invoice of invoices) {
      const key = invoice.invoiceDate.slice(0, 7);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    return [...counts.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([month, count]) => ({
        month: new Date(`${month}-01T00:00:00Z`).toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' }),
        count,
      }));
  }, [invoices]);

  const recentInvoices = useMemo(
    () => [...invoices]
      .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
      .slice(0, 5),
    [invoices],
  );

  const recentStatuses = useMemo(
    () => [...invoices]
      .sort((left, right) => new Date(right.lastStatusSyncAt || right.updatedAt).getTime() - new Date(left.lastStatusSyncAt || left.updatedAt).getTime())
      .slice(0, 5),
    [invoices],
  );

  const totalTtc = useMemo(
    () => invoices.reduce((sum, invoice) => sum + invoice.totalTtc, 0),
    [invoices],
  );

  const rejectedCount = useMemo(
    () => invoices.filter((invoice) => isRejectedStatus(getInvoiceStatusLabel(invoice))).length,
    [invoices],
  );

  const paidCount = useMemo(
    () => invoices.filter((invoice) => isPaidStatus(getInvoiceStatusLabel(invoice))).length,
    [invoices],
  );

  const statCards = useMemo(() => [
    { label: 'Total factures Chorus', value: searchResult?.total ?? invoices.length, icon: FileText, color: 'text-foreground' },
    { label: 'Montant TTC cumulé', value: formatCurrency(totalTtc), icon: Euro, color: 'text-info' },
    { label: 'Rejets Chorus', value: rejectedCount, icon: AlertTriangle, color: 'text-destructive' },
    { label: 'Paiement / payées', value: paidCount, icon: CheckCircle, color: 'text-success' },
  ], [invoices.length, paidCount, rejectedCount, searchResult?.total, totalTtc]);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Tableau de bord</h1>
          <p className="text-sm text-muted-foreground">
            {loading
              ? 'Chargement des données Chorus...'
              : lastSyncAt
                ? `Données Chorus synchronisées le ${formatDateTime(lastSyncAt)}`
                : 'Vue réelle des factures Chorus'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={loadDashboardInvoices} disabled={loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
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

      {searchResult && (
        <Alert>
          <AlertDescription>
            Chorus a retourné {searchResult.returned} ligne(s) sur {searchResult.total || searchResult.returned}.
            Taille demandée : {searchResult.requestedPageSize}.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((stat) => (
          <Card key={stat.label}>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{stat.label}</p>
                  <p className={`text-3xl font-bold ${stat.color}`}>{stat.value}</p>
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
          <CardHeader><CardTitle className="text-base">Factures Chorus par mois</CardTitle></CardHeader>
          <CardContent>
            <div className="h-[250px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={barData}>
                  <XAxis dataKey="month" />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="count" fill="hsl(220, 60%, 20%)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

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
                  {loading ? 'Chargement des factures Chorus...' : 'Aucune facture Chorus chargée'}
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
                  {loading ? 'Chargement des statuts Chorus...' : 'Aucun statut Chorus chargé'}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {!loading && invoices.length === 0 && !error && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Aucune facture réelle n&apos;a encore été retournée par Chorus.
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
