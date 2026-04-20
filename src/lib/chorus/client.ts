import { finalizeChorusSubmissionPayloadForPdfDeposit } from '@/lib/chorus/buildSubmissionPayload';
import { buildUploadPdfPayload } from '@/lib/chorus/buildUploadPdfPayload';
import { PisteChorusRoutes } from '@/lib/chorus/pisteRoutes';
import { validateChorusSubmissionPayload } from '@/lib/chorus/validateSubmissionPayload';
import type {
  ChorusConfig,
  ChorusConnectionResult,
  ChorusResolvedAttachmentService,
  ChorusResolvedStructureAttachment,
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

function getDefaultFetchImpl(): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init)) as typeof fetch;
}

function ensureDirectConfig(config: ChorusConfig): void {
  const missing: string[] = [];

  if (!config.enabled) missing.push('enabled');
  if (!config.tokenUrl) missing.push('tokenUrl');
  if (!config.clientId) missing.push('clientId');
  if (!config.clientSecret) missing.push('clientSecret');

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

function inferUploadedFileId(filename: string, response: unknown): string {
  if (response && typeof response === 'object') {
    const candidate = (response as Record<string, unknown>).fileId
      ?? (response as Record<string, unknown>).id
      ?? (response as Record<string, unknown>).pieceJointeId;

    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate;
    }

    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return String(candidate);
    }
  }

  return `file-${filename}`;
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

function buildSubmitFailureHint(
  responseStatus: number,
  routes: PisteChorusRoutes,
  body: unknown,
  mainUploadedFile: ChorusUploadedFile,
): string {
  if (!/\/v1\/soumettre$/i.test(routes.submitInvoicePath)) {
    return '';
  }

  const codeRetour = body && typeof body === 'object' ? (body as Record<string, unknown>).codeRetour : undefined;
  if (responseStatus < 500 && codeRetour !== 500) {
    return '';
  }

  const pieceJointeId = inferPieceJointeId(mainUploadedFile.response);
  const depositInfo = pieceJointeId
    ? ` Le dépôt PDF a probablement abouti avec la pièce jointe ${pieceJointeId}.`
    : ' Le dépôt PDF a probablement abouti avant l’erreur finale de soumission.';

  return `${depositInfo} Le blocage restant vient vraisemblablement du JSON envoyé à /v1/soumettre, qui doit suivre le contrat Chorus officiel (modeDepot, destinataire, fournisseur, cadreDeFacturation, references, montantTotal, pieceJointePrincipale).`;
}

function formatValidationIssues(issues: Array<{ path: string; message: string }>): string {
  return issues
    .map((issue) => `${issue.path}: ${issue.message}`)
    .join(' | ');
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

async function readFileAsBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
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

    const params = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      scope: this.config.scope || 'openid',
    });

    const response = await this.performFetch(this.config.tokenUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    }, 'Récupération du token OAuth2');

    if (!response.ok) {
      const body = await parseResponseBody(response);
      throw new Error(`Échec OAuth2 (${response.status}): ${typeof body === 'string' ? body : JSON.stringify(body)}`);
    }

    const data = await response.json() as { access_token?: string };
    if (!data.access_token) {
      throw new Error('Réponse OAuth2 invalide: access_token absent.');
    }

    return data.access_token;
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

    if (this.config.technicalLogin && this.config.technicalPassword) {
      headers['cpro-account'] = window.btoa(`${this.config.technicalLogin}:${this.config.technicalPassword}`);
    }

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

  private async uploadFile(file: File, currentUserId?: number, debugBypassValidation = false): Promise<ChorusUploadedFile> {
    if (!this.routes.uploadFilePath) {
      throw new Error('uploadFilePath manquant. Configure un endpoint d\'upload avant la soumission.');
    }

    const uploadUrl = this.routes.uploadFileUrl();
    let response: Response;

    if (this.routes.isPdfDepositUpload()) {
      if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
        throw new Error('L’endpoint Chorus `deposer/pdf` attend un fichier PDF.');
      }

      if (currentUserId === undefined && !debugBypassValidation) {
        throw new Error('Le dépôt Chorus `deposer/pdf` exige `idUtilisateurCourant` dans le contexte de soumission.');
      }

      const payload = buildUploadPdfPayload(
        await readFileAsBase64(file),
        file.name,
        false,
        currentUserId,
      );
      debugChorusLog('Upload PDF payload', {
        url: uploadUrl,
        payload,
      }, import.meta.env.DEV || debugBypassValidation);

      response = await this.performFetch(uploadUrl, {
        method: 'POST',
        headers: await this.buildApiHeaders({
          'content-type': 'application/json; charset=UTF-8',
        }),
        body: JSON.stringify(payload),
      }, 'Dépôt PDF Chorus');
    } else {
      const formData = new FormData();
      formData.append('file', file, file.name);

      response = await this.performFetch(uploadUrl, {
        method: 'POST',
        headers: await this.buildApiHeaders(),
        body: formData,
      }, 'Upload fichier Chorus');
      debugChorusLog('Upload file form-data', {
        url: uploadUrl,
        filename: file.name,
        mimeType: file.type,
      }, import.meta.env.DEV || debugBypassValidation);
    }

    const body = await parseResponseBody(response);
    debugChorusLog('Upload response', {
      url: uploadUrl,
      status: response.status,
      body,
    }, import.meta.env.DEV || debugBypassValidation);
    if (!response.ok) {
      throw new Error(`Upload fichier échoué (${response.status}): ${stringifyResponseBody(body)}`);
    }

    return {
      id: inferUploadedFileId(file.name, body),
      filename: file.name,
      response: body,
    };
  }

  async submitInvoice(input: ChorusSubmitInvoiceInput): Promise<ChorusSubmitInvoiceResult> {
    if (!this.routes.submitInvoicePath) {
      throw new Error('submitInvoicePath manquant. Configure un endpoint de soumission avant d\'envoyer une facture.');
    }

    if (this.routes.isPdfDepositUpload() && input.attachments.length > 0) {
      throw new Error('Le flux Chorus `deposer/pdf` ne gère pas encore les pièces jointes complémentaires dans ce connecteur.');
    }

    const debugEnabled = import.meta.env.DEV || input.debugBypassValidation === true;
    const preflightValidation = validateChorusSubmissionPayload(input.invoiceData);
    debugChorusLog('Submit preflight', {
      apiBaseUrl: this.config.apiBaseUrl,
      uploadFilePath: this.config.uploadFilePath,
      submitInvoicePath: this.config.submitInvoicePath,
      invoiceData: input.invoiceData,
      validation: preflightValidation,
      debugBypassValidation: input.debugBypassValidation === true,
    }, debugEnabled);
    if (!preflightValidation.valid && !input.debugBypassValidation) {
      throw new Error(`Payload Chorus invalide: ${formatValidationIssues(preflightValidation.errors)}`);
    }

    const mainFile = await this.uploadFile(input.mainFile, input.invoiceData.idUtilisateurCourant, input.debugBypassValidation);
    const attachmentFiles = await Promise.all(
      input.attachments.map((file) => this.uploadFile(file, input.invoiceData.idUtilisateurCourant, input.debugBypassValidation)),
    );
    const uploadedFiles = [mainFile, ...attachmentFiles];

    const payload = this.routes.isPdfDepositUpload()
      ? finalizeChorusSubmissionPayloadForPdfDeposit(input.invoiceData, {
          mainFileId: mainFile.id,
          mainFileName: mainFile.filename,
        })
      : input.invoiceData;

    const validation = validateChorusSubmissionPayload(payload);
    debugChorusLog('Submit final payload', {
      payload,
      validation,
      uploadedFiles,
    }, debugEnabled);
    if (!validation.valid && !input.debugBypassValidation) {
      throw new Error(`Payload Chorus invalide: ${formatValidationIssues(validation.errors)}`);
    }

    const submitUrl = this.routes.submitInvoiceUrl();
    const response = await this.performFetch(submitUrl, {
      method: 'POST',
      headers: await this.buildApiHeaders({
        'content-type': 'application/json; charset=UTF-8',
      }),
      body: JSON.stringify(payload),
    }, 'Soumission de facture Chorus');

    const body = await parseResponseBody(response);
    debugChorusLog('Submit response', {
      url: submitUrl,
      status: response.status,
      body,
    }, debugEnabled);
    if (!response.ok) {
      const hint = buildSubmitFailureHint(response.status, this.routes, body, mainFile);
      throw new Error(`Soumission Chorus échouée (${response.status}): ${stringifyResponseBody(body)}${hint}`);
    }

    const externalId = body && typeof body === 'object'
      ? ((body as Record<string, unknown>).invoiceId
        ?? (body as Record<string, unknown>).numeroFactureChorus
        ?? (body as Record<string, unknown>).id)
      : undefined;

    return {
      ok: true,
      externalId: typeof externalId === 'string' ? externalId : undefined,
      uploadedFiles,
      response: body,
    };
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
    const uploadedFiles: ChorusUploadedFile[] = [input.mainFile, ...input.attachments].map((file, index) => ({
      id: `mock-file-${index + 1}`,
      filename: file.name,
      response: { mocked: true },
    }));

    return {
      ok: true,
      externalId: `MOCK-${Date.now()}`,
      uploadedFiles,
      response: {
        mocked: true,
        invoiceData: input.invoiceData,
      },
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
