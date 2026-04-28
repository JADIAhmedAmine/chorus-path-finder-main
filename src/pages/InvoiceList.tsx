import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { StatusBadge } from '@/components/common/StatusBadge';
import { formatCurrency, formatDate } from '@/lib/status-utils';
import { getInvoices, getPublicCustomers, getSuppliers } from '@/data/mock-data';
import { useAsyncResource } from '@/hooks/use-async-resource';
import { Search, Download, Plus, Filter, ChevronLeft, ChevronRight, Loader2, RefreshCw, Server, ExternalLink } from 'lucide-react';
import { ChorusBackendAutomationClient, type ChorusSupplierInvoicesSearchResult } from '@/lib/chorus/backendAutomation';
import { FIXED_CHORUS_SUPPLIER_ID_TEXT } from '@/lib/chorus/constants';
import { saveChorusLiveInvoiceDetails } from '@/lib/chorus/liveInvoiceDetails';
import { loadChorusConfig } from '@/lib/chorus/storage';
import type { Invoice, InvoiceStatusInternal, PublicCustomer, SupplierOrganization } from '@/types';

const allStatuses: InvoiceStatusInternal[] = [
  'DRAFT_UPLOADED', 'DRAFT_STRUCTURED', 'PENDING_HUMAN_REVIEW', 'READY_FOR_SUBMISSION',
  'SUBMISSION_REQUESTED', 'SUBMITTED_TO_CHORUS', 'REJECTED_BUSINESS', 'REJECTED_TECHNICAL',
  'ACCEPTED_BY_CHORUS', 'PAID', 'ARCHIVED'
];

const PAGE_SIZE = 10;
const CHORUS_TENANT_ID = 'chorus-live';

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

function normalizeDate(value: string): string {
  if (!value) {
    return new Date(0).toISOString();
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date(0).toISOString() : parsed.toISOString();
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
  const dateFacture = normalizeDate(firstString(record, ['dateFacture', 'dateDepot', 'dateEmission', 'dateCreation', 'dateHeureDepot']));
  const updatedAt = normalizeDate(firstString(record, ['dateHeureEtatCourant', 'dateEtatCourant', 'dateDerniereModification', 'dateDepot']) || dateFacture);
  const statusChorus = firstString(record, ['statutCourant', 'statut', 'libelleStatutCourant', 'etatCourant']);
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
    submittedAt: normalizeDate(firstString(record, ['dateDepot']) || dateFacture),
    lastStatusSyncAt: updatedAt,
    createdBy: 'chorus',
    updatedBy: 'chorus',
    createdAt: dateFacture,
    updatedAt,
  };
}

export default function InvoiceList() {
  const [searchParams] = useSearchParams();
  const initialStatus = searchParams.get('status') || '';
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState(initialStatus);
  const [formatFilter, setFormatFilter] = useState('');
  const [page, setPage] = useState(1);
  const [loadingChorusInvoices, setLoadingChorusInvoices] = useState(false);
  const [chorusInvoices, setChorusInvoices] = useState<Invoice[] | null>(null);
  const [chorusSuppliers, setChorusSuppliers] = useState<SupplierOrganization[]>([]);
  const [chorusCustomers, setChorusCustomers] = useState<PublicCustomer[]>([]);
  const [chorusSearchResult, setChorusSearchResult] = useState<ChorusSupplierInvoicesSearchResult | null>(null);
  const [chorusSearchError, setChorusSearchError] = useState<string | null>(null);
  const { data, loading, error } = useAsyncResource(
    async () => {
      const [invoices, suppliers, publicCustomers] = await Promise.all([
        getInvoices(),
        getSuppliers(),
        getPublicCustomers(),
      ]);

      return { invoices, suppliers, publicCustomers };
    },
    [],
    {
      invoices: [],
      suppliers: [],
      publicCustomers: [],
    },
  );

  const visibleInvoices = chorusInvoices ?? data.invoices;
  const supplierById = useMemo(
    () => new Map([...data.suppliers, ...chorusSuppliers].map((supplier) => [supplier.id, supplier])),
    [chorusSuppliers, data.suppliers],
  );
  const customerById = useMemo(
    () => new Map([...data.publicCustomers, ...chorusCustomers].map((customer) => [customer.id, customer])),
    [chorusCustomers, data.publicCustomers],
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
      ].some(v => v?.toLowerCase().includes(search.toLowerCase()));

      const matchStatus = !statusFilter || statusFilter.split(',').includes(inv.statusInternal);
      const matchFormat = !formatFilter || inv.sourceFormat === formatFilter;
      return matchSearch && matchStatus && matchFormat;
    });
  }, [customerById, formatFilter, search, statusFilter, supplierById, visibleInvoices]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const safePage = Math.min(page, Math.max(totalPages, 1));
  const paginated = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const exportCSV = () => {
    const headers = ['Numéro', 'Fournisseur', 'SIRET', 'Client', 'Date', 'Montant TTC', 'Statut'];
    const rows = filtered.map(inv => {
      const supplier = supplierById.get(inv.supplierOrganizationId);
      const customer = customerById.get(inv.publicCustomerId);
      return [inv.supplierInvoiceNumber, supplier?.legalName, supplier?.siret, customer?.legalName, inv.invoiceDate, inv.totalTtc, inv.statusInternal].join(';');
    });
    const csv = [headers.join(';'), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'factures-export.csv';
    a.click();
  };

  async function loadChorusSupplierInvoices() {
    setLoadingChorusInvoices(true);
    setChorusSearchError(null);

    try {
      const config = loadChorusConfig();
      const idFournisseur = Number(config.submissionSupplierId || FIXED_CHORUS_SUPPLIER_ID_TEXT);
      const client = new ChorusBackendAutomationClient(config);
      const result = await client.searchSupplierInvoices({ idFournisseur });
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

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Factures</h1>
          <p className="text-sm text-muted-foreground">
            {loading ? 'Chargement des factures...' : `${filtered.length} facture(s) trouvée(s)`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={loadChorusSupplierInvoices} disabled={loadingChorusInvoices}>
            {loadingChorusInvoices ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Server className="mr-2 h-4 w-4" />}
            Charger Chorus
          </Button>
          {chorusInvoices && (
            <Button variant="outline" onClick={() => { setChorusInvoices(null); setChorusSearchResult(null); setChorusSearchError(null); setPage(1); }}>
              <RefreshCw className="mr-2 h-4 w-4" /> Données locales
            </Button>
          )}
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
          </AlertDescription>
        </Alert>
      )}

      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap gap-3 items-center">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Rechercher par numéro, fournisseur, SIRET..." className="pl-9" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
            </div>
            <Select value={statusFilter} onValueChange={v => { setStatusFilter(v === 'all' ? '' : v); setPage(1); }}>
              <SelectTrigger className="w-[200px]"><Filter className="mr-2 h-4 w-4" /><SelectValue placeholder="Tous les statuts" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous les statuts</SelectItem>
                {allStatuses.map(s => <SelectItem key={s} value={s}>{s.replace(/_/g, ' ')}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={formatFilter} onValueChange={v => { setFormatFilter(v === 'all' ? '' : v); setPage(1); }}>
              <SelectTrigger className="w-[140px]"><SelectValue placeholder="Format" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous</SelectItem>
                <SelectItem value="PDF">PDF</SelectItem>
                <SelectItem value="XML">XML</SelectItem>
                <SelectItem value="FACTUR_X">Factur-X</SelectItem>
              </SelectContent>
            </Select>
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
                  <th className="text-left p-3 font-medium hidden md:table-cell">Date</th>
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
                      className={`border-b hover:bg-muted/20 transition-colors ${chorusInvoices ? '' : 'cursor-pointer'}`}
                      onClick={() => {
                        if (!chorusInvoices) {
                          window.location.href = `/invoices/${inv.id}`;
                        }
                      }}
                    >
                      <td className="p-3">
                        {chorusInvoices ? (
                          <Link
                            to={`/invoices/chorus/${encodeURIComponent(inv.id)}`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 font-medium text-accent hover:underline"
                            onClick={(event) => event.stopPropagation()}
                          >
                            {inv.supplierInvoiceNumber}
                            <ExternalLink className="h-3.5 w-3.5" />
                          </Link>
                        ) : (
                          <Link to={`/invoices/${inv.id}`} className="font-medium text-accent hover:underline">{inv.supplierInvoiceNumber}</Link>
                        )}
                      </td>
                      <td className="p-3">
                        <div>{supplier?.legalName}</div>
                        <div className="text-xs text-muted-foreground">{supplier?.siret}</div>
                      </td>
                      <td className="p-3 hidden lg:table-cell">{customer?.legalName}</td>
                      <td className="p-3 hidden md:table-cell">{formatDate(inv.invoiceDate)}</td>
                      <td className="p-3 text-right font-medium">{formatCurrency(inv.totalTtc)}</td>
                      <td className="p-3 hidden md:table-cell">
                        <span className="text-xs px-2 py-0.5 rounded bg-muted">{inv.sourceFormat}</span>
                      </td>
                      <td className="p-3"><StatusBadge status={inv.statusInternal} /></td>
                      <td className="p-3 text-xs text-muted-foreground hidden lg:table-cell">{formatDate(inv.updatedAt)}</td>
                    </tr>
                  );
                })}
                {paginated.length === 0 && (
                  <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">Aucune facture trouvée</td></tr>
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
