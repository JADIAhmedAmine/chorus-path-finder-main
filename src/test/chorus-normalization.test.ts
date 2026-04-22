import { describe, expect, it } from 'vitest';
import {
  createEmptyInvoiceDraft,
  mergeExtractionIntoDraft,
  normalizeInvoiceDraft,
  parseInvoiceAmount,
} from '@/lib/chorus/normalization';

describe('chorus normalization', () => {
  it('merges extracted fields into the draft and formats numeric values for the form', () => {
    const currentDraft = {
      ...createEmptyInvoiceDraft(),
      supplierInvoiceNumber: 'FAC-MANUAL-01',
      currencyCode: 'EUR',
    };

    const merged = mergeExtractionIntoDraft(currentDraft, {
      sourceFormat: 'PDF',
      confidence: 0.9,
      requiresReview: false,
      warnings: [],
      rawText: 'Facture FAC-EXTRACT-01',
      rawTextPreview: 'Facture FAC-EXTRACT-01',
      fields: {
        supplierOrganizationId: 's1',
        supplierInvoiceNumber: 'FAC-EXTRACT-01',
        publicCustomerId: 'pc1',
        totalAmountTtc: 1200,
      },
    });

    expect(merged.supplierOrganizationId).toBe('s1');
    expect(merged.publicCustomerId).toBe('pc1');
    expect(merged.supplierInvoiceNumber).toBe('FAC-EXTRACT-01');
    expect(merged.totalAmountTtc).toBe('1200,00');
    expect(merged.currencyCode).toBe('EUR');
  });

  it('normalizes draft values and enriches them with resolved business references', () => {
    const normalized = normalizeInvoiceDraft({
      ...createEmptyInvoiceDraft(),
      supplierOrganizationId: 's1',
      supplierInvoiceNumber: ' FAC-2026-001 ',
      publicCustomerId: 'pc1',
      publicServiceId: 'ps1',
      invoiceDate: '2026-04-17',
      currencyCode: 'eur',
      totalAmountHt: '1000,00',
      totalAmountTtc: '1200,00',
    }, {
      supplier: {
        id: 's1',
        legalName: 'ACME',
        siret: '12345678901234',
      },
      publicCustomer: {
        id: 'pc1',
        legalName: 'Ville de Paris',
        siret: '11111111111111',
        codeDestinataire: '99001',
      },
      publicService: {
        id: 'ps1',
        publicCustomerId: 'pc1',
        codeServiceExecutant: 'SE001',
        label: 'Service financier',
      },
      extraction: {
        sourceFormat: 'PDF',
        confidence: 0.88,
        requiresReview: false,
        warnings: [],
        rawText: 'Facture FAC-2026-001',
        rawTextPreview: 'Facture FAC-2026-001',
        fields: {
          paymentMode: 'VIREMENT',
        },
      },
    });

    expect(normalized.supplierInvoiceNumber).toBe('FAC-2026-001');
    expect(normalized.currencyCode).toBe('EUR');
    expect(normalized.totalAmountHt).toBe(1000);
    expect(normalized.totalAmountTtc).toBe(1200);
    expect(normalized.supplierSiret).toBe('12345678901234');
    expect(normalized.publicCustomerCode).toBe('99001');
    expect(normalized.publicServiceCode).toBe('SE001');
    expect(normalized.paymentMode).toBe('VIREMENT');
    expect(normalized.sourceFormat).toBe('PDF');
  });

  it('parses decimal amounts from French-style inputs', () => {
    expect(parseInvoiceAmount('14 400,00')).toBe(14400);
    expect(parseInvoiceAmount('')).toBeUndefined();
  });
});
