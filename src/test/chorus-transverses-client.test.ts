import { describe, expect, it, vi } from 'vitest';
import { ChorusTransversesClient } from '@/lib/chorus/transversesClient';
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

function createPayload(): ChorusSubmissionPayload {
  return {
    cadreDeFacturation: {
      codeCadreFacturation: 'A1_FACTURE_FOURNISSEUR',
    },
    dateFacture: '2026-04-20',
    destinataire: {
      codeDestinataire: '23440003400026',
      codeServiceExecutant: 'SE001',
    },
    fournisseur: {
      idFournisseur: 32242033407300,
      codeCoordonneesBancairesFournisseur: 132,
    },
    idUtilisateurCourant: 331,
    lignePoste: [{
      lignePosteDenomination: 'Ligne globale facture',
      lignePosteMontantUnitaireHT: 100,
      lignePosteNumero: 1,
      lignePosteQuantite: 1,
      lignePosteUnite: 'UNITE',
    }],
    ligneTva: [{
      ligneTvaMontantBaseHtParTaux: 100,
      ligneTvaMontantTvaParTaux: 20,
      ligneTvaTaux: '0.2',
    }],
    modeDepot: 'DEPOT_PDF_API',
    montantTotal: {
      montantAPayer: 120,
      montantHtTotal: 100,
      montantRemiseGlobaleTTC: 0,
      montantTVA: 20,
      montantTtcTotal: 120,
      motifRemiseGlobaleTTC: '',
    },
    numeroFactureSaisi: 'FAC-2026-001',
    pieceJointeComplementaire: [],
    pieceJointePrincipale: [],
    references: {
      deviseFacture: 'EUR',
      modePaiement: 'CHEQUE',
      numeroBonCommande: 'BC-1',
      numeroFactureOrigine: '',
      numeroMarche: 'MA-1',
      typeFacture: 'FACTURE',
      typeTva: 'TVA_SUR_DEBIT',
    },
  };
}

describe('ChorusTransversesClient', () => {
  it('loads and checks transverses reference values against the current payload', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token-1' }))
      .mockResolvedValueOnce(jsonResponse({ listeCadreFacturation: [{ codeCadreFacturation: 'A1_FACTURE_FOURNISSEUR' }] }))
      .mockResolvedValueOnce(jsonResponse({ listeDevises: [{ codeDevise: 'EUR', libelleDevise: 'Euro' }] }))
      .mockResolvedValueOnce(jsonResponse({ listeTauxTva: [{ codeTauxTva: 'TVA20', libelleTauxTva: 'TVA 20%' }] }))
      .mockResolvedValueOnce(jsonResponse({ listeModePaiement: [{ modePaiement: 'CHEQUE' }] }))
      .mockResolvedValueOnce(jsonResponse({ listeModeDepot: [{ modeDepot: 'DEPOT_PDF_API' }] }))
      .mockResolvedValueOnce(jsonResponse({ listeStructures: [{ idStructureCPP: 32242033407300, identifiant: '32242033407300', designationStructure: 'Gigalis' }] }))
      .mockResolvedValueOnce(jsonResponse({ listeCoordonneeBancaire: [{ idCoordonneeBancaire: 132, nomCoordonneeBancaire: 'IBAN principal' }] }))
      .mockResolvedValueOnce(jsonResponse({ listeDestinataires: [{ idStructureCPP: 998, nomDestinataire: 'Region Pays de la Loire', siret: '23440003400026' }] }))
      .mockResolvedValueOnce(jsonResponse({ listeServices: [{ idServicesCPP: 123, codeServiceExecutant: 'SE001', nomServiceExecutant: 'Comptabilite fournisseurs' }] }));

    const client = new ChorusTransversesClient({
      ...getDefaultChorusConfig(),
      mode: 'direct',
      enabled: true,
      tokenUrl: 'https://sandbox-oauth.piste.gouv.fr/api/oauth/token',
      apiBaseUrl: 'https://sandbox-api.piste.gouv.fr/cpro/factures',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      technicalLogin: 'tech-user',
      technicalPassword: 'tech-pass',
    }, fetchMock);

    const snapshot = await client.resolveSubmissionReferences({
      payload: createPayload(),
    });

    expect(fetchMock).toHaveBeenCalledTimes(10);
    expect(snapshot.checks.cadreFacturationValid).toBe(true);
    expect(snapshot.checks.deviseValid).toBe(true);
    expect(snapshot.checks.modePaiementValid).toBe(true);
    expect(snapshot.checks.modeDepotValid).toBe(true);
    expect(snapshot.checks.fournisseurStructureValid).toBe(true);
    expect(snapshot.checks.coordonneeBancaireValide).toBe(true);
    expect(snapshot.checks.destinataireTrouve).toBe(true);
    expect(snapshot.checks.serviceExecutantTrouve).toBe(true);
    expect(snapshot.checks.tauxTvaValides).toBe(true);
    expect(snapshot.checks.warnings).toHaveLength(0);
    expect(snapshot.destinataires[0]?.siret).toBe('23440003400026');
  });

  it('resolves supplier bank references from structures actives fournisseur using the supplier SIRET', async () => {
    const payload = createPayload();
    payload.fournisseur.idFournisseur = undefined;
    payload.fournisseur.codeCoordonneesBancairesFournisseur = 132;

    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token-1' }))
      .mockResolvedValueOnce(jsonResponse({ listeCadreFacturation: [{ codeCadreFacturation: 'A1_FACTURE_FOURNISSEUR' }] }))
      .mockResolvedValueOnce(jsonResponse({ listeDevises: [{ codeDevise: 'EUR', libelleDevise: 'Euro' }] }))
      .mockResolvedValueOnce(jsonResponse({ listeTauxTva: [{ codeTauxTva: 'TVA20', libelleTauxTva: 'TVA 20%' }] }))
      .mockResolvedValueOnce(jsonResponse({ listeModePaiement: [{ modePaiement: 'CHEQUE' }] }))
      .mockResolvedValueOnce(jsonResponse({ listeModeDepot: [{ modeDepot: 'DEPOT_PDF_API' }] }))
      .mockResolvedValueOnce(jsonResponse({ listeStructures: [{ idStructureCPP: 26359578, identifiant: '32242033407300', designationStructure: 'Destinataire 32242033407300' }] }))
      .mockResolvedValueOnce(jsonResponse({ listeCoordonneeBancaire: [{ idCoordonneeBancaire: 132, nomCoordonneeBancaire: 'IBAN principal' }] }))
      .mockResolvedValueOnce(jsonResponse({ listeDestinataires: [{ idStructureCPP: 998, nomDestinataire: 'Region Pays de la Loire', siret: '23440003400026' }] }))
      .mockResolvedValueOnce(jsonResponse({ listeServices: [{ idServicesCPP: 123, codeServiceExecutant: 'SE001', nomServiceExecutant: 'Comptabilite fournisseurs' }] }));

    const client = new ChorusTransversesClient({
      ...getDefaultChorusConfig(),
      mode: 'direct',
      enabled: true,
      tokenUrl: 'https://sandbox-oauth.piste.gouv.fr/api/oauth/token',
      apiBaseUrl: 'https://sandbox-api.piste.gouv.fr/cpro/factures',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      technicalLogin: 'tech-user',
      technicalPassword: 'tech-pass',
    }, fetchMock);

    const snapshot = await client.resolveSubmissionReferences({
      payload,
      supplierSiret: '32242033407300',
    });

    expect(fetchMock).toHaveBeenCalledTimes(10);
    expect(snapshot.structuresFournisseur[0]?.idStructureCPP).toBe(26359578);
    expect(snapshot.coordonneesBancaires[0]?.idCoordonneeBancaire).toBe(132);
    expect(snapshot.checks.coordonneeBancaireValide).toBe(true);
  });
});
