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
        supplierName: 'ACME',
        supplierVatNumber: 'FR12345678901',
        supplierInvoiceNumber: 'FAC-EXTRACT-01',
        publicCustomerId: 'pc1',
        publicCustomerName: 'Ville de Paris',
        publicServiceLabel: 'Service financier',
        dueDate: '2026-04-30',
        paymentMode: 'VIREMENT',
        totalAmountTtc: 1200,
        totalVat: 200,
        customerReference: 'REF-001',
        lineItems: [
          {
            description: 'Ligne extraite',
            unitPriceHt: 1000,
            quantity: 1,
            reference: 'REF-001',
            vatRate: 20,
            unit: 'UNITE',
          },
        ],
        vatLines: [
          {
            rate: 20,
            baseHt: 1000,
            taxAmount: 200,
          },
        ],
      },
    });

    expect(merged.supplierOrganizationId).toBe('s1');
    expect(merged.supplierName).toBe('ACME');
    expect(merged.supplierVatNumber).toBe('FR12345678901');
    expect(merged.publicCustomerId).toBe('pc1');
    expect(merged.publicCustomerName).toBe('Ville de Paris');
    expect(merged.publicServiceLabel).toBe('Service financier');
    expect(merged.supplierInvoiceNumber).toBe('FAC-EXTRACT-01');
    expect(merged.dueDate).toBe('2026-04-30');
    expect(merged.paymentMode).toBe('VIREMENT');
    expect(merged.totalAmountTtc).toBe('1200,00');
    expect(merged.totalVat).toBe(200);
    expect(merged.customerReference).toBe('REF-001');
    expect(merged.lineItems).toHaveLength(1);
    expect(merged.vatLines).toHaveLength(1);
    expect(merged.currencyCode).toBe('EUR');
  });

  it('normalizes draft values and enriches them with resolved business references', () => {
    const normalized = normalizeInvoiceDraft({
      ...createEmptyInvoiceDraft(),
      supplierOrganizationId: 's1',
      supplierName: 'ACME',
      supplierVatNumber: 'FR12345678901',
      supplierInvoiceNumber: ' FAC-2026-001 ',
      publicCustomerId: 'pc1',
      publicCustomerName: 'Ville de Paris',
      publicServiceId: 'ps1',
      publicServiceLabel: 'Service financier',
      invoiceDate: '2026-04-17',
      dueDate: '2026-04-30',
      currencyCode: 'eur',
      paymentMode: 'VIREMENT',
      totalAmountHt: '1000,00',
      totalVat: 200,
      totalAmountTtc: '1200,00',
      customerReference: 'REF-001',
      lineItems: [{
        description: 'Ligne de test',
        unitPriceHt: 1000,
        quantity: 1,
        reference: 'REF-001',
        vatRate: 20,
        unit: 'UNITE',
      }],
      vatLines: [{
        rate: 20,
        baseHt: 1000,
        taxAmount: 200,
      }],
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
    expect(normalized.totalVat).toBe(200);
    expect(normalized.supplierSiret).toBe('12345678901234');
    expect(normalized.supplierVatNumber).toBe('FR12345678901');
    expect(normalized.publicCustomerCode).toBe('99001');
    expect(normalized.publicCustomerName).toBe('Ville de Paris');
    expect(normalized.publicServiceCode).toBe('SE001');
    expect(normalized.publicServiceLabel).toBe('Service financier');
    expect(normalized.paymentMode).toBe('VIREMENT');
    expect(normalized.dueDate).toBe('2026-04-30');
    expect(normalized.customerReference).toBe('REF-001');
    expect(normalized.lineItems).toHaveLength(1);
    expect(normalized.vatLines).toHaveLength(1);
    expect(normalized.sourceFormat).toBe('PDF');
  });

  it('keeps extracted invoice data once it has been merged into the draft', () => {
    const merged = mergeExtractionIntoDraft(createEmptyInvoiceDraft(), {
      sourceFormat: 'PDF',
      confidence: 0.9,
      requiresReview: false,
      warnings: [],
      rawText: 'Facture FAC-EXTRACT-02',
      rawTextPreview: 'Facture FAC-EXTRACT-02',
      fields: {
        supplierInvoiceNumber: 'FAC-EXTRACT-02',
        supplierName: 'ACME',
        supplierVatNumber: 'FR12345678901',
        publicCustomerName: 'Ville de Paris',
        publicCustomerCode: '99001',
        publicServiceLabel: 'Service financier',
        invoiceDate: '2026-04-18',
        dueDate: '2026-04-30',
        paymentMode: 'VIREMENT',
        customerReference: 'REF-002',
        totalAmountHt: 1000,
        totalVat: 200,
        totalAmountTtc: 1200,
        lineItems: [{
          description: 'Ligne extraite',
          unitPriceHt: 1000,
          quantity: 1,
          reference: 'REF-002',
          vatRate: 20,
          unit: 'UNITE',
        }],
        vatLines: [{
          rate: 20,
          baseHt: 1000,
          taxAmount: 200,
        }],
      },
    });

    const normalized = normalizeInvoiceDraft(merged);

    expect(normalized.supplierInvoiceNumber).toBe('FAC-EXTRACT-02');
    expect(normalized.supplierName).toBe('ACME');
    expect(normalized.supplierVatNumber).toBe('FR12345678901');
    expect(normalized.publicCustomerName).toBe('Ville de Paris');
    expect(normalized.publicCustomerCode).toBe('99001');
    expect(normalized.publicServiceLabel).toBe('Service financier');
    expect(normalized.invoiceDate).toBe('2026-04-18');
    expect(normalized.dueDate).toBe('2026-04-30');
    expect(normalized.paymentMode).toBe('VIREMENT');
    expect(normalized.customerReference).toBe('REF-002');
    expect(normalized.totalAmountHt).toBe(1000);
    expect(normalized.totalVat).toBe(200);
    expect(normalized.totalAmountTtc).toBe(1200);
    expect(normalized.lineItems).toHaveLength(1);
    expect(normalized.vatLines).toHaveLength(1);
  });

  it('parses decimal amounts from French-style inputs', () => {
    expect(parseInvoiceAmount('14 400,00')).toBe(14400);
    expect(parseInvoiceAmount('')).toBeUndefined();
  });
});
