// ==================== ENUMS ====================

export type InvoiceStatusInternal =
  | 'DRAFT_UPLOADED'
  | 'DRAFT_STRUCTURED'
  | 'PENDING_HUMAN_REVIEW'
  | 'READY_FOR_SUBMISSION'
  | 'SUBMISSION_REQUESTED'
  | 'ATTACHMENTS_UPLOADED'
  | 'SUBMITTED_TO_CHORUS'
  | 'STATUS_SYNC_PENDING'
  | 'REJECTED_BUSINESS'
  | 'REJECTED_TECHNICAL'
  | 'ACCEPTED_BY_CHORUS'
  | 'PAID'
  | 'ARCHIVED';

export type SourceFormat = 'PDF' | 'XML' | 'FACTUR_X';

export type JobStatus = 'PENDING' | 'RUNNING' | 'FAILED' | 'DONE' | 'DEAD';

export type UserRole = 'DEPOSANT' | 'GESTIONNAIRE' | 'ADMINISTRATEUR' | 'AUDITEUR';

export type EventSource = 'SYSTEM' | 'USER' | 'CHORUS';

export type AttachmentRole = 'MAIN' | 'PV_LIVRAISON' | 'ANNEXE' | 'AUTRE';

// ==================== ENTITIES ====================

export interface Tenant {
  id: string;
  code: string;
  name: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface User {
  id: string;
  tenantId: string;
  email: string;
  firstName: string;
  lastName: string;
  roleCode: UserRole;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SupplierOrganization {
  id: string;
  tenantId: string;
  legalName: string;
  siret: string;
  vatNumber: string;
  chorusSupplierCode?: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PublicCustomer {
  id: string;
  tenantId: string;
  codeDestinataire: string;
  legalName: string;
  siret: string;
  structureType: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PublicService {
  id: string;
  tenantId: string;
  publicCustomerId: string;
  codeServiceExecutant: string;
  label: string;
  engagementRequired: boolean;
  purchaseOrderRequired: boolean;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Invoice {
  id: string;
  tenantId: string;
  supplierOrganizationId: string;
  sourceFormat: SourceFormat;
  targetFormat?: string;
  supplierInvoiceNumber: string;
  chorusInvoiceNumber?: string;
  externalReference?: string;
  invoiceDate: string;
  dueDate?: string;
  currencyCode: string;
  totalHt: number;
  totalVat: number;
  totalTtc: number;
  publicCustomerId: string;
  publicServiceId?: string;
  engagementNumber?: string;
  purchaseOrderNumber?: string;
  marketNumber?: string;
  depositMode: string;
  statusInternal: InvoiceStatusInternal;
  statusChorus?: string;
  statusReasonCode?: string;
  statusReasonLabel?: string;
  extractionConfidence?: number;
  requiresHumanReview: boolean;
  currentRevision: number;
  submittedAt?: string;
  lastStatusSyncAt?: string;
  archivedAt?: string;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface InvoiceLine {
  id: string;
  tenantId: string;
  invoiceId: string;
  lineNumber: number;
  description: string;
  quantity: number;
  unitCode: string;
  unitPriceHt: number;
  vatRate: number;
  lineTotalHt: number;
  lineTotalTtc: number;
  createdAt: string;
  updatedAt: string;
}

export interface InvoiceAttachment {
  id: string;
  tenantId: string;
  invoiceId: string;
  attachmentRole: AttachmentRole;
  attachmentTypeCode: string;
  filename: string;
  mimeType: string;
  storageKey: string;
  sha256: string;
  sizeBytes: number;
  chorusFileId?: string;
  uploadedToChorus: boolean;
  createdAt: string;
}

export interface InvoiceExtractionResult {
  id: string;
  tenantId: string;
  invoiceId: string;
  engineName: string;
  engineVersion: string;
  rawText?: string;
  extractedPayload: Record<string, unknown>;
  confidenceScore: number;
  requiresReview: boolean;
  createdAt: string;
}

export interface InvoiceStatusHistory {
  id: string;
  tenantId: string;
  invoiceId: string;
  source: EventSource;
  previousStatus?: string;
  newStatus: string;
  eventCode: string;
  eventLabel: string;
  rawSnapshot?: Record<string, unknown>;
  occurredAt: string;
}

export interface ApiExchangeLog {
  id: string;
  tenantId: string;
  invoiceId?: string;
  targetSystem: string;
  operationName: string;
  correlationId: string;
  direction: 'OUTBOUND' | 'INBOUND';
  httpStatus?: number;
  businessCode?: string;
  businessMessage?: string;
  requestHeadersRedacted?: string;
  requestBodyRedacted?: string;
  responseHeadersRedacted?: string;
  responseBodyRedacted?: string;
  latencyMs?: number;
  success: boolean;
  createdAt: string;
}

export interface AsyncJob {
  id: string;
  tenantId: string;
  invoiceId?: string;
  jobType: string;
  status: JobStatus;
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAt?: string;
  lastErrorCode?: string;
  lastErrorMessage?: string;
  payload?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface AuditLog {
  id: string;
  tenantId: string;
  actorType: string;
  actorId: string;
  actionCode: string;
  entityType: string;
  entityId: string;
  diff?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  createdAt: string;
}

export interface InvoiceRevision {
  id: string;
  tenantId: string;
  invoiceId: string;
  revisionNumber: number;
  sourceEvent: string;
  canonicalPayload: Record<string, unknown>;
  createdBy: string;
  createdAt: string;
}

// ==================== UI HELPERS ====================

export interface StatusConfig {
  label: string;
  color: string;
  bgClass: string;
  textClass: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationError {
  field: string;
  message: string;
  code: string;
}

export interface ValidationWarning {
  field: string;
  message: string;
  code: string;
}
