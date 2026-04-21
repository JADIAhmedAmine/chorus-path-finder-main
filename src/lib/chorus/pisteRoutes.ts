import type { ChorusConfig } from '@/types/chorus';

export class PisteChorusRoutes {
  constructor(private readonly config: ChorusConfig) {}

  get tokenUrl(): string {
    return this.config.tokenUrl;
  }

  get apiBaseUrl(): string {
    return this.config.apiBaseUrl;
  }

  get connectionTestPath(): string {
    return this.config.connectionTestPath;
  }

  get uploadFilePath(): string {
    return this.config.uploadFilePath;
  }

  get submitInvoicePath(): string {
    return this.config.submitInvoicePath;
  }

  get userAccountPath(): string {
    return this.config.userAccountPath;
  }

  get userConnectionsPath(): string {
    return this.config.userConnectionsPath;
  }

  transversesBaseUrl(): string {
    if (!this.apiBaseUrl) {
      return '';
    }

    if (this.apiBaseUrl.startsWith('/')) {
      const basePrefix = this.apiBaseUrl.replace(/\/cpro\/.*$/i, '');
      return `${basePrefix}/cpro/transverses`;
    }

    try {
      const parsed = new URL(this.apiBaseUrl);
      return `${parsed.origin}/cpro/transverses`;
    } catch {
      return PisteChorusRoutes.joinUrl(this.apiBaseUrl, '/cpro/transverses');
    }
  }

  connectionTestUrl(): string {
    return this.joinApiUrl(this.connectionTestPath);
  }

  uploadFileUrl(): string {
    return this.joinApiUrl(this.uploadFilePath);
  }

  submitInvoiceUrl(): string {
    return this.joinApiUrl(this.submitInvoicePath);
  }

  userAccountUrl(): string {
    return this.joinPlatformUrl(this.userAccountPath);
  }

  userConnectionsUrl(): string {
    return this.joinPlatformUrl(this.userConnectionsPath);
  }

  transversesHealthUrl(): string {
    return PisteChorusRoutes.joinUrl(this.transversesBaseUrl(), '/v1/health-check');
  }

  transversesCadresFacturationUrl(): string {
    return PisteChorusRoutes.joinUrl(this.transversesBaseUrl(), '/v1/recuperer/cadrefacturation');
  }

  transversesDevisesUrl(): string {
    return PisteChorusRoutes.joinUrl(this.transversesBaseUrl(), '/v1/recuperer/devises');
  }

  transversesTauxTvaUrl(): string {
    return PisteChorusRoutes.joinUrl(this.transversesBaseUrl(), '/v1/recuperer/tauxtva');
  }

  transversesModesReglementUrl(): string {
    return PisteChorusRoutes.joinUrl(this.transversesBaseUrl(), '/v1/recuperer/modereglements');
  }

  transversesModesDepotUrl(): string {
    return PisteChorusRoutes.joinUrl(this.transversesBaseUrl(), '/v1/recuperer/modedepot');
  }

  transversesCoordonneesBancairesValidesUrl(): string {
    return PisteChorusRoutes.joinUrl(this.transversesBaseUrl(), '/v1/recuperer/coordbanc/valides');
  }

  transversesStructuresActivesFournisseurUrl(): string {
    return PisteChorusRoutes.joinUrl(this.transversesBaseUrl(), '/v1/recuperer/structures/actives/fournisseur');
  }

  transversesRechercherDestinataireUrl(): string {
    return PisteChorusRoutes.joinUrl(this.transversesBaseUrl(), '/v1/rechercher/destinataire');
  }

  transversesRechercherServiceExecutantUrl(): string {
    return PisteChorusRoutes.joinUrl(this.transversesBaseUrl(), '/v1/rechercher/serviceexecutant');
  }

  isAttachmentUpload(): boolean {
    return PisteChorusRoutes.isAttachmentUploadPath(this.uploadFilePath);
  }

  isPdfDepositUpload(): boolean {
    return PisteChorusRoutes.isPdfDepositPath(this.uploadFilePath);
  }

  usesQualificationUserApis(): boolean {
    return PisteChorusRoutes.isQualificationUserApiUrl(this.userAccountPath)
      || PisteChorusRoutes.isQualificationUserApiUrl(this.userConnectionsPath);
  }

  private joinApiUrl(path: string): string {
    return PisteChorusRoutes.joinUrl(this.apiBaseUrl, path);
  }

  private joinPlatformUrl(path: string): string {
    if (!path) {
      return this.apiBaseUrl;
    }

    if (/^https?:\/\//i.test(path)) {
      return path;
    }

    if (!path.startsWith('/cpro/')) {
      return this.joinApiUrl(path);
    }

    if (this.apiBaseUrl.startsWith('/')) {
      const basePrefix = this.apiBaseUrl.replace(/\/cpro\/.*$/i, '');
      return `${basePrefix}${path}`;
    }

    try {
      const parsed = new URL(this.apiBaseUrl);
      return `${parsed.origin}${path}`;
    } catch {
      return path;
    }
  }

  static joinUrl(baseUrl: string, path: string): string {
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

  static isPdfDepositPath(path: string): boolean {
    return /\/v1\/deposer\/pdf$/i.test(path) || /\/deposer\/pdf$/i.test(path);
  }

  static isAttachmentUploadPath(path: string): boolean {
    return /\/v1\/ajouter\/fichier$/i.test(path) || /\/ajouter\/fichier$/i.test(path);
  }

  static isQualificationUserApiUrl(url: string): boolean {
    return /service-qualif|sandbox/i.test(url);
  }
}
