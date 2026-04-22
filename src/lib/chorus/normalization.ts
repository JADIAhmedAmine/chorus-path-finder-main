import type {
  InvoiceDraftFormData,
  InvoiceDraftNormalizationContext,
  LocalInvoiceExtractionResult,
  NormalizedInvoiceDraftData,
} from '@/lib/chorus/types';

export function createEmptyInvoiceDraft(): InvoiceDraftFormData {
  return {
    supplierOrganizationId: '',
    supplierSiret: '',
    supplierInvoiceNumber: '',
    publicCustomerId: '',
    publicCustomerCode: '',
    publicServiceId: '',
    publicServiceCode: '',
    engagementNumber: '',
    marketNumber: '',
    purchaseOrderNumber: '',
    invoiceDate: '',
    currencyCode: 'EUR',
    totalAmountHt: '',
    totalAmountTtc: '',
  };
}

export function formatInvoiceAmountForInput(value?: number): string {
  if (value === undefined || Number.isNaN(value)) {
    return '';
  }

  return value.toFixed(2).replace('.', ',');
}

function normalizeText(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed || undefined;
}

export function parseInvoiceAmount(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const sanitized = trimmed.replace(/\s/g, '');
  const normalized = sanitized.includes(',') && !sanitized.includes('.')
    ? sanitized.replace(',', '.')
    : sanitized.replace(/,/g, '');
  const parsed = Number(normalized);

  return Number.isFinite(parsed) ? parsed : undefined;
}

export function mergeExtractionIntoDraft(
  currentDraft: InvoiceDraftFormData,
  extractionResult: LocalInvoiceExtractionResult,
): InvoiceDraftFormData {
  const { fields } = extractionResult;

  return {
    ...currentDraft,
    supplierOrganizationId: fields.supplierOrganizationId ?? currentDraft.supplierOrganizationId,
    supplierSiret: fields.supplierSiret ?? currentDraft.supplierSiret,
    supplierInvoiceNumber: fields.supplierInvoiceNumber ?? currentDraft.supplierInvoiceNumber,
    publicCustomerId: fields.publicCustomerId ?? currentDraft.publicCustomerId,
    publicCustomerCode: fields.publicCustomerCode ?? currentDraft.publicCustomerCode,
    publicServiceId: fields.publicServiceId ?? currentDraft.publicServiceId,
    publicServiceCode: fields.publicServiceCode ?? currentDraft.publicServiceCode,
    engagementNumber: fields.engagementNumber ?? currentDraft.engagementNumber,
    marketNumber: fields.marketNumber ?? currentDraft.marketNumber,
    purchaseOrderNumber: fields.purchaseOrderNumber ?? currentDraft.purchaseOrderNumber,
    invoiceDate: fields.invoiceDate ?? currentDraft.invoiceDate,
    currencyCode: fields.currencyCode ?? currentDraft.currencyCode,
    totalAmountHt: fields.totalAmountHt !== undefined
      ? formatInvoiceAmountForInput(fields.totalAmountHt)
      : currentDraft.totalAmountHt,
    totalAmountTtc: fields.totalAmountTtc !== undefined
      ? formatInvoiceAmountForInput(fields.totalAmountTtc)
      : currentDraft.totalAmountTtc,
  };
}

export function normalizeInvoiceDraft(
  formData: InvoiceDraftFormData,
  context: InvoiceDraftNormalizationContext = {},
): NormalizedInvoiceDraftData {
  const extractedFields = context.extraction?.fields;

  return {
    supplierOrganizationId: normalizeText(formData.supplierOrganizationId) || extractedFields?.supplierOrganizationId,
    supplierInvoiceNumber: normalizeText(formData.supplierInvoiceNumber) || extractedFields?.supplierInvoiceNumber,
    supplierName: context.supplier?.legalName || extractedFields?.supplierName,
    paymentMode: extractedFields?.paymentMode,
    publicCustomerId: normalizeText(formData.publicCustomerId) || extractedFields?.publicCustomerId,
    publicServiceId: normalizeText(formData.publicServiceId) || extractedFields?.publicServiceId,
    engagementNumber: normalizeText(formData.engagementNumber) || extractedFields?.engagementNumber,
    marketNumber: normalizeText(formData.marketNumber) || extractedFields?.marketNumber,
    purchaseOrderNumber: normalizeText(formData.purchaseOrderNumber) || extractedFields?.purchaseOrderNumber,
    invoiceDate: normalizeText(formData.invoiceDate) || extractedFields?.invoiceDate,
    dueDate: extractedFields?.dueDate,
    currencyCode: normalizeText(formData.currencyCode)?.toUpperCase() || extractedFields?.currencyCode || 'EUR',
    totalAmountHt: parseInvoiceAmount(formData.totalAmountHt) ?? extractedFields?.totalAmountHt,
    totalVat: extractedFields?.totalVat,
    totalAmountTtc: parseInvoiceAmount(formData.totalAmountTtc) ?? extractedFields?.totalAmountTtc,
    supplierSiret: normalizeText(formData.supplierSiret)?.replace(/\D/g, '') || context.supplier?.siret || extractedFields?.supplierSiret,
    supplierVatNumber: extractedFields?.supplierVatNumber,
    publicCustomerSiret: context.publicCustomer?.siret || extractedFields?.publicCustomerSiret,
    publicCustomerName: context.publicCustomer?.legalName || extractedFields?.publicCustomerName,
    publicCustomerCode: normalizeText(formData.publicCustomerCode) || context.publicCustomer?.codeDestinataire || extractedFields?.publicCustomerCode,
    publicServiceCode: normalizeText(formData.publicServiceCode) || context.publicService?.codeServiceExecutant || extractedFields?.publicServiceCode,
    publicServiceLabel: context.publicService?.label || extractedFields?.publicServiceLabel,
    customerReference: extractedFields?.customerReference,
    lineItems: extractedFields?.lineItems,
    vatLines: extractedFields?.vatLines,
    sourceFormat: context.extraction?.sourceFormat,
    extractionConfidence: context.extraction?.confidence,
    requiresHumanReview: context.extraction?.requiresReview,
  };
}
