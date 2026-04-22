import type { ChorusConfig, ChorusConnectionTestMethod, ChorusConnectorMode } from '@/types/chorus';

export const CHORUS_CONFIG_STORAGE_KEY = 'chorus.connector.config';
const DEV_PROXY_SANDBOX_OAUTH_PREFIX = '/__chorus-proxy/sandbox-oauth';
const DEV_PROXY_SANDBOX_API_PREFIX = '/__chorus-proxy/sandbox-api';
const DEV_PROXY_CHORUS_QUALIF_PREFIX = '/__chorus-proxy/chorus-qualif';
const DEFAULT_USER_ACCOUNT_PATH = 'https://chorus-pro.gouv.fr:5443/service-qualif/utilisateurs/consulter/compte';
const DEFAULT_USER_CONNECTIONS_PATH = 'https://chorus-pro.gouv.fr:5443/service-qualif/utilisateurs/monCompte/recuperer/rattachements';
const DEFAULT_DEV_ANNUAIRE_JSON_URL = '/annuaire/annuaire.normalized.json';
const DEFAULT_DEV_ANNUAIRE_XML_URL = '/annuaire/FAR0037A_SEC001_CPP0010037000000000007495';
const LEGACY_DEV_ANNUAIRE_JSON_URL = '/src/data/annuaire_out/annuaire.normalized.json';
const LEGACY_DEV_ANNUAIRE_XML_URL = '/src/data/annuaire_out/FAR0037A_SEC001_CPP0010037000000000007495';

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
      : config.referenceAnnuaireXmlUrl,
  };
}

export function getDefaultChorusConfig(): ChorusConfig {
  const mode = (envValue('VITE_CHORUS_MODE', 'mock') as ChorusConnectorMode) === 'direct' ? 'direct' : 'mock';
  const connectionTestMethod = (envValue('VITE_CHORUS_CONNECTION_TEST_METHOD', 'GET').toUpperCase() as ChorusConnectionTestMethod) === 'POST'
    ? 'POST'
    : 'GET';

  return {
    enabled: envBool('VITE_CHORUS_ENABLED', mode === 'direct'),
    mode,
    tokenUrl: envValue('VITE_CHORUS_TOKEN_URL', 'https://sandbox-oauth.piste.gouv.fr/api/oauth/token'),
    apiBaseUrl: envValue('VITE_CHORUS_API_BASE_URL', ''),
    referenceApiBaseUrl: envValue('VITE_REFERENCE_API_BASE_URL', ''),
    referenceSuppliersPath: envValue('VITE_REFERENCE_SUPPLIERS_PATH', ''),
    referencePublicCustomersPath: envValue('VITE_REFERENCE_PUBLIC_CUSTOMERS_PATH', ''),
    referencePublicServicesPath: envValue('VITE_REFERENCE_PUBLIC_SERVICES_PATH', ''),
    referenceAnnuaireJsonUrl: envValue(
      'VITE_REFERENCE_ANNUAIRE_JSON_URL',
      import.meta.env.DEV ? DEFAULT_DEV_ANNUAIRE_JSON_URL : '',
    ),
    referenceAnnuaireXmlUrl: envValue(
      'VITE_REFERENCE_ANNUAIRE_XML_URL',
      import.meta.env.DEV ? DEFAULT_DEV_ANNUAIRE_XML_URL : '',
    ),
    clientId: envValue('VITE_CHORUS_CLIENT_ID', ''),
    clientSecret: envValue('VITE_CHORUS_CLIENT_SECRET', ''),
    scope: envValue('VITE_CHORUS_SCOPE', 'openid'),
    technicalLogin: envValue('VITE_CHORUS_TECHNICAL_LOGIN', ''),
    technicalPassword: envValue('VITE_CHORUS_TECHNICAL_PASSWORD', ''),
    connectionTestPath: envValue('VITE_CHORUS_CONNECTION_TEST_PATH', ''),
    connectionTestMethod,
    uploadFilePath: envValue('VITE_CHORUS_UPLOAD_FILE_PATH', '/v1/ajouter/fichier'),
    submitInvoicePath: envValue('VITE_CHORUS_SUBMIT_INVOICE_PATH', ''),
    userAccountPath: envValue('VITE_CHORUS_USER_ACCOUNT_PATH', DEFAULT_USER_ACCOUNT_PATH),
    userConnectionsPath: envValue('VITE_CHORUS_USER_CONNECTIONS_PATH', DEFAULT_USER_CONNECTIONS_PATH),
    submissionBridgeUrl: envValue('VITE_CHORUS_SUBMISSION_BRIDGE_URL', ''),
    submissionCurrentUserId: envValue('VITE_CHORUS_SUBMISSION_CURRENT_USER_ID', ''),
    submissionSupplierId: envValue('VITE_CHORUS_SUBMISSION_SUPPLIER_ID', '26359578'),
    submissionSupplierServiceId: envValue('VITE_CHORUS_SUBMISSION_SUPPLIER_SERVICE_ID', ''),
    submissionBankAccountCode: envValue('VITE_CHORUS_SUBMISSION_BANK_ACCOUNT_CODE', ''),
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
      envValue('VITE_CHORUS_SUBMISSION_VAT_TYPE', 'TVA_SUR_ENCAISSEMENT').toUpperCase(),
      ['AUTO', 'TVA_SUR_DEBIT', 'TVA_SUR_ENCAISSEMENT', 'EXONERATION', 'SANS_TVA'],
      'TVA_SUR_ENCAISSEMENT',
    ),
    submissionVatExonerationReason: envValue('VITE_CHORUS_SUBMISSION_VAT_EXONERATION_REASON', ''),
    submissionOriginalInvoiceNumber: envValue('VITE_CHORUS_SUBMISSION_ORIGINAL_INVOICE_NUMBER', ''),
    submissionComment: envValue('VITE_CHORUS_SUBMISSION_COMMENT', ''),
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
    return mergeConfigWithFallback(fallback, parsed);
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

    if (parsed.origin === 'https://chorus-pro.gouv.fr:5443') {
      return `${DEV_PROXY_CHORUS_QUALIF_PREFIX}${parsed.pathname}${parsed.search}`;
    }
  } catch {
    return url;
  }

  return url;
}

export function resolveChorusRuntimeConfig(config: ChorusConfig, devMode = import.meta.env.DEV): ChorusConfig {
  if (!devMode) {
    return config;
  }

  return {
    ...config,
    tokenUrl: rewriteUrlToDevProxy(config.tokenUrl),
    apiBaseUrl: rewriteUrlToDevProxy(config.apiBaseUrl),
    userAccountPath: rewriteUrlToDevProxy(config.userAccountPath),
    userConnectionsPath: rewriteUrlToDevProxy(config.userConnectionsPath),
  };
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
