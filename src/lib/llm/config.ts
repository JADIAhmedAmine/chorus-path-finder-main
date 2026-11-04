export type GenerationProvider = 'ollama' | 'vllm' | '';

export interface LlmRuntimeConfig {
  provider: GenerationProvider;
  baseUrl: string;
  model: string;
  maxNewTokens: number;
  temperature: number;
  topP: number;
}

const DEV_OLLAMA_PROXY_PREFIX = '/__gen-proxy/ollama';
const DEV_VLLM_PROXY_PREFIX = '/__gen-proxy/vllm';

function envValue(key: string, fallback = ''): string {
  const value = import.meta.env[key as keyof ImportMetaEnv];
  return typeof value === 'string' ? value : fallback;
}

function envNumber(key: string, fallback: number): number {
  const value = Number(envValue(key, String(fallback)));
  return Number.isFinite(value) ? value : fallback;
}

export function loadLlmConfig(): LlmRuntimeConfig {
  const rawProvider = envValue('GEN_PROVIDER', '').toLowerCase();
  const provider: GenerationProvider =
    rawProvider === 'ollama' ? 'ollama' : rawProvider === 'vllm' ? 'vllm' : '';

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
  if (!devMode || !config.baseUrl || (config.provider !== 'ollama' && config.provider !== 'vllm')) {
    return config;
  }

  try {
    const parsed = new URL(config.baseUrl);
    if (/^https?:$/i.test(parsed.protocol)) {
      const prefix = config.provider === 'vllm' ? DEV_VLLM_PROXY_PREFIX : DEV_OLLAMA_PROXY_PREFIX;
      return {
        ...config,
        baseUrl: `${prefix}${parsed.pathname === '/' ? '' : parsed.pathname}`,
      };
    }
  } catch {
    return config;
  }

  return config;
}

export function canUseLlmExtraction(config: LlmRuntimeConfig): boolean {
  return (config.provider === 'ollama' || config.provider === 'vllm')
    && Boolean(config.baseUrl)
    && Boolean(config.model);
}
