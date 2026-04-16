import type {
  ChorusConfig,
  ChorusConnectionResult,
  ChorusSubmitInvoiceInput,
  ChorusSubmitInvoiceResult,
  ChorusUploadedFile,
} from '@/types/chorus';

export interface ChorusConnector {
  testConnection(): Promise<ChorusConnectionResult>;
  submitInvoice(input: ChorusSubmitInvoiceInput): Promise<ChorusSubmitInvoiceResult>;
}

function joinUrl(baseUrl: string, path: string): string {
  if (!path) {
    return baseUrl;
  }

  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  const safeBase = baseUrl.replace(/\/+$/, '');
  const safePath = path.replace(/^\/+/, '');
  return safeBase ? `${safeBase}/${safePath}` : `/${safePath}`;
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

  if (contentType.includes('application/json')) {
    return response.json();
  }

  return response.text();
}

function inferUploadedFileId(filename: string, response: unknown): string {
  if (response && typeof response === 'object') {
    const candidate = (response as Record<string, unknown>).fileId
      ?? (response as Record<string, unknown>).id
      ?? (response as Record<string, unknown>).pieceJointeId;

    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate;
    }
  }

  return `file-${filename}`;
}

export class DirectChorusConnector implements ChorusConnector {
  constructor(
    private readonly config: ChorusConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async getAccessToken(): Promise<string> {
    ensureDirectConfig(this.config);

    const params = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      scope: this.config.scope || 'openid',
    });

    const response = await this.fetchImpl(this.config.tokenUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

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

    if (!this.config.connectionTestPath) {
      return {
        ok: true,
        message: 'Token OAuth2 récupéré. Aucun endpoint de test configuré.',
        tokenPreview,
      };
    }

    const response = await this.fetchImpl(joinUrl(this.config.apiBaseUrl, this.config.connectionTestPath), {
      method: 'GET',
      headers: this.buildApiHeadersFromToken(token),
    });

    const body = await parseResponseBody(response);
    if (!response.ok) {
      throw new Error(`Test API Chorus échoué (${response.status}): ${typeof body === 'string' ? body : JSON.stringify(body)}`);
    }

    return {
      ok: true,
      message: 'Connexion Chorus testée avec succès.',
      tokenPreview,
      response: body,
    };
  }

  private async uploadFile(file: File): Promise<ChorusUploadedFile> {
    if (!this.config.uploadFilePath) {
      throw new Error('uploadFilePath manquant. Configure un endpoint d\'upload avant la soumission.');
    }

    const formData = new FormData();
    formData.append('file', file, file.name);

    const response = await this.fetchImpl(joinUrl(this.config.apiBaseUrl, this.config.uploadFilePath), {
      method: 'POST',
      headers: await this.buildApiHeaders(),
      body: formData,
    });

    const body = await parseResponseBody(response);
    if (!response.ok) {
      throw new Error(`Upload fichier échoué (${response.status}): ${typeof body === 'string' ? body : JSON.stringify(body)}`);
    }

    return {
      id: inferUploadedFileId(file.name, body),
      filename: file.name,
      response: body,
    };
  }

  async submitInvoice(input: ChorusSubmitInvoiceInput): Promise<ChorusSubmitInvoiceResult> {
    if (!this.config.submitInvoicePath) {
      throw new Error('submitInvoicePath manquant. Configure un endpoint de soumission avant d\'envoyer une facture.');
    }

    const mainFile = await this.uploadFile(input.mainFile);
    const attachmentFiles = await Promise.all(input.attachments.map((file) => this.uploadFile(file)));
    const uploadedFiles = [mainFile, ...attachmentFiles];

    const payload = {
      ...input.invoiceData,
      mainFileId: mainFile.id,
      attachmentIds: attachmentFiles.map((item) => item.id),
      uploadedFiles,
      sourceSystem: 'chorus-path-finder-ui',
    };

    const response = await this.fetchImpl(joinUrl(this.config.apiBaseUrl, this.config.submitInvoicePath), {
      method: 'POST',
      headers: await this.buildApiHeaders({
        'content-type': 'application/json',
      }),
      body: JSON.stringify(payload),
    });

    const body = await parseResponseBody(response);
    if (!response.ok) {
      throw new Error(`Soumission Chorus échouée (${response.status}): ${typeof body === 'string' ? body : JSON.stringify(body)}`);
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
