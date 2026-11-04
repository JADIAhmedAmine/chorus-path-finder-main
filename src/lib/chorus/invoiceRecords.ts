import type { Invoice, InvoiceStatusInternal, PublicCustomer, SupplierOrganization } from '@/types';
import type { ChorusSupplierInvoicesSearchResult } from '@/lib/chorus/backendAutomation';
import { saveChorusLiveInvoiceDetails } from '@/lib/chorus/liveInvoiceDetails';

const CHORUS_TENANT_ID = 'chorus-live';

export interface NormalizedChorusInvoiceSearch {
  idFournisseur: number;
  fetchedAt: string;
  invoices: Invoice[];
  supplier: SupplierOrganization;
  customers: PublicCustomer[];
}

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

function extractChorusStatusReason(record: Record<string, unknown>): { code?: string; label?: string } {
  const code = firstString(record, [
    'statusReasonCode',
    'codeMotifRejet',
    'codeRejet',
    'motifRejetCode',
    'codeEtatCourant',
  ]);
  const label = firstString(record, [
    'statusReasonLabel',
    'commentaireEtatCourant',
    'commentaireStatutCourant',
    'commentaireEtat',
    'motifRejet',
    'motifRefus',
    'libelleMotifRejet',
    'messageRejet',
  ]);

  return {
    code: code || undefined,
    label: label || undefined,
  };
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

function normalizeChorusStatus(value: string): InvoiceStatusInternal {
  const normalized = value.toUpperCase();
  if (normalized.includes('PAY') || normalized.includes('MISE_EN_PAIEMENT')) {
    return 'PAID';
  }
  if (normalized.includes('TECHNIQUE')) {
    return 'REJECTED_TECHNICAL';
  }
  if (
    normalized.includes('REJET')
    || normalized.includes('REFUS')
    || normalized.includes('NON_CONFORME')
    || normalized.includes('ERREUR')
    || normalized.includes('ABANDON')
    || normalized.includes('SUPPRIM')
  ) {
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

export function buildChorusSupplier(idFournisseur: number, records: unknown[]): SupplierOrganization {
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

  return {
    id: `chorus-customer-${safeIdentifier(stableKey)}`,
    code,
    legalName: legalName || `Destinataire ${stableKey}`,
    siret: code.replace(/\D/g, '').length === 14 ? code.replace(/\D/g, '') : '',
  };
}

export function buildChorusCustomer(item: unknown, index: number): PublicCustomer {
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

export function buildChorusCustomers(records: unknown[]): PublicCustomer[] {
  const customersById = new Map<string, PublicCustomer>();

  records.forEach((item, index) => {
    const customer = buildChorusCustomer(item, index);
    customersById.set(customer.id, customer);
  });

  return [...customersById.values()];
}

export function normalizeChorusInvoiceRecord(
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
  const statusReason = extractChorusStatusReason(record);
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
    statusReasonCode: statusReason.code,
    statusReasonLabel: statusReason.label,
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

export function normalizeChorusInvoiceSearch(
  result: ChorusSupplierInvoicesSearchResult,
  fallbackSupplierId: number,
): NormalizedChorusInvoiceSearch {
  const idFournisseur = result.idFournisseur || fallbackSupplierId;
  const invoices = result.invoices.map((item, index) => normalizeChorusInvoiceRecord(item, index, idFournisseur));
  const supplier = buildChorusSupplier(idFournisseur, result.invoices);
  const customers = buildChorusCustomers(result.invoices);
  const fetchedAt = new Date().toISOString();

  saveChorusLiveInvoiceDetails(invoices.map((invoice, index) => ({
    id: invoice.id,
    invoice,
    supplier,
    customer: buildChorusCustomer(result.invoices[index], index),
    raw: result.invoices[index],
    search: {
      idFournisseur,
      fetchedAt,
      total: result.total,
      returned: result.returned,
      requestedPageSize: result.requestedPageSize,
      payload: result.payload,
    },
  })));

  return {
    idFournisseur,
    fetchedAt,
    invoices,
    supplier,
    customers,
  };
}
