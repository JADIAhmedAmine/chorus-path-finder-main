import type { PublicCustomer, PublicService, SupplierOrganization } from '@/types';
import type { LocalInvoiceExtractionResult } from '@/lib/chorus/extraction';

export interface InvoiceDraftFormData {
  supplierOrganizationId: string;
  supplierInvoiceNumber: string;
  publicCustomerId: string;
  publicServiceId: string;
  engagementNumber: string;
  marketNumber: string;
  purchaseOrderNumber: string;
  invoiceDate: string;
  currencyCode: string;
  totalAmountHt: string;
  totalAmountTtc: string;
}

export interface InvoicePayloadContext {
  supplier?: Pick<SupplierOrganization, 'id' | 'legalName' | 'siret'>;
  publicCustomer?: Pick<PublicCustomer, 'id' | 'legalName' | 'siret' | 'codeDestinataire'>;
  publicService?: Pick<PublicService, 'id' | 'publicCustomerId' | 'codeServiceExecutant' | 'label'>;
  extraction?: LocalInvoiceExtractionResult | null;
}

function parseOptionalNumber(value: string): number | undefined {
  if (!value.trim()) {
    return undefined;
  }

  const sanitized = value.replace(/\s/g, '');
  const normalized = sanitized.includes(',') && !sanitized.includes('.')
    ? sanitized.replace(',', '.')
    : sanitized.replace(/,/g, '');
  const parsed = Number(normalized);

  return Number.isFinite(parsed) ? parsed : undefined;
}

export function buildInvoiceSubmissionPayload(
  formData: InvoiceDraftFormData,
  context: InvoicePayloadContext = {},
): Record<string, unknown> {
  const extractedFields = context.extraction?.fields;

  return {
    supplierOrganizationId: formData.supplierOrganizationId || undefined,
    supplierInvoiceNumber: formData.supplierInvoiceNumber || undefined,
    publicCustomerId: formData.publicCustomerId || undefined,
    publicServiceId: formData.publicServiceId || undefined,
    engagementNumber: formData.engagementNumber || undefined,
    marketNumber: formData.marketNumber || undefined,
    purchaseOrderNumber: formData.purchaseOrderNumber || undefined,
    invoiceDate: formData.invoiceDate || extractedFields?.invoiceDate || undefined,
    currencyCode: formData.currencyCode.toUpperCase() || extractedFields?.currencyCode || undefined,
    totalAmountHt: parseOptionalNumber(formData.totalAmountHt) ?? extractedFields?.totalAmountHt,
    totalAmountTtc: parseOptionalNumber(formData.totalAmountTtc) ?? extractedFields?.totalAmountTtc,
    supplierSiret: context.supplier?.siret || extractedFields?.supplierSiret || undefined,
    supplierName: context.supplier?.legalName || undefined,
    publicCustomerSiret: context.publicCustomer?.siret || extractedFields?.publicCustomerSiret || undefined,
    publicCustomerName: context.publicCustomer?.legalName || undefined,
    publicCustomerCodeDestinataire: context.publicCustomer?.codeDestinataire || extractedFields?.publicCustomerCode || undefined,
    publicServiceCode: context.publicService?.codeServiceExecutant || extractedFields?.publicServiceCode || undefined,
    publicServiceLabel: context.publicService?.label || undefined,
    sourceFormat: context.extraction?.sourceFormat || undefined,
    extractionConfidence: context.extraction?.confidence,
    requiresHumanReview: context.extraction?.requiresReview,
    submittedFrom: 'ui',
    requestedAt: new Date().toISOString(),
  };
}
