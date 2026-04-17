export type GenerationProvider = 'ollama' | '';

export interface LlmRuntimeConfig {
  provider: GenerationProvider;
  baseUrl: string;
  model: string;
  maxNewTokens: number;
  temperature: number;
  topP: number;
}

const DEV_OLLAMA_PROXY_PREFIX = '/__gen-proxy/ollama';

function envValue(key: string, fallback = ''): string {
  const value = import.meta.env[key as keyof ImportMetaEnv];
  return typeof value === 'string' ? value : fallback;
}

function envNumber(key: string, fallback: number): number {
  const value = Number(envValue(key, String(fallback)));
  return Number.isFinite(value) ? value : fallback;
}

export function loadLlmConfig(): LlmRuntimeConfig {
  const provider = envValue('GEN_PROVIDER', '').toLowerCase() === 'ollama' ? 'ollama' : '';

  return {
    provider,
    baseUrl: envValue('GEN_BASE_URL', ''),
    model: envValue('GEN_MODEL', ''),
    maxNewTokens: envNumber('GEN_MAX_NEW_TOKENS', 4096),
    temperature: envNumber('GEN_TEMPERATURE', 0.2),
    topP: envNumber('GEN_TOP_P', 0.9),
  };
}

export function resolveLlmRuntimeConfig(config: LlmRuntimeConfig, devMode = import.meta.env.DEV): LlmRuntimeConfig {
  if (!devMode || config.provider !== 'ollama' || !config.baseUrl) {
    return config;
  }

  try {
    const parsed = new URL(config.baseUrl);
    if (/^https?:$/i.test(parsed.protocol)) {
      return {
        ...config,
        baseUrl: `${DEV_OLLAMA_PROXY_PREFIX}${parsed.pathname === '/' ? '' : parsed.pathname}`,
      };
    }
  } catch {
    return config;
  }

  return config;
}

export function canUseLlmExtraction(config: LlmRuntimeConfig): boolean {
  return config.provider === 'ollama' && Boolean(config.baseUrl) && Boolean(config.model);
}
