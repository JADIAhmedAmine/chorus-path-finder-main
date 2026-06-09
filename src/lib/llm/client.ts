import type { LlmRuntimeConfig } from '@/lib/llm/config';

const LLM_API_TIMEOUT_MS = 15000;

interface OllamaChatResponse {
  message?: {
    content?: string;
  };
}

// Réponse OpenAI-compatible (vLLM expose /v1/chat/completions).
interface OpenAiChatResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

/**
 * Appel chat bas-niveau, provider-aware, partagé par les usages LLM (extraction,
 * analyse de rejet, …).
 *
 * - vLLM : API OpenAI → POST `{baseUrl}/chat/completions` (baseUrl finit par /v1).
 * - Ollama : API native → POST `{baseUrl}/api/chat`.
 *
 * Retourne le contenu texte de la réponse, ou `null` en cas d'échec / timeout
 * (le caller retombe alors sur son comportement de repli).
 */
export async function requestLlmCompletion(
  config: LlmRuntimeConfig,
  prompt: string,
  fetchImpl: typeof fetch = globalThis.fetch,
  timeoutMs: number = LLM_API_TIMEOUT_MS,
): Promise<string | null> {
  const baseUrl = config.baseUrl.replace(/\/+$/, '');
  const isVllm = config.provider === 'vllm';
  const requestUrl = isVllm ? `${baseUrl}/chat/completions` : `${baseUrl}/api/chat`;
  const requestBody = isVllm
    ? {
        model: config.model,
        stream: false,
        temperature: config.temperature,
        top_p: config.topP,
        max_tokens: config.maxNewTokens,
        messages: [{ role: 'user', content: prompt }],
      }
    : {
        model: config.model,
        stream: false,
        format: 'json',
        messages: [{ role: 'user', content: prompt }],
        options: {
          temperature: config.temperature,
          top_p: config.topP,
          num_predict: config.maxNewTokens,
        },
      };

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : undefined;
  const timeoutId = controller
    ? globalThis.setTimeout(() => controller.abort(), timeoutMs)
    : undefined;

  try {
    const response = await fetchImpl(requestUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      signal: controller?.signal,
      body: JSON.stringify(requestBody),
    }).finally(() => {
      if (timeoutId !== undefined) {
        globalThis.clearTimeout(timeoutId);
      }
    });

    if (!response.ok) {
      return null;
    }

    const payload = await response.json();
    const content = isVllm
      ? (payload as OpenAiChatResponse).choices?.[0]?.message?.content
      : (payload as OllamaChatResponse).message?.content;

    return content ?? null;
  } catch {
    return null;
  }
}
