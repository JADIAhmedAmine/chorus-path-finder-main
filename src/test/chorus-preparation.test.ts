import { describe, expect, it } from 'vitest';
import { prepareInvoiceSubmission } from '@/lib/chorus/preparation';
import { publicCustomers, publicServices, suppliers } from '@/data/mock-data';

describe('chorus preparation', () => {
  it('marks a complete draft as ready for submission', () => {
    const result = prepareInvoiceSubmission({
      formData: {
        supplierOrganizationId: 's1',
        supplierInvoiceNumber: 'FAC-2026-001',
        publicCustomerId: 'pc1',
        publicServiceId: 'ps1',
        engagementNumber: 'ENG-2026-100',
        marketNumber: 'MA-2026-10',
        purchaseOrderNumber: 'BC-2026-50',
        invoiceDate: '2026-04-16',
        currencyCode: 'EUR',
        totalAmountHt: '12000,00',
        totalAmountTtc: '14400,00',
      },
      supplier: suppliers[0],
      publicCustomer: publicCustomers[0],
      publicService: publicServices[0],
      availableServices: publicServices.filter((service) => service.publicCustomerId === 'pc1' && service.active),
      extraction: {
        sourceFormat: 'PDF',
        confidence: 0.93,
        requiresReview: false,
        warnings: [],
        rawTextPreview: 'Facture numéro FAC-2026-001',
        fields: {
          supplierSiret: suppliers[0].siret,
          publicCustomerSiret: publicCustomers[0].siret,
          publicServiceCode: publicServices[0].codeServiceExecutant,
        },
      },
    });

    expect(result.readiness).toBe('ready');
    expect(result.suggestedStatus).toBe('READY_FOR_SUBMISSION');
    expect(result.validation.valid).toBe(true);
    expect(result.validation.errors).toHaveLength(0);
    expect(result.normalized.totalAmountTtc).toBe(14400);
  });

  it('blocks submission when the selected service requires an engagement number', () => {
    const result = prepareInvoiceSubmission({
      formData: {
        supplierOrganizationId: 's1',
        supplierInvoiceNumber: 'FAC-2026-002',
        publicCustomerId: 'pc1',
        publicServiceId: 'ps1',
        engagementNumber: '',
        marketNumber: '',
        purchaseOrderNumber: 'BC-2026-51',
        invoiceDate: '2026-04-16',
        currencyCode: 'EUR',
        totalAmountHt: '',
        totalAmountTtc: '14400,00',
      },
      supplier: suppliers[0],
      publicCustomer: publicCustomers[0],
      publicService: publicServices[0],
      availableServices: publicServices.filter((service) => service.publicCustomerId === 'pc1' && service.active),
      extraction: null,
    });

    expect(result.readiness).toBe('blocked');
    expect(result.validation.valid).toBe(false);
    expect(result.validation.errors.some((error) => error.code === 'ENGAGEMENT_REQUIRED')).toBe(true);
  });

  it('keeps the draft in review when extraction confidence is low but critical data is present', () => {
    const result = prepareInvoiceSubmission({
      formData: {
        supplierOrganizationId: 's2',
        supplierInvoiceNumber: 'FAC-2026-003',
        publicCustomerId: 'pc2',
        publicServiceId: 'ps3',
        engagementNumber: '',
        marketNumber: '',
        purchaseOrderNumber: '',
        invoiceDate: '2026-04-16',
        currencyCode: 'EUR',
        totalAmountHt: '1000,00',
        totalAmountTtc: '1200,00',
      },
      supplier: suppliers[1],
      publicCustomer: publicCustomers[1],
      publicService: publicServices[2],
      availableServices: publicServices.filter((service) => service.publicCustomerId === 'pc2' && service.active),
      extraction: {
        sourceFormat: 'PDF',
        confidence: 0.68,
        requiresReview: true,
        warnings: ['Contrôle manuel conseillé'],
        rawTextPreview: 'Facture peu lisible',
        fields: {
          supplierSiret: suppliers[1].siret,
          publicCustomerSiret: publicCustomers[1].siret,
          publicServiceCode: publicServices[2].codeServiceExecutant,
        },
      },
    });

    expect(result.readiness).toBe('review');
    expect(result.suggestedStatus).toBe('PENDING_HUMAN_REVIEW');
    expect(result.validation.errors).toHaveLength(0);
    expect(result.validation.warnings.some((warning) => warning.code === 'EXTRACTION_REVIEW_REQUIRED')).toBe(true);
  });
});
