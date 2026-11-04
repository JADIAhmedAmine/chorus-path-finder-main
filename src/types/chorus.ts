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
  destinataire: {
    codeDestinataire: string;
    codeServiceExecutant?: string;
  };
  identifiantFactureCPP: number;
  reference?: {
    numeroBonCommande?: string;
  };
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
  historyStatusPersisted?: boolean;
  apiCalls: ChorusApiDebugEntry[];
}

export type ChorusBackendErrorCategory =
  | 'STATUS_NOT_ALLOWED'
  | 'BUSINESS_REJECTION'
  | 'VALIDATION'
  | 'AUTH'
  | 'RATE_LIMIT'
  | 'NOT_FOUND'
  | 'NETWORK'
  | 'UNKNOWN';

// === Réception : consultation côté valideur (POST /v1/consulter/valideur) ===
// Le backend renvoie une facture normalisée à plat (cf. chorus_python/reception.py).

export interface ReceptionInvoiceAddress {
  ligne: string | null;
  ville: string | null;
  codePostal: string | null;
  codePays: string | null;
  libellePays: string | null;
}

export interface ReceptionInvoiceParty {
  id: string | null;
  siret: string | null;
  raisonSociale: string | null;
  codeService: string | null;
  code: string | null;
  typeIdentifiant: string | null;
  serviceExecutantId: string | null;
  serviceExecutantLibelle: string | null;
  miseEnPaiement: boolean | null;
  adresse: ReceptionInvoiceAddress | null;
}

export interface ReceptionInvoiceDates {
  dateFacture: string | null;
  dateDepot: string | null;
  dateEcheancePaiement: string | null;
  dateCreationFacture: string | null;
}

export interface ReceptionInvoiceAmounts {
  ht: number;
  tva: number;
  ttc: number;
  aPayer: number;
  devise: string;
  remiseGlobaleTtc: number;
  ttcAvantRemiseGlobale: number | null;
  libelleDevise: string | null;
}

export interface ReceptionInvoiceReferences {
  numeroBonCommande: string | null;
  numeroMarche: string | null;
  numeroDpMandat: string | null;
  numeroFactureOrigine: string | null;
  motifExonerationTva: string | null;
  modePaiement: string | null;
  typeFacture: string | null;
  typeTva: string | null;
  tailleTotalePiecesJointes: number | null;
}

export interface ReceptionInvoiceCadre {
  code: string | null;
  libelle: string | null;
}

export interface ReceptionInvoiceAttachment {
  role: 'PRINCIPALE' | 'COMPLEMENTAIRE';
  pieceJointeId: string | null;
  designation: string | null;
  typeCode: string | null;
  typeLibelle: string | null;
  extension: string | null;
  mimeType: string | null;
  numeroLigneFacture: string | null;
  idLiaison: string | null;
}

export interface ReceptionInvoiceLine {
  numero: string;
  reference: string | null;
  denomination: string | null;
  quantite: number | null;
  unite: string | null;
  puHt: number | null;
  remiseHt: number | null;
  tauxTva: string | null;
  montantTva: number | null;
  montantHtApresRemise: number | null;
  montantTtcApresRemise: number | null;
}

export interface ReceptionInvoiceVatLine {
  taux: string | null;
  tauxValeur: number | null;
  baseHt: number | null;
  montantTva: number | null;
}

export interface ReceptionInvoice {
  identifiantFactureCPP: number | null;
  numeroFacture: string | null;
  statutFacture: string | null;
  modeDepot: string | null;
  rejetTraite: boolean | null;
  commentaire: string | null;
  cadreDeFacturation: ReceptionInvoiceCadre | null;
  fournisseur: ReceptionInvoiceParty | null;
  destinataire: ReceptionInvoiceParty | null;
  dates: ReceptionInvoiceDates;
  montants: ReceptionInvoiceAmounts;
  references: ReceptionInvoiceReferences;
  piecesJointes: ReceptionInvoiceAttachment[];
  lignesDePoste: ReceptionInvoiceLine[];
  recapitulatifTva: ReceptionInvoiceVatLine[];
}

export interface ReceptionConsultSuccess {
  ok: true;
  success: true;
  identifiantFactureCPP: number;
  facture: ReceptionInvoice;
  persisted?: boolean;
  apiCalls?: ChorusApiDebugEntry[];
}

export interface ReceptionConsultError {
  ok: false;
  success: false;
  identifiantFactureCPP?: number;
  category: ChorusBackendErrorCategory | string;
  human_message: string;
  raw_message: string;
  recommended_action: string;
  severity?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  code_retour?: number;
  chorus_code?: string;
  matched_states?: string[];
  apiCalls?: ChorusApiDebugEntry[];
}

export type ReceptionConsultResult = ReceptionConsultSuccess | ReceptionConsultError;

export interface ReceptionBulkResultItem {
  identifiantFactureCPP: number;
  success: true;
  facture: ReceptionInvoice;
  persisted?: boolean;
}

export interface ReceptionBulkResultError {
  identifiantFactureCPP: number;
  success: false;
  category: ChorusBackendErrorCategory | string;
  human_message: string;
  raw_message: string;
  recommended_action: string;
  severity?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  code_retour?: number;
  chorus_code?: string;
}

export interface ReceptionBulkConsultResult {
  ok: true;
  success: true;
  totalRequested: number;
  totalSuccess: number;
  totalFailed: number;
  items: ReceptionBulkResultItem[];
  errors: ReceptionBulkResultError[];
  apiCalls?: ChorusApiDebugEntry[];
}

// === Traitement d'une facture reçue (POST /v1/traiter/recue) ===

export const RECEPTION_PROCESS_STATUSES = [
  'A_RECYCLER',
  'COMPLETEE',
  'COMPTABILISEE',
  'MISE_A_DISPOSITION',
  'MISE_A_DISPOSITION_COMPTABLE',
  'MISE_EN_PAIEMENT',
  'PRISE_EN_COMPTE_DESTINATAIRE',
  'REJETEE',
  'SERVICE_FAIT',
  'SUSPENDUE',
  'TRANSMISE_MOA',
  'MANDATEE',
] as const;
export type ReceptionProcessStatus = typeof RECEPTION_PROCESS_STATUSES[number];

export const RECEPTION_PROCESS_MOTIF_REQUIRED: ReadonlySet<ReceptionProcessStatus> = new Set<ReceptionProcessStatus>([
  'REJETEE',
  'SUSPENDUE',
]);

export interface ReceptionProcessInput {
  idFacture: number;
  nouveauStatut: ReceptionProcessStatus;
  motif?: string;
  numeroDPMandat?: string;
}

export interface ReceptionProcessSuccess {
  ok: true;
  success: true;
  processedPersisted?: boolean;
  payload: {
    idFacture: number;
    nouveauStatut: ReceptionProcessStatus;
    motif?: string;
    numeroDPMandat?: string;
    idUtilisateurCourant?: number;
  };
  response: {
    codeRetour?: number;
    libelle?: string;
    [key: string]: unknown;
  };
  apiCalls?: ChorusApiDebugEntry[];
}

export type ReceptionProcessResult = ReceptionProcessSuccess | ReceptionConsultError;

// === Complément d'une facture suspendue (POST /v1/completer) ===

export interface ReceptionCompleteAttachmentInput {
  pieceJointeComplementaireDesignation: string;
  pieceJointeComplementaireId: number;
  pieceJointeComplementaireNumeroLigneFacture?: number;
  pieceJointeComplementaireType: string;
}

export interface ReceptionCompleteInput {
  identifiantFactureCPP: number;
  commentaire?: string;
  idUtilisateurCourant?: number;
  pieceJointeComplementaire?: ReceptionCompleteAttachmentInput[];
  attachmentFiles?: Array<{
    file: File;
    designation?: string;
    type?: string;
    lineNumber?: number;
  }>;
}

export interface ReceptionCompleteSuccess {
  ok: true;
  success: true;
  identifiantFactureCPP: number;
  numeroFacture?: string | null;
  dateTraitement?: string | null;
  libelle?: string | null;
  raw?: Record<string, unknown>;
  apiCalls?: ChorusApiDebugEntry[];
}

export type ReceptionCompleteResult = ReceptionCompleteSuccess | ReceptionConsultError;

// === Téléchargement groupé (POST /v1/telecharger/groupe) ===

export type ReceptionDownloadFormat = 'PDF' | 'XML' | 'ZIP';

export interface ReceptionDownloadInput {
  idFacture: number;
  format: ReceptionDownloadFormat;
  /** Inclure les pièces jointes complémentaires (par défaut true côté backend). */
  avecPiecesJointesComplementaires?: boolean;
}

export interface ReceptionDownloadSuccess {
  ok: true;
  blob: Blob;
  filename: string;
  mimeType: string;
  codeRetour: number | null;
  libelle: string | null;
}

export type ReceptionDownloadResult = ReceptionDownloadSuccess | ReceptionConsultError;

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
