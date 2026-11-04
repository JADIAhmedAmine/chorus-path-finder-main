import { describe, it, expect } from 'vitest';
import { validateG2BRecipient } from '@/lib/g2b/g2bAnnuaireApi';
import type { ChorusConfig } from '@/types/chorus';

const config = { submissionBridgeUrl: '', environment: 'qualif' } as unknown as ChorusConfig;

function fakeFetch(status: number, body: unknown): typeof fetch {
  return (async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  })) as unknown as typeof fetch;
}

describe('validateG2BRecipient', () => {
  it('maps an active recipient with rules', async () => {
    const r = await validateG2BRecipient(config, '70204275500240', {}, fakeFetch(200, {
      success: true,
      recipient: { siret: '70204275500240', denomination: 'MAIRIE', active: true, address: { line1: '1 place', postalCode: '75001', city: 'Paris', country: 'FR' }, rules: { serviceCodeRequired: true } },
      validation: { severity: 'WARNING', errors: [], warnings: [{ field: 'chorus.service_code', message: 'Code service requis.' }], recommendations: ['Code service requis pour ce destinataire.'] },
    }));
    expect(r.recipient.active).toBe(true);
    expect(r.recipient.denomination).toBe('MAIRIE');
    expect(r.recipient.rules.serviceCodeRequired).toBe(true);
    expect(r.validation.severity).toBe('WARNING');
    expect(r.validation.recommendations[0]).toContain('Code service');
  });

  it('maps a not-found recipient as blocking', async () => {
    const r = await validateG2BRecipient(config, '70204275500240', {}, fakeFetch(200, {
      success: true,
      recipient: { siret: '70204275500240', active: false, denomination: null, address: null, rules: {} },
      validation: { severity: 'BLOCKING', errors: [{ field: 'customer.siret', message: 'introuvable' }], warnings: [], recommendations: [] },
    }));
    expect(r.recipient.active).toBe(false);
    expect(r.validation.severity).toBe('BLOCKING');
  });

  it('throws when backend reports failure', async () => {
    await expect(validateG2BRecipient(config, '123', {}, fakeFetch(400, { success: false, error: 'SIRET invalide' }))).rejects.toThrow('SIRET invalide');
  });
});
