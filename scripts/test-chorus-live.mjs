import fs from 'node:fs';
import path from 'node:path';

function parseEnvFile(content) {
  const env = {};

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    env[key] = value;
  }

  return env;
}

function envValue(env, key, fallback = '') {
  return typeof env[key] === 'string' ? env[key] : fallback;
}

function envBool(env, key, fallback) {
  const value = envValue(env, key, String(fallback));
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function joinUrl(baseUrl, nextPath) {
  if (!nextPath) {
    return baseUrl;
  }

  if (/^https?:\/\//i.test(nextPath)) {
    return nextPath;
  }

  const safeBase = baseUrl.replace(/\/+$/, '');
  const safePath = nextPath.replace(/^\/+/, '');
  return safeBase ? `${safeBase}/${safePath}` : `/${safePath}`;
}

async function parseResponseBody(response) {
  const contentType = response.headers.get('content-type') ?? '';

  if (contentType.includes('application/json')) {
    return response.json();
  }

  return response.text();
}

function summarizeBody(body) {
  if (body == null) {
    return 'empty response body';
  }

  if (typeof body === 'string') {
    const compact = body.replace(/\s+/g, ' ').trim();
    return compact ? `text: ${compact.slice(0, 240)}` : 'empty text body';
  }

  if (Array.isArray(body)) {
    return `array(${body.length})`;
  }

  if (typeof body === 'object') {
    const keys = Object.keys(body);
    return keys.length > 0 ? `object keys: ${keys.slice(0, 12).join(', ')}` : 'empty object';
  }

  return String(body);
}

function basicAuthValue(login, password) {
  const raw = `${login}:${password}`;

  if (typeof globalThis.btoa === 'function') {
    return globalThis.btoa(raw);
  }

  return Buffer.from(raw, 'utf8').toString('base64');
}

function readConfig() {
  const envPath = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) {
    throw new Error(`Fichier ${envPath} introuvable.`);
  }

  const env = parseEnvFile(fs.readFileSync(envPath, 'utf8'));
  const mode = envValue(env, 'VITE_CHORUS_MODE', 'mock') === 'direct' ? 'direct' : 'mock';
  const connectionTestMethod = envValue(env, 'VITE_CHORUS_CONNECTION_TEST_METHOD', 'GET').toUpperCase() === 'POST'
    ? 'POST'
    : 'GET';

  return {
    enabled: envBool(env, 'VITE_CHORUS_ENABLED', mode === 'direct'),
    mode,
    tokenUrl: envValue(env, 'VITE_CHORUS_TOKEN_URL', 'https://sandbox-oauth.aife.economie.gouv.fr/api/oauth/token'),
    apiBaseUrl: envValue(env, 'VITE_CHORUS_API_BASE_URL', ''),
    clientId: envValue(env, 'VITE_CHORUS_CLIENT_ID', ''),
    clientSecret: envValue(env, 'VITE_CHORUS_CLIENT_SECRET', ''),
    scope: envValue(env, 'VITE_CHORUS_SCOPE', 'openid'),
    technicalLogin: envValue(env, 'VITE_CHORUS_TECHNICAL_LOGIN', ''),
    technicalPassword: envValue(env, 'VITE_CHORUS_TECHNICAL_PASSWORD', ''),
    connectionTestPath: envValue(env, 'VITE_CHORUS_CONNECTION_TEST_PATH', ''),
    connectionTestMethod,
    uploadFilePath: envValue(env, 'VITE_CHORUS_UPLOAD_FILE_PATH', ''),
    submitInvoicePath: envValue(env, 'VITE_CHORUS_SUBMIT_INVOICE_PATH', ''),
  };
}

function validateConfig(config) {
  const missing = [];

  if (!config.enabled) missing.push('VITE_CHORUS_ENABLED=true');
  if (config.mode !== 'direct') missing.push('VITE_CHORUS_MODE=direct');
  if (!config.tokenUrl) missing.push('VITE_CHORUS_TOKEN_URL');
  if (!config.clientId) missing.push('VITE_CHORUS_CLIENT_ID');
  if (!config.clientSecret) missing.push('VITE_CHORUS_CLIENT_SECRET');

  if (missing.length > 0) {
    throw new Error(`Configuration live incomplète: ${missing.join(', ')}`);
  }
}

async function main() {
  const config = readConfig();
  validateConfig(config);

  console.log('Chorus live smoke test');
  console.log(`- mode: ${config.mode}`);
  console.log(`- enabled: ${config.enabled}`);
  console.log(`- connection test: ${config.connectionTestMethod} ${config.connectionTestPath || '(token only)'}`);

  const tokenParams = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: config.clientId,
    client_secret: config.clientSecret,
    scope: config.scope || 'openid',
  });

  const tokenResponse = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: tokenParams.toString(),
    signal: AbortSignal.timeout(30000),
  });

  const tokenBody = await parseResponseBody(tokenResponse);
  if (!tokenResponse.ok) {
    throw new Error(`OAuth2 KO (${tokenResponse.status}): ${summarizeBody(tokenBody)}`);
  }

  const token = tokenBody && typeof tokenBody === 'object' ? tokenBody.access_token : undefined;
  if (typeof token !== 'string' || !token) {
    throw new Error('OAuth2 KO: access_token absent dans la reponse.');
  }

  console.log(`- OAuth2 OK (${tokenResponse.status})`);

  if (!config.connectionTestPath) {
    console.log('Aucun endpoint de test configure, le token OAuth2 a bien ete recupere.');
    return;
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  };

  if (config.technicalLogin && config.technicalPassword) {
    headers['cpro-account'] = basicAuthValue(config.technicalLogin, config.technicalPassword);
  }

  if (config.connectionTestMethod === 'POST') {
    headers['content-type'] = 'application/json';
  }

  const response = await fetch(joinUrl(config.apiBaseUrl, config.connectionTestPath), {
    method: config.connectionTestMethod,
    headers,
    body: config.connectionTestMethod === 'POST' ? '{}' : undefined,
    signal: AbortSignal.timeout(30000),
  });

  const responseBody = await parseResponseBody(response);
  if (!response.ok) {
    throw new Error(`API KO (${response.status}): ${summarizeBody(responseBody)}`);
  }

  console.log(`- API OK (${response.status})`);
  console.log(`- response: ${summarizeBody(responseBody)}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Echec du test live Chorus: ${message}`);
  process.exitCode = 1;
});
