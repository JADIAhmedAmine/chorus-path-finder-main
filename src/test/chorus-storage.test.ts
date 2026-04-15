import { beforeEach, describe, expect, it } from 'vitest';
import {
  CHORUS_CONFIG_STORAGE_KEY,
  getDefaultChorusConfig,
  loadChorusConfig,
  maskSecret,
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

  it('masks secrets safely', () => {
    expect(maskSecret('')).toBe('Non renseigné');
    expect(maskSecret('abc')).toBe('••••••');
    expect(maskSecret('abcdefgh')).toBe('ab••••gh');
  });
});
