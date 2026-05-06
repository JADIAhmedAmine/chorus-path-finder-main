import type {
  ChorusConfig,
  ChorusConnectionTestMethod,
  ChorusConnectorMode,
  ChorusEnvironment,
} from '@/types/chorus';

export const CHORUS_CONFIG_STORAGE_KEY = 'chorus.connector.config';
const DEV_PROXY_SANDBOX_OAUTH_PREFIX = '/__chorus-proxy/sandbox-oauth';
const DEV_PROXY_SANDBOX_API_PREFIX = '/__chorus-proxy/sandbox-api';
const DEV_PROXY_PROD_OAUTH_PREFIX = '/__chorus-proxy/prod-oauth';
const DEV_PROXY_PROD_API_PREFIX = '/__chorus-proxy/prod-api';
const DEV_PROXY_CHORUS_QUALIF_PREFIX = '/__chorus-proxy/chorus-qualif';
const DEV_PROXY_CHORUS_PROD_PREFIX = '/__chorus-proxy/chorus-prod';

interface ChorusEnvPreset {
  tokenUrl: string;
  apiBaseUrl: string;
  userAccountPath: string;
  userConnectionsPath: string;
}

export const CHORUS_ENV_PRESETS: Record<ChorusEnvironment, ChorusEnvPreset> = {
  qualif: {
    tokenUrl: 'https://sandbox-oauth.piste.gouv.fr/api/oauth/token',
    apiBaseUrl: 'https://sandbox-api.piste.gouv.fr/cpro/factures',
    userAccountPath: 'https://chorus-pro.gouv.fr:5443/service-qualif/utilisateurs/consulter/compte',
    userConnectionsPath: 'https://chorus-pro.gouv.fr:5443/service-qualif/utilisateurs/monCompte/recuperer/rattachements',
  },
  prod: {
    tokenUrl: 'https://oauth.piste.gouv.fr/api/oauth/token',
    apiBaseUrl: 'https://api.piste.gouv.fr/cpro/factures',
    userAccountPath: 'https://chorus-pro.gouv.fr:5443/service/utilisateurs/consulter/compte',
    userConnectionsPath: 'https://chorus-pro.gouv.fr:5443/service/utilisateurs/monCompte/recuperer/rattachements',
  },
};

const DEFAULT_USER_ACCOUNT_PATH = CHORUS_ENV_PRESETS.qualif.userAccountPath;
const DEFAULT_USER_CONNECTIONS_PATH = CHORUS_ENV_PRESETS.qualif.userConnectionsPath;
const DEFAULT_DEV_ANNUAIRE_JSON_URL = '/annuaire/annuaire.normalized.json';
const DEFAULT_DEV_ANNUAIRE_XML_URL = '';
const LEGACY_DEV_ANNUAIRE_JSON_URL = '/src/data/annuaire_out/annuaire.normalized.json';
const LEGACY_DEV_ANNUAIRE_XML_URL = '/src/data/annuaire_out/FAR0037A_SEC001_CPP0010037000000000007495';
const EXTENSIONLESS_DEV_ANNUAIRE_XML_URL = '/annuaire/FAR0037A_SEC001_CPP0010037000000000007495';
const DEFAULT_BACKEND_BRIDGE_URL = '/api/chorus/submit';

function envValue(key: string, fallback = ''): string {
  const value = import.meta.env[key as keyof ImportMetaEnv];
  return typeof value === 'string' ? value : fallback;
}

function envBool(key: string, fallback: boolean): boolean {
  const value = envValue(key, String(fallback));
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function pickEnumValue<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

export function resolveChorusEnvironment(): ChorusEnvironment {
  const raw = envValue('VITE_CHORUS_ENV', 'prod').trim().toLowerCase();
  return raw === 'prod' ? 'prod' : 'qualif';
}

export function getChorusEnvPreset(env: ChorusEnvironment = resolveChorusEnvironment()): ChorusEnvPreset {
  return CHORUS_ENV_PRESETS[env];
}

function envCredential(env: ChorusEnvironment, suffix: string, fallback = ''): string {
  const envSpecific = envValue(`VITE_CHORUS_${env.toUpperCase()}_${suffix}`, '');
  if (envSpecific) {
    return envSpecific;
  }
  return envValue(`VITE_CHORUS_${suffix}`, fallback);
}

interface EnvScopedCredentials {
  submissionSupplierId: string;
  submissionCurrentUserId: string;
  submissionSupplierServiceId: string;
  submissionBankAccountCode: string;
}

interface EnvReferenceConfig {
  referenceApiBaseUrl: string;
  referenceSuppliersPath: string;
  referencePublicCustomersPath: string;
  referencePublicServicesPath: string;
  referenceAnnuaireJsonUrl: string;
  referenceAnnuaireXmlUrl: string;
}

function readEnvScopedCredentials(env: ChorusEnvironment): EnvScopedCredentials {
  return {
    submissionSupplierId: envCredential(env, 'SUBMISSION_SUPPLIER_ID'),
    submissionCurrentUserId: envCredential(env, 'SUBMISSION_CURRENT_USER_ID'),
    submissionSupplierServiceId: envCredential(env, 'SUBMISSION_SUPPLIER_SERVICE_ID'),
    submissionBankAccountCode: envCredential(env, 'SUBMISSION_BANK_ACCOUNT_CODE'),
  };
}

function readEnvReferenceConfig(): EnvReferenceConfig {
  return {
    referenceApiBaseUrl: envValue('VITE_REFERENCE_API_BASE_URL', envValue('VITE_DATA_API_BASE_URL', '')),
    referenceSuppliersPath: envValue('VITE_REFERENCE_SUPPLIERS_PATH', envValue('VITE_DATA_SUPPLIERS_PATH', '')),
    referencePublicCustomersPath: envValue('VITE_REFERENCE_PUBLIC_CUSTOMERS_PATH', envValue('VITE_DATA_PUBLIC_CUSTOMERS_PATH', '')),
    referencePublicServicesPath: envValue('VITE_REFERENCE_PUBLIC_SERVICES_PATH', envValue('VITE_DATA_PUBLIC_SERVICES_PATH', '')),
    referenceAnnuaireJsonUrl: envValue(
      'VITE_REFERENCE_ANNUAIRE_JSON_URL',
      import.meta.env.DEV ? DEFAULT_DEV_ANNUAIRE_JSON_URL : '',
    ),
    referenceAnnuaireXmlUrl: envValue(
      'VITE_REFERENCE_ANNUAIRE_XML_URL',
      import.meta.env.DEV ? DEFAULT_DEV_ANNUAIRE_XML_URL : '',
    ),
  };
}

export function applyEnvironmentPreset(config: ChorusConfig, env: ChorusEnvironment): ChorusConfig {
  const preset = CHORUS_ENV_PRESETS[env];
  const credentials = readEnvScopedCredentials(env);
  return {
    ...config,
    environment: env,
    tokenUrl: preset.tokenUrl,
    apiBaseUrl: preset.apiBaseUrl,
    userAccountPath: preset.userAccountPath,
    userConnectionsPath: preset.userConnectionsPath,
    ...credentials,
  };
}

function mergeConfigWithFallback(
  fallback: ChorusConfig,
  parsed: Partial<ChorusConfig>,
): ChorusConfig {
  const merged = { ...fallback } as ChorusConfig;

  (Object.keys(parsed) as Array<keyof ChorusConfig>).forEach((key) => {
    const nextValue = parsed[key];

    if (typeof nextValue === 'string') {
      const trimmed = nextValue.trim();
      if (trimmed) {
        merged[key] = nextValue as ChorusConfig[typeof key];
      }
      return;
    }

    if (nextValue !== undefined) {
      merged[key] = nextValue as ChorusConfig[typeof key];
    }
  });

  return normalizeLegacyChorusUserServiceConfig(merged);
}

function normalizeLegacyChorusUserServiceUrl(
  value: string,
  fallback: string,
): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return fallback;
  }

  const normalized = trimmed
    .replace('https://sandbox-api.piste.gouv.fr/cpro/utilisateurs/v1/consulter/compte', DEFAULT_USER_ACCOUNT_PATH)
    .replace('https://sandbox-api.piste.gouv.fr/cpro/utilisateurs/v1/monCompte/recuperer/rattachements', DEFAULT_USER_CONNECTIONS_PATH)
    .replace('/cpro/utilisateurs/v1/consulter/compte', DEFAULT_USER_ACCOUNT_PATH)
    .replace('/cpro/utilisateurs/v1/monCompte/recuperer/rattachements', DEFAULT_USER_CONNECTIONS_PATH)
    .replace('https://chorus-pro.gouv.fr:5443/service-qualif/consulter/compte', DEFAULT_USER_ACCOUNT_PATH)
    .replace('https://chorus-pro.gouv.fr:5443/service-qualif/monCompte/recuperer/rattachements', DEFAULT_USER_CONNECTIONS_PATH);

  return normalized;
}

function normalizeLegacyChorusUserServiceConfig(config: ChorusConfig): ChorusConfig {
  return {
    ...config,
    userAccountPath: normalizeLegacyChorusUserServiceUrl(config.userAccountPath, DEFAULT_USER_ACCOUNT_PATH),
    userConnectionsPath: normalizeLegacyChorusUserServiceUrl(config.userConnectionsPath, DEFAULT_USER_CONNECTIONS_PATH),
    referenceAnnuaireJsonUrl: config.referenceAnnuaireJsonUrl === LEGACY_DEV_ANNUAIRE_JSON_URL
      ? DEFAULT_DEV_ANNUAIRE_JSON_URL
      : config.referenceAnnuaireJsonUrl,
    referenceAnnuaireXmlUrl: config.referenceAnnuaireXmlUrl === LEGACY_DEV_ANNUAIRE_XML_URL
      ? DEFAULT_DEV_ANNUAIRE_XML_URL
      : config.referenceAnnuaireXmlUrl === EXTENSIONLESS_DEV_ANNUAIRE_XML_URL
        ? DEFAULT_DEV_ANNUAIRE_XML_URL
      : config.referenceAnnuaireXmlUrl,
    submissionBridgeUrl: normalizeBackendBridgeUrl(config.submissionBridgeUrl),
  };
}

function normalizeBackendBridgeUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return trimmed;
  }

  try {
    const parsed = new URL(trimmed);
    if ((parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost') && parsed.port === '8008') {
      return parsed.pathname === '/api/chorus/submit' ? DEFAULT_BACKEND_BRIDGE_URL : parsed.pathname;
    }
  } catch {
    return trimmed;
  }

  return trimmed;
}

function normalizeChorusConfig(config: ChorusConfig): ChorusConfig {
  return {
    ...normalizeLegacyChorusUserServiceConfig(config),
    clientId: '',
    clientSecret: '',
    technicalLogin: '',
    technicalPassword: '',
  };
}

export function getDefaultChorusConfig(): ChorusConfig {
  const mode = (envValue('VITE_CHORUS_MODE', 'direct') as ChorusConnectorMode) === 'mock' ? 'mock' : 'direct';
  const connectionTestMethod = (envValue('VITE_CHORUS_CONNECTION_TEST_METHOD', 'GET').toUpperCase() as ChorusConnectionTestMethod) === 'POST'
    ? 'POST'
    : 'GET';
  const environment = resolveChorusEnvironment();
  const preset = getChorusEnvPreset(environment);
  const credentials = readEnvScopedCredentials(environment);
  const references = readEnvReferenceConfig();

  return normalizeChorusConfig({
    enabled: envBool('VITE_CHORUS_ENABLED', mode === 'direct'),
    mode,
    environment,
    tokenUrl: envValue('VITE_CHORUS_TOKEN_URL', preset.tokenUrl),
    apiBaseUrl: envValue('VITE_CHORUS_API_BASE_URL', preset.apiBaseUrl),
    ...references,
    clientId: '',
    clientSecret: '',
    scope: envValue('VITE_CHORUS_SCOPE', 'openid'),
    technicalLogin: '',
    technicalPassword: '',
    connectionTestPath: envValue('VITE_CHORUS_CONNECTION_TEST_PATH', ''),
    connectionTestMethod,
    uploadFilePath: envValue('VITE_CHORUS_UPLOAD_FILE_PATH', '/v1/deposer/pdf'),
    submitInvoicePath: envValue('VITE_CHORUS_SUBMIT_INVOICE_PATH', '/v1/soumettre'),
    userAccountPath: envValue('VITE_CHORUS_USER_ACCOUNT_PATH', preset.userAccountPath),
    userConnectionsPath: envValue('VITE_CHORUS_USER_CONNECTIONS_PATH', preset.userConnectionsPath),
    submissionBridgeUrl: envValue('VITE_CHORUS_SUBMISSION_BRIDGE_URL', DEFAULT_BACKEND_BRIDGE_URL),
    submissionCurrentUserId: credentials.submissionCurrentUserId,
    submissionSupplierId: credentials.submissionSupplierId,
    submissionSupplierServiceId: credentials.submissionSupplierServiceId,
    submissionBankAccountCode: credentials.submissionBankAccountCode,
    submissionCadreCode: envValue('VITE_CHORUS_SUBMISSION_CADRE_CODE', 'A1_FACTURE_FOURNISSEUR'),
    submissionValidatorServiceCode: envValue('VITE_CHORUS_SUBMISSION_VALIDATOR_SERVICE_CODE', ''),
    submissionValidatorStructureCode: envValue('VITE_CHORUS_SUBMISSION_VALIDATOR_STRUCTURE_CODE', ''),
    submissionPaymentMode: pickEnumValue(
      envValue('VITE_CHORUS_SUBMISSION_PAYMENT_MODE', 'VIREMENT').toUpperCase(),
      ['CHEQUE', 'ESPECE', 'VIREMENT', 'PRELEVEMENT', 'AUTRE', 'REPORT'],
      'VIREMENT',
    ),
    submissionInvoiceType: pickEnumValue(
      envValue('VITE_CHORUS_SUBMISSION_INVOICE_TYPE', 'FACTURE').toUpperCase(),
      ['FACTURE', 'AVOIR'],
      'FACTURE',
    ),
    submissionVatType: pickEnumValue(
      envValue('VITE_CHORUS_SUBMISSION_VAT_TYPE', 'AUTO').toUpperCase(),
      ['AUTO', 'TVA_SUR_DEBIT', 'TVA_SUR_ENCAISSEMENT', 'EXONERATION', 'SANS_TVA'],
      'AUTO',
    ),
    submissionVatExonerationReason: envValue('VITE_CHORUS_SUBMISSION_VAT_EXONERATION_REASON', ''),
    submissionOriginalInvoiceNumber: envValue('VITE_CHORUS_SUBMISSION_ORIGINAL_INVOICE_NUMBER', ''),
    submissionComment: envValue('VITE_CHORUS_SUBMISSION_COMMENT', ''),
  });
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
    const merged = mergeConfigWithFallback(fallback, parsed);
    return normalizeChorusConfig({
      ...merged,
      ...readEnvReferenceConfig(),
      ...readEnvScopedCredentials(merged.environment),
    });
  } catch {
    return fallback;
  }
}

function rewriteUrlToDevProxy(url: string): string {
  if (!url || url.startsWith('/')) {
    return url;
  }

  try {
    const parsed = new URL(url);

    if (parsed.origin === 'https://sandbox-oauth.piste.gouv.fr') {
      return `${DEV_PROXY_SANDBOX_OAUTH_PREFIX}${parsed.pathname}${parsed.search}`;
    }

    if (parsed.origin === 'https://sandbox-api.piste.gouv.fr') {
      return `${DEV_PROXY_SANDBOX_API_PREFIX}${parsed.pathname}${parsed.search}`;
    }

    if (parsed.origin === 'https://oauth.piste.gouv.fr') {
      return `${DEV_PROXY_PROD_OAUTH_PREFIX}${parsed.pathname}${parsed.search}`;
    }

    if (parsed.origin === 'https://api.piste.gouv.fr') {
      return `${DEV_PROXY_PROD_API_PREFIX}${parsed.pathname}${parsed.search}`;
    }

    if (parsed.origin === 'https://chorus-pro.gouv.fr:5443') {
      const isProdPath = parsed.pathname.startsWith('/service/');
      const prefix = isProdPath ? DEV_PROXY_CHORUS_PROD_PREFIX : DEV_PROXY_CHORUS_QUALIF_PREFIX;
      return `${prefix}${parsed.pathname}${parsed.search}`;
    }
  } catch {
    return url;
  }

  return url;
}

export function resolveChorusRuntimeConfig(config: ChorusConfig, devMode = import.meta.env.DEV): ChorusConfig {
  if (!devMode) {
    return normalizeChorusConfig(config);
  }

  return normalizeChorusConfig({
    ...config,
    tokenUrl: rewriteUrlToDevProxy(config.tokenUrl),
    apiBaseUrl: rewriteUrlToDevProxy(config.apiBaseUrl),
    userAccountPath: rewriteUrlToDevProxy(config.userAccountPath),
    userConnectionsPath: rewriteUrlToDevProxy(config.userConnectionsPath),
  });
}

export function saveChorusConfig(config: ChorusConfig): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(
    CHORUS_CONFIG_STORAGE_KEY,
    JSON.stringify(normalizeChorusConfig(config)),
  );
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
