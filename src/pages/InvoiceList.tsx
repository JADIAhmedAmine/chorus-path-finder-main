import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { CHORUS_INVOICE_STATUS_CODES, formatCurrency, formatDate, formatDateTime, getChorusRawStatusConfig } from '@/lib/status-utils';
import { Search, Download, Plus, ChevronLeft, ChevronRight, Loader2, Server, ExternalLink } from 'lucide-react';
import {
  ChorusBackendAutomationClient,
  type ChorusSupplierInvoicesSearchInput,
  type ChorusSupplierInvoicesSearchResult,
} from '@/lib/chorus/backendAutomation';
import { FIXED_CHORUS_SUPPLIER_ID_TEXT } from '@/lib/chorus/constants';
import { saveChorusLiveInvoiceDetails } from '@/lib/chorus/liveInvoiceDetails';
import { loadChorusConfig } from '@/lib/chorus/storage';
import type { Invoice, InvoiceStatusInternal, PublicCustomer, SupplierOrganization } from '@/types';

const PAGE_SIZE = 10;
const CHORUS_TENANT_ID = 'chorus-live';

type RejetTraiteFilter = 'all' | 'true' | 'false';

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
  rejetTraite: RejetTraiteFilter;
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
  rejetTraite: 'all',
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim();
  }

  if (typeof value === 'number' || typeof value === 'bigint') {
    return String(value);
  }

  return '';
}

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

function safeIdentifier(value: string): string {
  const normalized = value.trim().replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized || 'unknown';
}

function firstString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = asString(record[key]);
    if (value) {
      return value;
    }
  }

  return '';
}

function asStatusText(value: unknown): string {
  const directValue = asString(value);
  if (directValue) {
    return directValue;
  }

  if (Array.isArray(value)) {
    return value.map(asStatusText).filter(Boolean).join(', ');
  }

  if (isRecord(value)) {
    return firstString(value, ['libelle', 'label', 'code', 'statutCourant', 'statut', 'etatCourant']);
  }

  return '';
}

function extractChorusStatus(record: Record<string, unknown>): string {
  for (const key of ['libelleStatutCourant', 'statutCourant', 'statut', 'etatCourant', 'codeStatutCourant', 'libelleEtatCourant']) {
    const value = asStatusText(record[key]);
    if (value) {
      return value;
    }
  }

  return '';
}

function firstNumber(record: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const rawValue = record[key];
    const value = asNumber(rawValue, Number.NaN);
    if (Number.isFinite(value)) {
      return value;
    }
  }

  return 0;
}

function splitChorusValues(value: string): string[] {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function addTextCriterion(payload: ChorusSupplierInvoicesSearchInput, key: keyof ChorusSupplierInvoicesSearchInput, value: string) {
  const trimmedValue = value.trim();
  if (trimmedValue) {
    (payload as Record<string, unknown>)[key] = trimmedValue;
  }
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
    + (form.modeDepot !== 'all' ? 1 : 0)
    + (form.rejetTraite !== 'all' ? 1 : 0);
}

function buildChorusSupplierInvoiceSearchInput(
  form: ChorusInvoiceSearchForm,
  idFournisseur: number,
): ChorusSupplierInvoicesSearchInput {
  const payload: ChorusSupplierInvoicesSearchInput = {
    idFournisseur,
    typeFacture: 'FACTURE',
    rechercheFactureParFournisseur: {
      triColonne: form.triColonne,
      triSens: form.triSens,
    },
  };

  addTextCriterion(payload, 'numeroFacture', form.numeroFacture);
  addTextCriterion(payload, 'destinataire', form.destinataire);
  addTextCriterion(payload, 'periodeDateDepotDu', form.periodeDateDepotDu);
  addTextCriterion(payload, 'periodeDateDepotAu', form.periodeDateDepotAu);
  addTextCriterion(payload, 'periodeDateFactureDu', form.periodeDateFactureDu);
  addTextCriterion(payload, 'periodeDateFactureAu', form.periodeDateFactureAu);
  addTextCriterion(payload, 'montantTTCMin', form.montantTTCMin);
  addTextCriterion(payload, 'montantTTCMax', form.montantTTCMax);
  addTextCriterion(payload, 'numeroBonCommande', form.numeroBonCommande);
  addTextCriterion(payload, 'numeroMarche', form.numeroMarche);

  if (form.modeDepot !== 'all') {
    payload.modeDepot = form.modeDepot;
  }

  if (form.rejetTraite !== 'all') {
    payload.rejetTraite = form.rejetTraite === 'true';
  }

  const statuts = splitChorusValues(form.statutCourant);
  if (statuts.length > 0) {
    payload.statutCourant = statuts;
  }

  return payload;
}

function normalizeDate(value: string): string {
  if (!value) {
    return new Date(0).toISOString();
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date(0).toISOString() : parsed.toISOString();
}

function normalizeOptionalDate(value: string): string | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function parseDateParts(value: string): { year: number; month: number; day: number } | null {
  const isoDateMatch = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoDateMatch) {
    return {
      year: Number(isoDateMatch[1]),
      month: Number(isoDateMatch[2]),
      day: Number(isoDateMatch[3]),
    };
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return {
    year: parsed.getFullYear(),
    month: parsed.getMonth() + 1,
    day: parsed.getDate(),
  };
}

function normalizeDepositDateWithStatusTime(dateDepotValue: string, statusDateTimeValue: string): string | undefined {
  const dateDepot = dateDepotValue.trim();
  const statusDateTime = statusDateTimeValue.trim();
  const dateParts = dateDepot ? parseDateParts(dateDepot) : null;
  const parsedStatusDateTime = statusDateTime ? new Date(statusDateTime) : null;
  const hasStatusDateTime = parsedStatusDateTime !== null && !Number.isNaN(parsedStatusDateTime.getTime());

  if (dateParts && hasStatusDateTime) {
    return new Date(
      dateParts.year,
      dateParts.month - 1,
      dateParts.day,
      parsedStatusDateTime.getHours(),
      parsedStatusDateTime.getMinutes(),
      parsedStatusDateTime.getSeconds(),
      parsedStatusDateTime.getMilliseconds(),
    ).toISOString();
  }

  if (dateDepot) {
    return normalizeOptionalDate(dateDepot);
  }

  return hasStatusDateTime ? parsedStatusDateTime.toISOString() : undefined;
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

function normalizeChorusStatus(value: string): InvoiceStatusInternal {
  const normalized = value.toUpperCase();
  if (normalized.includes('PAY') || normalized.includes('MISE_EN_PAIEMENT')) {
    return 'PAID';
  }
  if (normalized.includes('REJET')) {
    return 'REJECTED_BUSINESS';
  }
  if (normalized.includes('ACCEPT') || normalized.includes('VALID')) {
    return 'ACCEPTED_BY_CHORUS';
  }
  if (normalized.includes('ARCHIV')) {
    return 'ARCHIVED';
  }
  return 'SUBMITTED_TO_CHORUS';
}

function buildChorusSupplier(idFournisseur: number, records: unknown[]): SupplierOrganization {
  const firstRecord = records.find(isRecord);
  const legalName = firstRecord
    ? firstString(firstRecord, ['raisonSocialeFournisseur', 'nomFournisseur', 'designationFournisseur', 'fournisseur'])
    : '';

  return {
    id: `chorus-supplier-${idFournisseur}`,
    tenantId: CHORUS_TENANT_ID,
    legalName: legalName || `Fournisseur Chorus ${idFournisseur}`,
    siret: '',
    vatNumber: '',
    chorusSupplierCode: String(idFournisseur),
    active: true,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
}

function extractCustomerIdentity(record: Record<string, unknown>, index: number): {
  id: string;
  code: string;
  legalName: string;
  siret: string;
} {
  const code = firstString(record, ['codeDestinataire', 'siretDestinataire', 'siretStructure', 'siret']);
  const idDestinataire = firstString(record, ['idDestinataire', 'idStructureDestinataire', 'idStructureCPP']);
  const legalName = firstString(record, [
    'raisonSocialeStuctDmd',
    'raisonSocialeStructureDmd',
    'raisonSocialeDestinataire',
    'nomDestinataire',
    'destinataire',
  ]);
  const stableKey = code || idDestinataire || `unknown-${index + 1}`;
  const safeStableKey = safeIdentifier(stableKey);

  return {
    id: `chorus-customer-${safeStableKey}`,
    code,
    legalName: legalName || `Destinataire ${stableKey}`,
    siret: code.replace(/\D/g, '').length === 14 ? code.replace(/\D/g, '') : '',
  };
}

function buildChorusCustomer(item: unknown, index: number): PublicCustomer {
  const identity = extractCustomerIdentity(isRecord(item) ? item : {}, index);

  return {
    id: identity.id,
    tenantId: CHORUS_TENANT_ID,
    codeDestinataire: identity.code,
    legalName: identity.legalName,
    siret: identity.siret,
    structureType: 'PUBLIC',
    active: true,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
}

function buildChorusCustomers(records: unknown[]): PublicCustomer[] {
  const customersById = new Map<string, PublicCustomer>();

  records.forEach((item, index) => {
    const customer = buildChorusCustomer(item, index);
    customersById.set(customer.id, customer);
  });

  return [...customersById.values()];
}

function normalizeChorusInvoiceRecord(
  item: unknown,
  index: number,
  idFournisseur: number,
): Invoice {
  const record = isRecord(item) ? item : {};
  const invoiceNumber = firstString(record, [
    'numeroFacture',
    'numeroFactureSaisi',
    'numeroFactureFournisseur',
    'numeroDemandePaiement',
    'numeroFactureChorus',
  ]);
  const chorusInvoiceNumber = firstString(record, ['numeroFactureChorus', 'numeroDemandePaiement']);
  const customer = extractCustomerIdentity(record, index);
  const dateFacture = normalizeDate(firstString(record, ['dateFacture', 'dateEmission', 'dateCreation']));
  const dateDepot = normalizeDepositDateWithStatusTime(
    firstString(record, ['dateDepot', 'dateHeureDepot']),
    firstString(record, ['dateHeureEtatCourant', 'dateEtatCourant']),
  );
  const updatedAt = normalizeDate(firstString(record, ['dateHeureEtatCourant', 'dateEtatCourant', 'dateDerniereModification', 'dateDepot']) || dateFacture);
  const statusChorus = extractChorusStatus(record);
  const stableKey = firstString(record, ['idFacture', 'idDemandePaiement', 'id']) || invoiceNumber || String(index + 1);

  return {
    id: `chorus-invoice-${safeIdentifier(stableKey)}`,
    tenantId: CHORUS_TENANT_ID,
    supplierOrganizationId: `chorus-supplier-${idFournisseur}`,
    sourceFormat: 'PDF',
    supplierInvoiceNumber: invoiceNumber || `Facture Chorus ${index + 1}`,
    chorusInvoiceNumber: chorusInvoiceNumber || undefined,
    invoiceDate: dateFacture,
    currencyCode: firstString(record, ['deviseFacture', 'devise']) || 'EUR',
    totalHt: firstNumber(record, ['montantHT', 'montantHt', 'montantHtTotal']),
    totalVat: firstNumber(record, ['montantTVA', 'montantTva']),
    totalTtc: firstNumber(record, ['montantTTC', 'montantTtc', 'montantTtcTotal', 'montantAPayer', 'montantApayer']),
    publicCustomerId: customer.id,
    engagementNumber: firstString(record, ['numeroEngagement', 'numeroBonCommande']) || undefined,
    purchaseOrderNumber: firstString(record, ['numeroBonCommande']) || undefined,
    marketNumber: firstString(record, ['numeroMarche']) || undefined,
    depositMode: firstString(record, ['modeDepot']) || 'CHORUS',
    statusInternal: normalizeChorusStatus(statusChorus),
    statusChorus: statusChorus || undefined,
    requiresHumanReview: false,
    currentRevision: 1,
    submittedAt: dateDepot,
    lastStatusSyncAt: updatedAt,
    createdBy: 'chorus',
    updatedBy: 'chorus',
    createdAt: dateFacture,
    updatedAt,
  };
}

export default function InvoiceList() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [loadingChorusInvoices, setLoadingChorusInvoices] = useState(false);
  const [chorusInvoices, setChorusInvoices] = useState<Invoice[]>([]);
  const [chorusSuppliers, setChorusSuppliers] = useState<SupplierOrganization[]>([]);
  const [chorusCustomers, setChorusCustomers] = useState<PublicCustomer[]>([]);
  const [chorusSearchResult, setChorusSearchResult] = useState<ChorusSupplierInvoicesSearchResult | null>(null);
  const [chorusSearchError, setChorusSearchError] = useState<string | null>(null);
  const [chorusSearchForm, setChorusSearchForm] = useState<ChorusInvoiceSearchForm>(DEFAULT_CHORUS_INVOICE_SEARCH_FORM);
  const didAutoLoadChorusInvoices = useRef(false);

  const visibleInvoices = chorusInvoices;
  const supplierById = useMemo(
    () => new Map(chorusSuppliers.map((supplier) => [supplier.id, supplier])),
    [chorusSuppliers],
  );
  const customerById = useMemo(
    () => new Map(chorusCustomers.map((customer) => [customer.id, customer])),
    [chorusCustomers],
  );

  const filtered = useMemo(() => {
    return visibleInvoices.filter((inv) => {
      const supplier = supplierById.get(inv.supplierOrganizationId);
      const customer = customerById.get(inv.publicCustomerId);
      const matchSearch = !search || [
        inv.supplierInvoiceNumber,
        supplier?.legalName,
        supplier?.siret,
        customer?.legalName,
        inv.statusChorus,
      ].some(v => v?.toLowerCase().includes(search.toLowerCase()));

      return matchSearch;
    });
  }, [customerById, search, supplierById, visibleInvoices]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const safePage = Math.min(page, Math.max(totalPages, 1));
  const paginated = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const activeChorusSearchCriteria = useMemo(
    () => countChorusSearchCriteria(chorusSearchForm),
    [chorusSearchForm],
  );

  const exportCSV = () => {
    const headers = ['Numéro', 'Fournisseur', 'SIRET', 'Client', 'Date facture', 'Date dépôt / heure statut', 'Montant TTC', 'Statut'];
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
  }

  async function loadChorusSupplierInvoices() {
    setLoadingChorusInvoices(true);
    setChorusSearchError(null);

    try {
      const config = loadChorusConfig();
      const idFournisseur = Number(config.submissionSupplierId || FIXED_CHORUS_SUPPLIER_ID_TEXT);
      const client = new ChorusBackendAutomationClient(config);
      const result = await client.searchSupplierInvoices(
        buildChorusSupplierInvoiceSearchInput(chorusSearchForm, idFournisseur),
      );
      const resolvedSupplierId = result.idFournisseur || idFournisseur;
      const nextInvoices = result.invoices.map((item, index) => normalizeChorusInvoiceRecord(item, index, resolvedSupplierId));
      const nextSupplier = buildChorusSupplier(resolvedSupplierId, result.invoices);
      const nextCustomers = buildChorusCustomers(result.invoices);
      const fetchedAt = new Date().toISOString();

      saveChorusLiveInvoiceDetails(nextInvoices.map((invoice, index) => ({
        id: invoice.id,
        invoice,
        supplier: nextSupplier,
        customer: buildChorusCustomer(result.invoices[index], index),
        raw: result.invoices[index],
        search: {
          idFournisseur: resolvedSupplierId,
          fetchedAt,
          total: result.total,
          returned: result.returned,
          requestedPageSize: result.requestedPageSize,
          payload: result.payload,
        },
      })));

      setChorusSearchResult(result);
      setChorusInvoices(nextInvoices);
      setChorusSuppliers([nextSupplier]);
      setChorusCustomers(nextCustomers);
      setPage(1);
    } catch (error) {
      setChorusSearchError(error instanceof Error ? error.message : 'Chargement des factures Chorus impossible.');
    } finally {
      setLoadingChorusInvoices(false);
    }
  }

  useEffect(() => {
    if (didAutoLoadChorusInvoices.current) {
      return;
    }

    didAutoLoadChorusInvoices.current = true;
    void loadChorusSupplierInvoices();
  }, []);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Factures</h1>
          <p className="text-sm text-muted-foreground">
            {loadingChorusInvoices ? 'Chargement des factures Chorus...' : `${filtered.length} facture(s) Chorus trouvée(s)`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={loadChorusSupplierInvoices} disabled={loadingChorusInvoices}>
            {loadingChorusInvoices ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Server className="mr-2 h-4 w-4" />}
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

      {chorusSearchError && (
        <Alert variant="destructive">
          <AlertDescription>{chorusSearchError}</AlertDescription>
        </Alert>
      )}

      {chorusSearchResult && (
        <Alert>
          <AlertDescription>
            Factures Chorus chargées : {chorusSearchResult.returned} ligne(s) reçue(s) sur {chorusSearchResult.total || chorusSearchResult.returned}.
            Page demandée : {chorusSearchResult.requestedPageSize} résultat(s).
            {activeChorusSearchCriteria > 0 ? ` Critères actifs : ${activeChorusSearchCriteria}.` : ''}
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <CardTitle className="text-base">Recherche Chorus</CardTitle>
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
              <span className="text-xs font-medium text-muted-foreground">Rejet traité</span>
              <Select
                value={chorusSearchForm.rejetTraite}
                onValueChange={(value) => updateChorusSearchField('rejetTraite', value as RejetTraiteFilter)}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous</SelectItem>
                  <SelectItem value="false">Non traité</SelectItem>
                  <SelectItem value="true">Traité</SelectItem>
                </SelectContent>
              </Select>
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
            <Button onClick={loadChorusSupplierInvoices} disabled={loadingChorusInvoices}>
              {loadingChorusInvoices ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
              Rechercher Chorus
            </Button>
            <Button variant="outline" onClick={resetChorusSearchForm} disabled={loadingChorusInvoices}>
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
                        <ChorusStatusPill value={inv.statusChorus || inv.statusInternal} />
                      </td>
                      <td className="p-3 text-xs text-muted-foreground hidden lg:table-cell">{formatDate(inv.updatedAt)}</td>
                    </tr>
                  );
                })}
                {paginated.length === 0 && (
                  <tr>
                    <td colSpan={9} className="p-8 text-center text-muted-foreground">
                      {loadingChorusInvoices ? 'Chargement des factures Chorus...' : 'Aucune facture Chorus trouvée'}
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
