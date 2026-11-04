import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearReferenceCatalogCaches, ReferenceCatalogClient } from '@/lib/references/client';
import { getDefaultChorusConfig } from '@/lib/chorus/storage';

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  });
}

describe('ReferenceCatalogClient', () => {
  beforeEach(() => {
    clearReferenceCatalogCaches();
  });

  it('loads suppliers, public customers and public services from configured APIs', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse([{ id: 's1', legalName: 'Gigalis', siret: '25440253000011', active: true }]))
      .mockResolvedValueOnce(jsonResponse([{ id: 'pc1', legalName: 'Region', codeDestinataire: '23440003400026', siret: '23440003400026', active: true }]))
      .mockResolvedValueOnce(jsonResponse([{ id: 'ps1', publicCustomerId: 'pc1', codeServiceExecutant: 'SE001', label: 'Comptabilite fournisseurs', active: true }]));

    const client = new ReferenceCatalogClient({
      ...getDefaultChorusConfig(),
      referenceApiBaseUrl: 'https://backend.example.test/api',
      referenceSuppliersPath: '/suppliers',
      referencePublicCustomersPath: '/public-customers',
      referencePublicServicesPath: '/public-services',
    }, fetchMock);

    const catalog = await client.fetchCatalog();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(catalog.suppliers[0]?.legalName).toBe('Gigalis');
    expect(catalog.publicCustomers[0]?.codeDestinataire).toBe('23440003400026');
    expect(catalog.publicServices[0]?.codeServiceExecutant).toBe('SE001');
    expect(catalog.metadata.suppliersSource).toBe('api');
    expect(catalog.metadata.publicCustomersSource).toBe('api');
    expect(catalog.metadata.publicServicesSource).toBe('api');
  });

  it('returns empty collections when reference APIs are not configured', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const client = new ReferenceCatalogClient({
      ...getDefaultChorusConfig(),
      referenceAnnuaireJsonUrl: '',
      referenceAnnuaireXmlUrl: '',
    }, fetchMock);

    const catalog = await client.fetchCatalog();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(catalog).toEqual({
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
    });
  });

  it('falls back to the Chorus annuaire XML for public customers and services', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(`
        <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
        <CPPStructuresPartenaires>
          <CPPStructurePartenaireUnitaire>
            <TypeIdentifiant>SIRET</TypeIdentifiant>
            <Identifiant>23440003400026</Identifiant>
            <RaisonSociale>REGION DES PAYS DE LA LOIRE - SI EPLE</RaisonSociale>
            <Services>
              <Service>
                <Code>SE001</Code>
                <Nom>Comptabilite fournisseurs</Nom>
                <ServiceActif>true</ServiceActif>
              </Service>
            </Services>
            <GestionEngagement>true</GestionEngagement>
            <StructureActive>true</StructureActive>
          </CPPStructurePartenaireUnitaire>
        </CPPStructuresPartenaires>
      `, {
        status: 200,
        headers: {
          'content-type': 'application/xml',
        },
      }));

    const client = new ReferenceCatalogClient({
      ...getDefaultChorusConfig(),
      referenceApiBaseUrl: '',
      referenceAnnuaireJsonUrl: '',
      referenceAnnuaireXmlUrl: '/src/data/annuaire_out/FAR00001',
    }, fetchMock);

    const catalog = await client.fetchCatalog();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(catalog.suppliers).toEqual([]);
    expect(catalog.publicCustomers[0]?.legalName).toBe('REGION DES PAYS DE LA LOIRE - SI EPLE');
    expect(catalog.publicServices[0]?.codeServiceExecutant).toBe('SE001');
    expect(catalog.metadata.publicCustomersSource).toBe('annuaire');
    expect(catalog.metadata.publicServicesSource).toBe('annuaire');
    expect(catalog.metadata.annuaireStructureCount).toBe(1);
    expect(catalog.metadata.annuaireServiceCount).toBe(1);
  });

  it('reuses the cached catalog on subsequent loads with the same configuration', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse([{ id: 's1', legalName: 'Gigalis', siret: '25440253000011', active: true }]))
      .mockResolvedValueOnce(jsonResponse([{ id: 'pc1', legalName: 'Region', codeDestinataire: '23440003400026', siret: '23440003400026', active: true }]))
      .mockResolvedValueOnce(jsonResponse([{ id: 'ps1', publicCustomerId: 'pc1', codeServiceExecutant: 'SE001', label: 'Comptabilite fournisseurs', active: true }]));

    const client = new ReferenceCatalogClient({
      ...getDefaultChorusConfig(),
      referenceApiBaseUrl: 'https://backend.example.test/api',
      referenceSuppliersPath: '/suppliers',
      referencePublicCustomersPath: '/public-customers',
      referencePublicServicesPath: '/public-services',
    }, fetchMock);

    const firstCatalog = await client.fetchCatalog();
    const secondCatalog = await client.fetchCatalog();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(secondCatalog).toBe(firstCatalog);
    expect(client.getCachedCatalog()).toBe(firstCatalog);
  });
});
