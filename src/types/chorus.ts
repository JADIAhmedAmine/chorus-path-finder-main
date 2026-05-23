import type {
  ChorusInvoiceType,
  ChorusPaymentMode,
  ChorusSubmissionPayload,
  ChorusVatType,
} from '@/lib/chorus/types';

export type ChorusConnectorMode = 'mock' | 'direct';
export type ChorusConnectionTestMethod = 'GET' | 'POST';
export type ChorusEnvironment = 'qualif' | 'prod';

export interface ChorusConfig {
  enabled: boolean;
  mode: ChorusConnectorMode;
  environment: ChorusEnvironment;
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
  submissionBridgeUrl: string;
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
  role?: 'MAIN' | 'COMPLEMENTARY';
  designation?: string;
  type?: string;
  lineNumber?: number;
  liaisonId?: number;
  response?: unknown;
}

export interface ChorusApiDebugEntry {
  label: string;
  method: 'POST' | 'GET';
  url: string;
  requestBody?: unknown;
  responseStatus?: number;
  responseBody?: unknown;
}

export interface ChorusSubmitInvoiceInput {
  invoiceData: ChorusSubmissionPayload;
  mainFile: File;
  attachments: ChorusSubmitAttachmentInput[];
  debugBypassValidation?: boolean;
  /**
   * État courant Chorus de la demande de paiement, si déjà connu.
   * Le backend bloque la soumission si l'état n'autorise pas l'action
   * (cf. chorus_python/submission_state.py).
   */
  currentState?: string;
}

export type ChorusSubmitAttachmentInput = File | {
  file: File;
  designation?: string;
  type?: string;
  lineNumber?: number;
  liaisonId?: number;
};

export interface ChorusSubmitInvoiceResult {
  ok: boolean;
  externalId?: string;
  uploadedFiles: ChorusUploadedFile[];
  submittedPayload?: unknown;
  response?: unknown;
  apiCalls: ChorusApiDebugEntry[];
}

export interface ChorusRecycleInvoicePayload {
  commentaire?: string;
  destinataire: {
    codeDestinataire: string;
  };
  identifiantFactureCPP: number;
}

export interface ChorusRecycleInvoiceResult {
  ok: boolean;
  externalId?: string;
  payload?: unknown;
  response?: unknown;
  apiCalls: ChorusApiDebugEntry[];
}

export interface ChorusCorrectValidatorPayload {
  idFacture: number;
  idStructure?: number;
  identifiantStructure?: string;
  typeIdentifiantStructure: 'SIRET' | string;
}

export interface ChorusCorrectValidatorResult {
  ok: boolean;
  payload?: unknown;
  response?: {
    codeRetour?: number;
    idFacture?: number;
    libelle?: string;
  } | unknown;
  apiCalls: ChorusApiDebugEntry[];
}

export interface ChorusInvoiceHistoryPayload {
  idFacture: number;
  nbResultatsMaximum: number;
  paramRechercheHistoActionsUtilisateurs: {
    nbResultatsParPageListeHistoAction: number;
    pageResultatDemandeeListeHistoAction: number;
    triColonneListeHistoAction: 'HistoActionDateHeure' | string;
    triSensListeHistoAction: 'Descendant' | 'Ascendant' | string;
  };
  paramRechercheHistoEvenementsComplementaires: {
    nbResultatsParPageListeHistoEvenement: number;
    pageResultatDemandeeListeHistoEvenement: number;
    triColonneListeHistoEvenement: 'EvenementLibelle' | string;
    triSensListeHistoEvenement: 'Descendant' | 'Ascendant' | string;
  };
  paramRechercheHistoStatuts: {
    nbResultatsParPageListeHistoStatut: number;
    pageResultatDemandeeListeHistoStatut: number;
    triColonneListeHistoStatut: 'HistoStatutDatePassage' | 'HistoStatutCode' | string;
    triSensListeHistoStatut: 'Descendant' | 'Ascendant' | string;
  };
}

export interface ChorusInvoiceHistoryStatus {
  histoStatutId?: number;
  histoStatutCode?: string;
  histoStatutDatePassage?: string;
  histoStatutCommentaire?: string;
  histoStatutUtilisateurPrenom?: string;
  histoStatutUtilisateurNom?: string;
  histoStatutUtilisateurEmail?: string;
  histoStatutUtilisateurTelephone?: string;
}

export interface ChorusInvoiceHistoryAction {
  histoActionId?: number;
  histoActionCode?: string;
  histoActionDateHeure?: string;
  histoActionUtilisateurPrenom?: string;
  histoActionUtilisateurNom?: string;
  histoActionUtilisateurEmail?: string;
  histoActionUtilisateurTelephone?: string;
}

export interface ChorusInvoiceHistoryResponse {
  codeRetour?: number;
  libelle?: string;
  idFacture?: number;
  numeroFacture?: string;
  modeDepot?: string;
  statutCourantCode?: string;
  historiquesDesStatuts?: {
    histoStatut?: ChorusInvoiceHistoryStatus[];
    pageCouranteHistoStatut?: number;
    pagesHistoStatut?: number;
    nbResultatsParPageHistoStatut?: number;
    totalHistoStatut?: number;
  };
  historiquesDesActionsUtilisateurs?: {
    histoAction?: ChorusInvoiceHistoryAction[];
    pageCouranteHistoAction?: number;
    pagesHistoAction?: number;
    nbResultatsParPageHistoAction?: number;
    totalHistoAction?: number;
  };
  derniereAction?: {
    derniereActionId?: number;
    derniereActionCode?: string;
  };
}

export interface ChorusInvoiceHistoryResult {
  ok: boolean;
  payload?: unknown;
  response?: ChorusInvoiceHistoryResponse;
  apiCalls: ChorusApiDebugEntry[];
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
  codeDestinataire?: string;
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
  supplierSiret?: string;
  recipientCode?: string;
  recipientSiret?: string;
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
