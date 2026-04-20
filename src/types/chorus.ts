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
  referenceApiBaseUrl: string;
  referenceSuppliersPath: string;
  referencePublicCustomersPath: string;
  referencePublicServicesPath: string;
  referenceAnnuaireJsonUrl: string;
  referenceAnnuaireXmlUrl: string;
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
  debugBypassValidation?: boolean;
}

export interface ChorusSubmitInvoiceResult {
  ok: boolean;
  externalId?: string;
  uploadedFiles: ChorusUploadedFile[];
  response?: unknown;
}

export interface ChorusTransverseCodeListItem {
  code: string;
  label?: string;
}

export interface ChorusTransverseVatRate {
  code: string;
  label?: string;
  rate?: number;
}

export interface ChorusTransverseStructure {
  designationStructure?: string;
  idStructureCPP?: number;
  identifiant?: string;
}

export interface ChorusTransverseBankAccount {
  idCoordonneeBancaire?: number;
  nomCoordonneeBancaire?: string;
}

export interface ChorusTransverseRecipient {
  adresseCodePostal?: string;
  adresseVille?: string;
  idStructureCPP?: number;
  nomDestinataire?: string;
  siret?: string;
}

export interface ChorusTransverseOperatingService {
  codeServiceExecutant?: string;
  idServicesCPP?: number;
  nomServiceExecutant?: string;
}

export interface ChorusSubmissionReferenceResolutionInput {
  payload: ChorusSubmissionPayload;
  codeLangue?: 'FR' | 'EN';
}

export interface ChorusSubmissionReferenceChecks {
  cadreFacturationValid: boolean;
  deviseValid: boolean;
  modePaiementValid: boolean;
  modeDepotValid: boolean;
  fournisseurStructureValid: boolean;
  coordonneeBancaireValide: boolean;
  destinataireTrouve: boolean;
  serviceExecutantTrouve: boolean;
  tauxTvaValides: boolean;
  warnings: string[];
}

export interface ChorusSubmissionReferenceSnapshot {
  cadresFacturation: ChorusTransverseCodeListItem[];
  devises: ChorusTransverseCodeListItem[];
  tauxTva: ChorusTransverseVatRate[];
  modesReglement: ChorusTransverseCodeListItem[];
  modesDepot: ChorusTransverseCodeListItem[];
  coordonneesBancaires: ChorusTransverseBankAccount[];
  structuresFournisseur: ChorusTransverseStructure[];
  destinataires: ChorusTransverseRecipient[];
  servicesExecutants: ChorusTransverseOperatingService[];
  checks: ChorusSubmissionReferenceChecks;
}
