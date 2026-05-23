import { describe, expect, it, vi } from 'vitest';
import { ChorusBackendAutomationClient, ChorusBackendAutomationError, resolveChorusBridgeUrl } from '@/lib/chorus/backendAutomation';
import { getDefaultChorusConfig } from '@/lib/chorus/storage';

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  });
}

describe('ChorusBackendAutomationClient', () => {
  it('derives the annuaire endpoint from the configured submission bridge URL', () => {
    const url = resolveChorusBridgeUrl({
      ...getDefaultChorusConfig(),
      submissionBridgeUrl: 'http://127.0.0.1:8008/api/chorus/submit',
    }, '/api/chorus/annuaire/sync');

    expect(url).toBe('http://127.0.0.1:8008/api/chorus/annuaire/sync');
  });

  it('synchronizes the annuaire through the backend bridge', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse({
      ok: true,
      codeRetour: 0,
      libelle: 'TRA_MSG_00.000',
      generatedAt: '2026-04-28T10:00:00.000Z',
      sourceFile: 'annuaire.destinataire.xml',
      structureCount: 1,
      serviceCount: 2,
      jsonPath: 'public/annuaire/annuaire.normalized.json',
      xmlPath: 'public/annuaire/annuaire.destinataire.xml',
      apiCalls: [],
    }));

    const client = new ChorusBackendAutomationClient({
      ...getDefaultChorusConfig(),
      submissionBridgeUrl: 'http://127.0.0.1:8008/api/chorus/submit',
    }, fetchMock);

    const result = await client.syncAnnuaire();

    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:8008/api/chorus/annuaire/sync', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ environment: 'qualif' }),
    }));
    expect(result.structureCount).toBe(1);
    expect(result.serviceCount).toBe(2);
    expect(result.jsonPath).toBe('public/annuaire/annuaire.normalized.json');
  });

  it('consults SIRET information through the backend bridge', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse({
      ok: true,
      siretStructure: '23440003400026',
      info: {
        codeRetour: 0,
        libelle: 'TRA_MSG_00.000',
        raisonSociale: 'REGION DES PAYS DE LA LOIRE',
        siret: '23440003400026',
      },
      apiCalls: [],
    }));

    const client = new ChorusBackendAutomationClient({
      ...getDefaultChorusConfig(),
      submissionBridgeUrl: 'http://127.0.0.1:8008/api/chorus/submit',
    }, fetchMock);

    const result = await client.consultSiretInformation('23440003400026');

    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:8008/api/chorus/siret/info', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ environment: 'qualif', siretStructure: '23440003400026' }),
    }));
    expect(result.info).toMatchObject({
      raisonSociale: 'REGION DES PAYS DE LA LOIRE',
      siret: '23440003400026',
    });
  });

  it('searches supplier invoices through the backend bridge', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse({
      ok: true,
      idFournisseur: 26359578,
      total: 83,
      returned: 83,
      requestedPageSize: 90,
      payload: {
        cadreFacturation: 'A1_FACTURE_FOURNISSEUR',
        idFournisseur: 26359578,
      },
      invoices: [
        {
          numeroFacture: 'FAC-2026-001',
          montantTTC: 120,
          statutCourant: 'MISE_EN_PAIEMENT',
        },
      ],
      apiCalls: [],
    }));

    const client = new ChorusBackendAutomationClient({
      ...getDefaultChorusConfig(),
      submissionBridgeUrl: 'http://127.0.0.1:8008/api/chorus/submit',
    }, fetchMock);

    const result = await client.searchSupplierInvoices({ idFournisseur: 26359578 });

    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:8008/api/chorus/invoices/supplier/search', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ idFournisseur: 26359578, environment: 'qualif' }),
    }));
    expect(result.total).toBe(83);
    expect(result.returned).toBe(83);
    expect(result.invoices).toHaveLength(1);
  });

  it('retrieves active recipient structures through the backend bridge', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse({
      ok: true,
      idFournisseur: 987654,
      idStructureCPP: 987654,
      structures: [{ idStructureCPP: 987654, designationStructure: 'Structure active' }],
      rawResponse: { listeStructures: [{ idStructureCPP: 987654 }] },
      apiCalls: [],
    }));

    const client = new ChorusBackendAutomationClient({
      ...getDefaultChorusConfig(),
      submissionBridgeUrl: 'http://127.0.0.1:8008/api/chorus/submit',
    }, fetchMock);

    const result = await client.getActiveRecipientStructures();

    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:8008/api/chorus/structures/active-destinataire', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ environment: 'qualif' }),
    }));
    expect(result.idFournisseur).toBe(987654);
    expect(result.structures).toHaveLength(1);
  });

  it('recycles an invoice through the backend bridge', async () => {
    const payload = {
      commentaire: 'Correction acheminement',
      destinataire: {
        codeDestinataire: '32242033407300',
      },
      identifiantFactureCPP: 8426157,
    };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse({
      ok: true,
      externalId: '8426157',
      payload,
      response: {
        codeRetour: 0,
        libelle: 'TRA_MSG_00.000',
        identifiantFactureCPP: 8426157,
        statutFacture: 'BROUILLON',
      },
      apiCalls: [],
    }));

    const client = new ChorusBackendAutomationClient({
      ...getDefaultChorusConfig(),
      submissionBridgeUrl: 'http://127.0.0.1:8008/api/chorus/submit',
    }, fetchMock);

    const result = await client.recycleInvoice(payload);

    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:8008/api/chorus/recycle', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ environment: 'qualif', payload }),
    }));
    expect(result.externalId).toBe('8426157');
    expect(result.response).toMatchObject({ statutFacture: 'BROUILLON' });
  });

  it('marks rejected payment requests as treated through the backend bridge', async () => {
    const payload = {
      cpltInfos: 'Rejet traité après contrôle métier',
      listeDemandePaiement: [
        {
          idDemandePaiement: 123456,
        },
      ],
      motifRejet: 'REJET_METIER',
    };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse({
      ok: true,
      payload,
      response: {
        codeRetour: 0,
        libelle: 'TRA_MSG_00.000',
      },
      apiCalls: [],
    }));

    const client = new ChorusBackendAutomationClient({
      ...getDefaultChorusConfig(),
      submissionBridgeUrl: 'http://127.0.0.1:8008/api/chorus/submit',
    }, fetchMock);

    const result = await client.treatRejection(payload);

    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:8008/api/chorus/rejection/treat', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ environment: 'qualif', payload }),
    }));
    expect(result.response).toMatchObject({ libelle: 'TRA_MSG_00.000' });
  });

  it('raises backend errors with debug api calls attached', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse({
      ok: false,
      error: 'Configuration Chorus incomplète',
      apiCalls: [{ label: 'Téléchargement', method: 'POST', url: 'https://example.test' }],
    }, 502));

    const client = new ChorusBackendAutomationClient(getDefaultChorusConfig(), fetchMock);

    await expect(client.syncAnnuaire()).rejects.toMatchObject({
      name: 'ChorusBackendAutomationError',
      message: 'Configuration Chorus incomplète',
      apiCalls: [{ label: 'Téléchargement', method: 'POST', url: 'https://example.test' }],
    });
  });
});
