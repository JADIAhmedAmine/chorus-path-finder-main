import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { CHORUS_INVOICE_STATUS_CODES, formatCurrency, formatDate, formatDateTime, getChorusRawStatusConfig } from '@/lib/status-utils';
import { Search, Download, Plus, ChevronLeft, ChevronRight, Loader2, Server, ExternalLink } from 'lucide-react';
import {
  type SyncRunResult,
  useInvoicesQuery,
  usePublicCustomersQuery,
  useSuppliersQuery,
  useSyncInvoicesMutation,
  useSyncSuppliersMutation,
} from '@/lib/queries/db';
import { SyncRunProgress, SyncRunSummary } from '@/components/common/SyncRunSummary';
import { SubmissionStateOverview } from '@/components/chorus/SubmissionStateOverview';
import { saveChorusLiveInvoiceDetails } from '@/lib/chorus/liveInvoiceDetails';
import { loadChorusConfig } from '@/lib/chorus/storage';
import type { Invoice } from '@/types';

const PAGE_SIZE = 10;

interface ChorusInvoiceSearchForm {
  numeroFacture: string;
  destinataire: string;
  statutCourant: string;
  periodeDateDepotDu: string;
  periodeDateDepotAu: string;
  periodeDateFactureDu: string;
  periodeDateFactureAu: string;
  montantTTCMin: string;
  montantTTCMax: string;
  numeroBonCommande: string;
  numeroMarche: string;
  modeDepot: string;
  triColonne: string;
  triSens: 'Ascendant' | 'Descendant';
}

const DEFAULT_CHORUS_INVOICE_SEARCH_FORM: ChorusInvoiceSearchForm = {
  numeroFacture: '',
  destinataire: '',
  statutCourant: '',
  periodeDateDepotDu: '',
  periodeDateDepotAu: '',
  periodeDateFactureDu: '',
  periodeDateFactureAu: '',
  montantTTCMin: '',
  montantTTCMax: '',
  numeroBonCommande: '',
  numeroMarche: '',
  modeDepot: 'all',
  triColonne: 'TypeDemandePaiement',
  triSens: 'Descendant',
};

const CHORUS_TRI_OPTIONS = [
  { value: 'TypeDemandePaiement', label: 'Type demande paiement' },
  { value: 'DateDepot', label: 'Date dépôt' },
  { value: 'DateFacture', label: 'Date facture' },
  { value: 'MontantTTC', label: 'Montant TTC' },
  { value: 'NumeroFacture', label: 'N° facture' },
  { value: 'StatutCourant', label: 'Statut courant' },
];

const CHORUS_MODE_DEPOT_OPTIONS = [
  { value: 'all', label: 'Tous les modes' },
  { value: 'SAISIE_WEB', label: 'Saisie web' },
  { value: 'SAISIE_API', label: 'Saisie API' },
  { value: 'DEPOT_PDF_API', label: 'Dépôt PDF API' },
  { value: 'DEPOT_PDF_SIGNE_API', label: 'Dépôt PDF signé API' },
];

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  return fallback;
}

function countChorusSearchCriteria(form: ChorusInvoiceSearchForm): number {
  return [
    form.numeroFacture,
    form.destinataire,
    form.statutCourant,
    form.periodeDateDepotDu,
    form.periodeDateDepotAu,
    form.periodeDateFactureDu,
    form.periodeDateFactureAu,
    form.montantTTCMin,
    form.montantTTCMax,
    form.numeroBonCommande,
    form.numeroMarche,
  ].filter((value) => value.trim()).length
    + (form.modeDepot !== 'all' ? 1 : 0);
}

function formatOptionalTableDate(value: string | undefined): string {
  if (!value) {
    return '-';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.getTime() === 0) {
    return '-';
  }

  return formatDate(value);
}

function formatOptionalTableDateTime(value: string | undefined): string {
  if (!value) {
    return '-';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.getTime() === 0) {
    return '-';
  }

  const hasTime = parsed.getHours() !== 0
    || parsed.getMinutes() !== 0
    || parsed.getSeconds() !== 0
    || parsed.getMilliseconds() !== 0;

  return hasTime ? formatDateTime(value) : formatDate(value);
}

function isRejectedInvoice(invoice: Invoice): boolean {
  return invoice.statusInternal === 'REJECTED_BUSINESS' || invoice.statusInternal === 'REJECTED_TECHNICAL';
}

function parseConfiguredSupplierId(value: string): number | undefined {
  const parsed = asNumber(value, Number.NaN);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : undefined;
}

function includesNormalized(value: string | undefined, searchValue: string): boolean {
  return !!value && value.toLowerCase().includes(searchValue);
}

function toTimestamp(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

function dateBoundaryTimestamp(value: string, endOfDay = false): number | null {
  if (!value) {
    return null;
  }

  const suffix = endOfDay ? 'T23:59:59.999' : 'T00:00:00.000';
  return toTimestamp(`${value}${value.includes('T') ? '' : suffix}`) ?? toTimestamp(value);
}

function matchesDateRange(value: string | undefined, from: string, to: string): boolean {
  if (!from && !to) {
    return true;
  }

  const timestamp = toTimestamp(value);
  if (timestamp === null) {
    return false;
  }

  const fromTimestamp = dateBoundaryTimestamp(from);
  const toTimestampValue = dateBoundaryTimestamp(to, true);
  return (fromTimestamp === null || timestamp >= fromTimestamp)
    && (toTimestampValue === null || timestamp <= toTimestampValue);
}

function matchesAmountRange(value: number, min: string, max: string): boolean {
  const minAmount = min ? asNumber(min, Number.NaN) : Number.NaN;
  const maxAmount = max ? asNumber(max, Number.NaN) : Number.NaN;

  return (!Number.isFinite(minAmount) || value >= minAmount)
    && (!Number.isFinite(maxAmount) || value <= maxAmount);
}

function getInvoiceSortValue(invoice: Invoice, column: string): string | number {
  switch (column) {
    case 'DateDepot':
      return toTimestamp(invoice.submittedAt || invoice.lastStatusSyncAt) ?? 0;
    case 'DateFacture':
      return toTimestamp(invoice.invoiceDate) ?? 0;
    case 'MontantTTC':
      return invoice.totalTtc;
    case 'NumeroFacture':
      return invoice.supplierInvoiceNumber;
    case 'StatutCourant':
      return invoice.statusChorus || invoice.statusInternal;
    default:
      return invoice.sourceFormat;
  }
}

export default function InvoiceList() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [chorusSearchForm, setChorusSearchForm] = useState<ChorusInvoiceSearchForm>(DEFAULT_CHORUS_INVOICE_SEARCH_FORM);

  const invoicesQuery = useInvoicesQuery({ pageSize: 500 });
  const suppliersQuery = useSuppliersQuery();
  const customersQuery = usePublicCustomersQuery();
  const syncInvoices = useSyncInvoicesMutation();
  const syncSuppliers = useSyncSuppliersMutation();

  const visibleInvoices = invoicesQuery.data?.items ?? [];
  const suppliers = suppliersQuery.data ?? [];
  const customers = customersQuery.data ?? [];
  const lastSyncRuns: SyncRunResult[] = syncInvoices.data ?? [];
  const loading = invoicesQuery.isLoading || suppliersQuery.isLoading || customersQuery.isLoading;
  const syncing = syncInvoices.isPending || syncSuppliers.isPending;
  const error =
    syncError
    || invoicesQuery.error?.message
    || suppliersQuery.error?.message
    || customersQuery.error?.message
    || null;

  const supplierById = useMemo(
    () => new Map(suppliers.map((supplier) => [supplier.id, supplier])),
    [suppliers],
  );
  const customerById = useMemo(
    () => new Map(customers.map((customer) => [customer.id, customer])),
    [customers],
  );

  const filtered = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    const nextFiltered = visibleInvoices.filter((inv) => {
      const supplier = supplierById.get(inv.supplierOrganizationId);
      const customer = customerById.get(inv.publicCustomerId);
      const status = inv.statusChorus || inv.statusInternal;
      const matchSearch = !normalizedSearch || [
        inv.supplierInvoiceNumber,
        inv.chorusInvoiceNumber,
        supplier?.legalName,
        supplier?.siret,
        customer?.legalName,
        customer?.siret,
        customer?.codeDestinataire,
        inv.purchaseOrderNumber,
        inv.marketNumber,
        inv.engagementNumber,
        inv.statusChorus,
        inv.statusInternal,
        inv.statusReasonLabel,
      ].some((value) => includesNormalized(value, normalizedSearch));

      return matchSearch
        && (!chorusSearchForm.numeroFacture || includesNormalized(inv.supplierInvoiceNumber, chorusSearchForm.numeroFacture.toLowerCase()) || includesNormalized(inv.chorusInvoiceNumber, chorusSearchForm.numeroFacture.toLowerCase()))
        && (!chorusSearchForm.destinataire || includesNormalized(customer?.legalName, chorusSearchForm.destinataire.toLowerCase()) || includesNormalized(customer?.siret, chorusSearchForm.destinataire.toLowerCase()) || includesNormalized(customer?.codeDestinataire, chorusSearchForm.destinataire.toLowerCase()))
        && (!chorusSearchForm.statutCourant || status === chorusSearchForm.statutCourant || includesNormalized(status, chorusSearchForm.statutCourant.toLowerCase()))
        && matchesDateRange(inv.submittedAt || inv.lastStatusSyncAt, chorusSearchForm.periodeDateDepotDu, chorusSearchForm.periodeDateDepotAu)
        && matchesDateRange(inv.invoiceDate, chorusSearchForm.periodeDateFactureDu, chorusSearchForm.periodeDateFactureAu)
        && matchesAmountRange(inv.totalTtc, chorusSearchForm.montantTTCMin, chorusSearchForm.montantTTCMax)
        && (!chorusSearchForm.numeroBonCommande || includesNormalized(inv.purchaseOrderNumber, chorusSearchForm.numeroBonCommande.toLowerCase()) || includesNormalized(inv.engagementNumber, chorusSearchForm.numeroBonCommande.toLowerCase()))
        && (!chorusSearchForm.numeroMarche || includesNormalized(inv.marketNumber, chorusSearchForm.numeroMarche.toLowerCase()))
        && (chorusSearchForm.modeDepot === 'all' || inv.depositMode === chorusSearchForm.modeDepot);
    });

    const direction = chorusSearchForm.triSens === 'Ascendant' ? 1 : -1;
    return nextFiltered.sort((left, right) => {
      const leftValue = getInvoiceSortValue(left, chorusSearchForm.triColonne);
      const rightValue = getInvoiceSortValue(right, chorusSearchForm.triColonne);

      if (typeof leftValue === 'number' && typeof rightValue === 'number') {
        return (leftValue - rightValue) * direction;
      }

      return String(leftValue).localeCompare(String(rightValue), 'fr', { numeric: true }) * direction;
    });
  }, [chorusSearchForm, customerById, search, supplierById, visibleInvoices]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const safePage = Math.min(page, Math.max(totalPages, 1));
  const paginated = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const activeChorusSearchCriteria = useMemo(
    () => countChorusSearchCriteria(chorusSearchForm),
    [chorusSearchForm],
  );

  useEffect(() => {
    if (visibleInvoices.length === 0) {
      return;
    }

    const fetchedAt = lastSyncAt || new Date().toISOString();
    saveChorusLiveInvoiceDetails(visibleInvoices.map((invoice) => {
      const supplier = supplierById.get(invoice.supplierOrganizationId);
      const customer = customerById.get(invoice.publicCustomerId);

      return {
        id: invoice.id,
        invoice,
        supplier,
        customer,
        raw: invoice,
        search: {
          idFournisseur: asNumber(supplier?.chorusSupplierCode, 0),
          fetchedAt,
          total: invoicesQuery.data?.total ?? visibleInvoices.length,
          returned: visibleInvoices.length,
          requestedPageSize: invoicesQuery.data?.pageSize ?? 500,
          payload: { source: 'db-cache' },
        },
      };
    }));
  }, [customerById, invoicesQuery.data?.pageSize, invoicesQuery.data?.total, lastSyncAt, supplierById, visibleInvoices]);

  const exportCSV = () => {
    const headers = ['Numéro', 'Fournisseur', 'SIRET', 'Client', 'Date facture', 'Date dépôt / heure statut', 'Montant TTC', 'Statut', 'Motif rejet'];
    const rows = filtered.map(inv => {
      const supplier = supplierById.get(inv.supplierOrganizationId);
      const customer = customerById.get(inv.publicCustomerId);
      return [
        inv.supplierInvoiceNumber,
        supplier?.legalName,
        supplier?.siret,
        customer?.legalName,
        inv.invoiceDate,
        formatOptionalTableDateTime(inv.submittedAt),
        inv.totalTtc,
        inv.statusChorus || inv.statusInternal,
        inv.statusReasonLabel || '',
      ].join(';');
    });
    const csv = [headers.join(';'), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'factures-export.csv';
    a.click();
  };

  function updateChorusSearchField<K extends keyof ChorusInvoiceSearchForm>(
    key: K,
    value: ChorusInvoiceSearchForm[K],
  ) {
    setChorusSearchForm((currentForm) => ({
      ...currentForm,
      [key]: value,
    }));
  }

  function resetChorusSearchForm() {
    setChorusSearchForm({ ...DEFAULT_CHORUS_INVOICE_SEARCH_FORM });
    setPage(1);
  }

  async function handleSyncInvoices() {
    setSyncError(null);
    try {
      const config = loadChorusConfig();
      const supplierId = parseConfiguredSupplierId(config.submissionSupplierId);
      const syncInput = {
        environment: config.environment,
        ...(supplierId !== undefined ? { supplierId } : {}),
      };

      await syncSuppliers.mutateAsync(syncInput).catch((supplierSyncError) => {
        console.warn('[invoices] sync suppliers skipped', supplierSyncError);
      });
      const runs = await syncInvoices.mutateAsync({ ...syncInput, mode: 'full' });
      const lastRun = runs[runs.length - 1];
      if (lastRun) {
        setLastSyncAt(lastRun.finishedAt || lastRun.startedAt);
      }
      setPage(1);
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : 'Synchronisation des factures Chorus impossible.');
    }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Factures</h1>
          <p className="text-sm text-muted-foreground">
            {loading
              ? 'Chargement depuis la base locale...'
              : lastSyncAt
                ? `${filtered.length} facture(s) en cache DB · dernière sync ${formatDateTime(lastSyncAt)}`
                : `${filtered.length} facture(s) en cache DB`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={handleSyncInvoices} disabled={syncing || loading}>
            {syncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Server className="mr-2 h-4 w-4" />}
            Actualiser Chorus
          </Button>
          <Button variant="outline" onClick={exportCSV}>
            <Download className="mr-2 h-4 w-4" /> Export CSV
          </Button>
          <Button asChild>
            <Link to="/invoices/new"><Plus className="mr-2 h-4 w-4" /> Nouvelle facture</Link>
          </Button>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <SubmissionStateOverview />

      {syncing && <SyncRunProgress />}

      {lastSyncRuns.length > 0 && (
        <SyncRunSummary runs={lastSyncRuns} />
      )}

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <CardTitle className="text-base">Filtres du cache DB</CardTitle>
            <span className="text-xs text-muted-foreground">
              {activeChorusSearchCriteria > 0 ? `${activeChorusSearchCriteria} critère(s) actif(s)` : 'Aucun critère avancé'}
            </span>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">N° facture</span>
              <Input
                value={chorusSearchForm.numeroFacture}
                onChange={(event) => updateChorusSearchField('numeroFacture', event.target.value)}
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Client public</span>
              <Input
                value={chorusSearchForm.destinataire}
                onChange={(event) => updateChorusSearchField('destinataire', event.target.value)}
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Statut Chorus</span>
              <Select
                value={chorusSearchForm.statutCourant || 'all'}
                onValueChange={(value) => updateChorusSearchField('statutCourant', value === 'all' ? '' : value)}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous les statuts</SelectItem>
                  {CHORUS_INVOICE_STATUS_CODES.map((status) => (
                    <SelectItem key={status} value={status}>{status}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Mode dépôt</span>
              <Select
                value={chorusSearchForm.modeDepot}
                onValueChange={(value) => updateChorusSearchField('modeDepot', value)}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CHORUS_MODE_DEPOT_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Dépôt du</span>
              <Input
                type="date"
                value={chorusSearchForm.periodeDateDepotDu}
                onChange={(event) => updateChorusSearchField('periodeDateDepotDu', event.target.value)}
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Dépôt au</span>
              <Input
                type="date"
                value={chorusSearchForm.periodeDateDepotAu}
                onChange={(event) => updateChorusSearchField('periodeDateDepotAu', event.target.value)}
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Facture du</span>
              <Input
                type="date"
                value={chorusSearchForm.periodeDateFactureDu}
                onChange={(event) => updateChorusSearchField('periodeDateFactureDu', event.target.value)}
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Facture au</span>
              <Input
                type="date"
                value={chorusSearchForm.periodeDateFactureAu}
                onChange={(event) => updateChorusSearchField('periodeDateFactureAu', event.target.value)}
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">TTC min</span>
              <Input
                inputMode="decimal"
                value={chorusSearchForm.montantTTCMin}
                onChange={(event) => updateChorusSearchField('montantTTCMin', event.target.value)}
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">TTC max</span>
              <Input
                inputMode="decimal"
                value={chorusSearchForm.montantTTCMax}
                onChange={(event) => updateChorusSearchField('montantTTCMax', event.target.value)}
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Bon de commande</span>
              <Input
                value={chorusSearchForm.numeroBonCommande}
                onChange={(event) => updateChorusSearchField('numeroBonCommande', event.target.value)}
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Marché</span>
              <Input
                value={chorusSearchForm.numeroMarche}
                onChange={(event) => updateChorusSearchField('numeroMarche', event.target.value)}
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Tri</span>
              <Select
                value={chorusSearchForm.triColonne}
                onValueChange={(value) => updateChorusSearchField('triColonne', value)}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CHORUS_TRI_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Sens</span>
              <Select
                value={chorusSearchForm.triSens}
                onValueChange={(value) => updateChorusSearchField('triSens', value as ChorusInvoiceSearchForm['triSens'])}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Descendant">Décroissant</SelectItem>
                  <SelectItem value="Ascendant">Croissant</SelectItem>
                </SelectContent>
              </Select>
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setPage(1)} disabled={loading}>
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
              Appliquer
            </Button>
            <Button variant="outline" onClick={resetChorusSearchForm} disabled={loading}>
              Réinitialiser critères
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Quick filter */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap gap-3 items-center">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Filtrer les résultats chargés : numéro, fournisseur, client, statut..." className="pl-9" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="text-left p-3 font-medium">N° Facture</th>
                  <th className="text-left p-3 font-medium">Fournisseur</th>
                  <th className="text-left p-3 font-medium hidden lg:table-cell">Client public</th>
                  <th className="text-left p-3 font-medium hidden md:table-cell">Date facture</th>
                  <th className="text-left p-3 font-medium hidden md:table-cell">Dépôt / heure statut</th>
                  <th className="text-right p-3 font-medium">Montant TTC</th>
                  <th className="text-left p-3 font-medium hidden md:table-cell">Format</th>
                  <th className="text-left p-3 font-medium">Statut</th>
                  <th className="text-left p-3 font-medium hidden lg:table-cell">MAJ</th>
                </tr>
              </thead>
              <tbody>
                {paginated.map((inv) => {
                  const supplier = supplierById.get(inv.supplierOrganizationId);
                  const customer = customerById.get(inv.publicCustomerId);
                  return (
                    <tr
                      key={inv.id}
                      className="border-b hover:bg-muted/20 transition-colors"
                    >
                      <td className="p-3">
                        <Link
                          to={`/invoices/chorus/${encodeURIComponent(inv.id)}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 font-medium text-accent hover:underline"
                        >
                          {inv.supplierInvoiceNumber}
                          <ExternalLink className="h-3.5 w-3.5" />
                        </Link>
                      </td>
                      <td className="p-3">
                        <div>{supplier?.legalName}</div>
                        <div className="text-xs text-muted-foreground">{supplier?.siret}</div>
                      </td>
                      <td className="p-3 hidden lg:table-cell">{customer?.legalName}</td>
                      <td className="p-3 hidden md:table-cell">{formatOptionalTableDate(inv.invoiceDate)}</td>
                      <td className="p-3 hidden md:table-cell">{formatOptionalTableDateTime(inv.submittedAt)}</td>
                      <td className="p-3 text-right font-medium">{formatCurrency(inv.totalTtc)}</td>
                      <td className="p-3 hidden md:table-cell">
                        <span className="text-xs px-2 py-0.5 rounded bg-muted">{inv.sourceFormat}</span>
                      </td>
                      <td className="p-3">
                        <div className="space-y-1">
                          <ChorusStatusPill value={inv.statusChorus || inv.statusInternal} />
                          {isRejectedInvoice(inv) && inv.statusReasonLabel && (
                            <p className="max-w-[260px] text-xs text-destructive">
                              {inv.statusReasonLabel}
                            </p>
                          )}
                        </div>
                      </td>
                      <td className="p-3 text-xs text-muted-foreground hidden lg:table-cell">{formatDate(inv.updatedAt)}</td>
                    </tr>
                  );
                })}
                {paginated.length === 0 && (
                  <tr>
                    <td colSpan={9} className="p-8 text-center text-muted-foreground">
                      {loading ? 'Chargement des factures...' : 'Aucune facture dans le cache local'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t">
              <span className="text-sm text-muted-foreground">Page {safePage} / {totalPages}</span>
              <div className="flex gap-1">
                <Button variant="outline" size="sm" disabled={safePage === 1} onClick={() => setPage(p => p - 1)}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="sm" disabled={safePage === totalPages} onClick={() => setPage(p => p + 1)}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
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
