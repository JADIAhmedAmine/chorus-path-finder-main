import type {
  ChorusInvoiceType,
  ChorusPaymentMode,
  ChorusSubmissionPayload,
  ChorusVatType,
} from '@/lib/chorus/types';

export type ChorusConnectorMode = 'mock' | 'direct';
export type ChorusConnectionTestMethod = 'GET' | 'POST';

export interface ChorusConfig {
  enabled: boolean;
  mode: ChorusConnectorMode;
  tokenUrl: string;
  apiBaseUrl: string;
  clientId: string;
  clientSecret: string;
  scope: string;
  technicalLogin: string;
  technicalPassword: string;
  connectionTestPath: string;
  connectionTestMethod: ChorusConnectionTestMethod;
  uploadFilePath: string;
  submitInvoicePath: string;
  userAccountPath: string;
  userConnectionsPath: string;
  submissionCurrentUserId: string;
  submissionSupplierId: string;
  submissionSupplierServiceId: string;
  submissionBankAccountCode: string;
  submissionCadreCode: string;
  submissionValidatorServiceCode: string;
  submissionValidatorStructureCode: string;
  submissionPaymentMode: ChorusPaymentMode;
  submissionInvoiceType: ChorusInvoiceType;
  submissionVatType: ChorusVatType | 'AUTO';
  submissionVatExonerationReason: string;
  submissionOriginalInvoiceNumber: string;
  submissionComment: string;
}

export interface ChorusConnectionResult {
  ok: boolean;
  message: string;
  tokenPreview?: string;
  response?: unknown;
}

export interface ChorusResolvedAttachmentService {
  codeService?: string;
  estActif?: boolean;
  idService?: number;
  libelleService?: string;
  statutRattachementService?: string;
  statutService?: string;
}

export interface ChorusResolvedStructureAttachment {
  designationStructure?: string;
  idRattachementStructure?: number;
  idStructure?: number;
  identifiantStructure?: string;
  listeServicesRattache: ChorusResolvedAttachmentService[];
  roleUtilisateur?: string;
  statutRattachementStructure?: string;
  statutUtilisateur?: string;
  typeIdentifiantStructure?: string;
}

export interface ChorusTechnicalContextResolutionInput {
  userEmail?: string;
  supplierSiret?: string;
  supplierServiceCodeHint?: string;
}

export interface ChorusTechnicalContextResolutionResult {
  ok: boolean;
  message: string;
  userId?: number;
  supplierStructureId?: number;
  supplierServiceId?: number;
  supplierServiceCode?: string;
  matchedOnSupplierSiret: boolean;
  availableStructures: ChorusResolvedStructureAttachment[];
  accountResponse?: unknown;
  attachmentsResponse?: unknown;
}

export interface ChorusUploadedFile {
  id: string;
  filename: string;
  response?: unknown;
}

export interface ChorusSubmitInvoiceInput {
  invoiceData: ChorusSubmissionPayload;
  mainFile: File;
  attachments: File[];
}

export interface ChorusSubmitInvoiceResult {
  ok: boolean;
  externalId?: string;
  uploadedFiles: ChorusUploadedFile[];
  response?: unknown;
}
