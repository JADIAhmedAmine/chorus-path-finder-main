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

function normalizeText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

export function parseInvoiceAmount(value: string | undefined): number | undefined {
  const trimmed = value?.trim();
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
    supplierName: fields.supplierName ?? currentDraft.supplierName,
    supplierVatNumber: fields.supplierVatNumber ?? currentDraft.supplierVatNumber,
    supplierInvoiceNumber: fields.supplierInvoiceNumber ?? currentDraft.supplierInvoiceNumber,
    publicCustomerId: fields.publicCustomerId ?? currentDraft.publicCustomerId,
    publicCustomerCode: fields.publicCustomerCode ?? currentDraft.publicCustomerCode,
    publicCustomerName: fields.publicCustomerName ?? currentDraft.publicCustomerName,
    publicServiceId: fields.publicServiceId ?? currentDraft.publicServiceId,
    publicServiceCode: fields.publicServiceCode ?? currentDraft.publicServiceCode,
    publicServiceLabel: fields.publicServiceLabel ?? currentDraft.publicServiceLabel,
    engagementNumber: fields.engagementNumber ?? currentDraft.engagementNumber,
    marketNumber: fields.marketNumber ?? currentDraft.marketNumber,
    purchaseOrderNumber: fields.purchaseOrderNumber ?? currentDraft.purchaseOrderNumber,
    invoiceDate: fields.invoiceDate ?? currentDraft.invoiceDate,
    dueDate: fields.dueDate ?? currentDraft.dueDate,
    currencyCode: fields.currencyCode ?? currentDraft.currencyCode,
    paymentMode: fields.paymentMode ?? currentDraft.paymentMode,
    totalAmountHt: fields.totalAmountHt !== undefined
      ? formatInvoiceAmountForInput(fields.totalAmountHt)
      : currentDraft.totalAmountHt,
    totalAmountTtc: fields.totalAmountTtc !== undefined
      ? formatInvoiceAmountForInput(fields.totalAmountTtc)
      : currentDraft.totalAmountTtc,
    totalVat: fields.totalVat ?? currentDraft.totalVat,
    customerReference: fields.customerReference ?? currentDraft.customerReference,
    lineItems: fields.lineItems ?? currentDraft.lineItems,
    vatLines: fields.vatLines ?? currentDraft.vatLines,
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
    supplierName: normalizeText(formData.supplierName) || context.supplier?.legalName || extractedFields?.supplierName,
    paymentMode: formData.paymentMode ?? extractedFields?.paymentMode,
    publicCustomerId: normalizeText(formData.publicCustomerId) || extractedFields?.publicCustomerId,
    publicServiceId: normalizeText(formData.publicServiceId) || extractedFields?.publicServiceId,
    engagementNumber: normalizeText(formData.engagementNumber) || extractedFields?.engagementNumber,
    marketNumber: normalizeText(formData.marketNumber) || extractedFields?.marketNumber,
    purchaseOrderNumber: normalizeText(formData.purchaseOrderNumber) || extractedFields?.purchaseOrderNumber,
    invoiceDate: normalizeText(formData.invoiceDate) || extractedFields?.invoiceDate,
    dueDate: normalizeText(formData.dueDate) || extractedFields?.dueDate,
    currencyCode: normalizeText(formData.currencyCode)?.toUpperCase() || extractedFields?.currencyCode || 'EUR',
    totalAmountHt: parseInvoiceAmount(formData.totalAmountHt) ?? extractedFields?.totalAmountHt,
    totalVat: formData.totalVat ?? extractedFields?.totalVat,
    totalAmountTtc: parseInvoiceAmount(formData.totalAmountTtc) ?? extractedFields?.totalAmountTtc,
    supplierSiret: normalizeText(formData.supplierSiret)?.replace(/\D/g, '') || context.supplier?.siret || extractedFields?.supplierSiret,
    supplierVatNumber: normalizeText(formData.supplierVatNumber) || extractedFields?.supplierVatNumber,
    publicCustomerSiret: context.publicCustomer?.siret || extractedFields?.publicCustomerSiret,
    publicCustomerName: normalizeText(formData.publicCustomerName) || context.publicCustomer?.legalName || extractedFields?.publicCustomerName,
    publicCustomerCode: normalizeText(formData.publicCustomerCode) || context.publicCustomer?.codeDestinataire || extractedFields?.publicCustomerCode,
    publicServiceCode: normalizeText(formData.publicServiceCode) || context.publicService?.codeServiceExecutant || extractedFields?.publicServiceCode,
    publicServiceLabel: normalizeText(formData.publicServiceLabel) || context.publicService?.label || extractedFields?.publicServiceLabel,
    customerReference: normalizeText(formData.customerReference) || extractedFields?.customerReference,
    lineItems: formData.lineItems ?? extractedFields?.lineItems,
    vatLines: formData.vatLines ?? extractedFields?.vatLines,
    sourceFormat: context.extraction?.sourceFormat,
    extractionConfidence: context.extraction?.confidence,
    requiresHumanReview: context.extraction?.requiresReview,
  };
}
