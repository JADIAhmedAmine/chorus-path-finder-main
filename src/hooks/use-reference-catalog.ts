import { useCallback, useEffect, useState } from 'react';
import { loadChorusConfig } from '@/lib/chorus/storage';
import {
  clearReferenceCatalogCaches,
  ReferenceCatalogClient,
  type ReferenceCatalog,
  type ReferenceCatalogLoadOptions,
} from '@/lib/references/client';
import type { ChorusConfig } from '@/types/chorus';

const EMPTY_REFERENCE_CATALOG: ReferenceCatalog = {
  suppliers: [],
  publicCustomers: [],
  publicServices: [],
  metadata: {
    suppliersSource: 'empty',
    publicCustomersSource: 'empty',
    publicServicesSource: 'empty',
    annuaireStructureCount: 0,
    annuaireServiceCount: 0,
  },
};

export function useReferenceCatalog(
  configOverride?: ChorusConfig,
  options: ReferenceCatalogLoadOptions = {},
) {
  const [refreshIndex, setRefreshIndex] = useState(0);
  const [catalog, setCatalog] = useState<ReferenceCatalog>(() => {
    const config = configOverride ?? loadChorusConfig();
    const client = new ReferenceCatalogClient(config);
    return client.getCachedCatalog(options) ?? EMPTY_REFERENCE_CATALOG;
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    clearReferenceCatalogCaches();
    setRefreshIndex((value) => value + 1);
  }, []);

  useEffect(() => {
    const config = configOverride ?? loadChorusConfig();

    const includeSuppliers = options.includeSuppliers ?? true;
    const includePublicCustomers = options.includePublicCustomers ?? true;
    const includePublicServices = options.includePublicServices ?? true;
    const includeAnnuaire = options.includeAnnuaire ?? true;

    const hasReferenceApiSource = !!config.referenceApiBaseUrl && (
      (includeSuppliers && !!config.referenceSuppliersPath)
      || (includePublicCustomers && !!config.referencePublicCustomersPath)
      || (includePublicServices && !!config.referencePublicServicesPath)
    );
    const hasAnnuaireSource = includeAnnuaire && (!!config.referenceAnnuaireJsonUrl || !!config.referenceAnnuaireXmlUrl);

    if (!hasReferenceApiSource && !hasAnnuaireSource) {
      setCatalog(EMPTY_REFERENCE_CATALOG);
      setLoading(false);
      setError(null);
      return;
    }

    const client = new ReferenceCatalogClient(config);
    const cachedCatalog = client.getCachedCatalog(options);
    let cancelled = false;

    async function loadCatalog() {
      if (cachedCatalog) {
        setCatalog(cachedCatalog);
      }

      setLoading(!cachedCatalog);
      setError(null);

      try {
        const nextCatalog = await client.fetchCatalog(options);
        if (!cancelled) {
          setCatalog(nextCatalog);
        }
      } catch (loadError) {
        if (!cancelled) {
          setCatalog(EMPTY_REFERENCE_CATALOG);
          setError(loadError instanceof Error ? loadError.message : 'Chargement des référentiels impossible.');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadCatalog();

    return () => {
      cancelled = true;
    };
  }, [configOverride, options.includeSuppliers, options.includePublicCustomers, options.includePublicServices, options.includeAnnuaire, refreshIndex]);

  return {
    ...catalog,
    loading,
    error,
    refresh,
  };
}
