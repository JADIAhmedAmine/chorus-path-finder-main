import { loadAuthSession } from '@/lib/auth/session';
import { createChorusConnector, ChorusSubmitApiError } from '@/lib/chorus/client';
import { buildInvoiceSubmissionPayload } from '@/lib/chorus/mappers';
import { formatInvoiceAmountForInput, normalizeInvoiceDraft } from '@/lib/chorus/normalization';
import { loadChorusConfig, resolveChorusRuntimeConfig } from '@/lib/chorus/storage';
import { buildChorusTechnicalContext } from '@/lib/chorus/technicalContext';
import { ChorusTransversesClient } from '@/lib/chorus/transversesClient';
import { validateChorusSubmissionPayload } from '@/lib/chorus/validateSubmissionPayload';
import { resolveAndHydrateChorusSubmissionPayload } from '@/lib/chorus/hydrateSubmissionPayload';
import type { InvoiceDraftFormData } from '@/lib/chorus/types';
import {
  appendInvoiceApiLog,
  appendInvoiceAuditLog,
  appendInvoiceStatusHistory,
  upsertInvoiceRuntimePatch,
} from '@/data/invoice-runtime-state';
import {
  getCustomer,
  getInvoice,
  getInvoiceAttachments,
  getInvoiceLines,
  getService,
  getSupplier,
  invalidateDataCache,
} from '@/data/mock-data';
import type { ChorusApiDebugEntry, ChorusSubmitInvoiceResult } from '@/types/chorus';
import type { ApiExchangeLog, AuditLog, Invoice, InvoiceAttachment, InvoiceStatusHistory } from '@/types';

const SAMPLE_PDF_PATH = '/test-data/facture_prototype_chorus_test.pdf';

function nowIso(): string {
  return new Date().toISOString();
}

function getActorId(): string {
  const session = loadAuthSession();
  return session?.email || session?.chorusCurrentUserId || 'user-local';
}

function buildDraftFromInvoice(invoice: Invoice): InvoiceDraftFormData {
  return {
    supplierOrganizationId: invoice.supplierOrganizationId,
    supplierSiret: '',
    supplierName: '',
    supplierVatNumber: '',
    supplierInvoiceNumber: invoice.supplierInvoiceNumber,
    publicCustomerId: invoice.publicCustomerId,
    publicCustomerCode: '',
    publicCustomerName: '',
    publicServiceId: invoice.publicServiceId ?? '',
    publicServiceCode: '',
    publicServiceLabel: '',
    engagementNumber: invoice.engagementNumber ?? '',
    marketNumber: invoice.marketNumber ?? '',
    purchaseOrderNumber: invoice.purchaseOrderNumber ?? '',
    invoiceDate: invoice.invoiceDate,
    dueDate: invoice.dueDate ?? '',
    currencyCode: invoice.currencyCode || 'EUR',
    paymentMode: undefined,
    totalAmountHt: formatInvoiceAmountForInput(invoice.totalHt),
    totalAmountTtc: formatInvoiceAmountForInput(invoice.totalTtc),
  };
}

async function resolveInvoiceSubmissionContext(invoiceId: string) {
  const invoice = await getInvoice(invoiceId);
  if (!invoice) {
    throw new Error('Facture introuvable.');
  }

  const [supplier, publicCustomer, publicService, attachments, invoiceLines] = await Promise.all([
    getSupplier(invoice.supplierOrganizationId),
    getCustomer(invoice.publicCustomerId),
    invoice.publicServiceId ? getService(invoice.publicServiceId) : Promise.resolve(undefined),
    getInvoiceAttachments(invoice.id),
    getInvoiceLines(invoice.id),
  ]);

  return {
    invoice,
    supplier,
    publicCustomer,
    publicService,
    attachments,
    invoiceLines,
    formData: buildDraftFromInvoice(invoice),
  };
}

function buildHistoryEntry(
  invoice: Invoice,
  newStatus: Invoice['statusInternal'],
  eventCode: string,
  eventLabel: string,
  source: InvoiceStatusHistory['source'] = 'USER',
): InvoiceStatusHistory {
  return {
    id: `runtime-history-${invoice.id}-${eventCode}-${Date.now()}`,
    tenantId: invoice.tenantId,
    invoiceId: invoice.id,
    source,
    previousStatus: invoice.statusInternal,
    newStatus,
    eventCode,
    eventLabel,
    rawSnapshot: {
      invoiceId: invoice.id,
      previousStatus: invoice.statusInternal,
      newStatus,
    },
    occurredAt: nowIso(),
  };
}

function buildAuditEntry(invoice: Invoice, actionCode: string, diff: Record<string, unknown>): AuditLog {
  return {
    id: `runtime-audit-${invoice.id}-${actionCode}-${Date.now()}`,
    tenantId: invoice.tenantId,
    actorType: 'USER',
    actorId: getActorId(),
    actionCode,
    entityType: 'INVOICE',
    entityId: invoice.id,
    diff,
    ipAddress: '127.0.0.1',
    userAgent: 'FacturX Pro UI',
    createdAt: nowIso(),
  };
}

function buildApiLogEntries(
  invoice: Invoice,
  apiCalls: ChorusApiDebugEntry[],
  success: boolean,
): ApiExchangeLog[] {
  return apiCalls.map((call, index) => ({
    id: `runtime-api-${invoice.id}-${Date.now()}-${index + 1}`,
    tenantId: invoice.tenantId,
    invoiceId: invoice.id,
    targetSystem: 'CHORUS_PRO',
    operationName: call.label,
    correlationId: `runtime-${invoice.id}-${Date.now()}-${index + 1}`,
    direction: 'OUTBOUND',
    httpStatus: call.responseStatus,
    businessCode: undefined,
    businessMessage: success ? 'Appel déclenché depuis la page détail.' : 'Appel en échec depuis la page détail.',
    requestHeadersRedacted: JSON.stringify({ method: call.method, url: call.url }),
    requestBodyRedacted: call.requestBody ? JSON.stringify(call.requestBody) : undefined,
    responseHeadersRedacted: undefined,
    responseBodyRedacted: call.responseBody ? JSON.stringify(call.responseBody) : undefined,
    latencyMs: undefined,
    success: success && (call.responseStatus == null || call.responseStatus < 400),
    createdAt: nowIso(),
  }));
}

async function fetchAttachmentFile(attachment?: InvoiceAttachment): Promise<File> {
  const requestUrl = attachment?.storageKey || SAMPLE_PDF_PATH;
  const response = await fetch(requestUrl);

  if (!response.ok) {
    throw new Error(`Fichier source introuvable pour la soumission (${response.status}).`);
  }

  const blob = await response.blob();
  const inferredType = attachment?.mimeType || blob.type || 'application/pdf';
  const filename = attachment?.filename || 'facture_prototype_chorus_test.pdf';
  return new File([blob], filename, { type: inferredType });
}

function refreshInvoiceCaches(invoiceId: string): void {
  invalidateDataCache([
    'invoices',
    `statusHistory:${invoiceId}`,
    'statusHistory:all',
    `apiExchangeLogs:${invoiceId}`,
    'apiExchangeLogs:all',
    `auditLogs:${invoiceId}`,
    'auditLogs:all',
  ]);
}

function extractChorusSubmissionStatus(response: unknown): string {
  if (response && typeof response === 'object') {
    const record = response as Record<string, unknown>;
    const status = record.statutCourant ?? record.statutFacture;
    if (typeof status === 'string' && status.trim()) {
      return status.trim();
    }
  }

  return 'DEPOSEE';
}

export async function markInvoiceReadyForSubmission(invoiceId: string): Promise<Invoice> {
  const invoice = await getInvoice(invoiceId);
  if (!invoice) {
    throw new Error('Facture introuvable.');
  }

  if (invoice.statusInternal === 'READY_FOR_SUBMISSION') {
    return invoice;
  }

  const updatedAt = nowIso();
  upsertInvoiceRuntimePatch(invoice.id, {
    statusInternal: 'READY_FOR_SUBMISSION',
    requiresHumanReview: false,
    updatedAt,
    updatedBy: getActorId(),
  });
  appendInvoiceStatusHistory(
    invoice.id,
    buildHistoryEntry(invoice, 'READY_FOR_SUBMISSION', 'MANUAL_VALIDATION', 'Facture validée pour soumission'),
  );
  appendInvoiceAuditLog(
    invoice.id,
    buildAuditEntry(invoice, 'INVOICE_VALIDATED_FOR_SUBMISSION', {
      previousStatus: invoice.statusInternal,
      newStatus: 'READY_FOR_SUBMISSION',
    }),
  );
  refreshInvoiceCaches(invoice.id);

  return {
    ...invoice,
    statusInternal: 'READY_FOR_SUBMISSION',
    requiresHumanReview: false,
    updatedAt,
    updatedBy: getActorId(),
  };
}

export async function submitInvoiceFromDetail(invoiceId: string): Promise<ChorusSubmitInvoiceResult> {
  const { invoice, supplier, publicCustomer, publicService, attachments, invoiceLines, formData } = await resolveInvoiceSubmissionContext(invoiceId);
  const rawConfig = loadChorusConfig();
  const chorusConfig = resolveChorusRuntimeConfig(rawConfig);
  const chorusTechnicalContext = {
    ...buildChorusTechnicalContext(chorusConfig),
    lineItems: invoiceLines.map((line) => ({
      description: line.description,
      reference: line.description,
      quantity: line.quantity,
      unit: line.unitCode,
      unitPriceHt: line.unitPriceHt,
      totalHt: line.lineTotalHt,
      vatRate: line.vatRate > 1 ? line.vatRate / 100 : line.vatRate,
    })),
    vatLines: invoice.totalVat > 0 ? [{
      rate: invoice.totalHt > 0 ? invoice.totalVat / invoice.totalHt : undefined,
      baseHt: invoice.totalHt,
      taxAmount: invoice.totalVat,
    }] : [],
  };
  const normalizedDraft = normalizeInvoiceDraft(formData, {
    supplier,
    publicCustomer,
    publicService,
    availableServices: publicService ? [publicService] : [],
    extraction: null,
  });

  let payload = buildInvoiceSubmissionPayload(formData, {
    supplier,
    publicCustomer,
    publicService,
    availableServices: publicService ? [publicService] : [],
    chorus: chorusTechnicalContext,
    mainFileName: attachments.find((attachment) => attachment.attachmentRole === 'MAIN')?.filename,
  });

  if (chorusConfig.mode === 'direct' && chorusConfig.enabled) {
    const transversesClient = new ChorusTransversesClient(chorusConfig);
    const hydrationResult = await resolveAndHydrateChorusSubmissionPayload(
      transversesClient,
      payload,
      normalizedDraft,
    );
    payload = hydrationResult.payload;
  }

  const validation = validateChorusSubmissionPayload(payload);
  if (!validation.valid) {
    throw new Error(validation.errors[0]?.message || 'Payload Chorus invalide.');
  }

  const connector = createChorusConnector(chorusConfig);
  const mainAttachment = attachments.find((attachment) => attachment.attachmentRole === 'MAIN');
  const mainFile = await fetchAttachmentFile(mainAttachment);

  try {
    const result = await connector.submitInvoice({
      invoiceData: payload,
      mainFile,
      attachments: [],
    });

    const submittedAt = nowIso();
    upsertInvoiceRuntimePatch(invoice.id, {
      statusInternal: 'SUBMITTED_TO_CHORUS',
      statusChorus: extractChorusSubmissionStatus(result.response),
      chorusInvoiceNumber: result.externalId || invoice.chorusInvoiceNumber,
      submittedAt,
      lastStatusSyncAt: submittedAt,
      updatedAt: submittedAt,
      updatedBy: getActorId(),
    });
    appendInvoiceStatusHistory(
      invoice.id,
      buildHistoryEntry(invoice, 'SUBMITTED_TO_CHORUS', 'SUBMITTED_FROM_DETAIL', 'Facture soumise depuis la page détail', 'USER'),
    );
    for (const apiLog of buildApiLogEntries(invoice, result.apiCalls, true)) {
      appendInvoiceApiLog(invoice.id, apiLog);
    }
    appendInvoiceAuditLog(
      invoice.id,
      buildAuditEntry(invoice, 'INVOICE_SUBMITTED', {
        previousStatus: invoice.statusInternal,
        newStatus: 'SUBMITTED_TO_CHORUS',
        externalId: result.externalId ?? null,
      }),
    );
    refreshInvoiceCaches(invoice.id);
    return result;
  } catch (error) {
    if (error instanceof ChorusSubmitApiError) {
      for (const apiLog of buildApiLogEntries(invoice, error.apiCalls, false)) {
        appendInvoiceApiLog(invoice.id, apiLog);
      }
      appendInvoiceAuditLog(
        invoice.id,
        buildAuditEntry(invoice, 'INVOICE_SUBMISSION_FAILED', {
          previousStatus: invoice.statusInternal,
          error: error.message,
        }),
      );
      refreshInvoiceCaches(invoice.id);
    }

    throw error;
  }
}
