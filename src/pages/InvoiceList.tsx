import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { CHORUS_INVOICE_STATUS_CODES, formatCurrency, formatDate, formatDateTime, getChorusRawStatusConfig } from '@/lib/status-utils';
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  Euro,
  FileText,
  Loader2,
  MessageSquareWarning,
  Plus,
  Search,
  Server,
  SlidersHorizontal,
  X,
} from 'lucide-react';
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
import { InvoiceDownloadMenu } from '@/components/chorus/InvoiceDownloadMenu';
import { InvoiceContextBadge } from '@/components/chorus/InvoiceContextBadge';
import { InvoiceOverviewDrawer } from '@/components/chorus/InvoiceOverviewDrawer';
import { PageHeader } from '@/components/common/PageHeader';
import { KpiCard } from '@/components/common/KpiCard';
import { ApiErrorCard } from '@/components/common/ApiErrorCard';
import { EmptyState } from '@/components/common/EmptyState';
import { saveChorusLiveInvoiceDetails } from '@/lib/chorus/liveInvoiceDetails';
import { toDisplayInvoiceFromInvoice } from '@/lib/chorus/invoiceDisplay';
import { loadChorusConfig } from '@/lib/chorus/storage';
import { isPaidChorusStatus, isRejectedChorusStatus } from '@/lib/chorus/actionableInvoices';
import { cn } from '@/lib/utils';
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
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.getTime() === 0) return '—';
  return formatDate(value);
}

function formatOptionalTableDateTime(value: string | undefined): string {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.getTime() === 0) return '—';
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
  if (!value) return null;
  const ts = new Date(value).getTime();
  return Number.isNaN(ts) ? null : ts;
}

function dateBoundaryTimestamp(value: string, endOfDay = false): number | null {
  if (!value) return null;
  const suffix = endOfDay ? 'T23:59:59.999' : 'T00:00:00.000';
  return toTimestamp(`${value}${value.includes('T') ? '' : suffix}`) ?? toTimestamp(value);
}

function matchesDateRange(value: string | undefined, from: string, to: string): boolean {
  if (!from && !to) return true;
  const ts = toTimestamp(value);
  if (ts === null) return false;
  const fromTs = dateBoundaryTimestamp(from);
  const toTs = dateBoundaryTimestamp(to, true);
  return (fromTs === null || ts >= fromTs) && (toTs === null || ts <= toTs);
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
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

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
  const selectedDisplayInvoice = useMemo(
    () => selectedInvoice
      ? toDisplayInvoiceFromInvoice(
          selectedInvoice,
          supplierById.get(selectedInvoice.supplierOrganizationId),
          customerById.get(selectedInvoice.publicCustomerId),
          {
            context: 'emission',
            source: 'Suivi émission',
            detailHref: `/invoices/chorus/${encodeURIComponent(selectedInvoice.id)}`,
          },
        )
      : null,
    [customerById, selectedInvoice, supplierById],
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

  // KPIs computed from the full visible cache (not the filtered subset)
  const kpis = useMemo(() => {
    const total = visibleInvoices.length;
    const totalTtc = visibleInvoices.reduce((s, i) => s + i.totalTtc, 0);
    const paid = visibleInvoices.filter((i) => isPaidChorusStatus(i.statusChorus || i.statusInternal)).length;
    const rejected = visibleInvoices.filter((i) => isRejectedChorusStatus(i.statusChorus || i.statusInternal)).length;
    return { total, totalTtc, paid, rejected };
  }, [visibleInvoices]);

  useEffect(() => {
    if (visibleInvoices.length === 0) return;
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
    setChorusSearchForm((currentForm) => ({ ...currentForm, [key]: value }));
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
    <div className="space-y-7 animate-fade-in">
      <PageHeader
        eyebrow={
          <>
            <FileText className="h-3 w-3" />
            Émission · suivi
          </>
        }
        title="Factures"
        description="Toutes les factures émises et synchronisées depuis Chorus Pro. Filtre par statut, période, fournisseur ou destinataire."
        meta={
          loading
            ? 'Chargement depuis la base locale…'
            : lastSyncAt
              ? <span className="inline-flex items-center gap-1.5"><span className="live-dot" />{filtered.length} facture{filtered.length > 1 ? 's' : ''} · dernière sync {formatDateTime(lastSyncAt)}</span>
              : `${filtered.length} facture${filtered.length > 1 ? 's' : ''} en cache`
        }
        actions={
          <>
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
          </>
        }
      />

      {error && (
        <ApiErrorCard
          severity="error"
          title="Synchronisation Chorus indisponible"
          explanation="Les factures affichées proviennent du dernier cache local. Vérifie ta connexion ou la configuration PISTE."
          technicalDetails={error}
          onRetry={handleSyncInvoices}
        />
      )}

      {/* KPI strip */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4 stagger-children">
        <KpiCard
          label="Total factures"
          value={loading ? '—' : kpis.total.toLocaleString('fr-FR')}
          hint="Cache Chorus synchronisé"
          icon={FileText}
          tone="primary"
          loading={loading}
        />
        <KpiCard
          label="Montant TTC cumulé"
          value={loading ? '—' : formatCurrency(kpis.totalTtc)}
          hint="Toutes factures confondues"
          icon={Euro}
          tone="info"
          loading={loading}
        />
        <KpiCard
          label="Payées"
          value={loading ? '—' : kpis.paid.toLocaleString('fr-FR')}
          hint={`${kpis.total > 0 ? Math.round((kpis.paid / kpis.total) * 100) : 0}% du total`}
          icon={CheckCircle2}
          tone="success"
          loading={loading}
        />
        <KpiCard
          label="Rejetées"
          value={loading ? '—' : kpis.rejected.toLocaleString('fr-FR')}
          hint="À analyser dans Rejets / refus"
          icon={MessageSquareWarning}
          tone="danger"
          loading={loading}
          href="/invoices/rejections"
        />
      </section>

      <SubmissionStateOverview />

      {syncing && <SyncRunProgress />}
      {lastSyncRuns.length > 0 && <SyncRunSummary runs={lastSyncRuns} />}

      {/* Search bar + Advanced toggle */}
      <Card className="card-surface">
        <CardContent className="flex flex-wrap items-center gap-3 p-3">
          <div className="relative min-w-[260px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Filtrer les résultats : numéro, fournisseur, client, statut, motif…"
              className="pl-9 pr-9"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label="Effacer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <Button
            variant={advancedOpen ? 'default' : 'outline'}
            onClick={() => setAdvancedOpen((v) => !v)}
            className="gap-1.5"
          >
            <SlidersHorizontal className="h-4 w-4" />
            Filtres avancés
            {activeChorusSearchCriteria > 0 && (
              <Badge
                variant="secondary"
                className={cn(
                  'ml-1 h-5 min-w-[20px] px-1.5 text-[10.5px] font-semibold',
                  advancedOpen ? 'bg-white/20 text-primary-foreground' : 'bg-primary/15 text-primary',
                )}
              >
                {activeChorusSearchCriteria}
              </Badge>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Advanced filters */}
      {advancedOpen && (
        <Card className="card-elevated">
          <CardHeader className="pb-3">
            <div className="flex flex-col gap-1 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <CardTitle className="text-[15px]">Filtres avancés</CardTitle>
                <p className="text-[12px] text-muted-foreground">Critères structurés sur le cache local.</p>
              </div>
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                {activeChorusSearchCriteria > 0 ? `${activeChorusSearchCriteria} critère${activeChorusSearchCriteria > 1 ? 's' : ''} actif${activeChorusSearchCriteria > 1 ? 's' : ''}` : 'Aucun critère actif'}
              </span>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
              <FieldWrap label="N° facture">
                <Input value={chorusSearchForm.numeroFacture} onChange={(e) => updateChorusSearchField('numeroFacture', e.target.value)} />
              </FieldWrap>
              <FieldWrap label="Client public">
                <Input value={chorusSearchForm.destinataire} onChange={(e) => updateChorusSearchField('destinataire', e.target.value)} />
              </FieldWrap>
              <FieldWrap label="Statut Chorus">
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
              </FieldWrap>
              <FieldWrap label="Mode dépôt">
                <Select value={chorusSearchForm.modeDepot} onValueChange={(value) => updateChorusSearchField('modeDepot', value)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CHORUS_MODE_DEPOT_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FieldWrap>
              <FieldWrap label="Dépôt du">
                <Input type="date" value={chorusSearchForm.periodeDateDepotDu} onChange={(e) => updateChorusSearchField('periodeDateDepotDu', e.target.value)} />
              </FieldWrap>
              <FieldWrap label="Dépôt au">
                <Input type="date" value={chorusSearchForm.periodeDateDepotAu} onChange={(e) => updateChorusSearchField('periodeDateDepotAu', e.target.value)} />
              </FieldWrap>
              <FieldWrap label="Facture du">
                <Input type="date" value={chorusSearchForm.periodeDateFactureDu} onChange={(e) => updateChorusSearchField('periodeDateFactureDu', e.target.value)} />
              </FieldWrap>
              <FieldWrap label="Facture au">
                <Input type="date" value={chorusSearchForm.periodeDateFactureAu} onChange={(e) => updateChorusSearchField('periodeDateFactureAu', e.target.value)} />
              </FieldWrap>
              <FieldWrap label="TTC min">
                <Input inputMode="decimal" value={chorusSearchForm.montantTTCMin} onChange={(e) => updateChorusSearchField('montantTTCMin', e.target.value)} />
              </FieldWrap>
              <FieldWrap label="TTC max">
                <Input inputMode="decimal" value={chorusSearchForm.montantTTCMax} onChange={(e) => updateChorusSearchField('montantTTCMax', e.target.value)} />
              </FieldWrap>
              <FieldWrap label="Bon de commande">
                <Input value={chorusSearchForm.numeroBonCommande} onChange={(e) => updateChorusSearchField('numeroBonCommande', e.target.value)} />
              </FieldWrap>
              <FieldWrap label="Marché">
                <Input value={chorusSearchForm.numeroMarche} onChange={(e) => updateChorusSearchField('numeroMarche', e.target.value)} />
              </FieldWrap>
              <FieldWrap label="Tri">
                <Select value={chorusSearchForm.triColonne} onValueChange={(value) => updateChorusSearchField('triColonne', value)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CHORUS_TRI_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FieldWrap>
              <FieldWrap label="Sens">
                <Select value={chorusSearchForm.triSens} onValueChange={(value) => updateChorusSearchField('triSens', value as ChorusInvoiceSearchForm['triSens'])}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Descendant">Décroissant</SelectItem>
                    <SelectItem value="Ascendant">Croissant</SelectItem>
                  </SelectContent>
                </Select>
              </FieldWrap>
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t pt-3">
              <Button onClick={() => setPage(1)} disabled={loading}>
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
                Appliquer
              </Button>
              <Button variant="outline" onClick={resetChorusSearchForm} disabled={loading}>
                <X className="mr-1.5 h-4 w-4" />
                Réinitialiser
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Result table */}
      <Card className="card-elevated overflow-hidden">
        <CardContent className="p-0">
          <div className="flex items-center justify-between border-b bg-muted/30 px-4 py-2.5 text-[12px] text-muted-foreground">
            <span>
              <span className="font-semibold text-foreground">{filtered.length}</span> résultat{filtered.length > 1 ? 's' : ''}
              {filtered.length !== visibleInvoices.length && ` sur ${visibleInvoices.length}`}
            </span>
            {totalPages > 1 && (
              <span>
                Page <span className="font-semibold text-foreground">{safePage}</span> / {totalPages}
              </span>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b bg-muted/20 text-left">
                  <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">N° Facture</th>
                  <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Fournisseur</th>
                  <th className="hidden px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground lg:table-cell">Client public</th>
                  <th className="hidden px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground md:table-cell">Date facture</th>
                  <th className="hidden px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground md:table-cell">Dépôt / heure</th>
                  <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">TTC</th>
                  <th className="hidden px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground md:table-cell">Format</th>
                  <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Statut</th>
                  <th className="hidden px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground lg:table-cell">MAJ</th>
                  <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">PJ</th>
                </tr>
              </thead>
              <tbody>
                {paginated.map((inv) => {
                  const supplier = supplierById.get(inv.supplierOrganizationId);
                  const customer = customerById.get(inv.publicCustomerId);
                  return (
                    <tr
                      key={inv.id}
                      role="button"
                      tabIndex={0}
                      aria-label={`Aperçu facture émise ${inv.supplierInvoiceNumber}`}
                      onClick={() => {
                        setSelectedInvoice(inv);
                        setDrawerOpen(true);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          setSelectedInvoice(inv);
                          setDrawerOpen(true);
                        }
                      }}
                      className="cursor-pointer border-b border-border/70 transition-colors last:border-0 hover:bg-primary/[0.025] focus-visible:bg-primary/[0.025] focus-visible:outline-none"
                    >
                      <td className="px-4 py-2.5">
                        <div className="flex flex-col gap-1">
                          <span className="font-medium text-primary">{inv.supplierInvoiceNumber}</span>
                          <InvoiceContextBadge context="emission" />
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="font-medium text-foreground">{supplier?.legalName || '—'}</div>
                        <div className="text-[11.5px] text-muted-foreground font-mono">{supplier?.siret || '—'}</div>
                      </td>
                      <td className="hidden px-4 py-2.5 lg:table-cell">{customer?.legalName || '—'}</td>
                      <td className="hidden px-4 py-2.5 text-muted-foreground md:table-cell">{formatOptionalTableDate(inv.invoiceDate)}</td>
                      <td className="hidden px-4 py-2.5 text-muted-foreground md:table-cell">{formatOptionalTableDateTime(inv.submittedAt)}</td>
                      <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{formatCurrency(inv.totalTtc)}</td>
                      <td className="hidden px-4 py-2.5 md:table-cell">
                        <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[10.5px] text-muted-foreground">
                          {inv.sourceFormat}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="space-y-1">
                          <ChorusStatusPill value={inv.statusChorus || inv.statusInternal} />
                          {isRejectedInvoice(inv) && inv.statusReasonLabel && (
                            <p className="max-w-[260px] truncate text-[11px] text-destructive" title={inv.statusReasonLabel}>
                              {inv.statusReasonLabel}
                            </p>
                          )}
                        </div>
                      </td>
                      <td className="hidden px-4 py-2.5 text-[11.5px] text-muted-foreground lg:table-cell">{formatDate(inv.updatedAt)}</td>
                      <td className="px-4 py-2.5 text-right" onClick={(event) => event.stopPropagation()}>
                        <InvoiceDownloadMenu invoice={inv} compact />
                      </td>
                    </tr>
                  );
                })}
                {paginated.length === 0 && !loading && (
                  <tr>
                    <td colSpan={10} className="p-0">
                      <EmptyState
                        icon={FileText}
                        title={visibleInvoices.length === 0 ? 'Aucune facture en cache' : 'Aucun résultat'}
                        description={
                          visibleInvoices.length === 0
                            ? 'Lance une synchronisation Chorus pour récupérer les factures émises.'
                            : 'Ajuste tes filtres pour trouver ce que tu cherches.'
                        }
                        action={
                          visibleInvoices.length === 0 ? (
                            <Button onClick={handleSyncInvoices} disabled={syncing}>
                              {syncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Server className="mr-2 h-4 w-4" />}
                              Synchroniser
                            </Button>
                          ) : undefined
                        }
                      />
                    </td>
                  </tr>
                )}
                {loading && (
                  <tr>
                    <td colSpan={10} className="p-12 text-center text-muted-foreground">
                      <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                      <p className="mt-2 text-sm">Chargement des factures…</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t bg-muted/20 px-4 py-2.5">
              <span className="text-[12px] text-muted-foreground">
                Page <span className="font-semibold text-foreground">{safePage}</span> / {totalPages}
              </span>
              <div className="flex gap-1">
                <Button variant="outline" size="sm" disabled={safePage === 1} onClick={() => setPage((p) => p - 1)}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="sm" disabled={safePage === totalPages} onClick={() => setPage((p) => p + 1)}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
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

function FieldWrap({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-1.5">
      <span className="block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
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
