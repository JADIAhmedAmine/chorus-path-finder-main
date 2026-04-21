/**
 * Test Fixtures for Chorus PDF Upload and Invoice Submission Workflows
 * 
 * Provides reusable test data for PDF upload and invoice submission scenarios
 */

import type { UploadPdfPayload } from '@/lib/chorus/buildUploadPdfPayload';
import type { ChorusSubmissionPayload } from '@/lib/chorus/types';

/**
 * Mock PDF Base64 - A minimal valid PDF for testing
 * This is the same content used in buildUploadPdfPayload.createMockUploadPdfPayload()
 */
export const MOCK_PDF_BASE64 = 'JVBERi0xLjQKJeLjz9CNaIHDrVjoN2V2dChkYXRhKQoxIDAgb2JqCjw8L1R5cGUvQ2F0YWxvZy9QYWdlcyAyIDAgUj4+CmVuZG9iagoyIDAgb2JqCjw8L1R5cGUvUGFnZXMvS2lkc1szIDAgUl0vQ291bnQgMT4+CmVuZG9iagozIDAgb2JqCjw8L1R5cGUvUGFnZS9QYXJlbnQgMiAwIFIvTWVkaWFCb3hbMCAwIDYxMiA3OTJdL0NvbnRlbnRzIDQgMCBSPj4KZW5kb2JqCjQgMCBvYmoKPDwvTGVuZ3RoIDQ0Pj4Kc3RyZWFtCkJUIC9GMSAxMiBUZiAxMDAgNzUwIFRkIChIZWxsbyB3b3JsZCkgVGoKRVQKZW5kc3RyZWFtCmVuZG9iagp4cmVmCjAgNQowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAwMDAwMDA1OCAwMDAwMCBuIAowMDAwMDAwMTE1IDAwMDAwIG4gCjAwMDAwMDAyMTcgMDAwMDAgbiAKdHJhaWxlcgo8PC9TaXplIDUvUm9vdCAxIDAgUj4+CnN0YXJ0eHJlZgozMTAKJSVFT0Y=';

/**
 * Fixture: Upload attachment payload
 * Used for testing the /ajouter/fichier endpoint
 */
export const uploadPdfPayloadFixture: UploadPdfPayload = {
  pieceJointeExtension: 'pdf',
  pieceJointeFichier: MOCK_PDF_BASE64,
  pieceJointeNom: 'facture-test-2026-001.pdf',
  pieceJointeTypeMime: 'application/pdf',
};

/**
 * Fixture: Invoice submission payload with PDF (DEPOT_PDF_API)
 * Complete example with realistic Gigalis supplier data
 */
export const submitInvoicePdfPayloadFixture: ChorusSubmissionPayload = {
  cadreDeFacturation: {
    codeCadreFacturation: 'A1_FACTURE_FOURNISSEUR',
    codeServiceValideur: undefined,
    codeStructureValideur: undefined,
  },
  commentaire: undefined,
  dateFacture: '2026-03-16',
  destinataire: {
    codeDestinataire: '23440003400026',
    codeServiceExecutant: 'SE-PDL',
  },
  fournisseur: {
    codeCoordonneesBancairesFournisseur: 132,
    idFournisseur: 160,
    idServiceFournisseur: 436,
  },
  idUtilisateurCourant: 331,
  lignePoste: [
    {
      lignePosteDenomination: 'Services de conseil - Achat 2026-001',
      lignePosteMontantHT: 45903.52,
      lignePosteTauxTVA: 20.0,
    },
  ],
  ligneTva: [
    {
      ligneTvaBaseHT: 45903.52,
      ligneTvaMontant: 9180.7,
      ligneTvaTaux: 20.0,
    },
  ],
  modeDepot: 'DEPOT_PDF_API',
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
  pieceJointePrincipale: [
    {
      pieceJointePrincipaleDesignation: 'Facture principale',
      pieceJointePrincipaleId: 'pie-abc123-xyz789-test',
    },
  ],
  references: {
    deviseFacture: 'EUR',
    modePaiement: 'CHEQUE',
    motifExonerationTva: undefined,
    numeroBonCommande: 'BC2025/25-007915',
    numeroFactureOrigine: undefined,
    typeFacture: 'FACTURE',
    typeTva: 'TVA_SUR_DEBIT',
  },
};

/**
 * Fixture: Invoice submission payload without PDF (SAISIE_API)
 * Used for testing business logic validation without PDF dependencies
 */
export const submitInvoiceSaisieApiPayloadFixture: ChorusSubmissionPayload = {
  cadreDeFacturation: {
    codeCadreFacturation: 'A1_FACTURE_FOURNISSEUR',
    codeServiceValideur: undefined,
    codeStructureValideur: undefined,
  },
  commentaire: 'Test submission without PDF attachment',
  dateFacture: '2026-04-17',
  destinataire: {
    codeDestinataire: '23440003400026',
    codeServiceExecutant: 'SE-PDL',
  },
  fournisseur: {
    codeCoordonneesBancairesFournisseur: 132,
    idFournisseur: 160,
    idServiceFournisseur: 436,
  },
  idUtilisateurCourant: 331,
  lignePoste: [
    {
      lignePosteDenomination: 'Frais de prestation - avril 2026',
      lignePosteMontantHT: 1500.0,
      lignePosteTauxTVA: 20.0,
    },
    {
      lignePosteDenomination: 'Déplacement forfaitaire',
      lignePosteMontantHT: 250.0,
      lignePosteTauxTVA: 20.0,
    },
  ],
  ligneTva: [
    {
      ligneTvaBaseHT: 1750.0,
      ligneTvaMontant: 350.0,
      ligneTvaTaux: 20.0,
    },
  ],
  modeDepot: 'SAISIE_API',
  montantTotal: {
    montantAPayer: 2100.0,
    montantHtTotal: 1750.0,
    montantRemiseGlobaleTTC: 0,
    montantTVA: 350.0,
    montantTtcTotal: 2100.0,
    motifRemiseGlobaleTTC: '',
  },
  numeroFactureSaisi: 'FAC-2026-SAISIE-001',
  pieceJointeComplementaire: [],
  pieceJointePrincipale: [],
  references: {
    deviseFacture: 'EUR',
    modePaiement: 'VIREMENT',
    motifExonerationTva: undefined,
    numeroBonCommande: 'CMD-2026-004',
    numeroFactureOrigine: undefined,
    typeFacture: 'FACTURE',
    typeTva: 'TVA_SUR_DEBIT',
  },
};

/**
 * Fixture: Upload response (mock)
 * What the /ajouter/fichier endpoint should return
 */
export const uploadPdfResponseFixture = {
  pieceJointeId: 'pie-abc123-xyz789-test',
  status: 'success',
  message: 'PDF uploaded successfully',
};

/**
 * Fixture: Invoice submission response (mock)
 * What the /soumettre endpoint should return
 */
export const submitInvoiceResponseFixture = {
  invoiceId: 'INV-2026-000001',
  numeroFactureChorus: 'FAC-CHORUS-2026-001',
  status: 'success',
  message: 'Invoice submitted successfully',
};

/**
 * Helper: Create a modified copy of upload payload with different file ID
 * Useful for testing with various file ID formats
 */
export function createUploadPayloadWithFileId(fileId: string): ChorusSubmissionPayload {
  return {
    ...submitInvoicePdfPayloadFixture,
    pieceJointePrincipale: [
      {
        pieceJointePrincipaleDesignation: 'Facture principale',
        pieceJointePrincipaleId: fileId,
      },
    ],
  };
}

/**
 * Helper: Create a payment mode variant
 * Useful for testing different payment methods
 */
export function createInvoiceWithPaymentMode(
  basePayload: ChorusSubmissionPayload,
  modePaiement: 'CHEQUE' | 'ESPECE' | 'VIREMENT',
): ChorusSubmissionPayload {
  return {
    ...basePayload,
    references: {
      ...basePayload.references,
      modePaiement,
    },
  };
}

/**
 * Helper: Create a multi-line invoice variant
 * Useful for testing line item calculations
 */
export function createMultiLineInvoice(): ChorusSubmissionPayload {
  return {
    ...submitInvoiceSaisieApiPayloadFixture,
    numeroFactureSaisi: 'FAC-2026-MULTILINE-001',
    lignePoste: [
      {
        lignePosteDenomination: 'Consultation - Jour 1',
        lignePosteMontantHT: 800.0,
        lignePosteTauxTVA: 20.0,
      },
      {
        lignePosteDenomination: 'Consultation - Jour 2',
        lignePosteMontantHT: 800.0,
        lignePosteTauxTVA: 20.0,
      },
      {
        lignePosteDenomination: 'Déplacements',
        lignePosteMontantHT: 300.0,
        lignePosteTauxTVA: 20.0,
      },
      {
        lignePosteDenomination: 'Supports de formation',
        lignePosteMontantHT: 200.0,
        lignePosteTauxTVA: 20.0,
      },
    ],
    ligneTva: [
      {
        ligneTvaBaseHT: 2100.0,
        ligneTvaMontant: 420.0,
        ligneTvaTaux: 20.0,
      },
    ],
    montantTotal: {
      montantAPayer: 2520.0,
      montantHtTotal: 2100.0,
      montantRemiseGlobaleTTC: 0,
      montantTVA: 420.0,
      montantTtcTotal: 2520.0,
      motifRemiseGlobaleTTC: '',
    },
  };
}

/**
 * Helper: Create an invoice with multiple VAT rates
 * Useful for testing complex VAT scenarios
 */
export function createMultiVatInvoice(): ChorusSubmissionPayload {
  return {
    ...submitInvoiceSaisieApiPayloadFixture,
    numeroFactureSaisi: 'FAC-2026-MULTIVAT-001',
    lignePoste: [
      {
        lignePosteDenomination: 'Service standard - TVA 20%',
        lignePosteMontantHT: 1000.0,
        lignePosteTauxTVA: 20.0,
      },
      {
        lignePosteDenomination: 'Fournitures - TVA 5.5%',
        lignePosteMontantHT: 500.0,
        lignePosteTauxTVA: 5.5,
      },
    ],
    ligneTva: [
      {
        ligneTvaBaseHT: 1000.0,
        ligneTvaMontant: 200.0,
        ligneTvaTaux: 20.0,
      },
      {
        ligneTvaBaseHT: 500.0,
        ligneTvaMontant: 27.5,
        ligneTvaTaux: 5.5,
      },
    ],
    montantTotal: {
      montantAPayer: 1727.5,
      montantHtTotal: 1500.0,
      montantRemiseGlobaleTTC: 0,
      montantTVA: 227.5,
      montantTtcTotal: 1727.5,
      motifRemiseGlobaleTTC: '',
    },
  };
}

/**
 * Test data for amount validation
 * Ensures calculations are correct
 */
export const amountValidationTestCases = [
  {
    name: 'Simple 20% VAT',
    ht: 1000,
    vat: 200,
    ttc: 1200,
    valid: true,
  },
  {
    name: 'Complex calculation with cents',
    ht: 45903.52,
    vat: 9180.7,
    ttc: 55084.22,
    valid: true,
  },
  {
    name: 'Multiple VAT rates sum',
    ht: 1500,
    vat: 227.5,
    ttc: 1727.5,
    valid: true,
  },
  {
    name: 'Amount mismatch (invalid)',
    ht: 1000,
    vat: 200,
    ttc: 1300, // Should be 1200
    valid: false,
  },
];
