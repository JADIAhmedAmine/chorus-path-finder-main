import { beforeEach, describe, expect, it } from 'vitest';
import {
  CHORUS_CONFIG_STORAGE_KEY,
  getDefaultChorusConfig,
  loadChorusConfig,
  maskSecret,
  resolveChorusRuntimeConfig,
  saveChorusConfig,
} from '@/lib/chorus/storage';

describe('chorus storage', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('loads defaults when no persisted config exists', () => {
    const config = loadChorusConfig();

    expect(config).toEqual(getDefaultChorusConfig());
  });

  it('persists and reloads connector config', () => {
    const config = {
      ...getDefaultChorusConfig(),
      mode: 'direct' as const,
      enabled: true,
      clientId: 'client-id',
      clientSecret: 'super-secret',
      technicalLogin: 'tech-user',
    };

    saveChorusConfig(config);

    expect(window.localStorage.getItem(CHORUS_CONFIG_STORAGE_KEY)).toContain('client-id');
    expect(loadChorusConfig()).toMatchObject(config);
  });

  it('keeps fallback env values when persisted config contains empty strings', () => {
    const fallback = getDefaultChorusConfig();
    window.localStorage.setItem(CHORUS_CONFIG_STORAGE_KEY, JSON.stringify({
      submissionCurrentUserId: '',
      submissionSupplierId: '',
      submissionCadreCode: '',
      clientId: '',
    }));

    const config = loadChorusConfig();

    expect(config.submissionCurrentUserId).toBe(fallback.submissionCurrentUserId);
    expect(config.submissionSupplierId).toBe(fallback.submissionSupplierId);
    expect(config.submissionCadreCode).toBe(fallback.submissionCadreCode);
    expect(config.clientId).toBe(fallback.clientId);
  });

  it('masks secrets safely', () => {
    expect(maskSecret('')).toBe('Non renseigné');
    expect(maskSecret('abc')).toBe('••••••');
    expect(maskSecret('abcdefgh')).toBe('ab••••gh');
  });

  it('rewrites official sandbox urls to the local dev proxy in development mode', () => {
    const resolved = resolveChorusRuntimeConfig({
      ...getDefaultChorusConfig(),
      tokenUrl: 'https://sandbox-oauth.piste.gouv.fr/api/oauth/token',
      apiBaseUrl: 'https://sandbox-api.piste.gouv.fr/cpro/factures',
      userAccountPath: 'https://chorus-pro.gouv.fr:5443/service-qualif/utilisateurs/consulter/compte',
    }, true);

    expect(resolved.tokenUrl).toBe('/__chorus-proxy/sandbox-oauth/api/oauth/token');
    expect(resolved.apiBaseUrl).toBe('/__chorus-proxy/sandbox-api/cpro/factures');
    expect(resolved.userAccountPath).toBe('/__chorus-proxy/chorus-qualif/service-qualif/utilisateurs/consulter/compte');
  });
});
