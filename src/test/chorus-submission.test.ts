import { describe, expect, it } from 'vitest';
import { buildInvoiceSubmissionPayload } from '@/lib/chorus/mappers';
import {
  finalizeChorusSubmissionPayloadForPdfDeposit,
} from '@/lib/chorus/buildSubmissionPayload';
import {
  normalizeFrenchAmountToNumber,
  normalizeFrenchDateToIsoDate,
} from '@/lib/chorus/normalizeSubmissionData';
import { validateChorusSubmissionPayload } from '@/lib/chorus/validateSubmissionPayload';
import { createEmptyInvoiceDraft } from '@/lib/chorus/normalization';
import { gigalisExtractionResult } from '@/test/fixtures/gigalis-invoice';

describe('chorus submission payload', () => {
  it('parses French amounts and dates', () => {
    expect(normalizeFrenchAmountToNumber('45 903,52')).toBe(45903.52);
    expect(normalizeFrenchAmountToNumber("244'242.00")).toBe(244242);
    expect(normalizeFrenchDateToIsoDate('16/03/2026')).toBe('2026-03-16');
    expect(normalizeFrenchDateToIsoDate('2026-03-16')).toBe('2026-03-16');
  });

  it('builds a Chorus payload from extracted invoice data with a single fallback line', () => {
    const payload = buildInvoiceSubmissionPayload(createEmptyInvoiceDraft(), {
      extraction: gigalisExtractionResult,
      supplier: {
        id: 'supplier-gigalis',
        legalName: 'GIP Gigalis',
        siret: '25440253000011',
      },
      publicCustomer: {
        id: 'customer-pdl',
        legalName: 'REGION DES PAYS DE LA LOIRE - SI EPLE',
        siret: '23440003400026',
        codeDestinataire: '23440003400026',
      },
      publicService: {
        id: 'service-pdl',
        publicCustomerId: 'customer-pdl',
        codeServiceExecutant: 'SE-PDL',
        label: 'Comptabilite fournisseurs',
      },
      chorus: {
        idUtilisateurCourant: 331,
        idFournisseur: 160,
        idServiceFournisseur: 436,
        codeCoordonneesBancairesFournisseur: 132,
      },
      mainFileName: 'gigalis-facture.pdf',
    });

    expect(payload).toMatchObject({
      modeDepot: 'SAISIE_API',
      dateFacture: '2026-03-16',
      numeroFactureSaisi: '2026-003-00565',
      destinataire: {
        codeDestinataire: '23440003400026',
        codeServiceExecutant: 'SE-PDL',
      },
      fournisseur: {
        idFournisseur: 160,
        idServiceFournisseur: 436,
        codeCoordonneesBancairesFournisseur: 132,
      },
      montantTotal: {
        montantHtTotal: 45903.52,
        montantTVA: 9180.7,
        montantTtcTotal: 55084.22,
        montantAPayer: 55084.22,
      },
      references: {
        deviseFacture: 'EUR',
        numeroBonCommande: 'BC2025/25-007915',
        typeFacture: 'FACTURE',
        typeTva: 'TVA_SUR_DEBIT',
      },
    });
    expect(payload.lignePoste).toHaveLength(1);
    expect(payload.lignePoste[0]?.lignePosteDenomination).toContain('2026-003-00565');
    expect(validateChorusSubmissionPayload(payload).valid).toBe(true);
  });

  it('keeps multiple extracted lines when they are available', () => {
    const payload = buildInvoiceSubmissionPayload({
      ...createEmptyInvoiceDraft(),
      supplierInvoiceNumber: 'FAC-2026-LIGNES',
      invoiceDate: '17/04/2026',
      currencyCode: 'EUR',
      totalAmountHt: '250,00',
      totalAmountTtc: '300,00',
    }, {
      extraction: {
        ...gigalisExtractionResult,
        fields: {
          ...gigalisExtractionResult.fields,
          supplierInvoiceNumber: 'FAC-2026-LIGNES',
          invoiceDate: '2026-04-17',
          totalAmountHt: 250,
          totalVat: 50,
          totalAmountTtc: 300,
          lineItems: [
            {
              description: 'Abonnement reseau',
              quantity: 2,
              unit: 'UNITE',
              unitPriceHt: 100,
              totalHt: 200,
              vatRate: 20,
            },
            {
              description: 'Support',
              quantity: 1,
              unit: 'UNITE',
              unitPriceHt: 50,
              totalHt: 50,
              vatRate: 20,
            },
          ],
          vatLines: [
            {
              rate: 20,
              baseHt: 250,
              taxAmount: 50,
            },
          ],
        },
      },
      publicCustomer: {
        id: 'customer-pdl',
        legalName: 'REGION DES PAYS DE LA LOIRE - SI EPLE',
        siret: '23440003400026',
        codeDestinataire: '23440003400026',
      },
      publicService: {
        id: 'service-pdl',
        publicCustomerId: 'customer-pdl',
        codeServiceExecutant: 'SE-PDL',
        label: 'Comptabilite fournisseurs',
      },
      chorus: {
        idUtilisateurCourant: 331,
        idFournisseur: 160,
      },
    });

    expect(payload.lignePoste).toHaveLength(2);
    expect(payload.lignePoste[0]).toMatchObject({
      lignePosteDenomination: 'Abonnement reseau',
      lignePosteQuantite: 2,
      lignePosteMontantUnitaireHT: 100,
      lignePosteTauxTva: '0.2',
    });
    expect(payload.ligneTva).toEqual([
      expect.objectContaining({
        ligneTvaMontantBaseHtParTaux: 250,
        ligneTvaMontantTvaParTaux: 50,
        ligneTvaTaux: '0.2',
      }),
    ]);

    const validation = validateChorusSubmissionPayload(payload);
    expect(validation.valid).toBe(true);
  });

  it('finalizes the payload for a PDF deposit by attaching the uploaded piece id', () => {
    const payload = buildInvoiceSubmissionPayload(createEmptyInvoiceDraft(), {
      extraction: gigalisExtractionResult,
      publicCustomer: {
        id: 'customer-pdl',
        legalName: 'REGION DES PAYS DE LA LOIRE - SI EPLE',
        siret: '23440003400026',
        codeDestinataire: '23440003400026',
      },
      publicService: {
        id: 'service-pdl',
        publicCustomerId: 'customer-pdl',
        codeServiceExecutant: 'SE-PDL',
        label: 'Comptabilite fournisseurs',
      },
      chorus: {
        idUtilisateurCourant: 331,
        idFournisseur: 160,
      },
    });

    const finalized = finalizeChorusSubmissionPayloadForPdfDeposit(payload, {
      mainFileId: 28093,
      mainFileName: 'gigalis-facture.pdf',
    });

    expect(finalized.modeDepot).toBe('DEPOT_PDF_API');
    expect(finalized.pieceJointePrincipale).toEqual([
      {
        pieceJointePrincipaleDesignation: 'gigalis-facture.pdf',
        pieceJointePrincipaleId: 28093,
      },
    ]);
  });

  it('reports missing mandatory context fields before POST', () => {
    const payload = buildInvoiceSubmissionPayload(createEmptyInvoiceDraft(), {
      extraction: gigalisExtractionResult,
      publicCustomer: {
        id: 'customer-pdl',
        legalName: 'REGION DES PAYS DE LA LOIRE - SI EPLE',
        siret: '23440003400026',
        codeDestinataire: '23440003400026',
      },
    });

    const validation = validateChorusSubmissionPayload(payload);

    expect(validation.valid).toBe(false);
    expect(validation.errors.some((error) => error.code === 'CURRENT_USER_ID_REQUIRED')).toBe(true);
    expect(validation.errors.some((error) => error.code === 'FOURNISSEUR_ID_REQUIRED')).toBe(true);
  });
});
