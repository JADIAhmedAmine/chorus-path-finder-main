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

function normalizeSiret(value: string | undefined): string | undefined {
  const digits = value?.replace(/\D/g, '') ?? '';
  return digits.length === 14 ? digits : undefined;
}

function normalizeLookup(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? '';
}

function isPlaceholderServiceCode(value: string | undefined): boolean {
  const normalized = value?.trim();
  return normalized === '0' || normalized === '00' || normalized === '01';
}

function normalizeServiceCode(value: string | undefined): string | undefined {
  const normalized = normalizeText(value);
  if (!normalized || isPlaceholderServiceCode(normalized)) {
    return undefined;
  }
  return normalized;
}

function resolvePublicCustomerCode(fields: LocalInvoiceExtractionResult['fields']): string | undefined {
  const destinationCode = normalizeText(fields.publicCustomerCode);
  if (destinationCode && /^\d+$/.test(destinationCode)) {
    return destinationCode;
  }

  return normalizeSiret(fields.publicCustomerSiret);
}

function resolvePublicServiceCode(
  formData: InvoiceDraftFormData,
  context: InvoiceDraftNormalizationContext,
  fields: LocalInvoiceExtractionResult['fields'] | undefined,
): string | undefined {
  const manualCode = normalizeServiceCode(formData.publicServiceCode);
  if (manualCode) {
    return manualCode;
  }

  if (context.publicService?.codeServiceExecutant) {
    return context.publicService.codeServiceExecutant;
  }

  const detectedCode = normalizeServiceCode(fields?.publicServiceCode);
  const detectedLabel = normalizeLookup(fields?.publicServiceLabel);
  if (!detectedCode && !detectedLabel) {
    return undefined;
  }

  const matchedService = (context.availableServices ?? []).find((service) => {
    const serviceCode = normalizeLookup(service.codeServiceExecutant);
    const serviceLabel = normalizeLookup(service.label);
    return Boolean(
      (detectedCode && serviceCode === normalizeLookup(detectedCode))
        || (detectedLabel && serviceLabel === detectedLabel),
    );
  });

  return matchedService?.codeServiceExecutant;
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
    supplierSiret: normalizeSiret(fields.supplierSiret) ?? currentDraft.supplierSiret,
    supplierName: fields.supplierName ?? currentDraft.supplierName,
    supplierVatNumber: fields.supplierVatNumber ?? currentDraft.supplierVatNumber,
    supplierInvoiceNumber: fields.supplierInvoiceNumber ?? currentDraft.supplierInvoiceNumber,
    publicCustomerId: fields.publicCustomerId ?? currentDraft.publicCustomerId,
    publicCustomerCode: resolvePublicCustomerCode(fields) ?? currentDraft.publicCustomerCode,
    publicCustomerName: fields.publicCustomerName ?? currentDraft.publicCustomerName,
    publicServiceId: fields.publicServiceId ?? currentDraft.publicServiceId,
    publicServiceCode: normalizeServiceCode(fields.publicServiceCode) ?? normalizeServiceCode(currentDraft.publicServiceCode),
    publicServiceLabel: normalizeServiceCode(fields.publicServiceLabel) ?? normalizeServiceCode(currentDraft.publicServiceLabel),
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
    supplierSiret: normalizeSiret(formData.supplierSiret) || context.supplier?.siret || normalizeSiret(extractedFields?.supplierSiret),
    supplierVatNumber: normalizeText(formData.supplierVatNumber) || extractedFields?.supplierVatNumber,
    publicCustomerSiret: context.publicCustomer?.siret || normalizeSiret(extractedFields?.publicCustomerSiret),
    publicCustomerName: normalizeText(formData.publicCustomerName) || context.publicCustomer?.legalName || extractedFields?.publicCustomerName,
    publicCustomerCode: normalizeText(formData.publicCustomerCode)
      || context.publicCustomer?.codeDestinataire
      || (extractedFields ? resolvePublicCustomerCode(extractedFields) : undefined),
    publicServiceCode: resolvePublicServiceCode(formData, context, extractedFields),
    publicServiceLabel: normalizeServiceCode(formData.publicServiceLabel)
      || context.publicService?.label
      || normalizeServiceCode(extractedFields?.publicServiceLabel),
    customerReference: normalizeText(formData.customerReference) || extractedFields?.customerReference,
    lineItems: formData.lineItems ?? extractedFields?.lineItems,
    vatLines: formData.vatLines ?? extractedFields?.vatLines,
    sourceFormat: context.extraction?.sourceFormat,
    extractionConfidence: context.extraction?.confidence,
    requiresHumanReview: context.extraction?.requiresReview,
  };
}
