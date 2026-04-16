import { describe, expect, it } from 'vitest';
import { buildInvoiceSubmissionPayload } from '@/lib/chorus/mappers';

describe('chorus mappers', () => {
  it('builds an enriched payload with resolved business metadata', () => {
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
        legalName: 'Direction Générale des Finances Publiques',
        siret: '13001803200011',
        codeDestinataire: '99002',
      },
      publicService: {
        id: 'ps3',
        publicCustomerId: 'pc2',
        codeServiceExecutant: 'SE003',
        label: 'Bureau de la comptabilité',
      },
      extraction: {
        sourceFormat: 'PDF',
        confidence: 0.91,
        requiresReview: false,
        warnings: [],
        rawTextPreview: 'Facture numéro : FAC-2026-001',
        fields: {
          supplierSiret: '12345678901234',
          publicCustomerSiret: '13001803200011',
          publicServiceCode: 'SE003',
        },
      },
    });

    expect(payload).toMatchObject({
      supplierInvoiceNumber: 'FAC-2026-001',
      invoiceDate: '2026-04-15',
      currencyCode: 'EUR',
      totalAmountHt: 12000,
      totalAmountTtc: 14400,
      supplierSiret: '12345678901234',
      publicCustomerSiret: '13001803200011',
      publicCustomerCodeDestinataire: '99002',
      publicServiceCode: 'SE003',
      publicServiceLabel: 'Bureau de la comptabilité',
      sourceFormat: 'PDF',
      extractionConfidence: 0.91,
      requiresHumanReview: false,
    });
    expect(typeof payload.requestedAt).toBe('string');
  });
});
