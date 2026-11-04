import { PisteChorusRoutes } from '@/lib/chorus/pisteRoutes';
import { CHORUS_OAUTH_TOKEN_PATH, CHORUS_SUBMIT_PATH, resolveChorusBridgeUrl } from '@/lib/chorus/backendAutomation';
import { authHeaders } from '@/lib/auth/session';
import {
  describeChorusSubmissionApiReturn,
  formatChorusApiReturnFailureMessage,
  isChorusApiReturnFailure,
} from '@/lib/chorus/submissionApiReturn';
import { validateChorusSubmissionPayload } from '@/lib/chorus/validateSubmissionPayload';
import {
  ChorusSubmissionStateError,
  parseChorusSubmissionStateErrorPayload,
} from '@/lib/chorus/submissionState';
import type {
  ChorusApiDebugEntry,
  ChorusConfig,
  ChorusConnectionResult,
  ChorusResolvedAttachmentService,
  ChorusResolvedStructureAttachment,
  ChorusSubmitAttachmentInput,
  ChorusSubmitInvoiceInput,
  ChorusSubmitInvoiceResult,
  ChorusTechnicalContextResolutionInput,
  ChorusTechnicalContextResolutionResult,
  ChorusUploadedFile,
} from '@/types/chorus';

export interface ChorusConnector {
  testConnection(): Promise<ChorusConnectionResult>;
  resolveTechnicalContext(input: ChorusTechnicalContextResolutionInput): Promise<ChorusTechnicalContextResolutionResult>;
  submitInvoice(input: ChorusSubmitInvoiceInput): Promise<ChorusSubmitInvoiceResult>;
}

export class ChorusSubmitApiError extends Error {
  readonly apiCalls: ChorusApiDebugEntry[];

  constructor(message: string, apiCalls: ChorusApiDebugEntry[]) {
    super(message);
    this.name = 'ChorusSubmitApiError';
    this.apiCalls = [...apiCalls];
  }
}

function getDefaultFetchImpl(): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init)) as typeof fetch;
}

function ensureDirectConfig(config: ChorusConfig): void {
  const missing: string[] = [];

  if (!config.enabled) missing.push('enabled');

  if (missing.length > 0) {
    throw new Error(`Configuration Chorus incomplète: ${missing.join(', ')}`);
  }
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

function compactText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function stringifyResponseBody(body: unknown): string {
  if (body === undefined || body === null) {
    return 'Réponse vide';
  }

  if (typeof body === 'string') {
    return compactText(body).slice(0, 500);
  }

  try {
    return JSON.stringify(body);
  } catch {
    return String(body);
  }
}

function debugChorusLog(label: string, payload: unknown, enabled: boolean): void {
  if (!enabled) {
    return;
  }

  console.groupCollapsed(`[Chorus debug] ${label}`);
  console.log(payload);
  console.groupEnd();
}

function summarizeBinaryField(value: string | undefined, fieldName: string): string | undefined {
  if (!value) {
    return undefined;
  }

  const preview = value.slice(0, 80);
  return `[${fieldName} base64 masqué, ${value.length} caractères, aperçu: ${preview}…]`;
}

function isDebugEntryArray(value: unknown): value is ChorusApiDebugEntry[] {
  return Array.isArray(value);
}

function stripCurrentUserIdFromSubmissionPayload(input: ChorusSubmitInvoiceInput['invoiceData']): ChorusSubmitInvoiceInput['invoiceData'] {
  const { idUtilisateurCourant: _ignoredCurrentUserId, ...payloadWithoutCurrentUserId } = input;
  return payloadWithoutCurrentUserId;
}

function normalizeSubmitAttachment(input: ChorusSubmitAttachmentInput): {
  file: File;
  designation?: string;
  type?: string;
  lineNumber?: number;
  liaisonId?: number;
} {
  if (input instanceof File) {
    return { file: input };
  }

  return input;
}

function inferPieceJointeId(response: unknown): string | undefined {
  if (!response || typeof response !== 'object') {
    return undefined;
  }

  const candidate = (response as Record<string, unknown>).pieceJointeId
    ?? (response as Record<string, unknown>).idPieceJointe
    ?? (response as Record<string, unknown>).id;

  if (typeof candidate === 'string' && candidate.trim()) {
    return candidate;
  }

  if (typeof candidate === 'number' && Number.isFinite(candidate)) {
    return String(candidate);
  }

  return undefined;
}

function inferSubmissionExternalId(response: unknown): string | undefined {
  if (!response || typeof response !== 'object') {
    return undefined;
  }

  const record = response as Record<string, unknown>;
  const candidate = record.invoiceId
    ?? record.numeroFactureChorus
    ?? record.identifiantFactureCPP
    ?? record.numeroFacture
    ?? record.id;

  if (typeof candidate === 'string' && candidate.trim()) {
    return candidate.trim();
  }

  if (typeof candidate === 'number' && Number.isFinite(candidate)) {
    return String(candidate);
  }

  return undefined;
}

function cleanDigits(value: string | undefined): string | undefined {
  const cleaned = value?.replace(/\D/g, '');
  return cleaned || undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function isActiveService(service: ChorusResolvedAttachmentService): boolean {
  if (service.estActif === true) {
    return true;
  }

  return service.statutRattachementService === 'VALIDEE' || service.statutService === 'ACTIF';
}

function pickPreferredService(
  services: ChorusResolvedAttachmentService[],
  serviceCodeHint?: string,
): ChorusResolvedAttachmentService | undefined {
  const activeServices = services.filter(isActiveService);

  if (serviceCodeHint) {
    const matchingService = activeServices.find((service) => service.codeService?.toLowerCase() === serviceCodeHint.toLowerCase());
    if (matchingService) {
      return matchingService;
    }
  }

  return activeServices.find((service) => service.codeService !== 'FACTURES_PUBLIQUES') ?? activeServices[0];
}

function parseStructureAttachments(body: unknown): ChorusResolvedStructureAttachment[] {
  if (!body || typeof body !== 'object') {
    return [];
  }

  const rawStructures = (body as Record<string, unknown>).listeStructureRattachement;
  if (!Array.isArray(rawStructures)) {
    return [];
  }

  return rawStructures
    .map((item): ChorusResolvedStructureAttachment | null => {
      if (!item || typeof item !== 'object') {
        return null;
      }

      const record = item as Record<string, unknown>;
      const rawServices = Array.isArray(record.listeServicesRattache) ? record.listeServicesRattache : [];

      return {
        designationStructure: typeof record.designationStructure === 'string' ? record.designationStructure : undefined,
        idRattachementStructure: asNumber(record.idRattachementStructure),
        idStructure: asNumber(record.idStructure),
        identifiantStructure: cleanDigits(typeof record.identifiantStructure === 'string' ? record.identifiantStructure : undefined),
        listeServicesRattache: rawServices
          .map((service): ChorusResolvedAttachmentService | null => {
            if (!service || typeof service !== 'object') {
              return null;
            }

            const serviceRecord = service as Record<string, unknown>;
            return {
              codeService: typeof serviceRecord.codeService === 'string' ? serviceRecord.codeService : undefined,
              estActif: typeof serviceRecord.estActif === 'boolean' ? serviceRecord.estActif : undefined,
              idService: asNumber(serviceRecord.idService),
              libelleService: typeof serviceRecord.libelleService === 'string' ? serviceRecord.libelleService : undefined,
              statutRattachementService: typeof serviceRecord.statutRattachementService === 'string' ? serviceRecord.statutRattachementService : undefined,
              statutService: typeof serviceRecord.statutService === 'string' ? serviceRecord.statutService : undefined,
            };
          })
          .filter((service): service is ChorusResolvedAttachmentService => service !== null),
        roleUtilisateur: typeof record.roleUtilisateur === 'string' ? record.roleUtilisateur : undefined,
        statutRattachementStructure: typeof record.statutRattachementStructure === 'string' ? record.statutRattachementStructure : undefined,
        statutUtilisateur: typeof record.statutUtilisateur === 'string' ? record.statutUtilisateur : undefined,
        typeIdentifiantStructure: typeof record.typeIdentifiantStructure === 'string' ? record.typeIdentifiantStructure : undefined,
      };
    })
    .filter((item): item is ChorusResolvedStructureAttachment => item !== null);
}

async function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === 'function') {
    return file.arrayBuffer();
  }

  if (typeof FileReader !== 'undefined') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error ?? new Error('Impossible de lire le fichier.'));
      reader.onload = () => {
        if (reader.result instanceof ArrayBuffer) {
          resolve(reader.result);
          return;
        }

        reject(new Error('Lecture fichier invalide.'));
      };
      reader.readAsArrayBuffer(file);
    });
  }

  const text = typeof file.text === 'function' ? await file.text() : '';
  return new TextEncoder().encode(text).buffer;
}

async function readFileAsBase64(file: File): Promise<string> {
  const buffer = await readFileAsArrayBuffer(file);
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return globalThis.btoa(binary);
}

export class DirectChorusConnector implements ChorusConnector {
  private readonly routes: PisteChorusRoutes;

  constructor(
    private readonly config: ChorusConfig,
    private readonly fetchImpl: typeof fetch = getDefaultFetchImpl(),
  ) {
    this.routes = new PisteChorusRoutes(config);
  }

  private async performFetch(url: string, init: RequestInit, operationLabel: string): Promise<Response> {
    try {
      return await this.fetchImpl(url, init);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erreur réseau inconnue';
      throw new Error(`${operationLabel} impossible vers ${url}: ${message}. Vérifie l’URL, le CORS et la disponibilité réseau.`);
    }
  }

  private async getAccessToken(): Promise<string> {
    ensureDirectConfig(this.config);

    const tokenUrl = resolveChorusBridgeUrl(this.config, CHORUS_OAUTH_TOKEN_PATH);

    const response = await this.performFetch(tokenUrl, {
      method: 'POST',
      headers: authHeaders({
        accept: 'application/json',
        'content-type': 'application/json; charset=UTF-8',
      }),
      body: JSON.stringify({ environment: this.config.environment }),
    }, 'Récupération du token OAuth2 via backend Chorus');

    const body = await parseResponseBody(response);

    if (!response.ok) {
      throw new Error(`Échec OAuth2 backend (${response.status}): ${stringifyResponseBody(body)}`);
    }

    const accessToken = body && typeof body === 'object'
      ? (body as Record<string, unknown>).access_token
      : undefined;
    if (typeof accessToken !== 'string' || !accessToken.trim()) {
      throw new Error('Réponse OAuth2 backend invalide: access_token absent.');
    }

    return accessToken;
  }

  private async buildApiHeaders(extraHeaders?: HeadersInit): Promise<HeadersInit> {
    const token = await this.getAccessToken();
    return this.buildApiHeadersFromToken(token, extraHeaders);
  }

  private buildApiHeadersFromToken(token: string, extraHeaders?: HeadersInit): HeadersInit {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    };

    const normalizedExtra = extraHeaders instanceof Headers
      ? Object.fromEntries(extraHeaders.entries())
      : Array.isArray(extraHeaders)
        ? Object.fromEntries(extraHeaders)
        : (extraHeaders ?? {});

    return { ...headers, ...normalizedExtra };
  }

  async testConnection(): Promise<ChorusConnectionResult> {
    const token = await this.getAccessToken();
    const tokenPreview = `${token.slice(0, 8)}…`;
    const method = this.config.connectionTestMethod || 'GET';

    if (!this.routes.connectionTestPath) {
      return {
        ok: true,
        message: 'Token OAuth2 récupéré. Aucun endpoint de test configuré.',
        tokenPreview,
      };
    }

    const isJsonBodyMethod = method === 'POST';
    const testUrl = this.routes.connectionTestUrl();
    const response = await this.performFetch(testUrl, {
      method,
      headers: this.buildApiHeadersFromToken(
        token,
        isJsonBodyMethod ? { 'content-type': 'application/json' } : undefined,
      ),
      body: isJsonBodyMethod ? JSON.stringify({}) : undefined,
    }, 'Test de connexion Chorus');

    const body = await parseResponseBody(response);
    if (!response.ok) {
      throw new Error(`Test API Chorus échoué (${response.status}): ${typeof body === 'string' ? body : JSON.stringify(body)}`);
    }

    return {
      ok: true,
      message: `Connexion Chorus testée avec succès via ${method}.`,
      tokenPreview,
      response: body,
    };
  }

  async resolveTechnicalContext(
    input: ChorusTechnicalContextResolutionInput,
  ): Promise<ChorusTechnicalContextResolutionResult> {
    if (this.routes.usesQualificationUserApis()) {
      throw new Error('Les API utilisateurs Chorus configurées ici pointent vers la qualification / sandbox et ne sont pas exploitables dans ce contexte. Renseigne le contexte technique manuellement.');
    }

    const token = await this.getAccessToken();
    const attachmentsUrl = this.routes.userConnectionsUrl();
    const attachmentsResponse = await this.performFetch(attachmentsUrl, {
      method: 'POST',
      headers: this.buildApiHeadersFromToken(token, {
        'content-type': 'application/json; charset=UTF-8',
      }),
      body: JSON.stringify({}),
    }, 'Récupération des rattachements Chorus');

    const attachmentsBody = await parseResponseBody(attachmentsResponse);
    if (!attachmentsResponse.ok) {
      const hint = attachmentsResponse.status === 403
        ? ` Vérifie que l’URL ${attachmentsUrl} est bien celle de qualification utilisateurs et que le compte/raccordement autorise ce service.`
        : '';
      throw new Error(`Récupération des rattachements Chorus échouée (${attachmentsResponse.status}): ${stringifyResponseBody(attachmentsBody)}${hint}`);
    }

    const structures = parseStructureAttachments(attachmentsBody);
    const supplierSiret = cleanDigits(input.supplierSiret);
    const matchedStructure = supplierSiret
      ? structures.find((structure) => structure.identifiantStructure === supplierSiret)
      : undefined;
    const selectedStructure = matchedStructure ?? structures[0];
    const selectedService = selectedStructure
      ? pickPreferredService(selectedStructure.listeServicesRattache, input.supplierServiceCodeHint)
      : undefined;

    let accountBody: unknown = undefined;
    let userId: number | undefined = undefined;

    if (input.userEmail && this.routes.userAccountPath) {
      const accountUrl = this.routes.userAccountUrl();
      const accountResponse = await this.performFetch(accountUrl, {
        method: 'POST',
        headers: this.buildApiHeadersFromToken(token, {
          'content-type': 'application/json; charset=UTF-8',
        }),
        body: JSON.stringify({
          utilisateur: {
            adresseEmailConnexionUtilisateur: input.userEmail,
          },
        }),
      }, 'Consultation du compte utilisateur Chorus');

      accountBody = await parseResponseBody(accountResponse);
      if (!accountResponse.ok) {
        const hint = accountResponse.status === 403
          ? ` Vérifie que l’URL ${accountUrl} est bien celle de qualification utilisateurs et que ce compte a accès au service consulter/compte.`
          : '';
        throw new Error(`Consultation du compte utilisateur Chorus échouée (${accountResponse.status}): ${stringifyResponseBody(accountBody)}${hint}`);
      }

      userId = accountBody && typeof accountBody === 'object'
        ? asNumber((accountBody as Record<string, unknown>).idUtilisateur)
        : undefined;
    }

    return {
      ok: true,
      message: matchedStructure
        ? 'Contexte technique Chorus récupéré à partir du SIRET fournisseur.'
        : structures.length > 0
          ? 'Contexte technique Chorus récupéré, mais le SIRET fournisseur n’a pas été rapproché précisément.'
          : 'Aucun rattachement Chorus n’a été retourné pour ce compte.',
      userId,
      supplierStructureId: selectedStructure?.idStructure,
      supplierServiceId: selectedService?.idService,
      supplierServiceCode: selectedService?.codeService,
      matchedOnSupplierSiret: Boolean(matchedStructure),
      availableStructures: structures,
      accountResponse: accountBody,
      attachmentsResponse: attachmentsBody,
    };
  }

  private async submitInvoiceViaPythonBridge(
    input: ChorusSubmitInvoiceInput,
  ): Promise<ChorusSubmitInvoiceResult> {
    const bridgeUrl = resolveChorusBridgeUrl(this.config, CHORUS_SUBMIT_PATH);

    const debugEnabled = import.meta.env.DEV || input.debugBypassValidation === true;
    const apiCalls: ChorusApiDebugEntry[] = [];
    const trimmedCurrentState = typeof input.currentState === 'string' ? input.currentState.trim() : '';
    const requestBody = {
      environment: this.config.environment,
      payload: stripCurrentUserIdFromSubmissionPayload(input.invoiceData),
      mainFile: {
        name: input.mainFile.name,
        mimeType: input.mainFile.type || 'application/pdf',
        base64: await readFileAsBase64(input.mainFile),
      },
      attachments: await Promise.all(
        input.attachments.map(async (attachmentInput) => {
          const attachment = normalizeSubmitAttachment(attachmentInput);

          return {
            name: attachment.file.name,
            mimeType: attachment.file.type || 'application/octet-stream',
            base64: await readFileAsBase64(attachment.file),
            designation: attachment.designation,
            type: attachment.type,
            lineNumber: attachment.lineNumber,
            liaisonId: attachment.liaisonId,
          };
        }),
      ),
      currentState: trimmedCurrentState || undefined,
    };
    const requestBodyForDebug = {
      ...requestBody,
      mainFile: {
        ...requestBody.mainFile,
        base64: summarizeBinaryField(requestBody.mainFile.base64, 'mainFile.base64'),
      },
      attachments: requestBody.attachments.map((attachment) => ({
        ...attachment,
        base64: summarizeBinaryField(attachment.base64, `attachment:${attachment.name}`),
      })),
    };

    debugChorusLog('Submit via Python bridge', {
      url: bridgeUrl,
      payload: requestBodyForDebug,
    }, debugEnabled);

    let response: Response;
    try {
      response = await this.performFetch(bridgeUrl, {
        method: 'POST',
        headers: authHeaders({
          'content-type': 'application/json; charset=UTF-8',
          accept: 'application/json',
        }),
        body: JSON.stringify(requestBody),
      }, 'Soumission via backend Python Chorus');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erreur réseau inconnue';
      throw new ChorusSubmitApiError(message, apiCalls);
    }

    const body = await parseResponseBody(response);
    const record = body && typeof body === 'object' ? body as Record<string, unknown> : undefined;
    const bridgeApiCalls = isDebugEntryArray(record?.apiCalls) ? record.apiCalls : [];
    const bridgeCallEntry: ChorusApiDebugEntry = {
      label: 'Bridge Python local',
      method: 'POST',
      url: bridgeUrl,
      requestBody: requestBodyForDebug,
      responseStatus: response.status,
      responseBody: body,
    };
    const combinedApiCalls = [bridgeCallEntry, ...bridgeApiCalls];

    if (!response.ok || record?.ok === false) {
      const stateErrorPayload = parseChorusSubmissionStateErrorPayload(record);
      if (stateErrorPayload) {
        throw new ChorusSubmissionStateError(stateErrorPayload);
      }
      const message = typeof record?.error === 'string'
        ? record.error
        : `Soumission backend Python échouée (${response.status}): ${stringifyResponseBody(body)}`;
      throw new ChorusSubmitApiError(message, combinedApiCalls);
    }

    const apiReturnSummary = describeChorusSubmissionApiReturn(record?.response ?? body, combinedApiCalls);
    if (isChorusApiReturnFailure(apiReturnSummary)) {
      throw new ChorusSubmitApiError(formatChorusApiReturnFailureMessage(apiReturnSummary), combinedApiCalls);
    }

    const uploadedFiles = Array.isArray(record?.uploadedFiles)
      ? (record?.uploadedFiles as ChorusUploadedFile[])
      : [];
    const externalId = typeof record?.externalId === 'string'
      ? record.externalId
      : inferSubmissionExternalId(record?.response);

    return {
      ok: true,
      externalId,
      uploadedFiles,
      submittedPayload: record?.payload,
      response: record?.response ?? body,
      apiCalls: combinedApiCalls,
    };
  }

  async submitInvoice(input: ChorusSubmitInvoiceInput): Promise<ChorusSubmitInvoiceResult> {
    if (input.debugBypassValidation !== true) {
      const validation = validateChorusSubmissionPayload(input.invoiceData);
      if (!validation.valid) {
        throw new Error(`Payload Chorus invalide: ${validation.errors.map((error) => `${error.path} ${error.message}`).join('; ')}`);
      }
    }

    return this.submitInvoiceViaPythonBridge(input);
  }
}

export class MockChorusConnector implements ChorusConnector {
  async testConnection(): Promise<ChorusConnectionResult> {
    return {
      ok: true,
      message: 'Mode mock actif: la connexion Chorus est simulée.',
      tokenPreview: 'mock-token',
      response: { environment: 'mock', status: 'ok' },
    };
  }

  async resolveTechnicalContext(): Promise<ChorusTechnicalContextResolutionResult> {
    return {
      ok: true,
      message: 'Mode mock actif: le contexte technique Chorus est simulé.',
      userId: 331,
      supplierStructureId: 160,
      supplierServiceId: 436,
      supplierServiceCode: 'SERVICE_FOURNISSEUR_DEMO',
      matchedOnSupplierSiret: true,
      availableStructures: [],
    };
  }

  async submitInvoice(input: ChorusSubmitInvoiceInput): Promise<ChorusSubmitInvoiceResult> {
    const complementaryAttachments = input.attachments.map(normalizeSubmitAttachment);
    const uploadedFiles: ChorusUploadedFile[] = [
      {
        id: 'mock-file-1',
        filename: input.mainFile.name,
        role: 'MAIN',
        response: { mocked: true },
      },
      ...complementaryAttachments.map((attachment, index) => ({
        id: `mock-file-${index + 2}`,
        filename: attachment.file.name,
        role: 'COMPLEMENTARY' as const,
        designation: attachment.designation || attachment.file.name,
        type: attachment.type,
        lineNumber: attachment.lineNumber,
        liaisonId: attachment.liaisonId,
        response: { mocked: true },
      })),
    ];

    return {
      ok: true,
      externalId: `MOCK-${Date.now()}`,
      uploadedFiles,
      submittedPayload: input.invoiceData,
      response: {
        mocked: true,
        invoiceData: input.invoiceData,
      },
      apiCalls: [
        {
          label: 'Upload mock',
          method: 'POST',
          url: '/mock/upload',
          requestBody: {
            fileName: input.mainFile.name,
          },
          responseStatus: 200,
          responseBody: { mocked: true },
        },
        {
          label: 'Soumission mock',
          method: 'POST',
          url: '/mock/soumettre',
          requestBody: input.invoiceData,
          responseStatus: 200,
          responseBody: { mocked: true, invoiceData: input.invoiceData },
        },
      ],
    };
  }
}

export function createChorusConnector(
  config: ChorusConfig,
  fetchImpl?: typeof fetch,
): ChorusConnector {
  return config.mode === 'direct'
    ? new DirectChorusConnector(config, fetchImpl)
    : new MockChorusConnector();
}
