import { useEffect, useState } from 'react';
import { loadChorusConfig } from '@/lib/chorus/storage';
import { ReferenceCatalogClient, type ReferenceCatalog } from '@/lib/references/client';
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

export function useReferenceCatalog(configOverride?: ChorusConfig) {
  const [catalog, setCatalog] = useState<ReferenceCatalog>(EMPTY_REFERENCE_CATALOG);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const config = configOverride ?? loadChorusConfig();

    const hasReferenceApiSource = !!config.referenceApiBaseUrl && (
      !!config.referenceSuppliersPath
      || !!config.referencePublicCustomersPath
      || !!config.referencePublicServicesPath
    );
    const hasAnnuaireSource = !!config.referenceAnnuaireXmlUrl;

    if (!hasReferenceApiSource && !hasAnnuaireSource) {
      setCatalog(EMPTY_REFERENCE_CATALOG);
      setLoading(false);
      setError(null);
      return;
    }

    const client = new ReferenceCatalogClient(config);
    let cancelled = false;

    async function loadCatalog() {
      setLoading(true);
      setError(null);

      try {
        const nextCatalog = await client.fetchCatalog();
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
  }, [configOverride]);

  return {
    ...catalog,
    loading,
    error,
  };
}
