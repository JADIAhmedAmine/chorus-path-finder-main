import { describe, expect, it } from 'vitest';
import { buildInvoiceSubmissionPayload } from '@/lib/chorus/mappers';

describe('chorus mappers', () => {
  it('maps the invoice draft to a typed Chorus submission payload', () => {
    const payload = buildInvoiceSubmissionPayload({
      supplierOrganizationId: 's1',
      supplierInvoiceNumber: 'FAC-2026-001',
      publicCustomerId: 'pc2',
      publicServiceId: 'ps3',
      engagementNumber: 'ENG-2026-42',
      marketNumber: 'MA-2026-10',
      purchaseOrderNumber: 'BC-2026-55',
      invoiceDate: '2026-04-15',
      currencyCode: 'eur',
      totalAmountHt: '12 000,00',
      totalAmountTtc: '14 400,00',
    }, {
      supplier: {
        id: 's1',
        legalName: 'ACME Solutions SAS',
        siret: '12345678901234',
      },
      publicCustomer: {
        id: 'pc2',
        legalName: 'Direction Generale des Finances Publiques',
        siret: '13001803200011',
        codeDestinataire: '99002',
      },
      publicService: {
        id: 'ps3',
        publicCustomerId: 'pc2',
        codeServiceExecutant: 'SE003',
        label: 'Bureau de la comptabilite',
      },
      extraction: {
        sourceFormat: 'PDF',
        confidence: 0.91,
        requiresReview: false,
        warnings: [],
        rawText: 'Facture numero : FAC-2026-001',
        rawTextPreview: 'Facture numero : FAC-2026-001',
        fields: {
          supplierSiret: '12345678901234',
          publicCustomerSiret: '13001803200011',
          publicServiceCode: 'SE003',
          totalVat: 2400,
        },
      },
      chorus: {
        idUtilisateurCourant: 42,
        idFournisseur: 160,
        idServiceFournisseur: 436,
        codeCoordonneesBancairesFournisseur: 132,
      },
    });

    expect(payload).toMatchObject({
      dateFacture: '2026-04-15',
      numeroFactureSaisi: 'FAC-2026-001',
      destinataire: {
        codeDestinataire: '99002',
        codeServiceExecutant: 'SE003',
      },
      fournisseur: {
        idFournisseur: 160,
        idServiceFournisseur: 436,
        codeCoordonneesBancairesFournisseur: 132,
      },
      montantTotal: {
        montantHtTotal: 12000,
        montantTVA: 2400,
        montantTtcTotal: 14400,
        montantAPayer: 14400,
      },
      references: {
        deviseFacture: 'EUR',
        numeroBonCommande: 'BC-2026-55',
        numeroMarche: 'MA-2026-10',
        typeFacture: 'FACTURE',
        typeTva: 'TVA_SUR_DEBIT',
      },
    });

    expect(payload.lignePoste).toHaveLength(1);
    expect(payload.lignePoste[0]?.lignePosteMontantUnitaireHT).toBe(12000);
  });
});
