import { describe, it, expect } from 'vitest';
import { detectG2BFlux, businessValidateG2BFlux, depositG2BFlux, getG2BFluxStatus } from '@/lib/g2b/g2bFluxApi';
import type { ChorusConfig } from '@/types/chorus';

const config = { submissionBridgeUrl: '', environment: 'qualif' } as unknown as ChorusConfig;
const xmlFile = new File([new Uint8Array([60])], 'f.xml', { type: 'application/xml' });

function fakeFetch(status: number, body: unknown): typeof fetch {
  return (async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  })) as unknown as typeof fetch;
}

describe('g2bFluxApi', () => {
  it('maps detect result with recommendation', async () => {
    const r = await detectG2BFlux(config, xmlFile, fakeFetch(200, {
      success: true, filename: 'f.xml',
      detected: { fileType: 'UBL_INVOICE', rootElement: 'Invoice', namespace: 'urn:...:Invoice-2', isDepositCompatible: true },
      recommendation: { status: 'recommended', title: 'Dépôt UBL recommandé', recommendedCodeInterface: 'FSO3110A', shortExplanation: 's', why: 'w', actionLabel: 'a' },
    }));
    expect(r.detected.fileType).toBe('UBL_INVOICE');
    expect(r.recommendation.recommendedCodeInterface).toBe('FSO3110A');
  });

  it('throws when detect backend fails', async () => {
    await expect(detectG2BFlux(config, xmlFile, fakeFetch(400, { success: false, error: 'vide' }))).rejects.toThrow('vide');
  });

  it('maps business validation with source tracing', async () => {
    const r = await businessValidateG2BFlux(config, xmlFile, 'FSO3110A', fakeFetch(200, {
      success: true, filename: 'f.xml', detected: { fileType: 'UBL_INVOICE' },
      businessValidation: {
        severity: 'BLOCKING', valid: false,
        errors: [{ code: 'TAX_SUBTOTAL_PERCENT_MISSING', field: 'TaxTotal.TaxSubtotal.Percent', xmlPath: 'Invoice > TaxTotal > TaxSubtotal > TaxCategory > Percent', currentValue: null, message: 'm', suggestedFix: 'Ajouter cbc:Percent.' }],
        warnings: [], extracted: { invoiceNumber: 'G2B-1', supplierSiret: '32242033407300', supplierIdentifierType: 'SIRET', customerSiret: '11000201100044', currency: 'EUR', totalTtc: 120, taxPercentages: [] },
      },
    }));
    expect(r.businessValidation.severity).toBe('BLOCKING');
    expect(r.businessValidation.errors[0].code).toBe('TAX_SUBTOTAL_PERCENT_MISSING');
    expect(r.businessValidation.errors[0].xmlPath).toContain('Percent');
    expect(r.businessValidation.extracted.supplierSiret).toBe('32242033407300');
  });

  it('maps a submitted deposit', async () => {
    const r = await depositG2BFlux(config, xmlFile, 'FSO3110A', true, fakeFetch(200, {
      success: true, statusLocal: 'SUBMITTED', uidFlux: 'uid-1', codeInterface: 'FSO3110A', checksum: 'abc', checksumMode: 'raw', fileSha256: 'def', message: 'ok',
    }));
    expect(r.statusLocal).toBe('SUBMITTED');
    expect(r.uidFlux).toBe('uid-1');
  });

  it('maps a blocked deposit', async () => {
    const r = await depositG2BFlux(config, xmlFile, 'FSO3110A', false, fakeFetch(422, {
      success: false, statusLocal: 'BLOCKED_BUSINESS_VALIDATION', message: 'à corriger',
    }));
    expect(r.success).toBe(false);
    expect(r.statusLocal).toBe('BLOCKED_BUSINESS_VALIDATION');
  });

  it('maps a temporary 404 status', async () => {
    const r = await getG2BFluxStatus(config, 'uid-1', false, fakeFetch(200, {
      success: true, temporary: true, status: 'PROCESSING_NOT_AVAILABLE_YET', message: 'pas encore',
    }));
    expect(r.temporary).toBe(true);
    expect(r.status).toBe('PROCESSING_NOT_AVAILABLE_YET');
  });

  it('maps IRRECEVABLE status with explanation', async () => {
    const r = await getG2BFluxStatus(config, 'uid-1', true, fakeFetch(200, {
      success: true, temporary: false, status: 'IRRECEVABLE', explanation: { friendlyMessage: 'irrecevable', technicalSource: null, suggestedFix: 'corriger', severity: 'blocking' }, terminal: true,
    }));
    expect(r.status).toBe('IRRECEVABLE');
    expect(r.explanation?.friendlyMessage).toBe('irrecevable');
  });
});
