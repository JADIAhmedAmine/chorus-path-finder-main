import { afterEach, describe, expect, it, vi } from 'vitest';
import { createChorusConnector, DirectChorusConnector } from '@/lib/chorus/client';
import { getDefaultChorusConfig } from '@/lib/chorus/storage';
import type { ChorusSubmissionPayload } from '@/lib/chorus/types';

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  });
}

function emptyJsonResponse(status = 200): Response {
  return new Response('', {
    status,
    headers: {
      'content-type': 'application/json',
    },
  });
}

function createValidPayload(): ChorusSubmissionPayload {
  return {
    cadreDeFacturation: {
      codeCadreFacturation: 'A1_FACTURE_FOURNISSEUR',
    },
    commentaire: 'Facture de test',
    dateFacture: '2026-04-17',
    destinataire: {
      codeDestinataire: '23440003400026',
      codeServiceExecutant: 'SE003',
    },
    fournisseur: {
      codeCoordonneesBancairesFournisseur: 132,
      idFournisseur: 160,
    },
    lignePoste: [{
      lignePosteDenomination: 'Ligne globale facture',
      lignePosteMontantRemiseHT: 0,
      lignePosteMontantUnitaireHT: 1200,
      lignePosteNumero: 1,
      lignePosteQuantite: 1,
      lignePosteReference: 'FAC-2026-001',
      lignePosteTauxTva: 'TV12',
      lignePosteUnite: 'UNITE',
    }],
    ligneTva: [{
      ligneTvaMontantBaseHtParTaux: 1200,
      ligneTvaMontantTvaParTaux: 240,
      ligneTvaTaux: 'TV12',
    }],
    modeDepot: 'SAISIE_API',
    montantTotal: {
      montantAPayer: 1440,
      montantHtTotal: 1200,
      montantRemiseGlobaleTTC: 0,
      montantTVA: 240,
      montantTtcTotal: 1440,
      motifRemiseGlobaleTTC: '',
    },
    numeroFactureSaisi: 'FAC-2026-001',
    pieceJointeComplementaire: [],
    pieceJointePrincipale: [],
    references: {
      deviseFacture: 'EUR',
      modePaiement: 'CHEQUE',
      numeroBonCommande: 'BC-2026-50',
      numeroFactureOrigine: '',
      numeroMarche: 'MA-2026-10',
      typeFacture: 'FACTURE',
      typeTva: 'TVA_SUR_DEBIT',
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('chorus connector', () => {
  it('retrieves an oauth token from the backend and calls the connection endpoint', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token-123456789' }))
      .mockResolvedValueOnce(jsonResponse({ status: 'ok' }));

    const connector = new DirectChorusConnector({
      ...getDefaultChorusConfig(),
      mode: 'direct',
      enabled: true,
      tokenUrl: 'https://sandbox-oauth.aife.economie.gouv.fr/api/oauth/token',
      apiBaseUrl: 'https://sandbox-api.example.test',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      technicalLogin: 'tech-user',
      technicalPassword: 'tech-pass',
      connectionTestPath: '/health',
      connectionTestMethod: 'GET',
    }, fetchMock);

    const result = await connector.testConnection();

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const tokenCall = fetchMock.mock.calls[0];
    expect(tokenCall?.[0]).toBe('/api/chorus/oauth-token');
    expect((tokenCall?.[1] as RequestInit).method).toBe('POST');
    expect(JSON.parse(String((tokenCall?.[1] as RequestInit).body))).toEqual({ environment: 'qualif' });

    const apiCall = fetchMock.mock.calls[1];
    expect(apiCall?.[0]).toBe('https://sandbox-api.example.test/health');
    const headers = (apiCall?.[1] as RequestInit).headers as Record<string, string>;
    expect((apiCall?.[1] as RequestInit).method).toBe('GET');
    expect(headers.Authorization).toBe('Bearer token-123456789');
    expect(headers['cpro-account']).toBeUndefined();
  });

  it('uses POST for the connection test when configured', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token-post-123456789' }))
      .mockResolvedValueOnce(jsonResponse({ status: 'ok' }));

    const connector = new DirectChorusConnector({
      ...getDefaultChorusConfig(),
      mode: 'direct',
      enabled: true,
      tokenUrl: 'https://sandbox-oauth.aife.economie.gouv.fr/api/oauth/token',
      apiBaseUrl: 'https://sandbox-api.example.test',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      technicalLogin: 'tech-user',
      technicalPassword: 'tech-pass',
      connectionTestPath: '/v1/rechercher/fournisseur',
      connectionTestMethod: 'POST',
    }, fetchMock);

    const result = await connector.testConnection();

    expect(result.ok).toBe(true);
    const apiCall = fetchMock.mock.calls[1];
    expect((apiCall?.[1] as RequestInit).method).toBe('POST');
    expect((apiCall?.[1] as RequestInit).body).toBe('{}');
    const headers = (apiCall?.[1] as RequestInit).headers as Record<string, string>;
    expect(headers['content-type']).toBe('application/json');
  });

  it('retrieves the Chorus technical context from user account and attachments APIs', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token-context' }))
      .mockResolvedValueOnce(jsonResponse({
        codeRetour: 0,
        libelle: 'TRA_MSG_00.000',
        listeStructureRattachement: [
          {
            designationStructure: 'GIP GIGALIS',
            idStructure: 160,
            identifiantStructure: '25440253000011',
            listeServicesRattache: [
              {
                codeService: 'FACTURES_PUBLIQUES',
                estActif: true,
                idService: 100,
                libelleService: 'Service des factures publiques',
                statutRattachementService: 'VALIDEE',
                statutService: 'ACTIF',
              },
              {
                codeService: 'SERVICE_GIGALIS',
                estActif: true,
                idService: 436,
                libelleService: 'Service Gigalis',
                statutRattachementService: 'VALIDEE',
                statutService: 'ACTIF',
              },
            ],
          },
        ],
      }))
      .mockResolvedValueOnce(jsonResponse({
        codeRetour: 0,
        libelle: 'TRA_MSG_00.000',
        idUtilisateur: 331,
      }));

    const connector = new DirectChorusConnector({
      ...getDefaultChorusConfig(),
      mode: 'direct',
      enabled: true,
      tokenUrl: 'https://oauth.example.test/token',
      apiBaseUrl: 'https://sandbox-api.piste.gouv.fr/cpro/factures',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      userAccountPath: '/cpro/utilisateurs/v1/consulter/compte',
      userConnectionsPath: '/cpro/utilisateurs/v1/monCompte/recuperer/rattachements',
    }, fetchMock);

    const result = await connector.resolveTechnicalContext({
      userEmail: 'marie.dupont@example.test',
      supplierSiret: '25440253000011',
    });

    expect(result.ok).toBe(true);
    expect(result.userId).toBe(331);
    expect(result.supplierStructureId).toBe(160);
    expect(result.supplierServiceId).toBe(436);
    expect(result.matchedOnSupplierSiret).toBe(true);

    const attachmentsCall = fetchMock.mock.calls[1];
    expect(attachmentsCall?.[0]).toBe('https://sandbox-api.piste.gouv.fr/cpro/utilisateurs/v1/monCompte/recuperer/rattachements');
    expect((attachmentsCall?.[1] as RequestInit).method).toBe('POST');
    expect((attachmentsCall?.[1] as RequestInit).body).toBe('{}');

    const accountCall = fetchMock.mock.calls[2];
    expect(accountCall?.[0]).toBe('https://sandbox-api.piste.gouv.fr/cpro/utilisateurs/v1/consulter/compte');
    expect(String((accountCall?.[1] as RequestInit).body)).toContain('marie.dupont@example.test');
  });

  it('tolerates an empty JSON body when resolving the Chorus technical context', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token-context' }))
      .mockResolvedValueOnce(jsonResponse({
        codeRetour: 0,
        libelle: 'TRA_MSG_00.000',
        listeStructureRattachement: [
          {
            designationStructure: 'GIP GIGALIS',
            idStructure: 160,
            identifiantStructure: '25440253000011',
            listeServicesRattache: [
              {
                codeService: 'SERVICE_GIGALIS',
                estActif: true,
                idService: 436,
                libelleService: 'Service Gigalis',
                statutRattachementService: 'VALIDEE',
                statutService: 'ACTIF',
              },
            ],
          },
        ],
      }))
      .mockResolvedValueOnce(emptyJsonResponse());

    const connector = new DirectChorusConnector({
      ...getDefaultChorusConfig(),
      mode: 'direct',
      enabled: true,
      tokenUrl: 'https://oauth.example.test/token',
      apiBaseUrl: 'https://sandbox-api.piste.gouv.fr/cpro/factures',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      userAccountPath: '/cpro/utilisateurs/v1/consulter/compte',
      userConnectionsPath: '/cpro/utilisateurs/v1/monCompte/recuperer/rattachements',
    }, fetchMock);

    const result = await connector.resolveTechnicalContext({
      userEmail: 'marie.dupont@example.test',
      supplierSiret: '25440253000011',
    });

    expect(result.ok).toBe(true);
    expect(result.userId).toBeUndefined();
    expect(result.supplierStructureId).toBe(160);
    expect(result.supplierServiceId).toBe(436);
  });

  it('sends files and a validated Chorus payload to the Python submission bridge', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({
        ok: true,
        externalId: 'CHORUS-INV-001',
        uploadedFiles: [{ id: 'main-file-id', filename: 'invoice.pdf' }],
        payload: createValidPayload(),
        response: { invoiceId: 'CHORUS-INV-001' },
        apiCalls: [{
          label: 'Soumission facture Chorus',
          method: 'POST',
          url: 'https://chorus-python.test/soumettre',
          responseStatus: 200,
        }],
      }));

    const connector = new DirectChorusConnector({
      ...getDefaultChorusConfig(),
      mode: 'direct',
      enabled: true,
      tokenUrl: 'https://oauth.example.test/token',
      apiBaseUrl: 'https://api.example.test',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      uploadFilePath: '/files/upload',
      submitInvoicePath: '/factures/soumettre',
      submissionBridgeUrl: 'https://bridge.example.test/submit',
    }, fetchMock);

    const result = await connector.submitInvoice({
      invoiceData: createValidPayload(),
      mainFile: new File(['main'], 'invoice.pdf', { type: 'application/pdf' }),
      attachments: [new File(['att'], 'attachment.xml', { type: 'text/xml' })],
    });

    expect(result.ok).toBe(true);
    expect(result.externalId).toBe('CHORUS-INV-001');
    expect(result.apiCalls).toHaveLength(2);
    expect(result.apiCalls[0]).toMatchObject({
      label: 'Bridge Python local',
      method: 'POST',
      url: 'https://bridge.example.test/api/chorus/submit',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const bridgeCall = fetchMock.mock.calls[0];
    expect(bridgeCall?.[0]).toBe('https://bridge.example.test/api/chorus/submit');
    const bridgePayload = JSON.parse(String((bridgeCall?.[1] as RequestInit).body));
    expect(bridgePayload.payload.numeroFactureSaisi).toBe('FAC-2026-001');
    expect(bridgePayload.payload.destinataire.codeDestinataire).toBe('23440003400026');
    expect(bridgePayload.payload.modeDepot).toBe('SAISIE_API');
    expect(bridgePayload.mainFile).toMatchObject({
      name: 'invoice.pdf',
      mimeType: 'application/pdf',
      base64: 'bWFpbg==',
    });
    expect(bridgePayload.attachments[0]).toMatchObject({
      name: 'attachment.xml',
      mimeType: 'text/xml',
      base64: 'YXR0',
    });
  });

  it('returns the Python bridge submission details for a PDF deposit', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({
        ok: true,
        externalId: 'CHORUS-PDF-001',
        uploadedFiles: [{ id: '28093', filename: 'invoice.pdf' }],
        payload: {
          ...createValidPayload(),
          modeDepot: 'DEPOT_PDF_SIGNE_API',
          pieceJointePrincipale: [{
            pieceJointePrincipaleDesignation: 'GCU_MSG_01_000',
            pieceJointePrincipaleId: 28093,
          }],
        },
        response: { invoiceId: 'CHORUS-PDF-001' },
        apiCalls: [
          {
            label: 'Upload fichier Chorus: invoice.pdf',
            method: 'POST',
            url: 'https://sandbox-api.piste.gouv.fr/cpro/factures/v1/deposer/pdf',
          },
          {
            label: 'Soumission facture Chorus',
            method: 'POST',
            url: 'https://sandbox-api.piste.gouv.fr/cpro/factures/v1/soumettre',
          },
        ],
      }));

    const connector = new DirectChorusConnector({
      ...getDefaultChorusConfig(),
      mode: 'direct',
      enabled: true,
      tokenUrl: 'https://oauth.example.test/token',
      apiBaseUrl: 'https://sandbox-api.piste.gouv.fr/cpro/factures',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      uploadFilePath: '/v1/deposer/pdf',
      submitInvoicePath: '/v1/soumettre',
      submissionBridgeUrl: 'https://bridge.example.test/submit',
    }, fetchMock);

    await expect(connector.submitInvoice({
      invoiceData: createValidPayload(),
      mainFile: new File(['PDF'], 'invoice.pdf', { type: 'application/pdf' }),
      attachments: [],
    })).resolves.toMatchObject({
      ok: true,
      externalId: 'CHORUS-PDF-001',
      apiCalls: [
        {
          label: 'Bridge Python local',
          method: 'POST',
          url: 'https://bridge.example.test/api/chorus/submit',
        },
        {
          label: 'Upload fichier Chorus: invoice.pdf',
          method: 'POST',
          url: 'https://sandbox-api.piste.gouv.fr/cpro/factures/v1/deposer/pdf',
        },
        {
          label: 'Soumission facture Chorus',
          method: 'POST',
          url: 'https://sandbox-api.piste.gouv.fr/cpro/factures/v1/soumettre',
        },
      ],
    });

    const bridgeCall = fetchMock.mock.calls[0];
    expect(bridgeCall?.[0]).toBe('https://bridge.example.test/api/chorus/submit');
    const bridgeBody = JSON.parse(String((bridgeCall?.[1] as RequestInit).body));
    expect(bridgeBody.payload.numeroFactureSaisi).toBe('FAC-2026-001');
    expect(bridgeBody.mainFile.name).toBe('invoice.pdf');
  });

  it('propagates Chorus-specific bridge errors with debug calls', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({
        ok: false,
        error: 'Erreur Chorus après upload de la piece jointe 28093.',
        apiCalls: [{
          label: 'Soumission facture Chorus',
          method: 'POST',
          url: 'https://sandbox-api.piste.gouv.fr/cpro/factures/v1/soumettre',
          responseStatus: 500,
        }],
      }, 500));

    const connector = new DirectChorusConnector({
      ...getDefaultChorusConfig(),
      mode: 'direct',
      enabled: true,
      tokenUrl: 'https://oauth.example.test/token',
      apiBaseUrl: 'https://sandbox-api.piste.gouv.fr/cpro/factures',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      uploadFilePath: '/v1/deposer/pdf',
      submitInvoicePath: '/v1/soumettre',
      submissionBridgeUrl: 'https://bridge.example.test/submit',
    }, fetchMock);

    await expect(connector.submitInvoice({
      invoiceData: createValidPayload(),
      mainFile: new File(['PDF'], 'invoice.pdf', { type: 'application/pdf' }),
      attachments: [],
    })).rejects.toThrow(/piece jointe 28093/i);
  });

  it('rejects Chorus business failures returned with HTTP 200', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({
        ok: true,
        uploadedFiles: [],
        payload: createValidPayload(),
        response: {
          codeRetour: 42,
          libelle: 'TRA_MSG_TEST.KO',
          statutFacture: 'REJETEE',
          numeroFacture: 'FAC-2026-001',
        },
        apiCalls: [{
          label: 'Soumission facture Chorus',
          method: 'POST',
          url: 'https://sandbox-api.piste.gouv.fr/cpro/factures/v1/soumettre',
          responseStatus: 200,
          responseBody: {
            codeRetour: 42,
            libelle: 'TRA_MSG_TEST.KO',
            statutFacture: 'REJETEE',
          },
        }],
      }));

    const connector = new DirectChorusConnector({
      ...getDefaultChorusConfig(),
      mode: 'direct',
      enabled: true,
      tokenUrl: 'https://oauth.example.test/token',
      apiBaseUrl: 'https://sandbox-api.piste.gouv.fr/cpro/factures',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      uploadFilePath: '/v1/deposer/pdf',
      submitInvoicePath: '/v1/soumettre',
      submissionBridgeUrl: 'https://bridge.example.test/submit',
    }, fetchMock);

    await expect(connector.submitInvoice({
      invoiceData: createValidPayload(),
      mainFile: new File(['PDF'], 'invoice.pdf', { type: 'application/pdf' }),
      attachments: [],
    })).rejects.toThrow(/Code retour Chorus 42.*TRA_MSG_TEST\.KO.*REJETEE/i);
  });

  it('fails fast when the payload is invalid before the HTTP POST', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token-upload-pdf' }))
      .mockResolvedValueOnce(jsonResponse({ pieceJointeId: 28093 }));

    const connector = new DirectChorusConnector({
      ...getDefaultChorusConfig(),
      mode: 'direct',
      enabled: true,
      tokenUrl: 'https://oauth.example.test/token',
      apiBaseUrl: 'https://sandbox-api.piste.gouv.fr/cpro/factures',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      uploadFilePath: '/v1/deposer/pdf',
      submitInvoicePath: '/v1/soumettre',
    }, fetchMock);

    const invalidPayload = {
      ...createValidPayload(),
      dateFacture: undefined,
    };

    await expect(connector.submitInvoice({
      invoiceData: invalidPayload,
      mainFile: new File(['PDF'], 'invoice.pdf', { type: 'application/pdf' }),
      attachments: [],
    })).rejects.toThrow(/Payload Chorus invalide/i);

    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  it('uses mock mode when direct mode is not requested', async () => {
    const connector = createChorusConnector({
      ...getDefaultChorusConfig(),
      mode: 'mock',
      enabled: false,
    });
    const result = await connector.testConnection();

    expect(result.ok).toBe(true);
    expect(result.message).toContain('mock');
  });

  it('keeps the native fetch bound to the browser global object', async () => {
    const fetchRequiringWindowContext = vi.fn(function (this: unknown) {
      if (this !== globalThis) {
        throw new TypeError('Illegal invocation');
      }

      return Promise.resolve(jsonResponse({ access_token: 'token-bound-123456789' }));
    }) as typeof fetch;

    vi.stubGlobal('fetch', fetchRequiringWindowContext);

    const connector = createChorusConnector({
      ...getDefaultChorusConfig(),
      mode: 'direct',
      enabled: true,
      tokenUrl: 'https://sandbox-oauth.aife.economie.gouv.fr/api/oauth/token',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      connectionTestPath: '',
    });

    const result = await connector.testConnection();

    expect(result.ok).toBe(true);
    expect(fetchRequiringWindowContext).toHaveBeenCalledTimes(1);
  });
});
