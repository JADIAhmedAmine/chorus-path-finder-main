import type {
  Tenant, User, SupplierOrganization, PublicCustomer, PublicService,
  Invoice, InvoiceLine, InvoiceAttachment, InvoiceStatusHistory,
  ApiExchangeLog, AsyncJob, AuditLog, InvoiceExtractionResult
} from '@/types';

export const tenant: Tenant = {
  id: 't1', code: 'ACME', name: 'ACME Solutions SAS', active: true,
  createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z'
};

export const currentUser: User = {
  id: 'u1', tenantId: 't1', email: 'marie.dupont@acme-solutions.fr',
  firstName: 'Marie', lastName: 'Dupont', roleCode: 'GESTIONNAIRE',
  active: true, createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z'
};

export const suppliers: SupplierOrganization[] = [
  { id: 's1', tenantId: 't1', legalName: 'ACME Solutions SAS', siret: '12345678901234', vatNumber: 'FR12345678901', chorusSupplierCode: 'SUP001', active: true, createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' },
  { id: 's2', tenantId: 't1', legalName: 'Tech Services SARL', siret: '98765432109876', vatNumber: 'FR98765432109', chorusSupplierCode: 'SUP002', active: true, createdAt: '2024-02-01T00:00:00Z', updatedAt: '2024-02-01T00:00:00Z' },
  { id: 's3', tenantId: 't1', legalName: 'Conseil & Stratégie SA', siret: '11223344556677', vatNumber: 'FR11223344556', active: true, createdAt: '2024-03-01T00:00:00Z', updatedAt: '2024-03-01T00:00:00Z' },
];

export const publicCustomers: PublicCustomer[] = [
  { id: 'pc1', tenantId: 't1', codeDestinataire: '99001', legalName: 'Ministère de l\'Intérieur', siret: '11000001100010', structureType: 'MINISTERE', active: true, createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' },
  { id: 'pc2', tenantId: 't1', codeDestinataire: '99002', legalName: 'Direction Générale des Finances Publiques', siret: '13001803200011', structureType: 'DIRECTION', active: true, createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' },
  { id: 'pc3', tenantId: 't1', codeDestinataire: '99003', legalName: 'Région Île-de-France', siret: '23750007900013', structureType: 'COLLECTIVITE', active: true, createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' },
  { id: 'pc4', tenantId: 't1', codeDestinataire: '99004', legalName: 'CHU de Paris', siret: '26750045200016', structureType: 'ETABLISSEMENT', active: true, createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' },
  { id: 'pc5', tenantId: 't1', codeDestinataire: '99005', legalName: 'Université Paris-Saclay', siret: '13002612300075', structureType: 'ETABLISSEMENT', active: false, createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-06-01T00:00:00Z' },
];

export const publicServices: PublicService[] = [
  { id: 'ps1', tenantId: 't1', publicCustomerId: 'pc1', codeServiceExecutant: 'SE001', label: 'Service des achats', engagementRequired: true, purchaseOrderRequired: true, active: true, createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' },
  { id: 'ps2', tenantId: 't1', publicCustomerId: 'pc1', codeServiceExecutant: 'SE002', label: 'Direction des systèmes d\'information', engagementRequired: true, purchaseOrderRequired: false, active: true, createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' },
  { id: 'ps3', tenantId: 't1', publicCustomerId: 'pc2', codeServiceExecutant: 'SE003', label: 'Bureau de la comptabilité', engagementRequired: false, purchaseOrderRequired: false, active: true, createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' },
  { id: 'ps4', tenantId: 't1', publicCustomerId: 'pc3', codeServiceExecutant: 'SE004', label: 'Direction des finances', engagementRequired: true, purchaseOrderRequired: true, active: true, createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' },
  { id: 'ps5', tenantId: 't1', publicCustomerId: 'pc4', codeServiceExecutant: 'SE005', label: 'Service biomédical', engagementRequired: true, purchaseOrderRequired: true, active: true, createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' },
];

export const invoices: Invoice[] = [
  {
    id: 'inv1', tenantId: 't1', supplierOrganizationId: 's1', sourceFormat: 'PDF',
    supplierInvoiceNumber: 'FAC-2024-001', chorusInvoiceNumber: 'CHR-78901',
    invoiceDate: '2024-09-15', dueDate: '2024-10-15', currencyCode: 'EUR',
    totalHt: 15000, totalVat: 3000, totalTtc: 18000,
    publicCustomerId: 'pc1', publicServiceId: 'ps1',
    engagementNumber: 'ENG-2024-100', purchaseOrderNumber: 'BC-2024-050', marketNumber: 'MA-2024-010',
    depositMode: 'API', statusInternal: 'ACCEPTED_BY_CHORUS', statusChorus: 'MISE_EN_PAIEMENT',
    extractionConfidence: 0.95, requiresHumanReview: false, currentRevision: 2,
    submittedAt: '2024-09-16T10:00:00Z', lastStatusSyncAt: '2024-09-20T14:00:00Z',
    createdBy: 'u1', updatedBy: 'u1', createdAt: '2024-09-15T08:00:00Z', updatedAt: '2024-09-20T14:00:00Z'
  },
  {
    id: 'inv2', tenantId: 't1', supplierOrganizationId: 's1', sourceFormat: 'FACTUR_X',
    supplierInvoiceNumber: 'FAC-2024-002',
    invoiceDate: '2024-10-01', dueDate: '2024-11-01', currencyCode: 'EUR',
    totalHt: 8500, totalVat: 1700, totalTtc: 10200,
    publicCustomerId: 'pc2', publicServiceId: 'ps3',
    depositMode: 'API', statusInternal: 'READY_FOR_SUBMISSION',
    extractionConfidence: 0.92, requiresHumanReview: false, currentRevision: 1,
    createdBy: 'u1', updatedBy: 'u1', createdAt: '2024-10-01T09:00:00Z', updatedAt: '2024-10-02T11:00:00Z'
  },
  {
    id: 'inv3', tenantId: 't1', supplierOrganizationId: 's2', sourceFormat: 'XML',
    supplierInvoiceNumber: 'TS-2024-0088',
    invoiceDate: '2024-10-05', dueDate: '2024-11-05', currencyCode: 'EUR',
    totalHt: 42000, totalVat: 8400, totalTtc: 50400,
    publicCustomerId: 'pc3', publicServiceId: 'ps4',
    engagementNumber: 'ENG-2024-200', marketNumber: 'MA-2024-020',
    depositMode: 'API', statusInternal: 'REJECTED_BUSINESS',
    statusReasonCode: 'ERR_ENGAGEMENT', statusReasonLabel: 'Numéro de bon de commande manquant pour ce service',
    extractionConfidence: 0.88, requiresHumanReview: false, currentRevision: 1,
    submittedAt: '2024-10-06T14:00:00Z',
    createdBy: 'u1', updatedBy: 'u1', createdAt: '2024-10-05T10:00:00Z', updatedAt: '2024-10-07T09:00:00Z'
  },
  {
    id: 'inv4', tenantId: 't1', supplierOrganizationId: 's1', sourceFormat: 'PDF',
    supplierInvoiceNumber: 'FAC-2024-003',
    invoiceDate: '2024-10-10', currencyCode: 'EUR',
    totalHt: 3200, totalVat: 640, totalTtc: 3840,
    publicCustomerId: 'pc4', publicServiceId: 'ps5',
    engagementNumber: 'ENG-2024-300', purchaseOrderNumber: 'BC-2024-075',
    depositMode: 'API', statusInternal: 'PENDING_HUMAN_REVIEW',
    extractionConfidence: 0.65, requiresHumanReview: true, currentRevision: 1,
    createdBy: 'u1', updatedBy: 'u1', createdAt: '2024-10-10T08:00:00Z', updatedAt: '2024-10-10T08:30:00Z'
  },
  {
    id: 'inv5', tenantId: 't1', supplierOrganizationId: 's3', sourceFormat: 'PDF',
    supplierInvoiceNumber: 'CS-2024-042',
    invoiceDate: '2024-10-12', dueDate: '2024-11-12', currencyCode: 'EUR',
    totalHt: 25000, totalVat: 5000, totalTtc: 30000,
    publicCustomerId: 'pc1', publicServiceId: 'ps2',
    engagementNumber: 'ENG-2024-400',
    depositMode: 'API', statusInternal: 'SUBMITTED_TO_CHORUS', statusChorus: 'EN_COURS_DE_TRAITEMENT',
    extractionConfidence: 0.91, requiresHumanReview: false, currentRevision: 1,
    submittedAt: '2024-10-13T09:00:00Z', lastStatusSyncAt: '2024-10-14T08:00:00Z',
    createdBy: 'u1', updatedBy: 'u1', createdAt: '2024-10-12T07:00:00Z', updatedAt: '2024-10-14T08:00:00Z'
  },
  {
    id: 'inv6', tenantId: 't1', supplierOrganizationId: 's2', sourceFormat: 'FACTUR_X',
    supplierInvoiceNumber: 'TS-2024-0102',
    invoiceDate: '2024-10-15', dueDate: '2024-11-15', currencyCode: 'EUR',
    totalHt: 12800, totalVat: 2560, totalTtc: 15360,
    publicCustomerId: 'pc2', publicServiceId: 'ps3',
    depositMode: 'API', statusInternal: 'REJECTED_TECHNICAL',
    statusReasonCode: 'ERR_TIMEOUT', statusReasonLabel: 'Timeout lors de la connexion à Chorus Pro',
    extractionConfidence: 0.89, requiresHumanReview: false, currentRevision: 1,
    submittedAt: '2024-10-16T10:00:00Z',
    createdBy: 'u1', updatedBy: 'u1', createdAt: '2024-10-15T09:00:00Z', updatedAt: '2024-10-16T10:30:00Z'
  },
  {
    id: 'inv7', tenantId: 't1', supplierOrganizationId: 's1', sourceFormat: 'PDF',
    supplierInvoiceNumber: 'FAC-2024-004', chorusInvoiceNumber: 'CHR-79012',
    invoiceDate: '2024-08-01', dueDate: '2024-09-01', currencyCode: 'EUR',
    totalHt: 6500, totalVat: 1300, totalTtc: 7800,
    publicCustomerId: 'pc3', publicServiceId: 'ps4',
    engagementNumber: 'ENG-2024-050', purchaseOrderNumber: 'BC-2024-025', marketNumber: 'MA-2024-005',
    depositMode: 'API', statusInternal: 'PAID', statusChorus: 'PAYEE',
    extractionConfidence: 0.97, requiresHumanReview: false, currentRevision: 1,
    submittedAt: '2024-08-02T09:00:00Z', lastStatusSyncAt: '2024-09-05T10:00:00Z',
    createdBy: 'u1', updatedBy: 'u1', createdAt: '2024-08-01T07:00:00Z', updatedAt: '2024-09-05T10:00:00Z'
  },
  {
    id: 'inv8', tenantId: 't1', supplierOrganizationId: 's1', sourceFormat: 'PDF',
    supplierInvoiceNumber: 'FAC-2024-005', chorusInvoiceNumber: 'CHR-79100',
    invoiceDate: '2024-07-01', dueDate: '2024-08-01', currencyCode: 'EUR',
    totalHt: 9200, totalVat: 1840, totalTtc: 11040,
    publicCustomerId: 'pc1', publicServiceId: 'ps1',
    engagementNumber: 'ENG-2024-020', purchaseOrderNumber: 'BC-2024-010', marketNumber: 'MA-2024-002',
    depositMode: 'API', statusInternal: 'ARCHIVED', statusChorus: 'PAYEE',
    extractionConfidence: 0.96, requiresHumanReview: false, currentRevision: 1,
    submittedAt: '2024-07-02T08:00:00Z', lastStatusSyncAt: '2024-08-10T11:00:00Z',
    archivedAt: '2024-09-01T00:00:00Z',
    createdBy: 'u1', updatedBy: 'u1', createdAt: '2024-07-01T06:00:00Z', updatedAt: '2024-09-01T00:00:00Z'
  },
  {
    id: 'inv9', tenantId: 't1', supplierOrganizationId: 's3', sourceFormat: 'XML',
    supplierInvoiceNumber: 'CS-2024-055',
    invoiceDate: '2024-10-18', currencyCode: 'EUR',
    totalHt: 18700, totalVat: 3740, totalTtc: 22440,
    publicCustomerId: 'pc4', publicServiceId: 'ps5',
    engagementNumber: 'ENG-2024-500', purchaseOrderNumber: 'BC-2024-100',
    depositMode: 'API', statusInternal: 'DRAFT_UPLOADED',
    extractionConfidence: 0.72, requiresHumanReview: true, currentRevision: 1,
    createdBy: 'u1', updatedBy: 'u1', createdAt: '2024-10-18T14:00:00Z', updatedAt: '2024-10-18T14:00:00Z'
  },
  {
    id: 'inv10', tenantId: 't1', supplierOrganizationId: 's2', sourceFormat: 'PDF',
    supplierInvoiceNumber: 'TS-2024-0115',
    invoiceDate: '2024-10-20', dueDate: '2024-11-20', currencyCode: 'EUR',
    totalHt: 5600, totalVat: 1120, totalTtc: 6720,
    publicCustomerId: 'pc1', publicServiceId: 'ps1',
    engagementNumber: 'ENG-2024-600', purchaseOrderNumber: 'BC-2024-110',
    depositMode: 'API', statusInternal: 'SUBMISSION_REQUESTED',
    extractionConfidence: 0.94, requiresHumanReview: false, currentRevision: 1,
    createdBy: 'u1', updatedBy: 'u1', createdAt: '2024-10-20T08:00:00Z', updatedAt: '2024-10-20T15:00:00Z'
  },
];

export const invoiceLines: InvoiceLine[] = [
  { id: 'il1', tenantId: 't1', invoiceId: 'inv1', lineNumber: 1, description: 'Prestation de conseil en transformation digitale', quantity: 10, unitCode: 'JR', unitPriceHt: 1200, vatRate: 20, lineTotalHt: 12000, lineTotalTtc: 14400, createdAt: '2024-09-15T08:00:00Z', updatedAt: '2024-09-15T08:00:00Z' },
  { id: 'il2', tenantId: 't1', invoiceId: 'inv1', lineNumber: 2, description: 'Frais de déplacement', quantity: 1, unitCode: 'FT', unitPriceHt: 3000, vatRate: 20, lineTotalHt: 3000, lineTotalTtc: 3600, createdAt: '2024-09-15T08:00:00Z', updatedAt: '2024-09-15T08:00:00Z' },
  { id: 'il3', tenantId: 't1', invoiceId: 'inv2', lineNumber: 1, description: 'Licence logicielle annuelle', quantity: 5, unitCode: 'LIC', unitPriceHt: 1700, vatRate: 20, lineTotalHt: 8500, lineTotalTtc: 10200, createdAt: '2024-10-01T09:00:00Z', updatedAt: '2024-10-01T09:00:00Z' },
];

export const invoiceAttachments: InvoiceAttachment[] = [
  { id: 'att1', tenantId: 't1', invoiceId: 'inv1', attachmentRole: 'MAIN', attachmentTypeCode: 'FACTURE', filename: 'FAC-2024-001.pdf', mimeType: 'application/pdf', storageKey: 'inv1/main.pdf', sha256: 'abc123', sizeBytes: 245000, chorusFileId: 'CF001', uploadedToChorus: true, createdAt: '2024-09-15T08:00:00Z' },
  { id: 'att2', tenantId: 't1', invoiceId: 'inv1', attachmentRole: 'PV_LIVRAISON', attachmentTypeCode: 'PV', filename: 'PV-livraison-2024-001.pdf', mimeType: 'application/pdf', storageKey: 'inv1/pv.pdf', sha256: 'def456', sizeBytes: 128000, chorusFileId: 'CF002', uploadedToChorus: true, createdAt: '2024-09-15T08:05:00Z' },
  { id: 'att3', tenantId: 't1', invoiceId: 'inv2', attachmentRole: 'MAIN', attachmentTypeCode: 'FACTURE', filename: 'FAC-2024-002.pdf', mimeType: 'application/pdf', storageKey: 'inv2/main.pdf', sha256: 'ghi789', sizeBytes: 310000, uploadedToChorus: false, createdAt: '2024-10-01T09:00:00Z' },
];

export const statusHistory: InvoiceStatusHistory[] = [
  { id: 'sh1', tenantId: 't1', invoiceId: 'inv1', source: 'SYSTEM', newStatus: 'DRAFT_UPLOADED', eventCode: 'UPLOAD', eventLabel: 'Facture déposée', occurredAt: '2024-09-15T08:00:00Z' },
  { id: 'sh2', tenantId: 't1', invoiceId: 'inv1', source: 'SYSTEM', previousStatus: 'DRAFT_UPLOADED', newStatus: 'DRAFT_STRUCTURED', eventCode: 'EXTRACT', eventLabel: 'Données extraites automatiquement', occurredAt: '2024-09-15T08:05:00Z' },
  { id: 'sh3', tenantId: 't1', invoiceId: 'inv1', source: 'USER', previousStatus: 'DRAFT_STRUCTURED', newStatus: 'READY_FOR_SUBMISSION', eventCode: 'VALIDATE', eventLabel: 'Validation métier réussie par Marie Dupont', occurredAt: '2024-09-15T09:00:00Z' },
  { id: 'sh4', tenantId: 't1', invoiceId: 'inv1', source: 'SYSTEM', previousStatus: 'READY_FOR_SUBMISSION', newStatus: 'SUBMITTED_TO_CHORUS', eventCode: 'SUBMIT', eventLabel: 'Soumis à Chorus Pro', occurredAt: '2024-09-16T10:00:00Z' },
  { id: 'sh5', tenantId: 't1', invoiceId: 'inv1', source: 'CHORUS', previousStatus: 'SUBMITTED_TO_CHORUS', newStatus: 'ACCEPTED_BY_CHORUS', eventCode: 'CHORUS_ACCEPT', eventLabel: 'Accepté par Chorus Pro - Mise en paiement', occurredAt: '2024-09-20T14:00:00Z' },
  { id: 'sh6', tenantId: 't1', invoiceId: 'inv3', source: 'SYSTEM', newStatus: 'DRAFT_UPLOADED', eventCode: 'UPLOAD', eventLabel: 'Facture déposée', occurredAt: '2024-10-05T10:00:00Z' },
  { id: 'sh7', tenantId: 't1', invoiceId: 'inv3', source: 'SYSTEM', previousStatus: 'DRAFT_UPLOADED', newStatus: 'READY_FOR_SUBMISSION', eventCode: 'VALIDATE', eventLabel: 'Validation automatique', occurredAt: '2024-10-05T10:30:00Z' },
  { id: 'sh8', tenantId: 't1', invoiceId: 'inv3', source: 'SYSTEM', previousStatus: 'READY_FOR_SUBMISSION', newStatus: 'SUBMITTED_TO_CHORUS', eventCode: 'SUBMIT', eventLabel: 'Soumis à Chorus Pro', occurredAt: '2024-10-06T14:00:00Z' },
  { id: 'sh9', tenantId: 't1', invoiceId: 'inv3', source: 'CHORUS', previousStatus: 'SUBMITTED_TO_CHORUS', newStatus: 'REJECTED_BUSINESS', eventCode: 'CHORUS_REJECT', eventLabel: 'Rejeté : numéro de bon de commande manquant', occurredAt: '2024-10-07T09:00:00Z' },
  { id: 'sh10', tenantId: 't1', invoiceId: 'inv6', source: 'SYSTEM', previousStatus: 'SUBMITTED_TO_CHORUS', newStatus: 'REJECTED_TECHNICAL', eventCode: 'CHORUS_TIMEOUT', eventLabel: 'Erreur technique : timeout API Chorus Pro', occurredAt: '2024-10-16T10:30:00Z' },
];

export const apiExchangeLogs: ApiExchangeLog[] = [
  { id: 'ae1', tenantId: 't1', invoiceId: 'inv1', targetSystem: 'CHORUS_PRO', operationName: 'uploadAttachment', correlationId: 'corr-001', direction: 'OUTBOUND', httpStatus: 200, success: true, latencyMs: 1250, createdAt: '2024-09-16T09:55:00Z' },
  { id: 'ae2', tenantId: 't1', invoiceId: 'inv1', targetSystem: 'CHORUS_PRO', operationName: 'submitInvoice', correlationId: 'corr-002', direction: 'OUTBOUND', httpStatus: 200, businessCode: 'OK', businessMessage: 'Facture acceptée', success: true, latencyMs: 2100, createdAt: '2024-09-16T10:00:00Z' },
  { id: 'ae3', tenantId: 't1', invoiceId: 'inv3', targetSystem: 'CHORUS_PRO', operationName: 'submitInvoice', correlationId: 'corr-003', direction: 'OUTBOUND', httpStatus: 400, businessCode: 'ERR_ENGAGEMENT', businessMessage: 'Bon de commande obligatoire pour ce service', success: false, latencyMs: 890, createdAt: '2024-10-06T14:00:00Z' },
  { id: 'ae4', tenantId: 't1', invoiceId: 'inv6', targetSystem: 'CHORUS_PRO', operationName: 'submitInvoice', correlationId: 'corr-004', direction: 'OUTBOUND', httpStatus: 504, businessCode: 'TIMEOUT', businessMessage: 'Gateway Timeout', success: false, latencyMs: 30000, createdAt: '2024-10-16T10:00:00Z' },
  { id: 'ae5', tenantId: 't1', invoiceId: 'inv1', targetSystem: 'CHORUS_PRO', operationName: 'getInvoiceStatus', correlationId: 'corr-005', direction: 'OUTBOUND', httpStatus: 200, success: true, latencyMs: 450, createdAt: '2024-09-20T14:00:00Z' },
];

export const asyncJobs: AsyncJob[] = [
  { id: 'job1', tenantId: 't1', invoiceId: 'inv1', jobType: 'SUBMIT_INVOICE', status: 'DONE', attemptCount: 1, maxAttempts: 5, createdAt: '2024-09-16T10:00:00Z', updatedAt: '2024-09-16T10:02:00Z' },
  { id: 'job2', tenantId: 't1', invoiceId: 'inv3', jobType: 'SUBMIT_INVOICE', status: 'FAILED', attemptCount: 1, maxAttempts: 5, lastErrorCode: 'ERR_ENGAGEMENT', lastErrorMessage: 'Bon de commande obligatoire pour ce service', createdAt: '2024-10-06T14:00:00Z', updatedAt: '2024-10-06T14:01:00Z' },
  { id: 'job3', tenantId: 't1', invoiceId: 'inv6', jobType: 'SUBMIT_INVOICE', status: 'FAILED', attemptCount: 3, maxAttempts: 5, nextAttemptAt: '2024-10-17T02:00:00Z', lastErrorCode: 'TIMEOUT', lastErrorMessage: 'Gateway Timeout lors de la soumission à Chorus Pro', createdAt: '2024-10-16T10:00:00Z', updatedAt: '2024-10-16T22:00:00Z' },
  { id: 'job4', tenantId: 't1', invoiceId: 'inv5', jobType: 'STATUS_SYNC', status: 'RUNNING', attemptCount: 1, maxAttempts: 3, createdAt: '2024-10-14T08:00:00Z', updatedAt: '2024-10-14T08:00:00Z' },
  { id: 'job5', tenantId: 't1', invoiceId: 'inv10', jobType: 'SUBMIT_INVOICE', status: 'PENDING', attemptCount: 0, maxAttempts: 5, nextAttemptAt: '2024-10-20T16:00:00Z', createdAt: '2024-10-20T15:00:00Z', updatedAt: '2024-10-20T15:00:00Z' },
  { id: 'job6', tenantId: 't1', invoiceId: 'inv4', jobType: 'EXTRACTION', status: 'DONE', attemptCount: 1, maxAttempts: 3, createdAt: '2024-10-10T08:10:00Z', updatedAt: '2024-10-10T08:15:00Z' },
  { id: 'job7', tenantId: 't1', jobType: 'STATUS_SYNC_BATCH', status: 'DEAD', attemptCount: 5, maxAttempts: 5, lastErrorCode: 'AUTH_EXPIRED', lastErrorMessage: 'Token d\'authentification Chorus Pro expiré', createdAt: '2024-10-01T00:00:00Z', updatedAt: '2024-10-03T00:00:00Z' },
];

export const auditLogs: AuditLog[] = [
  { id: 'al1', tenantId: 't1', actorType: 'USER', actorId: 'u1', actionCode: 'INVOICE_CREATE', entityType: 'Invoice', entityId: 'inv1', diff: { supplierInvoiceNumber: { before: null, after: 'FAC-2024-001' } }, ipAddress: '192.168.1.10', createdAt: '2024-09-15T08:00:00Z' },
  { id: 'al2', tenantId: 't1', actorType: 'SYSTEM', actorId: 'extraction-engine', actionCode: 'EXTRACTION_COMPLETE', entityType: 'Invoice', entityId: 'inv1', createdAt: '2024-09-15T08:05:00Z' },
  { id: 'al3', tenantId: 't1', actorType: 'USER', actorId: 'u1', actionCode: 'INVOICE_VALIDATE', entityType: 'Invoice', entityId: 'inv1', createdAt: '2024-09-15T09:00:00Z' },
  { id: 'al4', tenantId: 't1', actorType: 'SYSTEM', actorId: 'chorus-adapter', actionCode: 'INVOICE_SUBMIT', entityType: 'Invoice', entityId: 'inv1', createdAt: '2024-09-16T10:00:00Z' },
  { id: 'al5', tenantId: 't1', actorType: 'USER', actorId: 'u1', actionCode: 'INVOICE_CREATE', entityType: 'Invoice', entityId: 'inv3', ipAddress: '192.168.1.10', createdAt: '2024-10-05T10:00:00Z' },
  { id: 'al6', tenantId: 't1', actorType: 'USER', actorId: 'u1', actionCode: 'REF_UPDATE', entityType: 'PublicCustomer', entityId: 'pc5', diff: { active: { before: true, after: false } }, ipAddress: '192.168.1.10', createdAt: '2024-06-01T00:00:00Z' },
];

export const extractionResults: InvoiceExtractionResult[] = [
  {
    id: 'ex1', tenantId: 't1', invoiceId: 'inv4', engineName: 'OCR-Engine', engineVersion: '2.1.0',
    extractedPayload: {
      supplierInvoiceNumber: { value: 'FAC-2024-003', confidence: 0.92 },
      invoiceDate: { value: '2024-10-10', confidence: 0.88 },
      totalHt: { value: 3200, confidence: 0.75 },
      totalTtc: { value: 3840, confidence: 0.72 },
      siret: { value: '12345678901234', confidence: 0.60 },
    },
    confidenceScore: 0.65, requiresReview: true, createdAt: '2024-10-10T08:15:00Z'
  },
];

// Helper functions
export function getSupplier(id: string) { return suppliers.find(s => s.id === id); }
export function getCustomer(id: string) { return publicCustomers.find(c => c.id === id); }
export function getService(id: string) { return publicServices.find(s => s.id === id); }
export function getInvoiceHistory(invoiceId: string) { return statusHistory.filter(h => h.invoiceId === invoiceId).sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()); }
export function getInvoiceAttachments(invoiceId: string) { return invoiceAttachments.filter(a => a.invoiceId === invoiceId); }
export function getInvoiceLines(invoiceId: string) { return invoiceLines.filter(l => l.invoiceId === invoiceId); }
export function getInvoiceApiLogs(invoiceId: string) { return apiExchangeLogs.filter(l => l.invoiceId === invoiceId); }
export function getServicesForCustomer(customerId: string) { return publicServices.filter(s => s.publicCustomerId === customerId); }
