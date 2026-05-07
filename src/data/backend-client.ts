import type {
  ApiExchangeLog,
  AsyncJob,
  AuditLog,
  Invoice,
  InvoiceAttachment,
  InvoiceExtractionResult,
  InvoiceLine,
  InvoiceStatusHistory,
  PublicCustomer,
  PublicService,
  SourceFormat,
  SupplierOrganization,
  Tenant,
  User,
} from '@/types';
import { authHeaders, clearAuthSession, loadAuthSession } from '@/lib/auth/session';

export interface BackendDataApiConfig {
  baseUrl: string;
  tenantPath: string;
  currentUserPath: string;
  suppliersPath: string;
  publicCustomersPath: string;
  publicServicesPath: string;
  invoicesPath: string;
  invoiceLinesPath: string;
  invoiceAttachmentsPath: string;
  statusHistoryPath: string;
  apiExchangeLogsPath: string;
  asyncJobsPath: string;
  auditLogsPath: string;
  extractionResultsPath: string;
}

const DATA_API_ENV_KEYS = [
  'VITE_DATA_API_BASE_URL',
  'VITE_DATA_TENANT_PATH',
  'VITE_DATA_CURRENT_USER_PATH',
  'VITE_DATA_SUPPLIERS_PATH',
  'VITE_DATA_PUBLIC_CUSTOMERS_PATH',
  'VITE_DATA_PUBLIC_SERVICES_PATH',
  'VITE_DATA_INVOICES_PATH',
  'VITE_DATA_INVOICE_LINES_PATH',
  'VITE_DATA_INVOICE_ATTACHMENTS_PATH',
  'VITE_DATA_STATUS_HISTORY_PATH',
  'VITE_DATA_API_EXCHANGE_LOGS_PATH',
  'VITE_DATA_ASYNC_JOBS_PATH',
  'VITE_DATA_AUDIT_LOGS_PATH',
  'VITE_DATA_EXTRACTION_RESULTS_PATH',
] as const;

const LOCAL_TEST_DATA_CONFIG: BackendDataApiConfig = {
  baseUrl: '',
  tenantPath: '/test-data/tenant.current.json',
  currentUserPath: '/test-data/users.me.json',
  suppliersPath: '/test-data/suppliers.json',
  publicCustomersPath: '/test-data/public-customers.json',
  publicServicesPath: '/test-data/public-services.json',
  invoicesPath: '/test-data/invoices.json',
  invoiceLinesPath: '/test-data/invoice-lines.json',
  invoiceAttachmentsPath: '/test-data/invoice-attachments.json',
  statusHistoryPath: '/test-data/invoice-status-history.json',
  apiExchangeLogsPath: '/test-data/api-exchange-logs.json',
  asyncJobsPath: '/test-data/async-jobs.json',
  auditLogsPath: '/test-data/audit-logs.json',
  extractionResultsPath: '/test-data/invoice-extraction-results.json',
};

const REMOTE_BACKEND_CONFIG: BackendDataApiConfig = {
  baseUrl: '/api',
  tenantPath: '/tenant/current',
  currentUserPath: '/users/me',
  suppliersPath: '/suppliers',
  publicCustomersPath: '/public-customers',
  publicServicesPath: '/public-services',
  invoicesPath: '/invoices',
  invoiceLinesPath: '/invoice-lines',
  invoiceAttachmentsPath: '/invoice-attachments',
  statusHistoryPath: '/invoice-status-history',
  apiExchangeLogsPath: '/api-exchange-logs',
  asyncJobsPath: '/async-jobs',
  auditLogsPath: '/audit-logs',
  extractionResultsPath: '/invoice-extraction-results',
};

function envValue(key: string, fallback: string): string {
  const raw = import.meta.env[key];
  return typeof raw === 'string' && raw.trim().length > 0 ? raw : fallback;
}

function hasConfiguredDataBackend(): boolean {
  return DATA_API_ENV_KEYS.some((key) => {
    const raw = import.meta.env[key];
    return typeof raw === 'string' && raw.trim().length > 0;
  });
}

export function loadBackendDataApiConfig(): BackendDataApiConfig {
  const defaults = hasConfiguredDataBackend() ? REMOTE_BACKEND_CONFIG : LOCAL_TEST_DATA_CONFIG;

  return {
    baseUrl: envValue('VITE_DATA_API_BASE_URL', defaults.baseUrl),
    tenantPath: envValue('VITE_DATA_TENANT_PATH', defaults.tenantPath),
    currentUserPath: envValue('VITE_DATA_CURRENT_USER_PATH', defaults.currentUserPath),
    suppliersPath: envValue('VITE_DATA_SUPPLIERS_PATH', defaults.suppliersPath),
    publicCustomersPath: envValue('VITE_DATA_PUBLIC_CUSTOMERS_PATH', defaults.publicCustomersPath),
    publicServicesPath: envValue('VITE_DATA_PUBLIC_SERVICES_PATH', defaults.publicServicesPath),
    invoicesPath: envValue('VITE_DATA_INVOICES_PATH', defaults.invoicesPath),
    invoiceLinesPath: envValue('VITE_DATA_INVOICE_LINES_PATH', defaults.invoiceLinesPath),
    invoiceAttachmentsPath: envValue('VITE_DATA_INVOICE_ATTACHMENTS_PATH', defaults.invoiceAttachmentsPath),
    statusHistoryPath: envValue('VITE_DATA_STATUS_HISTORY_PATH', defaults.statusHistoryPath),
    apiExchangeLogsPath: envValue('VITE_DATA_API_EXCHANGE_LOGS_PATH', defaults.apiExchangeLogsPath),
    asyncJobsPath: envValue('VITE_DATA_ASYNC_JOBS_PATH', defaults.asyncJobsPath),
    auditLogsPath: envValue('VITE_DATA_AUDIT_LOGS_PATH', defaults.auditLogsPath),
    extractionResultsPath: envValue('VITE_DATA_EXTRACTION_RESULTS_PATH', defaults.extractionResultsPath),
  };
}

function getDefaultFetchImpl(): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init)) as typeof fetch;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function joinUrl(baseUrl: string, path: string): string {
  if (!path) {
    return baseUrl;
  }

  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  const safeBase = baseUrl.replace(/\/+$/, '');
  const safePath = path.replace(/^\/+/, '');
  return safeBase ? `${safeBase}/${safePath}` : `/${safePath}`;
}

function addQueryParams(path: string, query?: Record<string, string | undefined>): string {
  if (!query || Object.keys(query).length === 0) {
    return path;
  }

  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(query)) {
    if (value) {
      search.set(key, value);
    }
  }

  const queryString = search.toString();
  if (!queryString) {
    return path;
  }

  return `${path}${path.includes('?') ? '&' : '?'}${queryString}`;
}

function pickArrayPayload(body: unknown, candidateKeys: string[]): Record<string, unknown>[] {
  if (Array.isArray(body)) {
    return body.filter(isRecord);
  }

  if (!isRecord(body)) {
    return [];
  }

  const candidates = [
    body.items,
    body.results,
    body.data,
    ...candidateKeys.map((key) => body[key]),
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.filter(isRecord);
    }
  }

  return [];
}

function filterRecordsByQuery(
  records: Record<string, unknown>[],
  query?: Record<string, string | undefined>,
): Record<string, unknown>[] {
  if (!query) {
    return records;
  }

  const activeFilters = Object.entries(query).filter(([, value]) => typeof value === 'string' && value.trim());
  if (activeFilters.length === 0) {
    return records;
  }

  return records.filter((record) =>
    activeFilters.every(([key, value]) => asString(record[key]) === value),
  );
}

function pickRecordPayload(body: unknown, candidateKeys: string[]): Record<string, unknown> | null {
  if (isRecord(body)) {
    for (const key of candidateKeys) {
      const candidate = body[key];
      if (isRecord(candidate)) {
        return candidate;
      }
    }

    return body;
  }

  return null;
}

function asString(value: unknown): string {
  if (typeof value === 'string') {
    return value;
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

  if (typeof value === 'string') {
    const normalized = value.replace(/\s/g, '').replace(',', '.');
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  return fallback;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function asTimestamp(value: unknown): string {
  const text = asString(value);
  return text || new Date(0).toISOString();
}

function firstRecordString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = asString(record[key]);
    if (value) {
      return value;
    }
  }

  return '';
}

function inferChorusInvoiceStatus(value: unknown): Invoice['statusInternal'] | undefined {
  const text = asString(value).toUpperCase();
  if (!text) {
    return undefined;
  }

  if (text.includes('PAY') || text.includes('MISE_EN_PAIEMENT')) {
    return 'PAID';
  }
  if (text.includes('TECHNIQUE')) {
    return 'REJECTED_TECHNICAL';
  }
  if (
    text.includes('REJET')
    || text.includes('REFUS')
    || text.includes('NON_CONFORME')
    || text.includes('ERREUR')
    || text.includes('ABANDON')
    || text.includes('SUPPRIM')
  ) {
    return 'REJECTED_BUSINESS';
  }
  if (text.includes('ACCEPT') || text.includes('VALID')) {
    return 'ACCEPTED_BY_CHORUS';
  }
  if (text.includes('ARCHIV')) {
    return 'ARCHIVED';
  }
  if (text.includes('DEPOSE') || text.includes('MISE_A_DISPOSITION') || text.includes('TRANSMISE')) {
    return 'SUBMITTED_TO_CHORUS';
  }

  return undefined;
}

function normalizeInvoiceStatus(value: unknown): Invoice['statusInternal'] {
  const text = asString(value);
  const allowed: Invoice['statusInternal'][] = [
    'DRAFT_UPLOADED',
    'DRAFT_STRUCTURED',
    'PENDING_HUMAN_REVIEW',
    'READY_FOR_SUBMISSION',
    'SUBMISSION_REQUESTED',
    'ATTACHMENTS_UPLOADED',
    'SUBMITTED_TO_CHORUS',
    'STATUS_SYNC_PENDING',
    'REJECTED_BUSINESS',
    'REJECTED_TECHNICAL',
    'ACCEPTED_BY_CHORUS',
    'PAID',
    'ARCHIVED',
  ];

  return allowed.includes(text as Invoice['statusInternal']) ? (text as Invoice['statusInternal']) : 'DRAFT_UPLOADED';
}

function normalizeSourceFormat(value: unknown): SourceFormat {
  const text = asString(value);
  return text === 'XML' || text === 'FACTUR_X' ? text : 'PDF';
}

function normalizeEventSource(value: unknown): InvoiceStatusHistory['source'] {
  const text = asString(value);
  return text === 'USER' || text === 'CHORUS' ? text : 'SYSTEM';
}

function normalizeAttachmentRole(value: unknown): InvoiceAttachment['attachmentRole'] {
  const text = asString(value);
  if (text === 'PV_LIVRAISON' || text === 'ANNEXE' || text === 'AUTRE') {
    return text;
  }

  return 'MAIN';
}

function normalizeJobStatus(value: unknown): AsyncJob['status'] {
  const text = asString(value);
  if (text === 'RUNNING' || text === 'FAILED' || text === 'DONE' || text === 'DEAD') {
    return text;
  }

  return 'PENDING';
}

function normalizeUserRole(value: unknown): User['roleCode'] {
  const text = asString(value);
  if (text === 'DEPOSANT' || text === 'ADMINISTRATEUR' || text === 'AUDITEUR') {
    return text;
  }

  return 'GESTIONNAIRE';
}

function warnMissingEndpoint(label: string): void {
  if (typeof console !== 'undefined') {
    console.warn(`[data backend] ${label} non configuré. TODO: brancher cet endpoint backend réel.`);
  }
}

function buildFallbackTenant(): Tenant {
  return {
    id: 'tenant-unresolved',
    code: 'UNRESOLVED',
    name: 'Tenant non configuré',
    active: false,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
}

function buildFallbackCurrentUser(): User {
  const session = loadAuthSession();

  return {
    id: 'user-unresolved',
    tenantId: 'tenant-unresolved',
    email: session?.email ?? '',
    firstName: session?.firstName ?? '',
    lastName: session?.lastName ?? '',
    roleCode: normalizeUserRole(session?.roleCode),
    active: true,
    createdAt: session?.createdAt ?? new Date(0).toISOString(),
    updatedAt: session?.createdAt ?? new Date(0).toISOString(),
  };
}

function normalizeTenant(record: Record<string, unknown>): Tenant {
  return {
    id: asString(record.id) || asString(record.tenantId) || buildFallbackTenant().id,
    code: asString(record.code) || asString(record.tenantCode) || buildFallbackTenant().code,
    name: asString(record.name) || asString(record.legalName) || buildFallbackTenant().name,
    active: asBoolean(record.active, true),
    createdAt: asTimestamp(record.createdAt),
    updatedAt: asTimestamp(record.updatedAt),
  };
}

function normalizeUser(record: Record<string, unknown>): User {
  const fallback = buildFallbackCurrentUser();

  return {
    id: asString(record.id) || fallback.id,
    tenantId: asString(record.tenantId) || fallback.tenantId,
    email: asString(record.email) || fallback.email,
    firstName: asString(record.firstName) || asString(record.givenName) || fallback.firstName,
    lastName: asString(record.lastName) || asString(record.familyName) || fallback.lastName,
    roleCode: normalizeUserRole(record.roleCode ?? record.role),
    active: asBoolean(record.active, true),
    createdAt: asTimestamp(record.createdAt || fallback.createdAt),
    updatedAt: asTimestamp(record.updatedAt || fallback.updatedAt),
  };
}

function normalizeSupplier(record: Record<string, unknown>, index: number): SupplierOrganization {
  return {
    id: asString(record.id) || asString(record.supplierId) || `supplier-${index + 1}`,
    tenantId: asString(record.tenantId) || 'external',
    legalName: asString(record.legalName) || asString(record.name),
    siret: asString(record.siret).replace(/\D/g, ''),
    vatNumber: asString(record.vatNumber),
    chorusSupplierCode: asString(record.chorusSupplierCode) || undefined,
    active: asBoolean(record.active, true),
    createdAt: asTimestamp(record.createdAt),
    updatedAt: asTimestamp(record.updatedAt),
  };
}

function normalizePublicCustomer(record: Record<string, unknown>, index: number): PublicCustomer {
  return {
    id: asString(record.id) || asString(record.customerId) || `customer-${index + 1}`,
    tenantId: asString(record.tenantId) || 'external',
    codeDestinataire: asString(record.codeDestinataire) || asString(record.destinationCode),
    legalName: asString(record.legalName) || asString(record.name),
    siret: asString(record.siret).replace(/\D/g, ''),
    structureType: asString(record.structureType) || 'PUBLIC',
    active: asBoolean(record.active, true),
    createdAt: asTimestamp(record.createdAt),
    updatedAt: asTimestamp(record.updatedAt),
  };
}

function normalizePublicService(record: Record<string, unknown>, index: number): PublicService {
  return {
    id: asString(record.id) || asString(record.serviceId) || `service-${index + 1}`,
    tenantId: asString(record.tenantId) || 'external',
    publicCustomerId: asString(record.publicCustomerId) || asString(record.customerId),
    codeServiceExecutant: asString(record.codeServiceExecutant) || asString(record.codeService),
    label: asString(record.label) || asString(record.libelleService),
    engagementRequired: asBoolean(record.engagementRequired, false),
    purchaseOrderRequired: asBoolean(record.purchaseOrderRequired, false),
    active: asBoolean(record.active, true),
    createdAt: asTimestamp(record.createdAt),
    updatedAt: asTimestamp(record.updatedAt),
  };
}

function normalizeInvoice(record: Record<string, unknown>, index: number): Invoice {
  const statusChorus = firstRecordString(record, [
    'statusChorus',
    'libelleStatutCourant',
    'statutCourant',
    'statutFacture',
    'statut',
    'etatCourant',
    'codeStatutCourant',
    'libelleEtatCourant',
  ]);
  const normalizedStatus = normalizeInvoiceStatus(record.statusInternal);
  const inferredStatus = normalizedStatus === 'DRAFT_UPLOADED'
    ? inferChorusInvoiceStatus(statusChorus || record.statusInternal)
    : undefined;

  return {
    id: asString(record.id) || `invoice-${index + 1}`,
    tenantId: asString(record.tenantId) || 'external',
    supplierOrganizationId: asString(record.supplierOrganizationId) || asString(record.supplierId),
    sourceFormat: normalizeSourceFormat(record.sourceFormat),
    targetFormat: asString(record.targetFormat) || undefined,
    supplierInvoiceNumber: asString(record.supplierInvoiceNumber) || asString(record.invoiceNumber),
    chorusInvoiceNumber: asString(record.chorusInvoiceNumber) || undefined,
    externalReference: asString(record.externalReference) || undefined,
    invoiceDate: asString(record.invoiceDate),
    dueDate: asString(record.dueDate) || undefined,
    currencyCode: asString(record.currencyCode) || 'EUR',
    totalHt: asNumber(record.totalHt),
    totalVat: asNumber(record.totalVat),
    totalTtc: asNumber(record.totalTtc),
    publicCustomerId: asString(record.publicCustomerId) || asString(record.customerId),
    publicServiceId: asString(record.publicServiceId) || asString(record.serviceId) || undefined,
    engagementNumber: asString(record.engagementNumber) || undefined,
    purchaseOrderNumber: asString(record.purchaseOrderNumber) || undefined,
    marketNumber: asString(record.marketNumber) || undefined,
    depositMode: asString(record.depositMode) || 'API',
    statusInternal: inferredStatus || normalizedStatus,
    statusChorus: statusChorus || undefined,
    statusReasonCode: firstRecordString(record, ['statusReasonCode', 'codeMotifRejet', 'codeRejet', 'motifRejetCode', 'codeEtatCourant']) || undefined,
    statusReasonLabel: firstRecordString(record, [
      'statusReasonLabel',
      'commentaireEtatCourant',
      'commentaireStatutCourant',
      'commentaireEtat',
      'motifRejet',
      'motifRefus',
      'libelleMotifRejet',
      'messageRejet',
    ]) || undefined,
    extractionConfidence: record.extractionConfidence == null ? undefined : asNumber(record.extractionConfidence),
    requiresHumanReview: asBoolean(record.requiresHumanReview, false),
    currentRevision: asNumber(record.currentRevision, 1),
    submittedAt: asString(record.submittedAt) || undefined,
    lastStatusSyncAt: asString(record.lastStatusSyncAt) || undefined,
    archivedAt: asString(record.archivedAt) || undefined,
    createdBy: asString(record.createdBy) || 'system',
    updatedBy: asString(record.updatedBy) || 'system',
    createdAt: asTimestamp(record.createdAt),
    updatedAt: asTimestamp(record.updatedAt),
  };
}

function normalizeInvoiceLine(record: Record<string, unknown>, index: number): InvoiceLine {
  return {
    id: asString(record.id) || `invoice-line-${index + 1}`,
    tenantId: asString(record.tenantId) || 'external',
    invoiceId: asString(record.invoiceId),
    lineNumber: asNumber(record.lineNumber, index + 1),
    description: asString(record.description) || asString(record.label),
    quantity: asNumber(record.quantity, 1),
    unitCode: asString(record.unitCode) || 'UNITE',
    unitPriceHt: asNumber(record.unitPriceHt),
    vatRate: asNumber(record.vatRate),
    lineTotalHt: asNumber(record.lineTotalHt),
    lineTotalTtc: asNumber(record.lineTotalTtc),
    createdAt: asTimestamp(record.createdAt),
    updatedAt: asTimestamp(record.updatedAt),
  };
}

function normalizeInvoiceAttachment(record: Record<string, unknown>, index: number): InvoiceAttachment {
  return {
    id: asString(record.id) || `attachment-${index + 1}`,
    tenantId: asString(record.tenantId) || 'external',
    invoiceId: asString(record.invoiceId),
    attachmentRole: normalizeAttachmentRole(record.attachmentRole),
    attachmentTypeCode: asString(record.attachmentTypeCode) || 'DOCUMENT',
    filename: asString(record.filename) || `attachment-${index + 1}`,
    mimeType: asString(record.mimeType) || 'application/octet-stream',
    storageKey: asString(record.storageKey),
    sha256: asString(record.sha256),
    sizeBytes: asNumber(record.sizeBytes),
    chorusFileId: asString(record.chorusFileId) || undefined,
    uploadedToChorus: asBoolean(record.uploadedToChorus, false),
    createdAt: asTimestamp(record.createdAt),
  };
}

function normalizeInvoiceStatusHistory(record: Record<string, unknown>, index: number): InvoiceStatusHistory {
  return {
    id: asString(record.id) || `status-history-${index + 1}`,
    tenantId: asString(record.tenantId) || 'external',
    invoiceId: asString(record.invoiceId),
    source: normalizeEventSource(record.source),
    previousStatus: asString(record.previousStatus) || undefined,
    newStatus: asString(record.newStatus),
    eventCode: asString(record.eventCode),
    eventLabel: asString(record.eventLabel),
    rawSnapshot: asObject(record.rawSnapshot),
    occurredAt: asTimestamp(record.occurredAt),
  };
}

function normalizeApiExchangeLog(record: Record<string, unknown>, index: number): ApiExchangeLog {
  return {
    id: asString(record.id) || `api-log-${index + 1}`,
    tenantId: asString(record.tenantId) || 'external',
    invoiceId: asString(record.invoiceId) || undefined,
    targetSystem: asString(record.targetSystem) || 'CHORUS_PRO',
    operationName: asString(record.operationName),
    correlationId: asString(record.correlationId),
    direction: asString(record.direction) === 'INBOUND' ? 'INBOUND' : 'OUTBOUND',
    httpStatus: record.httpStatus == null ? undefined : asNumber(record.httpStatus),
    businessCode: asString(record.businessCode) || undefined,
    businessMessage: asString(record.businessMessage) || undefined,
    requestHeadersRedacted: asString(record.requestHeadersRedacted) || undefined,
    requestBodyRedacted: asString(record.requestBodyRedacted) || undefined,
    responseHeadersRedacted: asString(record.responseHeadersRedacted) || undefined,
    responseBodyRedacted: asString(record.responseBodyRedacted) || undefined,
    latencyMs: record.latencyMs == null ? undefined : asNumber(record.latencyMs),
    success: asBoolean(record.success, false),
    createdAt: asTimestamp(record.createdAt),
  };
}

function normalizeAsyncJob(record: Record<string, unknown>, index: number): AsyncJob {
  return {
    id: asString(record.id) || `job-${index + 1}`,
    tenantId: asString(record.tenantId) || 'external',
    invoiceId: asString(record.invoiceId) || undefined,
    jobType: asString(record.jobType),
    status: normalizeJobStatus(record.status),
    attemptCount: asNumber(record.attemptCount),
    maxAttempts: asNumber(record.maxAttempts, 1),
    nextAttemptAt: asString(record.nextAttemptAt) || undefined,
    lastErrorCode: asString(record.lastErrorCode) || undefined,
    lastErrorMessage: asString(record.lastErrorMessage) || undefined,
    payload: asObject(record.payload),
    createdAt: asTimestamp(record.createdAt),
    updatedAt: asTimestamp(record.updatedAt),
  };
}

function normalizeAuditLog(record: Record<string, unknown>, index: number): AuditLog {
  return {
    id: asString(record.id) || `audit-log-${index + 1}`,
    tenantId: asString(record.tenantId) || 'external',
    actorType: asString(record.actorType),
    actorId: asString(record.actorId),
    actionCode: asString(record.actionCode),
    entityType: asString(record.entityType),
    entityId: asString(record.entityId),
    diff: asObject(record.diff),
    ipAddress: asString(record.ipAddress) || undefined,
    userAgent: asString(record.userAgent) || undefined,
    createdAt: asTimestamp(record.createdAt),
  };
}

function normalizeExtractionResult(record: Record<string, unknown>, index: number): InvoiceExtractionResult {
  return {
    id: asString(record.id) || `extraction-${index + 1}`,
    tenantId: asString(record.tenantId) || 'external',
    invoiceId: asString(record.invoiceId),
    engineName: asString(record.engineName),
    engineVersion: asString(record.engineVersion),
    rawText: asString(record.rawText) || undefined,
    extractedPayload: asObject(record.extractedPayload) ?? {},
    confidenceScore: asNumber(record.confidenceScore),
    requiresReview: asBoolean(record.requiresReview, false),
    createdAt: asTimestamp(record.createdAt),
  };
}

export class BackendDataClient {
  constructor(
    private readonly config: BackendDataApiConfig = loadBackendDataApiConfig(),
    private readonly fetchImpl: typeof fetch = getDefaultFetchImpl(),
  ) {}

  private handleUnauthorized(response: Response): void {
    if (response.status !== 401) {
      return;
    }

    clearAuthSession();
    if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
      window.location.assign('/login');
    }
  }

  private async fetchCollection<T>(
    path: string,
    label: string,
    candidateKeys: string[],
    normalizeItem: (record: Record<string, unknown>, index: number) => T,
    query?: Record<string, string | undefined>,
  ): Promise<T[]> {
    const relativePath = path.trim();

    if (!relativePath) {
      warnMissingEndpoint(label);
      return [];
    }

    const response = await this.fetchImpl(
      joinUrl(this.config.baseUrl.trim(), addQueryParams(relativePath, query)),
      {
        method: 'GET',
        headers: authHeaders({
          Accept: 'application/json',
        }),
      },
    );

    this.handleUnauthorized(response);

    if (response.status === 404) {
      console.warn(`[data backend] ${label} introuvable (404). TODO: brancher cet endpoint côté backend.`);
      return [];
    }

    if (!response.ok) {
      throw new Error(`${label} indisponible (${response.status}).`);
    }

    const body = await response.json() as unknown;
    return filterRecordsByQuery(pickArrayPayload(body, candidateKeys), query).map(normalizeItem);
  }

  private async fetchEntity<T>(
    path: string,
    label: string,
    candidateKeys: string[],
    normalizeItem: (record: Record<string, unknown>) => T,
    fallbackFactory: () => T,
  ): Promise<T> {
    const relativePath = path.trim();

    if (!relativePath) {
      warnMissingEndpoint(label);
      return fallbackFactory();
    }

    const response = await this.fetchImpl(joinUrl(this.config.baseUrl.trim(), relativePath), {
      method: 'GET',
      headers: authHeaders({
        Accept: 'application/json',
      }),
    });

    this.handleUnauthorized(response);

    if (response.status === 404) {
      console.warn(`[data backend] ${label} introuvable (404). TODO: brancher cet endpoint côté backend.`);
      return fallbackFactory();
    }

    if (!response.ok) {
      throw new Error(`${label} indisponible (${response.status}).`);
    }

    const body = await response.json() as unknown;
    const record = pickRecordPayload(body, candidateKeys);
    return record ? normalizeItem(record) : fallbackFactory();
  }

  async fetchTenant(): Promise<Tenant> {
    return this.fetchEntity(
      this.config.tenantPath,
      'API tenant',
      ['tenant', 'data', 'item'],
      normalizeTenant,
      buildFallbackTenant,
    );
  }

  async fetchCurrentUser(): Promise<User> {
    return this.fetchEntity(
      this.config.currentUserPath,
      'API utilisateur courant',
      ['user', 'currentUser', 'data', 'item'],
      normalizeUser,
      buildFallbackCurrentUser,
    );
  }

  async fetchSuppliers(): Promise<SupplierOrganization[]> {
    return this.fetchCollection(
      this.config.suppliersPath,
      'API fournisseurs',
      ['suppliers'],
      normalizeSupplier,
    );
  }

  async fetchPublicCustomers(): Promise<PublicCustomer[]> {
    return this.fetchCollection(
      this.config.publicCustomersPath,
      'API clients publics',
      ['publicCustomers', 'customers'],
      normalizePublicCustomer,
    );
  }

  async fetchPublicServices(): Promise<PublicService[]> {
    return this.fetchCollection(
      this.config.publicServicesPath,
      'API services publics',
      ['publicServices', 'services'],
      normalizePublicService,
    );
  }

  async fetchInvoices(): Promise<Invoice[]> {
    return this.fetchCollection(
      this.config.invoicesPath,
      'API factures',
      ['invoices'],
      normalizeInvoice,
    );
  }

  async fetchInvoiceLines(invoiceId?: string): Promise<InvoiceLine[]> {
    return this.fetchCollection(
      this.config.invoiceLinesPath,
      'API lignes de facture',
      ['invoiceLines', 'lines'],
      normalizeInvoiceLine,
      { invoiceId },
    );
  }

  async fetchInvoiceAttachments(invoiceId?: string): Promise<InvoiceAttachment[]> {
    return this.fetchCollection(
      this.config.invoiceAttachmentsPath,
      'API pièces jointes facture',
      ['invoiceAttachments', 'attachments'],
      normalizeInvoiceAttachment,
      { invoiceId },
    );
  }

  async fetchStatusHistory(invoiceId?: string): Promise<InvoiceStatusHistory[]> {
    return this.fetchCollection(
      this.config.statusHistoryPath,
      'API historique de statut',
      ['statusHistory', 'history'],
      normalizeInvoiceStatusHistory,
      { invoiceId },
    );
  }

  async fetchApiExchangeLogs(invoiceId?: string): Promise<ApiExchangeLog[]> {
    return this.fetchCollection(
      this.config.apiExchangeLogsPath,
      'API logs d’échanges',
      ['apiExchangeLogs', 'logs'],
      normalizeApiExchangeLog,
      { invoiceId },
    );
  }

  async fetchAsyncJobs(): Promise<AsyncJob[]> {
    return this.fetchCollection(
      this.config.asyncJobsPath,
      'API jobs asynchrones',
      ['asyncJobs', 'jobs'],
      normalizeAsyncJob,
    );
  }

  async fetchAuditLogs(entityId?: string): Promise<AuditLog[]> {
    return this.fetchCollection(
      this.config.auditLogsPath,
      'API journal d’audit',
      ['auditLogs', 'logs'],
      normalizeAuditLog,
      { entityId },
    );
  }

  async fetchExtractionResults(invoiceId?: string): Promise<InvoiceExtractionResult[]> {
    return this.fetchCollection(
      this.config.extractionResultsPath,
      'API résultats d’extraction',
      ['extractionResults', 'results'],
      normalizeExtractionResult,
      { invoiceId },
    );
  }
}
