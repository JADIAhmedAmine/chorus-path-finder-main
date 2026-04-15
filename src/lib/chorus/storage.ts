import type { ChorusConfig, ChorusConnectorMode } from '@/types/chorus';

export const CHORUS_CONFIG_STORAGE_KEY = 'chorus.connector.config';

function envValue(key: string, fallback = ''): string {
  const value = import.meta.env[key as keyof ImportMetaEnv];
  return typeof value === 'string' ? value : fallback;
}

function envBool(key: string, fallback: boolean): boolean {
  const value = envValue(key, String(fallback));
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

export function getDefaultChorusConfig(): ChorusConfig {
  const mode = (envValue('VITE_CHORUS_MODE', 'mock') as ChorusConnectorMode) === 'direct' ? 'direct' : 'mock';

  return {
    enabled: envBool('VITE_CHORUS_ENABLED', mode === 'direct'),
    mode,
    tokenUrl: envValue('VITE_CHORUS_TOKEN_URL', 'https://sandbox-oauth.aife.economie.gouv.fr/api/oauth/token'),
    apiBaseUrl: envValue('VITE_CHORUS_API_BASE_URL', ''),
    clientId: envValue('VITE_CHORUS_CLIENT_ID', ''),
    clientSecret: envValue('VITE_CHORUS_CLIENT_SECRET', ''),
    scope: envValue('VITE_CHORUS_SCOPE', 'openid'),
    technicalLogin: envValue('VITE_CHORUS_TECHNICAL_LOGIN', ''),
    technicalPassword: envValue('VITE_CHORUS_TECHNICAL_PASSWORD', ''),
    connectionTestPath: envValue('VITE_CHORUS_CONNECTION_TEST_PATH', ''),
    uploadFilePath: envValue('VITE_CHORUS_UPLOAD_FILE_PATH', ''),
    submitInvoicePath: envValue('VITE_CHORUS_SUBMIT_INVOICE_PATH', ''),
  };
}

export function loadChorusConfig(): ChorusConfig {
  const fallback = getDefaultChorusConfig();

  if (typeof window === 'undefined') {
    return fallback;
  }

  const raw = window.localStorage.getItem(CHORUS_CONFIG_STORAGE_KEY);
  if (!raw) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<ChorusConfig>;
    return { ...fallback, ...parsed };
  } catch {
    return fallback;
  }
}

export function saveChorusConfig(config: ChorusConfig): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(CHORUS_CONFIG_STORAGE_KEY, JSON.stringify(config));
}

export function maskSecret(value: string): string {
  if (!value) {
    return 'Non renseigné';
  }

  if (value.length <= 6) {
    return '••••••';
  }

  return `${value.slice(0, 2)}••••${value.slice(-2)}`;
}
