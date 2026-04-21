import type { ChorusConfig } from '@/types/chorus';
import type { PublicCustomer, PublicService, SupplierOrganization } from '@/types';
import { parseChorusAnnuaireXml, type ChorusAnnuaireCatalog } from '@/lib/references/annuaire';

export interface ReferenceCatalog {
  suppliers: SupplierOrganization[];
  publicCustomers: PublicCustomer[];
  publicServices: PublicService[];
  metadata: ReferenceCatalogMetadata;
}

export interface ReferenceCatalogLoadOptions {
  includeSuppliers?: boolean;
  includePublicCustomers?: boolean;
  includePublicServices?: boolean;
  includeAnnuaire?: boolean;
}

export type ReferenceCatalogSource = 'api' | 'annuaire' | 'empty';

export interface ReferenceCatalogMetadata {
  suppliersSource: ReferenceCatalogSource;
  publicCustomersSource: ReferenceCatalogSource;
  publicServicesSource: ReferenceCatalogSource;
  annuaireSourceFormat?: 'json' | 'xml';
  annuaireJsonUrl?: string;
  annuaireXmlUrl?: string;
  annuaireStructureCount: number;
  annuaireServiceCount: number;
}

const annuaireCache = new Map<string, Promise<ChorusAnnuaireCatalog>>();
const referenceCatalogCache = new Map<string, ReferenceCatalog>();
const referenceCatalogPromiseCache = new Map<string, Promise<ReferenceCatalog>>();

function getDefaultFetchImpl(): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init)) as typeof fetch;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function pickArrayPayload(body: unknown): Record<string, unknown>[] {
  if (Array.isArray(body)) {
    return body.filter(isRecord);
  }

  if (!isRecord(body)) {
    return [];
  }

  const candidates = [
    body.items,
    body.results,
    body.data,
    body.suppliers,
    body.publicCustomers,
    body.publicServices,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.filter(isRecord);
    }
  }

  return [];
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asBoolean(value: unknown, fallback = true): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeSupplier(record: Record<string, unknown>, index: number): SupplierOrganization {
  return {
    id: asString(record.id) || asString(record.supplierId) || `supplier-${index + 1}`,
    tenantId: asString(record.tenantId) || 'external',
    legalName: asString(record.legalName) || asString(record.name),
    siret: asString(record.siret).replace(/\D/g, ''),
    vatNumber: asString(record.vatNumber),
    chorusSupplierCode: asString(record.chorusSupplierCode) || undefined,
    active: asBoolean(record.active, true),
    createdAt: asString(record.createdAt) || new Date(0).toISOString(),
    updatedAt: asString(record.updatedAt) || new Date(0).toISOString(),
  };
}

function normalizePublicCustomer(record: Record<string, unknown>, index: number): PublicCustomer {
  return {
    id: asString(record.id) || asString(record.customerId) || `customer-${index + 1}`,
    tenantId: asString(record.tenantId) || 'external',
    codeDestinataire: asString(record.codeDestinataire) || asString(record.destinationCode),
    legalName: asString(record.legalName) || asString(record.name),
    siret: asString(record.siret).replace(/\D/g, ''),
    structureType: asString(record.structureType) || 'PUBLIC',
    active: asBoolean(record.active, true),
    createdAt: asString(record.createdAt) || new Date(0).toISOString(),
    updatedAt: asString(record.updatedAt) || new Date(0).toISOString(),
  };
}

function normalizePublicService(record: Record<string, unknown>, index: number): PublicService {
  return {
    id: asString(record.id) || asString(record.serviceId) || `service-${index + 1}`,
    tenantId: asString(record.tenantId) || 'external',
    publicCustomerId: asString(record.publicCustomerId) || asString(record.customerId),
    codeServiceExecutant: asString(record.codeServiceExecutant) || asString(record.codeService),
    label: asString(record.label) || asString(record.libelleService),
    engagementRequired: asBoolean(record.engagementRequired, false),
    purchaseOrderRequired: asBoolean(record.purchaseOrderRequired, false),
    active: asBoolean(record.active, true),
    createdAt: asString(record.createdAt) || new Date(0).toISOString(),
    updatedAt: asString(record.updatedAt) || new Date(0).toISOString(),
  };
}

export class ReferenceCatalogClient {
  constructor(
    private readonly config: ChorusConfig,
    private readonly fetchImpl: typeof fetch = getDefaultFetchImpl(),
  ) {}

  private async fetchCollection<T>(
    path: string,
    label: string,
    normalizeItem: (record: Record<string, unknown>, index: number) => T,
  ): Promise<T[]> {
    const baseUrl = this.config.referenceApiBaseUrl.trim();
    const relativePath = path.trim();

    if (!baseUrl || !relativePath) {
      return [];
    }

    const response = await this.fetchImpl(joinUrl(baseUrl, relativePath), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`${label} indisponible (${response.status}).`);
    }

    const body = await response.json() as unknown;
    return pickArrayPayload(body).map(normalizeItem);
  }

  private async fetchAnnuaireCatalog(): Promise<ChorusAnnuaireCatalog> {
    const annuaireJsonUrl = this.config.referenceAnnuaireJsonUrl.trim();
    const annuaireUrl = this.config.referenceAnnuaireXmlUrl.trim();
    if (!annuaireJsonUrl && !annuaireUrl) {
      return {
        publicCustomers: [],
        publicServices: [],
        structureCount: 0,
        serviceCount: 0,
      };
    }

    const cacheKey = annuaireJsonUrl || annuaireUrl;
    const existing = annuaireCache.get(cacheKey);
    if (existing) {
      return existing;
    }

    const nextPromise = (async () => {
      if (annuaireJsonUrl) {
        const jsonResponse = await this.fetchImpl(annuaireJsonUrl, {
          method: 'GET',
          headers: {
            Accept: 'application/json',
          },
        });

        if (jsonResponse.ok) {
          const payload = await jsonResponse.json() as {
            metadata?: { structureCount?: number; serviceCount?: number };
            publicCustomers?: PublicCustomer[];
            publicServices?: PublicService[];
          };

          return {
            publicCustomers: Array.isArray(payload.publicCustomers) ? payload.publicCustomers : [],
            publicServices: Array.isArray(payload.publicServices) ? payload.publicServices : [],
            structureCount: payload.metadata?.structureCount ?? 0,
            serviceCount: payload.metadata?.serviceCount ?? 0,
          };
        }
      }

      if (!annuaireUrl) {
        return {
          publicCustomers: [],
          publicServices: [],
          structureCount: 0,
          serviceCount: 0,
        };
      }

      const response = await this.fetchImpl(annuaireUrl, {
        method: 'GET',
        headers: {
          Accept: 'application/xml,text/xml;q=0.9,*/*;q=0.1',
        },
      });

      if (!response.ok) {
        throw new Error(`Annuaire Chorus XML indisponible (${response.status}).`);
      }

      const xmlContent = await response.text();
      return parseChorusAnnuaireXml(xmlContent);
    })().catch((error) => {
      annuaireCache.delete(cacheKey);
      throw error;
    });

    annuaireCache.set(cacheKey, nextPromise);
    return nextPromise;
  }

  private buildCatalogCacheKey(options: ReferenceCatalogLoadOptions): string {
    return JSON.stringify({
      referenceApiBaseUrl: this.config.referenceApiBaseUrl,
      referenceSuppliersPath: this.config.referenceSuppliersPath,
      referencePublicCustomersPath: this.config.referencePublicCustomersPath,
      referencePublicServicesPath: this.config.referencePublicServicesPath,
      referenceAnnuaireJsonUrl: this.config.referenceAnnuaireJsonUrl,
      referenceAnnuaireXmlUrl: this.config.referenceAnnuaireXmlUrl,
      includeSuppliers: options.includeSuppliers ?? true,
      includePublicCustomers: options.includePublicCustomers ?? true,
      includePublicServices: options.includePublicServices ?? true,
      includeAnnuaire: options.includeAnnuaire ?? true,
    });
  }

  getCachedCatalog(options: ReferenceCatalogLoadOptions = {}): ReferenceCatalog | null {
    return referenceCatalogCache.get(this.buildCatalogCacheKey(options)) ?? null;
  }

  async fetchCatalog(options: ReferenceCatalogLoadOptions = {}): Promise<ReferenceCatalog> {
    const cacheKey = this.buildCatalogCacheKey(options);
    const cachedCatalog = referenceCatalogCache.get(cacheKey);
    if (cachedCatalog) {
      return cachedCatalog;
    }

    const pendingCatalog = referenceCatalogPromiseCache.get(cacheKey);
    if (pendingCatalog) {
      return pendingCatalog;
    }

    const includeSuppliers = options.includeSuppliers ?? true;
    const includePublicCustomers = options.includePublicCustomers ?? true;
    const includePublicServices = options.includePublicServices ?? true;
    const includeAnnuaire = options.includeAnnuaire ?? true;

    const nextPromise = (async () => {
      const [suppliers, publicCustomers, publicServices, annuaireCatalog] = await Promise.all([
        includeSuppliers
          ? this.fetchCollection(this.config.referenceSuppliersPath, 'API fournisseurs', normalizeSupplier)
          : Promise.resolve([]),
        includePublicCustomers
          ? this.fetchCollection(this.config.referencePublicCustomersPath, 'API clients publics', normalizePublicCustomer)
          : Promise.resolve([]),
        includePublicServices
          ? this.fetchCollection(this.config.referencePublicServicesPath, 'API services publics', normalizePublicService)
          : Promise.resolve([]),
        includeAnnuaire
          ? this.fetchAnnuaireCatalog()
          : Promise.resolve({
              publicCustomers: [],
              publicServices: [],
              structureCount: 0,
              serviceCount: 0,
            }),
      ]);

      const nextCatalog: ReferenceCatalog = {
        suppliers,
        publicCustomers: publicCustomers.length > 0 ? publicCustomers : annuaireCatalog.publicCustomers,
        publicServices: publicServices.length > 0 ? publicServices : annuaireCatalog.publicServices,
        metadata: {
          suppliersSource: includeSuppliers && suppliers.length > 0 ? 'api' : 'empty',
          publicCustomersSource: publicCustomers.length > 0 ? 'api' : annuaireCatalog.publicCustomers.length > 0 ? 'annuaire' : 'empty',
          publicServicesSource: publicServices.length > 0 ? 'api' : annuaireCatalog.publicServices.length > 0 ? 'annuaire' : 'empty',
          annuaireSourceFormat: this.config.referenceAnnuaireJsonUrl.trim() ? 'json' : this.config.referenceAnnuaireXmlUrl.trim() ? 'xml' : undefined,
          annuaireJsonUrl: this.config.referenceAnnuaireJsonUrl.trim() || undefined,
          annuaireXmlUrl: this.config.referenceAnnuaireXmlUrl.trim() || undefined,
          annuaireStructureCount: annuaireCatalog.structureCount,
          annuaireServiceCount: annuaireCatalog.serviceCount,
        },
      };

      referenceCatalogCache.set(cacheKey, nextCatalog);
      referenceCatalogPromiseCache.delete(cacheKey);
      return nextCatalog;
    })().catch((error) => {
      referenceCatalogPromiseCache.delete(cacheKey);
      throw error;
    });

    referenceCatalogPromiseCache.set(cacheKey, nextPromise);
    return nextPromise;
  }
}
