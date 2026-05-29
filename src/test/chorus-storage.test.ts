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
      submissionSupplierId: '160',
    };

    saveChorusConfig(config);

    expect(window.localStorage.getItem(CHORUS_CONFIG_STORAGE_KEY)).not.toContain('super-secret');
    expect(loadChorusConfig()).toMatchObject({
      mode: 'direct',
      enabled: true,
      clientId: '',
      clientSecret: '',
      technicalLogin: '',
      submissionSupplierId: '160',
    });
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

  it('uses the build environment when persisted config was saved for another environment', () => {
    window.localStorage.setItem(CHORUS_CONFIG_STORAGE_KEY, JSON.stringify({
      environment: 'prod',
      tokenUrl: 'https://oauth.piste.gouv.fr/api/oauth/token',
      apiBaseUrl: 'https://api.piste.gouv.fr/cpro/factures',
      userAccountPath: 'https://chorus-pro.gouv.fr:5443/service/utilisateurs/consulter/compte',
      userConnectionsPath: 'https://chorus-pro.gouv.fr:5443/service/utilisateurs/monCompte/recuperer/rattachements',
    }));

    const config = loadChorusConfig();

    expect(config.environment).toBe('qualif');
    expect(config.tokenUrl).toBe('https://sandbox-oauth.piste.gouv.fr/api/oauth/token');
    expect(config.apiBaseUrl).toBe('https://sandbox-api.piste.gouv.fr/cpro/factures');
    expect(config.userAccountPath).toContain('/service-qualif/');
    expect(config.userConnectionsPath).toContain('/service-qualif/');
  });

  it('migrates legacy user service endpoints stored in localStorage', () => {
    window.localStorage.setItem(CHORUS_CONFIG_STORAGE_KEY, JSON.stringify({
      userAccountPath: '/cpro/utilisateurs/v1/consulter/compte',
      userConnectionsPath: 'https://sandbox-api.piste.gouv.fr/cpro/utilisateurs/v1/monCompte/recuperer/rattachements',
    }));

    const config = loadChorusConfig();

    expect(config.userAccountPath).toBe('https://chorus-pro.gouv.fr:5443/service-qualif/utilisateurs/consulter/compte');
    expect(config.userConnectionsPath).toBe('https://chorus-pro.gouv.fr:5443/service-qualif/utilisateurs/monCompte/recuperer/rattachements');
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
      userConnectionsPath: 'https://chorus-pro.gouv.fr:5443/service-qualif/utilisateurs/monCompte/recuperer/rattachements',
    }, true);

    expect(resolved.tokenUrl).toBe('/__chorus-proxy/sandbox-oauth/api/oauth/token');
    expect(resolved.apiBaseUrl).toBe('/__chorus-proxy/sandbox-api/cpro/factures');
    expect(resolved.userAccountPath).toBe('/__chorus-proxy/chorus-qualif/service-qualif/utilisateurs/consulter/compte');
    expect(resolved.userConnectionsPath).toBe('/__chorus-proxy/chorus-qualif/service-qualif/utilisateurs/monCompte/recuperer/rattachements');
  });
});
