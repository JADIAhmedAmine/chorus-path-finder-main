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
      destinataire: {
        codeDestinataire: '32242033407300',
        codeServiceExecutant: 'SERVICE-FACTURES',
      },
      identifiantFactureCPP: 8426157,
      reference: {
        numeroBonCommande: 'EJ-2026-0042',
      },
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

  it('corrects a wrong invoice validator through the backend bridge', async () => {
    const payload = {
      idFacture: 8424327,
      idStructure: 123456,
      identifiantStructure: '32242033407300',
      typeIdentifiantStructure: 'SIRET',
    };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse({
      ok: true,
      payload,
      response: {
        codeRetour: 0,
        idFacture: 8424327,
        libelle: 'TRA_MSG_00.000',
      },
      apiCalls: [],
    }));

    const client = new ChorusBackendAutomationClient({
      ...getDefaultChorusConfig(),
      submissionBridgeUrl: 'http://127.0.0.1:8008/api/chorus/submit',
    }, fetchMock);

    const result = await client.correctInvoiceValidator(payload);

    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:8008/api/chorus/validator/correct', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ environment: 'qualif', payload }),
    }));
    expect(result.response).toMatchObject({ idFacture: 8424327, libelle: 'TRA_MSG_00.000' });
  });

  it('consults an invoice for reception through the backend bridge', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse({
      ok: true,
      success: true,
      identifiantFactureCPP: 8424327,
      facture: {
        identifiantFactureCPP: 8424327,
        numeroFacture: '20260000000000000064',
        statutFacture: 'REJETEE',
        modeDepot: 'SAISIE_API',
        rejetTraite: false,
        fournisseur: null,
        destinataire: null,
        dates: { dateFacture: null, dateDepot: null, dateEcheancePaiement: null },
        montants: { ht: 0, tva: 0, ttc: 0, aPayer: 0, devise: 'EUR' },
        references: {
          numeroBonCommande: null,
          numeroMarche: null,
          numeroDpMandat: null,
          numeroFactureOrigine: null,
          motifExonerationTva: null,
          modePaiement: null,
          typeFacture: null,
          typeTva: null,
        },
        piecesJointes: [],
        lignesDePoste: [],
        recapitulatifTva: [],
      },
      apiCalls: [],
    }));

    const client = new ChorusBackendAutomationClient({
      ...getDefaultChorusConfig(),
      submissionBridgeUrl: 'http://127.0.0.1:8008/api/chorus/submit',
    }, fetchMock);

    const result = await client.consultInvoiceForReception(8424327);

    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:8008/api/reception/consult', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ environment: 'qualif', identifiantFactureCPP: 8424327 }),
    }));
    expect(result).toMatchObject({
      ok: true,
      success: true,
      facture: { numeroFacture: '20260000000000000064' },
    });
  });

  it('consults invoices in bulk for reception through the backend bridge', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse({
      ok: true,
      success: true,
      totalRequested: 2,
      totalSuccess: 1,
      totalFailed: 1,
      items: [
        {
          identifiantFactureCPP: 8424327,
          success: true,
          facture: {
            identifiantFactureCPP: 8424327,
            numeroFacture: 'FAC-1',
            statutFacture: 'REJETEE',
            modeDepot: 'SAISIE_API',
            rejetTraite: false,
            fournisseur: null,
            destinataire: null,
            dates: { dateFacture: null, dateDepot: null, dateEcheancePaiement: null },
            montants: { ht: 0, tva: 0, ttc: 0, aPayer: 0, devise: 'EUR' },
            references: {
              numeroBonCommande: null,
              numeroMarche: null,
              numeroDpMandat: null,
              numeroFactureOrigine: null,
              motifExonerationTva: null,
              modePaiement: null,
              typeFacture: null,
              typeTva: null,
            },
            piecesJointes: [],
            lignesDePoste: [],
            recapitulatifTva: [],
          },
        },
      ],
      errors: [
        {
          identifiantFactureCPP: 8424328,
          success: false,
          category: 'NOT_FOUND',
          human_message: 'Introuvable',
          raw_message: '404',
          recommended_action: 'Vérifier l’identifiant.',
        },
      ],
      apiCalls: [],
    }));

    const client = new ChorusBackendAutomationClient({
      ...getDefaultChorusConfig(),
      submissionBridgeUrl: 'http://127.0.0.1:8008/api/chorus/submit',
    }, fetchMock);

    const result = await client.consultInvoicesBulkForReception([8424327, 8424328]);

    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:8008/api/reception/consult-bulk', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ environment: 'qualif', identifiantsFactureCPP: [8424327, 8424328] }),
    }));
    expect(result.totalSuccess).toBe(1);
    expect(result.errors).toHaveLength(1);
  });

  it('consults invoice history through the backend bridge', async () => {
    const payload = {
      idFacture: 8424327,
      nbResultatsMaximum: 10,
      paramRechercheHistoActionsUtilisateurs: {
        nbResultatsParPageListeHistoAction: 10,
        pageResultatDemandeeListeHistoAction: 1,
        triColonneListeHistoAction: 'HistoActionDateHeure',
        triSensListeHistoAction: 'Descendant',
      },
      paramRechercheHistoEvenementsComplementaires: {
        nbResultatsParPageListeHistoEvenement: 10,
        pageResultatDemandeeListeHistoEvenement: 1,
        triColonneListeHistoEvenement: 'EvenementLibelle',
        triSensListeHistoEvenement: 'Descendant',
      },
      paramRechercheHistoStatuts: {
        nbResultatsParPageListeHistoStatut: 10,
        pageResultatDemandeeListeHistoStatut: 1,
        triColonneListeHistoStatut: 'HistoStatutDatePassage',
        triSensListeHistoStatut: 'Descendant',
      },
    };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse({
      ok: true,
      payload,
      response: {
        codeRetour: 0,
        libelle: 'GCU_MSG_01_000',
        idFacture: 8424327,
        numeroFacture: '20260000000000000064',
        modeDepot: 'SAISIE_API',
        statutCourantCode: 'REJETEE',
        historiquesDesStatuts: {
          histoStatut: [
            {
              histoStatutId: 19990676,
              histoStatutCode: 'REJETEE',
              histoStatutDatePassage: '2026-04-28 14:51',
            },
          ],
        },
        historiquesDesActionsUtilisateurs: {
          histoAction: [
            {
              histoActionId: 100085487,
              histoActionCode: 'ACQUITTEMENT_REJET',
              histoActionDateHeure: '2026-04-29 16:08',
            },
          ],
        },
        derniereAction: {
          derniereActionId: 100085487,
          derniereActionCode: 'ACQUITTEMENT_REJET',
        },
      },
      apiCalls: [],
    }));

    const client = new ChorusBackendAutomationClient({
      ...getDefaultChorusConfig(),
      submissionBridgeUrl: 'http://127.0.0.1:8008/api/chorus/submit',
    }, fetchMock);

    const result = await client.getInvoiceHistory(payload);

    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:8008/api/chorus/invoices/history', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ environment: 'qualif', payload }),
    }));
    expect(result.response).toMatchObject({
      idFacture: 8424327,
      statutCourantCode: 'REJETEE',
    });
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
