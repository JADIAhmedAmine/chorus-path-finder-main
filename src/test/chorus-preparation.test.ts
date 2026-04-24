import { describe, expect, it } from 'vitest';
import { prepareInvoiceSubmission } from '@/lib/chorus/preparation';
import { publicCustomersFixture, publicServicesFixture, suppliersFixture } from '@/test/fixtures/reference-data';

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
      supplier: suppliersFixture[0],
      publicCustomer: publicCustomersFixture[0],
      publicService: publicServicesFixture[0],
      availableServices: publicServicesFixture.filter((service) => service.publicCustomerId === 'pc1' && service.active),
      extraction: {
        sourceFormat: 'PDF',
        confidence: 0.93,
        requiresReview: false,
        warnings: [],
        rawText: 'Facture numéro FAC-2026-001',
        rawTextPreview: 'Facture numéro FAC-2026-001',
        fields: {
          supplierSiret: suppliersFixture[0].siret,
          publicCustomerSiret: publicCustomersFixture[0].siret,
          publicServiceCode: publicServicesFixture[0].codeServiceExecutant,
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
      supplier: suppliersFixture[0],
      publicCustomer: publicCustomersFixture[0],
      publicService: publicServicesFixture[0],
      availableServices: publicServicesFixture.filter((service) => service.publicCustomerId === 'pc1' && service.active),
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
      supplier: suppliersFixture[1],
      publicCustomer: publicCustomersFixture[1],
      publicService: publicServicesFixture[2],
      availableServices: publicServicesFixture.filter((service) => service.publicCustomerId === 'pc2' && service.active),
      extraction: {
        sourceFormat: 'PDF',
        confidence: 0.68,
        requiresReview: true,
        warnings: ['Contrôle manuel conseillé'],
        rawText: 'Facture peu lisible',
        rawTextPreview: 'Facture peu lisible',
        fields: {
          supplierSiret: suppliersFixture[1].siret,
          publicCustomerSiret: publicCustomersFixture[1].siret,
          publicServiceCode: publicServicesFixture[2].codeServiceExecutant,
        },
      },
    });

    expect(result.readiness).toBe('review');
    expect(result.suggestedStatus).toBe('PENDING_HUMAN_REVIEW');
    expect(result.validation.errors).toHaveLength(0);
    expect(result.validation.warnings.some((warning) => warning.code === 'EXTRACTION_REVIEW_REQUIRED')).toBe(true);
  });

  it('keeps service destinataire and market number optional for the minimal Chorus payload', () => {
    const result = prepareInvoiceSubmission({
      formData: {
        supplierOrganizationId: 's1',
        supplierInvoiceNumber: 'FAC-2026-MIN',
        publicCustomerId: 'pc1',
        publicServiceId: '',
        engagementNumber: '',
        marketNumber: '',
        purchaseOrderNumber: '',
        invoiceDate: '2026-04-16',
        currencyCode: 'EUR',
        totalAmountHt: '20,00',
        totalAmountTtc: '24,00',
      },
      supplier: suppliersFixture[0],
      publicCustomer: publicCustomersFixture[0],
      publicService: undefined,
      availableServices: publicServicesFixture.filter((service) => service.publicCustomerId === 'pc1' && service.active),
      extraction: null,
    });

    expect(result.readiness).toBe('ready');
    expect(result.validation.valid).toBe(true);
    expect(result.validation.errors.some((error) => error.code === 'PUBLIC_SERVICE_REQUIRED')).toBe(false);
    expect(result.validation.warnings.some((warning) => warning.code === 'MARKET_NUMBER_MISSING')).toBe(false);
  });

  it('accepts manual Chorus destination codes when the right references are not selectable locally', () => {
    const result = prepareInvoiceSubmission({
      formData: {
        supplierOrganizationId: '',
        supplierSiret: '25440253000011',
        supplierInvoiceNumber: 'FAC-2026-004',
        publicCustomerId: '',
        publicCustomerCode: '23440003400026',
        publicServiceId: '',
        publicServiceCode: 'SE-COMPTA',
        engagementNumber: '',
        marketNumber: '',
        purchaseOrderNumber: '',
        invoiceDate: '2026-04-16',
        currencyCode: 'EUR',
        totalAmountHt: '1000,00',
        totalAmountTtc: '1200,00',
      },
      supplier: undefined,
      publicCustomer: undefined,
      publicService: undefined,
      availableServices: [],
      extraction: null,
    });

    expect(result.validation.errors.some((error) => error.code === 'SUPPLIER_REQUIRED')).toBe(false);
    expect(result.validation.errors.some((error) => error.code === 'PUBLIC_CUSTOMER_REQUIRED')).toBe(false);
    expect(result.validation.errors.some((error) => error.code === 'PUBLIC_SERVICE_REQUIRED')).toBe(false);
  });
});
