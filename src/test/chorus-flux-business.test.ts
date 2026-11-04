import { describe, it, expect } from 'vitest';
import { buildFluxRecommendation, mapBusinessValidation, type FluxBusinessValidation } from '@/lib/chorus/fluxDetection';
import { businessValidateChorusFlux } from '@/lib/chorus/fluxDeposit';
import type { ChorusConfig } from '@/types/chorus';

const config = { submissionBridgeUrl: '', environment: 'qualif' } as unknown as ChorusConfig;

function fakeFetch(status: number, body: unknown): typeof fetch {
  return (async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  })) as unknown as typeof fetch;
}

const blockingBV = (): FluxBusinessValidation => ({
  valid: false,
  severity: 'BLOCKING',
  errors: [{ code: 'SUPPLIER_ADDRESS_MISSING', field: 'AccountingSupplierParty.Party.PostalAddress', xmlPath: 'AccountingSupplierParty.Party.PostalAddress', currentValue: null, suggestedFix: 'Ajouter une adresse.', line: null, message: 'Adresse fournisseur requise.', value: null }],
  warnings: [],
  checks: {
    supplier_identifier_present: true,
    supplier_identifier_known: false,
    supplier_address_present: false,
    customer_identifier_present: true,
    customer_identifier_known: false,
    customer_address_present: false,
    supplier_dp_application_enabled: false,
  },
  extracted: {
    invoiceNumber: 'TSTF1104', supplierIdentifier: 'DEMO',
    supplierBusinessIdentifier: 'DEMO', supplierIdentifierType: 'NON_SIRET',
    supplierSiretsConfigured: ['32242033407300'], supplierInternalIdsConfigured: ['26359578'],
    supplierName: 'ACME', supplierAddress: null,
    customerIdentifier: 'DEMO2', customerName: 'MAIRIE', customerAddress: null, currency: 'EUR',
    totalHt: 100, totalTva: 20, totalTtc: 120, taxPercentages: ['20.00'],
  },
});

describe('mapBusinessValidation', () => {
  it('returns null for non-object', () => {
    expect(mapBusinessValidation(null)).toBeNull();
  });

  it('maps snake_case payload to camelCase', () => {
    const bv = mapBusinessValidation({
      valid: false, severity: 'BLOCKING',
      errors: [{ code: 'TAX_SUBTOTAL_PERCENT_MISSING', field: 'TaxTotal.TaxSubtotal.Percent', xml_path: 'Invoice.TaxTotal.TaxSubtotal.TaxCategory.Percent', current_value: null, suggested_fix: 'Ajouter cbc:Percent.', message: 'm', value: null }],
      warnings: [{ code: 'ANNUAIRE_UNAVAILABLE', field: 'y', message: 'w', value: null }],
      checks: { supplier_address_present: false, customer_address_present: true },
      extracted: {
        invoice_number: 'INV-1', supplier_identifier: '32242033407300',
        supplier_business_identifier: '32242033407300', supplier_identifier_type: 'SIRET',
        supplier_sirets_configured: ['32242033407300'], supplier_internal_ids_configured: ['26359578'],
        total_ttc: 120,
      },
    });
    expect(bv?.severity).toBe('BLOCKING');
    expect(bv?.errors[0].code).toBe('TAX_SUBTOTAL_PERCENT_MISSING');
    expect(bv?.errors[0].xmlPath).toBe('Invoice.TaxTotal.TaxSubtotal.TaxCategory.Percent');
    expect(bv?.errors[0].suggestedFix).toBe('Ajouter cbc:Percent.');
    expect(bv?.warnings[0].code).toBe('ANNUAIRE_UNAVAILABLE');
    expect(bv?.checks.supplier_address_present).toBe(false);
    expect(bv?.extracted.invoiceNumber).toBe('INV-1');
    expect(bv?.extracted.totalTtc).toBe(120);
    expect(bv?.extracted.supplierIdentifierType).toBe('SIRET');
    expect(bv?.extracted.supplierBusinessIdentifier).toBe('32242033407300');
    expect(bv?.extracted.supplierSiretsConfigured).toEqual(['32242033407300']);
    expect(bv?.extracted.supplierInternalIdsConfigured).toEqual(['26359578']);
  });
});

describe('buildFluxRecommendation with business validation', () => {
  it('overrides to blocked when skeleton compatible but business BLOCKING', () => {
    const reco = buildFluxRecommendation({
      detectedFileType: 'UBL_INVOICE',
      selectedFormatFlux: 'IN_DP_E1_STRUCT',
      selectedSyntaxeFlux: 'IN_DP_E1_UBL_INVOICE',
      businessValidation: blockingBV(),
    });
    expect(reco?.status).toBe('blocked');
    expect(reco?.title).toBe('Format correct, données métier à corriger');
    // supplier_identifier_known=false → action mentions the supplier SIRET
    expect(reco?.actionLabel).toContain('identifiant SIRET de la structure fournisseur');
  });

  it('suggests checking the recipient SIRET when only the customer is unknown', () => {
    const bv = blockingBV();
    bv.checks.supplier_identifier_known = true;
    bv.checks.supplier_address_present = true;
    const reco = buildFluxRecommendation({
      detectedFileType: 'UBL_INVOICE', selectedFormatFlux: null, selectedSyntaxeFlux: null, businessValidation: bv,
    });
    expect(reco?.actionLabel).toContain('annuaire Chorus');
  });

  it('suggests adding an address line when only addresses are missing', () => {
    const bv = blockingBV();
    bv.checks.supplier_identifier_known = true;
    bv.checks.customer_identifier_known = true;
    const reco = buildFluxRecommendation({
      detectedFileType: 'UBL_INVOICE', selectedFormatFlux: null, selectedSyntaxeFlux: null, businessValidation: bv,
    });
    expect(reco?.actionLabel).toContain("ligne d'adresse");
  });

  it('keeps the normal recommendation when business validation is OK', () => {
    const reco = buildFluxRecommendation({
      detectedFileType: 'UBL_INVOICE',
      selectedFormatFlux: 'IN_DP_E1_STRUCT',
      selectedSyntaxeFlux: 'IN_DP_E1_UBL_INVOICE',
      businessValidation: { ...blockingBV(), severity: 'OK', valid: true, errors: [] },
    });
    expect(reco?.status).toBe('recommended');
  });
});

describe('businessValidateChorusFlux client', () => {
  const file = new File([new Uint8Array([60])], 'f.xml', { type: 'application/xml' });

  it('maps a blocking business validation response', async () => {
    const result = await businessValidateChorusFlux(config, file, undefined, undefined, fakeFetch(200, {
      success: true, filename: 'f.xml',
      detected: { detected_file_type: 'UBL_INVOICE' },
      metadata: { document: { kind: 'xml' }, xml: null, invoice: null },
      business_validation: {
        valid: false, severity: 'BLOCKING',
        errors: [{ code: 'CUSTOMER_ADDRESS_MISSING', field: 'x', message: 'm', value: null }],
        warnings: [], checks: { customer_address_present: false }, extracted: { invoice_number: 'INV-1' },
      },
    }));
    expect(result.businessValidation?.severity).toBe('BLOCKING');
    expect(result.businessValidation?.errors[0].code).toBe('CUSTOMER_ADDRESS_MISSING');
    expect(result.detected?.detectedFileType).toBe('UBL_INVOICE');
  });

  it('throws when backend reports failure', async () => {
    await expect(businessValidateChorusFlux(config, file, undefined, undefined, fakeFetch(400, { success: false, error: 'vide' })))
      .rejects.toThrow('vide');
  });
});
