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
      idServiceFournisseur: 436,
    },
    idUtilisateurCourant: 331,
    lignePoste: [{
      lignePosteDenomination: 'Ligne globale facture',
      lignePosteMontantRemiseHT: 0,
      lignePosteMontantUnitaireHT: 1200,
      lignePosteNumero: 1,
      lignePosteQuantite: 1,
      lignePosteReference: 'FAC-2026-001',
      lignePosteTauxTva: '0.2',
      lignePosteUnite: 'UNITE',
    }],
    ligneTva: [{
      ligneTvaMontantBaseHtParTaux: 1200,
      ligneTvaMontantTvaParTaux: 240,
      ligneTvaTaux: '0.2',
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
  it('retrieves an oauth token and calls the connection endpoint with cpro-account', async () => {
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
    expect(tokenCall?.[0]).toBe('https://sandbox-oauth.aife.economie.gouv.fr/api/oauth/token');
    expect((tokenCall?.[1] as RequestInit).method).toBe('POST');
    expect(String((tokenCall?.[1] as RequestInit).body)).toContain('grant_type=client_credentials');
    expect(String((tokenCall?.[1] as RequestInit).body)).toContain('client_id=client-id');

    const apiCall = fetchMock.mock.calls[1];
    expect(apiCall?.[0]).toBe('https://sandbox-api.example.test/health');
    const headers = (apiCall?.[1] as RequestInit).headers as Record<string, string>;
    expect((apiCall?.[1] as RequestInit).method).toBe('GET');
    expect(headers.Authorization).toBe('Bearer token-123456789');
    expect(headers['cpro-account']).toBe(window.btoa('tech-user:tech-pass'));
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

  it('uploads files then submits a validated Chorus payload', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token-upload-1' }))
      .mockResolvedValueOnce(jsonResponse({ fileId: 'main-file-id' }))
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token-upload-2' }))
      .mockResolvedValueOnce(jsonResponse({ fileId: 'attachment-id' }))
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token-submit' }))
      .mockResolvedValueOnce(jsonResponse({ invoiceId: 'CHORUS-INV-001' }));

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
    }, fetchMock);

    const result = await connector.submitInvoice({
      invoiceData: createValidPayload(),
      mainFile: new File(['main'], 'invoice.pdf', { type: 'application/pdf' }),
      attachments: [new File(['att'], 'attachment.xml', { type: 'text/xml' })],
    });

    expect(result.ok).toBe(true);
    expect(result.externalId).toBe('CHORUS-INV-001');
    expect(fetchMock).toHaveBeenCalledTimes(6);

    const uploadCall = fetchMock.mock.calls[1];
    expect(uploadCall?.[0]).toBe('https://api.example.test/files/upload');
    expect((uploadCall?.[1] as RequestInit).body).toBeInstanceOf(FormData);

    const submitCall = fetchMock.mock.calls[5];
    expect(submitCall?.[0]).toBe('https://api.example.test/factures/soumettre');
    const submitPayload = JSON.parse(String((submitCall?.[1] as RequestInit).body));
    expect(submitPayload.numeroFactureSaisi).toBe('FAC-2026-001');
    expect(submitPayload.destinataire.codeDestinataire).toBe('23440003400026');
    expect(submitPayload.modeDepot).toBe('SAISIE_API');
  });

  it('uses the official Chorus PDF deposit contract for /v1/deposer/pdf and finalizes the submission payload', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token-upload-pdf' }))
      .mockResolvedValueOnce(jsonResponse({ pieceJointeId: 28093 }))
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token-submit-pdf' }))
      .mockResolvedValueOnce(jsonResponse({ invoiceId: 'CHORUS-PDF-001' }));

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

    await expect(connector.submitInvoice({
      invoiceData: createValidPayload(),
      mainFile: new File(['PDF'], 'invoice.pdf', { type: 'application/pdf' }),
      attachments: [],
    })).resolves.toMatchObject({
      ok: true,
      externalId: 'CHORUS-PDF-001',
    });

    const uploadCall = fetchMock.mock.calls[1];
    expect(uploadCall?.[0]).toBe('https://sandbox-api.piste.gouv.fr/cpro/factures/v1/deposer/pdf');
    const uploadHeaders = (uploadCall?.[1] as RequestInit).headers as Record<string, string>;
    expect(uploadHeaders['content-type']).toContain('application/json');

    const uploadBody = JSON.parse(String((uploadCall?.[1] as RequestInit).body));
    expect(uploadBody.idUtilisateurCourant).toBe(331);
    expect(uploadBody.nomFichier).toBe('invoice.pdf');
    expect(uploadBody.formatDepot).toBe('PDF_NON_SIGNE');
    expect(typeof uploadBody.fichierFacture).toBe('string');
    expect(uploadBody.fichierFacture.length).toBeGreaterThan(0);

    const submitCall = fetchMock.mock.calls[3];
    const submitBody = JSON.parse(String((submitCall?.[1] as RequestInit).body));
    expect(submitBody.modeDepot).toBe('DEPOT_PDF_API');
    expect(submitBody.pieceJointePrincipale).toEqual([
      {
        pieceJointePrincipaleDesignation: 'invoice.pdf',
        pieceJointePrincipaleId: 28093,
      },
    ]);
  });

  it('adds a Chorus-specific hint when /v1/soumettre returns a 500 after PDF deposit', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token-upload-pdf' }))
      .mockResolvedValueOnce(jsonResponse({ pieceJointeId: 28093 }))
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token-submit-pdf' }))
      .mockResolvedValueOnce(jsonResponse({ codeRetour: 500, libelle: 'Erreur interne' }, 500));

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

    await expect(connector.submitInvoice({
      invoiceData: createValidPayload(),
      mainFile: new File(['PDF'], 'invoice.pdf', { type: 'application/pdf' }),
      attachments: [],
    })).rejects.toThrow(/piece jointe 28093/i);
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
      idUtilisateurCourant: undefined,
    };

    await expect(connector.submitInvoice({
      invoiceData: invalidPayload,
      mainFile: new File(['PDF'], 'invoice.pdf', { type: 'application/pdf' }),
      attachments: [],
    })).rejects.toThrow(/Payload Chorus invalide/i);

    expect(fetchMock).toHaveBeenCalledTimes(2);
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
