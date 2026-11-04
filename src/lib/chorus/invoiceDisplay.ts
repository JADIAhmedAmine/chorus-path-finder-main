import type { Invoice, PublicCustomer, SupplierOrganization } from '@/types';
import type { ReceptionInvoice } from '@/types/chorus';
import type { InvoiceBusinessContext } from '@/lib/chorus/invoiceStatusGuide';
import { getChorusRawStatusConfig } from '@/lib/status-utils';

export interface InvoiceDisplayModel {
  id: string;
  number: string;
  context: InvoiceBusinessContext;
  status: string;
  statusLabel: string;
  supplierName: string;
  supplierCode?: string;
  recipientName: string;
  recipientCode?: string;
  amountTtc: number;
  currency: string;
  dateLabel: string;
  date?: string;
  chorusId?: string;
  source: string;
  lastUpdated?: string;
  reason?: string;
  detailHref?: string;
  raw?: unknown;
}

function fallback(value: string | null | undefined, defaultValue = '—'): string {
  const trimmed = String(value ?? '').trim();
  return trimmed || defaultValue;
}

function stringOrUndefined(value: string | number | null | undefined): string | undefined {
  const trimmed = String(value ?? '').trim();
  return trimmed || undefined;
}

export function toDisplayInvoiceFromInvoice(
  invoice: Invoice,
  supplier?: SupplierOrganization,
  customer?: PublicCustomer,
  options: {
    context?: InvoiceBusinessContext;
    source?: string;
    detailHref?: string;
  } = {},
): InvoiceDisplayModel {
  const status = invoice.statusChorus || invoice.statusInternal;
  const context = options.context ?? 'emission';
  const source = options.source
    ?? (context === 'reception' ? 'Consultation valideur' : invoice.sourceFormat || invoice.depositMode || 'Suivi émission');

  return {
    id: invoice.id,
    number: fallback(invoice.supplierInvoiceNumber || invoice.chorusInvoiceNumber, invoice.id),
    context,
    status,
    statusLabel: getChorusRawStatusConfig(status).label,
    supplierName: fallback(supplier?.legalName || invoice.supplierChorusName),
    supplierCode: stringOrUndefined(supplier?.siret || invoice.supplierChorusCode),
    recipientName: fallback(customer?.legalName || invoice.recipientChorusName),
    recipientCode: stringOrUndefined(customer?.siret || customer?.codeDestinataire || invoice.recipientChorusCode),
    amountTtc: invoice.totalTtc,
    currency: fallback(invoice.currencyCode, 'EUR'),
    dateLabel: context === 'reception' ? 'Date de réception' : 'Date d’émission',
    date: invoice.invoiceDate || invoice.submittedAt || invoice.createdAt,
    chorusId: stringOrUndefined(invoice.chorusInvoiceNumber || invoice.externalReference),
    source,
    lastUpdated: invoice.lastStatusSyncAt || invoice.statusChangedAt || invoice.updatedAt,
    reason: stringOrUndefined(invoice.statusReasonLabel || invoice.statusReasonCode),
    detailHref: options.detailHref ?? `/invoices/chorus/${encodeURIComponent(invoice.id)}`,
    raw: invoice.rawPayload ?? invoice,
  };
}

export function toDisplayInvoiceFromReception(
  invoice: ReceptionInvoice,
  options: {
    source?: string;
    detailHref?: string;
  } = {},
): InvoiceDisplayModel {
  const id = String(invoice.identifiantFactureCPP ?? invoice.numeroFacture ?? 'reception');
  const status = invoice.statutFacture || 'STATUT_INCONNU';

  return {
    id,
    number: fallback(invoice.numeroFacture, id),
    context: 'reception',
    status,
    statusLabel: getChorusRawStatusConfig(status).label,
    supplierName: fallback(invoice.fournisseur?.raisonSociale),
    supplierCode: stringOrUndefined(invoice.fournisseur?.siret || invoice.fournisseur?.id || invoice.fournisseur?.code),
    recipientName: fallback(invoice.destinataire?.raisonSociale),
    recipientCode: stringOrUndefined(invoice.destinataire?.siret || invoice.destinataire?.id || invoice.destinataire?.code),
    amountTtc: invoice.montants.ttc,
    currency: fallback(invoice.montants.devise, 'EUR'),
    dateLabel: 'Date de réception',
    date: invoice.dates.dateDepot || invoice.dates.dateCreationFacture || invoice.dates.dateFacture || undefined,
    chorusId: stringOrUndefined(invoice.identifiantFactureCPP),
    source: options.source ?? 'Consultation valideur',
    lastUpdated: invoice.dates.dateCreationFacture || invoice.dates.dateDepot || undefined,
    reason: stringOrUndefined(invoice.commentaire),
    detailHref: options.detailHref ?? (invoice.identifiantFactureCPP ? `/invoices/reception/${invoice.identifiantFactureCPP}` : undefined),
    raw: invoice,
  };
}
