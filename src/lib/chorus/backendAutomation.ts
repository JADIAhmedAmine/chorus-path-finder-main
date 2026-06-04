import { authHeaders } from '@/lib/auth/session';
import type {
  ChorusApiDebugEntry,
  ChorusConfig,
  ChorusCorrectValidatorPayload,
  ChorusCorrectValidatorResult,
  ChorusInvoiceHistoryPayload,
  ChorusInvoiceHistoryResponse,
  ChorusInvoiceHistoryResult,
  ChorusRecycleInvoicePayload,
  ChorusRecycleInvoiceResult,
  ReceptionBulkConsultResult,
  ReceptionConsultResult,
  ReceptionInvoice,
  ReceptionCompleteInput,
  ReceptionCompleteResult,
  ReceptionCompleteSuccess,
  ReceptionDownloadInput,
  ReceptionDownloadResult,
  ReceptionProcessInput,
  ReceptionProcessResult,
  ReceptionProcessSuccess,
} from '@/types/chorus';

export const CHORUS_OAUTH_TOKEN_PATH = '/api/chorus/oauth-token';
export const CHORUS_SUBMIT_PATH = '/api/chorus/submit';
export const CHORUS_RECYCLE_PATH = '/api/chorus/recycle';
export const CHORUS_CORRECT_VALIDATOR_PATH = '/api/chorus/validator/correct';
export const RECEPTION_CONSULT_PATH = '/api/reception/consult';
export const RECEPTION_CONSULT_BULK_PATH = '/api/reception/consult-bulk';
export const RECEPTION_PROCESS_PATH = '/api/reception/process';
export const RECEPTION_COMPLETE_PATH = '/api/reception/complete';
export const RECEPTION_DOWNLOAD_PATH = '/api/reception/download';
export const CHORUS_INVOICE_DOWNLOAD_PATH = '/api/chorus/invoices/download';
export const CHORUS_INVOICE_HISTORY_PATH = '/api/chorus/invoices/history';
export const CHORUS_ANNUAIRE_SYNC_PATH = '/api/chorus/annuaire/sync';
export const CHORUS_SIRET_INFO_PATH = '/api/chorus/siret/info';
export const CHORUS_ACTIVE_RECIPIENT_STRUCTURES_PATH = '/api/chorus/structures/active-destinataire';
export const CHORUS_SUPPLIER_INVOICES_SEARCH_PATH = '/api/chorus/invoices/supplier/search';

export interface ChorusAnnuaireSyncResult {
  ok: boolean;
  codeRetour?: number | string | null;
  libelle?: string | null;
  generatedAt?: string;
  sourceFile?: string;
  structureCount: number;
  serviceCount: number;
  jsonPath?: string;
  xmlPath?: string;
  apiCalls: ChorusApiDebugEntry[];
}

export interface ChorusSiretInformationResult {
  ok: boolean;
  siretStructure: string;
  info: unknown;
  apiCalls: ChorusApiDebugEntry[];
}

export interface ChorusActiveRecipientStructuresResult {
  ok: boolean;
  idFournisseur: number;
  idStructureCPP: number;
  structures: unknown[];
  rawResponse?: unknown;
  apiCalls: ChorusApiDebugEntry[];
}

export interface ChorusSupplierInvoicesSearchResult {
  ok: boolean;
  idFournisseur: number;
  total: number;
  returned: number;
  requestedPageSize: number;
  payload?: unknown;
  invoices: unknown[];
  rawResponse?: unknown;
  initialResponse?: unknown;
  apiCalls: ChorusApiDebugEntry[];
}

export interface ChorusSupplierInvoicesSearchInput {
  idFournisseur?: number | string;
  coordonneeBancaire?: number | string;
  idServiceFournisseur?: number | string;
  idStructureValideur?: number | string;
  idUtilisateurCourant?: number | string;
  idUtilisateurCreateur?: Array<number | string>;
  idDestinataire?: number | string;
  listeIdServiceExecutant?: Array<number | string>;
  destinataire?: string;
  raisonSocialeStuctDmd?: string;
  modeDepot?: string;
  montantApayerMax?: number | string;
  montantApayerMin?: number | string;
  montantHTMax?: number | string;
  montantHTMin?: number | string;
  montantTTCMax?: number | string;
  montantTTCMin?: number | string;
  numeroBonCommande?: string;
  numeroFacture?: string;
  numeroFactureOrigine?: string;
  numeroFluxDepot?: string;
  numeroMarche?: string;
  periodeDateDepotAu?: string;
  periodeDateDepotDu?: string;
  periodeDateFactureAu?: string;
  periodeDateFactureDu?: string;
  periodeDateHeureEtatCourantAu?: string;
  periodeDateHeureEtatCourantDu?: string;
  rechercheFactureParFournisseur?: {
    triColonne?: string;
    triSens?: string;
  };
  rechercheSirenDestinataire?: boolean;
  rejetTraite?: boolean;
  statutCourant?: string[];
  typeFacture?: string;
}

export class ChorusBackendAutomationError extends Error {
  readonly apiCalls: ChorusApiDebugEntry[];

  constructor(message: string, apiCalls: ChorusApiDebugEntry[] = []) {
    super(message);
    this.name = 'ChorusBackendAutomationError';
    this.apiCalls = [...apiCalls];
  }
}

function getDefaultFetchImpl(): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init)) as typeof fetch;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function asCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function isApiDebugEntryArray(value: unknown): value is ChorusApiDebugEntry[] {
  return Array.isArray(value);
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? '';
  const rawBody = await response.text();
  const trimmedBody = rawBody.trim();

  if (!trimmedBody) {
    return undefined;
  }

  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(trimmedBody);
    } catch {
      return rawBody;
    }
  }

  return rawBody;
}

export function resolveChorusBridgeUrl(config: ChorusConfig, path: string): string {
  const configuredBridgeUrl = config.submissionBridgeUrl.trim();

  if (!configuredBridgeUrl) {
    return path;
  }

  if (/^https?:\/\//i.test(configuredBridgeUrl)) {
    const parsedUrl = new URL(configuredBridgeUrl);
    parsedUrl.pathname = path;
    parsedUrl.search = '';
    parsedUrl.hash = '';
    return parsedUrl.toString();
  }

  if (configuredBridgeUrl.startsWith('/')) {
    return path;
  }

  return path;
}

function normalizeAnnuaireSyncResult(body: unknown): ChorusAnnuaireSyncResult {
  if (!isRecord(body)) {
    throw new ChorusBackendAutomationError('Réponse backend annuaire invalide.');
  }

  return {
    ok: body.ok === true,
    codeRetour: typeof body.codeRetour === 'number' || typeof body.codeRetour === 'string' ? body.codeRetour : null,
    libelle: typeof body.libelle === 'string' ? body.libelle : null,
    generatedAt: asString(body.generatedAt),
    sourceFile: asString(body.sourceFile),
    structureCount: asCount(body.structureCount),
    serviceCount: asCount(body.serviceCount),
    jsonPath: asString(body.jsonPath),
    xmlPath: asString(body.xmlPath),
    apiCalls: isApiDebugEntryArray(body.apiCalls) ? body.apiCalls : [],
  };
}

function normalizeSiretInformationResult(body: unknown): ChorusSiretInformationResult {
  if (!isRecord(body)) {
    throw new ChorusBackendAutomationError('Réponse backend SIRET invalide.');
  }

  return {
    ok: body.ok === true,
    siretStructure: typeof body.siretStructure === 'string' ? body.siretStructure : '',
    info: body.info,
    apiCalls: isApiDebugEntryArray(body.apiCalls) ? body.apiCalls : [],
  };
}

function normalizeSupplierInvoicesSearchResult(body: unknown): ChorusSupplierInvoicesSearchResult {
  if (!isRecord(body)) {
    throw new ChorusBackendAutomationError('Réponse backend factures fournisseur invalide.');
  }

  return {
    ok: body.ok === true,
    idFournisseur: asCount(body.idFournisseur),
    total: asCount(body.total),
    returned: asCount(body.returned),
    requestedPageSize: asCount(body.requestedPageSize),
    payload: body.payload,
    invoices: Array.isArray(body.invoices) ? body.invoices : [],
    rawResponse: body.rawResponse,
    initialResponse: body.initialResponse,
    apiCalls: isApiDebugEntryArray(body.apiCalls) ? body.apiCalls : [],
  };
}

function normalizeActiveRecipientStructuresResult(body: unknown): ChorusActiveRecipientStructuresResult {
  if (!isRecord(body)) {
    throw new ChorusBackendAutomationError('Réponse backend structures destinataire invalide.');
  }

  return {
    ok: body.ok === true,
    idFournisseur: asCount(body.idFournisseur),
    idStructureCPP: asCount(body.idStructureCPP),
    structures: Array.isArray(body.structures) ? body.structures : [],
    rawResponse: body.rawResponse,
    apiCalls: isApiDebugEntryArray(body.apiCalls) ? body.apiCalls : [],
  };
}

function normalizeRecycleInvoiceResult(body: unknown): ChorusRecycleInvoiceResult {
  if (!isRecord(body)) {
    throw new ChorusBackendAutomationError('Réponse backend recyclage invalide.');
  }

  return {
    ok: body.ok === true,
    externalId: asString(body.externalId),
    payload: body.payload,
    response: body.response,
    apiCalls: isApiDebugEntryArray(body.apiCalls) ? body.apiCalls : [],
  };
}

function normalizeCorrectValidatorResult(body: unknown): ChorusCorrectValidatorResult {
  if (!isRecord(body)) {
    throw new ChorusBackendAutomationError('Réponse backend correction valideur invalide.');
  }

  return {
    ok: body.ok === true,
    payload: body.payload,
    response: body.response,
    apiCalls: isApiDebugEntryArray(body.apiCalls) ? body.apiCalls : [],
  };
}

function normalizeInvoiceHistoryResult(body: unknown): ChorusInvoiceHistoryResult {
  if (!isRecord(body)) {
    throw new ChorusBackendAutomationError('Réponse backend historique facture invalide.');
  }

  return {
    ok: body.ok === true,
    payload: body.payload,
    response: isRecord(body.response) ? body.response as ChorusInvoiceHistoryResponse : undefined,
    historyStatusPersisted: body.historyStatusPersisted === true,
    apiCalls: isApiDebugEntryArray(body.apiCalls) ? body.apiCalls : [],
  };
}

async function readFileAsBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return globalThis.btoa(binary);
}

export class ChorusBackendAutomationClient {
  constructor(
    private readonly config: ChorusConfig,
    private readonly fetchImpl: typeof fetch = getDefaultFetchImpl(),
  ) {}

  get annuaireSyncUrl(): string {
    return resolveChorusBridgeUrl(this.config, CHORUS_ANNUAIRE_SYNC_PATH);
  }

  get siretInfoUrl(): string {
    return resolveChorusBridgeUrl(this.config, CHORUS_SIRET_INFO_PATH);
  }

  get activeRecipientStructuresUrl(): string {
    return resolveChorusBridgeUrl(this.config, CHORUS_ACTIVE_RECIPIENT_STRUCTURES_PATH);
  }

  get supplierInvoicesSearchUrl(): string {
    return resolveChorusBridgeUrl(this.config, CHORUS_SUPPLIER_INVOICES_SEARCH_PATH);
  }

  get recycleInvoiceUrl(): string {
    return resolveChorusBridgeUrl(this.config, CHORUS_RECYCLE_PATH);
  }

  get correctValidatorUrl(): string {
    return resolveChorusBridgeUrl(this.config, CHORUS_CORRECT_VALIDATOR_PATH);
  }

  get receptionConsultUrl(): string {
    return resolveChorusBridgeUrl(this.config, RECEPTION_CONSULT_PATH);
  }

  get receptionConsultBulkUrl(): string {
    return resolveChorusBridgeUrl(this.config, RECEPTION_CONSULT_BULK_PATH);
  }

  get receptionProcessUrl(): string {
    return resolveChorusBridgeUrl(this.config, RECEPTION_PROCESS_PATH);
  }

  get receptionCompleteUrl(): string {
    return resolveChorusBridgeUrl(this.config, RECEPTION_COMPLETE_PATH);
  }

  get receptionDownloadUrl(): string {
    return resolveChorusBridgeUrl(this.config, RECEPTION_DOWNLOAD_PATH);
  }

  get invoiceDownloadUrl(): string {
    return resolveChorusBridgeUrl(this.config, CHORUS_INVOICE_DOWNLOAD_PATH);
  }

  get invoiceHistoryUrl(): string {
    return resolveChorusBridgeUrl(this.config, CHORUS_INVOICE_HISTORY_PATH);
  }

  async syncAnnuaire(): Promise<ChorusAnnuaireSyncResult> {
    const response = await this.fetchImpl(this.annuaireSyncUrl, {
      method: 'POST',
      headers: authHeaders({
        Accept: 'application/json',
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify({ environment: this.config.environment }),
    });

    const body = await parseResponseBody(response);
    const apiCalls = isRecord(body) && isApiDebugEntryArray(body.apiCalls) ? body.apiCalls : [];

    if (!response.ok || !isRecord(body) || body.ok !== true) {
      const message = isRecord(body) && typeof body.error === 'string'
        ? body.error
        : `Synchronisation annuaire impossible (${response.status}).`;
      throw new ChorusBackendAutomationError(message, apiCalls);
    }

    return normalizeAnnuaireSyncResult(body);
  }

  async consultSiretInformation(siretStructure: string): Promise<ChorusSiretInformationResult> {
    const response = await this.fetchImpl(this.siretInfoUrl, {
      method: 'POST',
      headers: authHeaders({
        Accept: 'application/json',
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify({
        environment: this.config.environment,
        siretStructure,
      }),
    });

    const body = await parseResponseBody(response);
    const apiCalls = isRecord(body) && isApiDebugEntryArray(body.apiCalls) ? body.apiCalls : [];

    if (!response.ok || !isRecord(body) || body.ok !== true) {
      const message = isRecord(body) && typeof body.error === 'string'
        ? body.error
        : `Consultation SIRET impossible (${response.status}).`;
      throw new ChorusBackendAutomationError(message, apiCalls);
    }

    return normalizeSiretInformationResult(body);
  }

  async searchSupplierInvoices(input: ChorusSupplierInvoicesSearchInput = {}): Promise<ChorusSupplierInvoicesSearchResult> {
    const response = await this.fetchImpl(this.supplierInvoicesSearchUrl, {
      method: 'POST',
      headers: authHeaders({
        Accept: 'application/json',
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify({
        ...input,
        environment: this.config.environment,
      }),
    });

    const body = await parseResponseBody(response);
    const apiCalls = isRecord(body) && isApiDebugEntryArray(body.apiCalls) ? body.apiCalls : [];

    if (!response.ok || !isRecord(body) || body.ok !== true) {
      const message = isRecord(body) && typeof body.error === 'string'
        ? body.error
        : `Recherche factures fournisseur impossible (${response.status}).`;
      throw new ChorusBackendAutomationError(message, apiCalls);
    }

    return normalizeSupplierInvoicesSearchResult(body);
  }

  async getActiveRecipientStructures(idFournisseur?: number | string): Promise<ChorusActiveRecipientStructuresResult> {
    const requestBody = idFournisseur
      ? { environment: this.config.environment, idFournisseur }
      : { environment: this.config.environment };
    const response = await this.fetchImpl(this.activeRecipientStructuresUrl, {
      method: 'POST',
      headers: authHeaders({
        Accept: 'application/json',
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify(requestBody),
    });

    const body = await parseResponseBody(response);
    const apiCalls = isRecord(body) && isApiDebugEntryArray(body.apiCalls) ? body.apiCalls : [];

    if (!response.ok || !isRecord(body) || body.ok !== true) {
      const message = isRecord(body) && typeof body.error === 'string'
        ? body.error
        : `Récupération des structures actives destinataire impossible (${response.status}).`;
      throw new ChorusBackendAutomationError(message, apiCalls);
    }

    return normalizeActiveRecipientStructuresResult(body);
  }

  async recycleInvoice(payload: ChorusRecycleInvoicePayload): Promise<ChorusRecycleInvoiceResult> {
    const response = await this.fetchImpl(this.recycleInvoiceUrl, {
      method: 'POST',
      headers: authHeaders({
        Accept: 'application/json',
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify({
        environment: this.config.environment,
        payload,
      }),
    });

    const body = await parseResponseBody(response);
    const apiCalls = isRecord(body) && isApiDebugEntryArray(body.apiCalls) ? body.apiCalls : [];

    if (!response.ok || !isRecord(body) || body.ok !== true) {
      const message = isRecord(body) && typeof body.error === 'string'
        ? body.error
        : `Recyclage facture impossible (${response.status}).`;
      throw new ChorusBackendAutomationError(message, apiCalls);
    }

    return normalizeRecycleInvoiceResult(body);
  }

  async correctInvoiceValidator(payload: ChorusCorrectValidatorPayload): Promise<ChorusCorrectValidatorResult> {
    const response = await this.fetchImpl(this.correctValidatorUrl, {
      method: 'POST',
      headers: authHeaders({
        Accept: 'application/json',
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify({
        environment: this.config.environment,
        payload,
      }),
    });

    const body = await parseResponseBody(response);
    const apiCalls = isRecord(body) && isApiDebugEntryArray(body.apiCalls) ? body.apiCalls : [];

    if (!response.ok || !isRecord(body) || body.ok !== true) {
      const message = isRecord(body) && typeof body.error === 'string'
        ? body.error
        : `Correction valideur impossible (${response.status}).`;
      throw new ChorusBackendAutomationError(message, apiCalls);
    }

    return normalizeCorrectValidatorResult(body);
  }

  async consultInvoiceForReception(identifiantFactureCPP: number): Promise<ReceptionConsultResult> {
    const response = await this.fetchImpl(this.receptionConsultUrl, {
      method: 'POST',
      headers: authHeaders({
        Accept: 'application/json',
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify({
        environment: this.config.environment,
        identifiantFactureCPP,
      }),
    });

    const body = await parseResponseBody(response);
    if (!isRecord(body)) {
      throw new ChorusBackendAutomationError(
        `Consultation réception impossible (${response.status}).`,
      );
    }

    const apiCalls = isApiDebugEntryArray(body.apiCalls) ? body.apiCalls : [];

    if (response.ok && body.ok === true && body.success === true && isRecord(body.facture)) {
      return {
        ok: true,
        success: true,
        identifiantFactureCPP,
        facture: body.facture as unknown as ReceptionInvoice,
        persisted: typeof body.persisted === 'boolean' ? body.persisted : undefined,
        apiCalls,
      } as ReceptionConsultResult;
    }

    return {
      ok: false,
      success: false,
      identifiantFactureCPP,
      category: typeof body.category === 'string' ? body.category : 'UNKNOWN',
      human_message: typeof body.human_message === 'string'
        ? body.human_message
        : `Consultation réception impossible (${response.status}).`,
      raw_message: typeof body.raw_message === 'string'
        ? body.raw_message
        : typeof body.error === 'string'
          ? body.error
          : `HTTP ${response.status}`,
      recommended_action: typeof body.recommended_action === 'string'
        ? body.recommended_action
        : 'Vérifier l’identifiant fourni et réessayer ultérieurement.',
      severity: typeof body.severity === 'string'
        ? (body.severity as 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL')
        : undefined,
      code_retour: typeof body.code_retour === 'number' ? body.code_retour : undefined,
      chorus_code: typeof body.chorus_code === 'string' ? body.chorus_code : undefined,
      matched_states: Array.isArray(body.matched_states)
        ? body.matched_states.filter((value): value is string => typeof value === 'string')
        : undefined,
      apiCalls,
    };
  }

  async consultInvoicesBulkForReception(identifiantsFactureCPP: number[]): Promise<ReceptionBulkConsultResult> {
    const response = await this.fetchImpl(this.receptionConsultBulkUrl, {
      method: 'POST',
      headers: authHeaders({
        Accept: 'application/json',
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify({
        environment: this.config.environment,
        identifiantsFactureCPP,
      }),
    });

    const body = await parseResponseBody(response);

    if (!response.ok || !isRecord(body) || body.ok !== true) {
      const message = isRecord(body) && typeof body.human_message === 'string'
        ? body.human_message
        : isRecord(body) && typeof body.error === 'string'
          ? body.error
          : `Consultation en masse impossible (${response.status}).`;
      throw new ChorusBackendAutomationError(
        message,
        isRecord(body) && isApiDebugEntryArray(body.apiCalls) ? body.apiCalls : [],
      );
    }

    return body as unknown as ReceptionBulkConsultResult;
  }

  async processReceivedInvoice(input: ReceptionProcessInput): Promise<ReceptionProcessResult> {
    const requestBody: Record<string, unknown> = {
      environment: this.config.environment,
      idFacture: input.idFacture,
      nouveauStatut: input.nouveauStatut,
    };
    if (typeof input.motif === 'string' && input.motif.trim()) {
      requestBody.motif = input.motif.trim();
    }
    if (typeof input.numeroDPMandat === 'string' && input.numeroDPMandat.trim()) {
      requestBody.numeroDPMandat = input.numeroDPMandat.trim();
    }

    const response = await this.fetchImpl(this.receptionProcessUrl, {
      method: 'POST',
      headers: authHeaders({
        Accept: 'application/json',
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify(requestBody),
    });

    const body = await parseResponseBody(response);
    if (!isRecord(body)) {
      throw new ChorusBackendAutomationError(
        `Traitement facture reçue impossible (${response.status}).`,
      );
    }
    const apiCalls = isApiDebugEntryArray(body.apiCalls) ? body.apiCalls : [];

    if (response.ok && body.ok === true && body.success === true) {
      return {
        ok: true,
        success: true,
        processedPersisted: typeof body.processedPersisted === 'boolean' ? body.processedPersisted : undefined,
        payload: body.payload as ReceptionProcessSuccess['payload'],
        response: (isRecord(body.response) ? body.response : {}) as ReceptionProcessSuccess['response'],
        apiCalls,
      } satisfies ReceptionProcessSuccess;
    }

    return {
      ok: false,
      success: false,
      identifiantFactureCPP: input.idFacture,
      category: typeof body.category === 'string' ? body.category : 'UNKNOWN',
      human_message: typeof body.human_message === 'string'
        ? body.human_message
        : `Traitement facture reçue impossible (${response.status}).`,
      raw_message: typeof body.raw_message === 'string'
        ? body.raw_message
        : typeof body.error === 'string'
          ? body.error
          : `HTTP ${response.status}`,
      recommended_action: typeof body.recommended_action === 'string'
        ? body.recommended_action
        : 'Vérifier les données saisies et réessayer.',
      severity: typeof body.severity === 'string'
        ? (body.severity as 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL')
        : undefined,
      code_retour: typeof body.code_retour === 'number' ? body.code_retour : undefined,
      chorus_code: typeof body.chorus_code === 'string' ? body.chorus_code : undefined,
      matched_states: Array.isArray(body.matched_states)
        ? body.matched_states.filter((value): value is string => typeof value === 'string')
        : undefined,
      apiCalls,
    };
  }

  async completeSuspendedInvoice(input: ReceptionCompleteInput): Promise<ReceptionCompleteResult> {
    const requestBody: Record<string, unknown> = {
      environment: this.config.environment,
      identifiantFactureCPP: input.identifiantFactureCPP,
    };
    if (typeof input.commentaire === 'string' && input.commentaire.trim()) {
      requestBody.commentaire = input.commentaire.trim();
    }
    if (typeof input.idUtilisateurCourant === 'number' && Number.isFinite(input.idUtilisateurCourant)) {
      requestBody.idUtilisateurCourant = input.idUtilisateurCourant;
    }
    if (Array.isArray(input.pieceJointeComplementaire) && input.pieceJointeComplementaire.length > 0) {
      requestBody.pieceJointeComplementaire = input.pieceJointeComplementaire;
    }
    if (Array.isArray(input.attachmentFiles) && input.attachmentFiles.length > 0) {
      requestBody.attachmentFiles = await Promise.all(
        input.attachmentFiles.map(async (attachment) => ({
          name: attachment.file.name,
          mimeType: attachment.file.type || 'application/octet-stream',
          base64: await readFileAsBase64(attachment.file),
          designation: attachment.designation,
          type: attachment.type,
          lineNumber: attachment.lineNumber,
        })),
      );
    }

    const response = await this.fetchImpl(this.receptionCompleteUrl, {
      method: 'POST',
      headers: authHeaders({
        Accept: 'application/json',
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify(requestBody),
    });

    const body = await parseResponseBody(response);
    if (!isRecord(body)) {
      throw new ChorusBackendAutomationError(
        `Complément facture suspendue impossible (${response.status}).`,
      );
    }
    const apiCalls = isApiDebugEntryArray(body.apiCalls) ? body.apiCalls : [];

    if (response.ok && body.ok === true && body.success === true) {
      return {
        ok: true,
        success: true,
        identifiantFactureCPP: typeof body.identifiantFactureCPP === 'number'
          ? body.identifiantFactureCPP
          : input.identifiantFactureCPP,
        numeroFacture: typeof body.numeroFacture === 'string' ? body.numeroFacture : null,
        dateTraitement: typeof body.dateTraitement === 'string' ? body.dateTraitement : null,
        libelle: typeof body.libelle === 'string' ? body.libelle : null,
        raw: isRecord(body.raw) ? body.raw : undefined,
        apiCalls,
      } satisfies ReceptionCompleteSuccess;
    }

    return {
      ok: false,
      success: false,
      identifiantFactureCPP: input.identifiantFactureCPP,
      category: typeof body.category === 'string' ? body.category : 'UNKNOWN',
      human_message: typeof body.human_message === 'string'
        ? body.human_message
        : `Complément facture suspendue impossible (${response.status}).`,
      raw_message: typeof body.raw_message === 'string'
        ? body.raw_message
        : typeof body.error === 'string'
          ? body.error
          : `HTTP ${response.status}`,
      recommended_action: typeof body.recommended_action === 'string'
        ? body.recommended_action
        : 'Vérifier que la facture est bien au statut SUSPENDUE.',
      severity: typeof body.severity === 'string'
        ? (body.severity as 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL')
        : undefined,
      code_retour: typeof body.code_retour === 'number' ? body.code_retour : undefined,
      chorus_code: typeof body.chorus_code === 'string' ? body.chorus_code : undefined,
      matched_states: Array.isArray(body.matched_states)
        ? body.matched_states.filter((value): value is string => typeof value === 'string')
        : undefined,
      apiCalls,
    };
  }

  async downloadInvoice(input: ReceptionDownloadInput): Promise<ReceptionDownloadResult> {
    return this.downloadInvoiceFromUrl(this.invoiceDownloadUrl, input);
  }

  async downloadReceivedInvoice(input: ReceptionDownloadInput): Promise<ReceptionDownloadResult> {
    return this.downloadInvoiceFromUrl(this.receptionDownloadUrl, input);
  }

  private async downloadInvoiceFromUrl(url: string, input: ReceptionDownloadInput): Promise<ReceptionDownloadResult> {
    const requestBody: Record<string, unknown> = {
      environment: this.config.environment,
      idFacture: input.idFacture,
      format: input.format,
    };
    if (typeof input.avecPiecesJointesComplementaires === 'boolean') {
      requestBody.avecPiecesJointesComplementaires = input.avecPiecesJointesComplementaires;
    }

    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: authHeaders({
        Accept: '*/*',
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify(requestBody),
    });

    const contentType = response.headers.get('content-type') ?? '';
    const isJsonResponse = contentType.includes('application/json');

    if (!response.ok || isJsonResponse) {
      // Erreur structurée renvoyée par le backend (JSON).
      const body = await response.json().catch(() => null);
      const record = isRecord(body) ? body : {};
      return {
        ok: false,
        success: false,
        identifiantFactureCPP: input.idFacture,
        category: typeof record.category === 'string' ? record.category : 'UNKNOWN',
        human_message: typeof record.human_message === 'string'
          ? record.human_message
          : `Téléchargement impossible (${response.status}).`,
        raw_message: typeof record.raw_message === 'string'
          ? record.raw_message
          : typeof record.error === 'string'
            ? record.error
            : `HTTP ${response.status}`,
        recommended_action: typeof record.recommended_action === 'string'
          ? record.recommended_action
          : 'Vérifier l’identifiant et réessayer ultérieurement.',
        severity: typeof record.severity === 'string'
          ? (record.severity as 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL')
          : undefined,
        code_retour: typeof record.code_retour === 'number' ? record.code_retour : undefined,
        chorus_code: typeof record.chorus_code === 'string' ? record.chorus_code : undefined,
      };
    }

    const blob = await response.blob();
    const disposition = response.headers.get('content-disposition') ?? '';
    const match = /filename="?([^";]+)"?/.exec(disposition);
    const fallbackSuffix = input.format.toLowerCase();
    const filename = match?.[1]?.trim() || `chorus-facture-${input.idFacture}.${fallbackSuffix}`;
    const codeRetourHeader = response.headers.get('x-chorus-code-retour');
    const codeRetour = codeRetourHeader && /^-?\d+$/.test(codeRetourHeader)
      ? Number(codeRetourHeader)
      : null;
    const libelle = response.headers.get('x-chorus-libelle') || null;

    return {
      ok: true,
      blob,
      filename,
      mimeType: blob.type || contentType,
      codeRetour,
      libelle,
    };
  }

  async getInvoiceHistory(payload: ChorusInvoiceHistoryPayload): Promise<ChorusInvoiceHistoryResult> {
    const response = await this.fetchImpl(this.invoiceHistoryUrl, {
      method: 'POST',
      headers: authHeaders({
        Accept: 'application/json',
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify({
        environment: this.config.environment,
        payload,
      }),
    });

    const body = await parseResponseBody(response);
    const apiCalls = isRecord(body) && isApiDebugEntryArray(body.apiCalls) ? body.apiCalls : [];

    if (!response.ok || !isRecord(body) || body.ok !== true) {
      const message = isRecord(body) && typeof body.error === 'string'
        ? body.error
        : `Consultation historique facture impossible (${response.status}).`;
      throw new ChorusBackendAutomationError(message, apiCalls);
    }

    return normalizeInvoiceHistoryResult(body);
  }
}
