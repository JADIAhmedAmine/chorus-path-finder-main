import { describe, expect, it } from 'vitest';
import { hydrateChorusSubmissionPayloadWithSnapshot } from '@/lib/chorus/hydrateSubmissionPayload';
import type { ChorusSubmissionPayload, NormalizedInvoiceDraftData } from '@/lib/chorus/types';
import type { ChorusSubmissionReferenceSnapshot } from '@/types/chorus';

function createPayload(): ChorusSubmissionPayload {
  return {
    cadreDeFacturation: {
      codeCadreFacturation: 'A1_FACTURE_FOURNISSEUR',
    },
    dateFacture: '2026-03-16',
    destinataire: {},
    fournisseur: {},
    lignePoste: [{
      lignePosteDenomination: 'Facture 2026-003-00565',
      lignePosteMontantUnitaireHT: 45903.52,
      lignePosteNumero: 1,
      lignePosteQuantite: 1,
      lignePosteTauxTva: '0.2',
      lignePosteUnite: 'UNITE',
    }],
    ligneTva: [{
      ligneTvaMontantBaseHtParTaux: 45903.52,
      ligneTvaMontantTvaParTaux: 9180.7,
      ligneTvaTaux: '0.2',
    }],
    modeDepot: 'SAISIE_API',
    montantTotal: {
      montantAPayer: 55084.22,
      montantHtTotal: 45903.52,
      montantRemiseGlobaleTTC: 0,
      montantTVA: 9180.7,
      montantTtcTotal: 55084.22,
      motifRemiseGlobaleTTC: '',
    },
    numeroFactureSaisi: '2026-003-00565',
    pieceJointeComplementaire: [],
    pieceJointePrincipale: [],
    references: {
      deviseFacture: 'EUR',
      modePaiement: 'CHEQUE',
      numeroBonCommande: 'BC2025/25-007915',
      numeroMarche: '',
      typeFacture: 'FACTURE',
      typeTva: 'TVA_SUR_DEBIT',
    },
  };
}

function createNormalized(): NormalizedInvoiceDraftData {
  return {
    supplierInvoiceNumber: '2026-003-00565',
    invoiceDate: '2026-03-16',
    supplierSiret: '25440253000011',
    publicCustomerSiret: '23440003400026',
    publicServiceLabel: 'Comptabilite fournisseurs',
    currencyCode: 'EUR',
    totalAmountHt: 45903.52,
    totalVat: 9180.7,
    totalAmountTtc: 55084.22,
  };
}

function createSnapshot(): ChorusSubmissionReferenceSnapshot {
  return {
    cadresFacturation: [{ code: 'A1_FACTURE_FOURNISSEUR' }],
    devises: [{ code: 'EUR', label: 'Euro' }],
    tauxTva: [{ code: 'TVA20', label: 'TVA 20%', rate: 0.2 }],
    modesReglement: [{ code: 'CHEQUE' }],
    modesDepot: [{ code: 'SAISIE_API' }],
    coordonneesBancaires: [{ idCoordonneeBancaire: 132, nomCoordonneeBancaire: 'IBAN principal' }],
    structuresFournisseur: [{
      designationStructure: 'GIP Gigalis',
      idStructureCPP: 32242033407300,
      identifiant: '25440253000011',
    }],
    destinataires: [{
      idStructureCPP: 998,
      nomDestinataire: 'REGION DES PAYS DE LA LOIRE - SI EPLE',
      siret: '23440003400026',
    }],
    servicesExecutants: [{
      idServicesCPP: 123,
      codeServiceExecutant: 'SE001',
      nomServiceExecutant: 'Comptabilite fournisseurs',
    }],
    checks: {
      cadreFacturationValid: true,
      deviseValid: true,
      modePaiementValid: true,
      modeDepotValid: true,
      fournisseurStructureValid: false,
      coordonneeBancaireValide: false,
      destinataireTrouve: true,
      serviceExecutantTrouve: false,
      tauxTvaValides: true,
      warnings: [],
    },
  };
}

describe('hydrateChorusSubmissionPayloadWithSnapshot', () => {
  it('enriches the payload with values safely resolved from Chorus Transverses', () => {
    const result = hydrateChorusSubmissionPayloadWithSnapshot(
      createPayload(),
      createSnapshot(),
      createNormalized(),
    );

    expect(result.payload.fournisseur.idFournisseur).toBe(32242033407300);
    expect(result.payload.fournisseur.codeCoordonneesBancairesFournisseur).toBe(132);
    expect(result.payload.destinataire.codeDestinataire).toBe('23440003400026');
    expect(result.payload.destinataire.codeServiceExecutant).toBe('SE001');
    expect(result.payload.lignePoste[0]?.lignePosteTauxTva).toBe('TVA20');
    expect(result.payload.ligneTva[0]?.ligneTvaTaux).toBe('TVA20');
    expect(result.changes.map((change) => change.path)).toEqual(expect.arrayContaining([
      'fournisseur.idFournisseur',
      'fournisseur.codeCoordonneesBancairesFournisseur',
      'destinataire.codeDestinataire',
      'destinataire.codeServiceExecutant',
    ]));
  });

  it('keeps explicit unresolved fields visible when they cannot come from the PDF or transverses', () => {
    const result = hydrateChorusSubmissionPayloadWithSnapshot(
      createPayload(),
      createSnapshot(),
      createNormalized(),
    );

    expect(result.unresolved.some((issue) => issue.path === 'fournisseur.idServiceFournisseur')).toBe(true);
    expect(result.validation.valid).toBe(true);
  });
});
