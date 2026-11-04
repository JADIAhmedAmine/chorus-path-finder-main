import { describe, it, expect } from 'vitest';
import {
  deposerGenerated,
  detectPdfToFlux,
  extractPdfToFlux,
  generateXml,
  validateDraft,
  validateXml,
  type InvoiceDraft,
} from '@/lib/chorus/pdfToFlux';
import type { ChorusConfig } from '@/types/chorus';

const config = { submissionBridgeUrl: '', environment: 'qualif' } as unknown as ChorusConfig;

function fakeFetch(status: number, body: unknown): typeof fetch {
  return (async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  })) as unknown as typeof fetch;
}

const pdfFile = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'invoice.pdf', { type: 'application/pdf' });

function draft(): InvoiceDraft {
  return {
    supplier: { name: 'ACME', siret: '12345678900012', vat_number: null, address: '1 rue X' },
    customer: { name: 'MAIRIE', siret: '11000201100044', service_code: null, engagement_number: null, address: '2 av Y' },
    invoice: { invoice_number: 'INV-1', invoice_date: '2026-05-26', due_date: null, currency: 'EUR', total_ht: 100, total_tva: 20, total_ttc: 120, payment_terms: null },
    vat_breakdown: [{ vat_rate: 20, base_amount: 100, vat_amount: 20 }],
    lines: [{ description: 'x', quantity: 1, unit_price: 100, vat_rate: 20, line_total_ht: 100 }],
    chorus: { cadre_facturation: null, service_code: null, engagement_number: null, format_flux_target: 'IN_DP_E1_STRUCT', syntaxe_flux_target: 'IN_DP_E1_UBL_INVOICE' },
  };
}

describe('pdfToFlux client', () => {
  it('maps a normal PDF detection', async () => {
    const result = await detectPdfToFlux(config, pdfFile, fakeFetch(200, {
      success: true, filename: 'invoice.pdf', pdf_type: 'PDF_GENERIC',
      is_facturx: false, direct_deposit_possible: false, conversion_required: true,
      message: 'conversion',
    }));
    expect(result.pdfType).toBe('PDF_GENERIC');
    expect(result.conversionRequired).toBe(true);
    expect(result.directDepositPossible).toBe(false);
  });

  it('maps a Factur-X detection with recommended targets', async () => {
    const result = await detectPdfToFlux(config, pdfFile, fakeFetch(200, {
      success: true, filename: 'fx.pdf', pdf_type: 'FACTURX_CII',
      is_facturx: true, direct_deposit_possible: true, conversion_required: false,
      embedded_xml_filename: 'factur-x.xml', embedded_xml_root: 'CrossIndustryInvoice',
      message: 'ok', recommended: { formatFlux: ['IN_DP_E2_FACTURX_FE'], syntaxeFlux: ['IN_DP_E2_CII_FACTURX_FE'] },
    }));
    expect(result.isFacturx).toBe(true);
    expect(result.recommended?.formatFlux).toEqual(['IN_DP_E2_FACTURX_FE']);
  });

  it('throws when detection backend fails', async () => {
    await expect(detectPdfToFlux(config, pdfFile, fakeFetch(400, { success: false, error: 'Seuls les PDF.' })))
      .rejects.toThrow('Seuls les PDF.');
  });

  it('passes the extracted draft and warnings through', async () => {
    const result = await extractPdfToFlux(config, pdfFile, fakeFetch(200, {
      success: true, filename: 'invoice.pdf', draft: draft(), confidence: { invoice_number: 0.7 }, warnings: ['w1'],
    }));
    expect(result.draft.invoice.invoice_number).toBe('INV-1');
    expect(result.confidence.invoice_number).toBe(0.7);
    expect(result.warnings).toEqual(['w1']);
  });

  it('maps draft validation issues', async () => {
    const result = await validateDraft(config, draft(), fakeFetch(200, {
      success: true, valid: false,
      errors: [{ field: 'customer.siret', message: 'requis' }],
      warnings: [{ field: 'chorus.service_code', message: 'peut être requis' }],
    }));
    expect(result.valid).toBe(false);
    expect(result.errors[0].field).toBe('customer.siret');
    expect(result.warnings[0].field).toBe('chorus.service_code');
  });

  it('maps generated XML payload', async () => {
    const result = await generateXml(config, draft(), { formatFlux: 'IN_DP_E1_STRUCT', syntaxeFlux: 'IN_DP_E1_UBL_INVOICE' }, fakeFetch(200, {
      success: true,
      generated: { filename: 'g.xml', formatFlux: 'IN_DP_E1_STRUCT', syntaxeFlux: 'IN_DP_E1_UBL_INVOICE', detected_file_type: 'UBL_INVOICE', xml_preview: '<Invoice/>' },
      warnings: [],
    }));
    expect(result.success).toBe(true);
    expect(result.generated?.detectedFileType).toBe('UBL_INVOICE');
    expect(result.generated?.xmlPreview).toContain('<Invoice');
  });

  it('surfaces generate-xml validation errors on 422', async () => {
    const result = await generateXml(config, draft(), { formatFlux: 'IN_DP_E1_STRUCT', syntaxeFlux: 'IN_DP_E1_UBL_INVOICE' }, fakeFetch(422, {
      success: false, error: 'corrigez', validation: { valid: false, errors: [{ field: 'customer.siret', message: 'requis' }], warnings: [] },
    }));
    expect(result.success).toBe(false);
    expect(result.validation?.errors[0].field).toBe('customer.siret');
  });

  it('maps validate-xml OK', async () => {
    const result = await validateXml(config, '<Invoice/>', 'IN_DP_E1_UBL_INVOICE', fakeFetch(200, {
      success: true, valid: true,
      detected: { detected_file_type: 'UBL_INVOICE', root_element: 'Invoice', namespace: 'urn:...:Invoice-2' },
      compatibility: { severity: 'OK', compatible: true }, warnings: [],
    }));
    expect(result.valid).toBe(true);
    expect(result.detected?.detectedFileType).toBe('UBL_INVOICE');
    expect(result.compatibility?.severity).toBe('OK');
  });

  it('maps deposer-generated accepted response', async () => {
    const result = await deposerGenerated(config, { xml: '<Invoice/>', formatFlux: 'IN_DP_E1_STRUCT', syntaxeFlux: 'IN_DP_E1_UBL_INVOICE' }, fakeFetch(200, {
      success: true, http_status: 200, status_local: 'ACCEPTED', codeRetour: 0,
      libelle: 'TRA_MSG_00.000', dateDepot: '2026-05-26', numeroFluxDepot: 'FLX1',
      formatFlux: 'IN_DP_E1_STRUCT', syntaxeFlux: 'IN_DP_E1_UBL_INVOICE', persisted: false, raw: { ok: 1 },
    }));
    expect(result.statusLocal).toBe('ACCEPTED');
    expect(result.numeroFluxDepot).toBe('FLX1');
  });

  it('maps deposer-generated blocked response', async () => {
    const result = await deposerGenerated(config, { xml: '<x/>', formatFlux: 'IN_DP_E1_STRUCT', syntaxeFlux: 'IN_DP_E1_UBL_INVOICE' }, fakeFetch(422, {
      success: false, status_local: 'BLOCKED_LOCAL_VALIDATION', error: 'non UBL',
    }));
    expect(result.statusLocal).toBe('BLOCKED_LOCAL_VALIDATION');
    expect(result.success).toBe(false);
  });
});
