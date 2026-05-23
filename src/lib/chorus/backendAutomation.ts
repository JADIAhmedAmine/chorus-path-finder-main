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
} from '@/types/chorus';

export const CHORUS_OAUTH_TOKEN_PATH = '/api/chorus/oauth-token';
export const CHORUS_SUBMIT_PATH = '/api/chorus/submit';
export const CHORUS_RECYCLE_PATH = '/api/chorus/recycle';
export const CHORUS_CORRECT_VALIDATOR_PATH = '/api/chorus/validator/correct';
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
    apiCalls: isApiDebugEntryArray(body.apiCalls) ? body.apiCalls : [],
  };
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
