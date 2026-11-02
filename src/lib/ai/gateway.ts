/** Environment factory for the replaceable LLMGateway provider boundary. */
import type { LLMGateway } from '@/lib/ai/types';
import { DEFAULT_GEMINI_FAST_MODEL, DEFAULT_GEMINI_HEAVY_MODEL, GeminiProvider } from '@/lib/ai/gemini-provider';
import { DEFAULT_OLLAMA_FAST_MODEL, DEFAULT_OLLAMA_HEAVY_MODEL, OllamaProvider } from '@/lib/ai/ollama-provider';
import { OpenAICompatibleProvider } from '@/lib/ai/openai-compatible-provider';
import { ReplayProvider } from '@/lib/ai/replay-provider';

export type AiProviderName = 'ollama' | 'gemini' | 'replay' | 'openai_compatible' | 'manual_chat';
export type GatewayProviderName = Exclude<AiProviderName, 'manual_chat'>;

export interface ActiveAiRuntime {
  provider: AiProviderName;
  heavyModel: string;
  fastModel: string;
  runtimeLabel?: string;
}

function envValue(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export function activeProviderName(): AiProviderName {
  const value = (envValue('AI_PROVIDER') ?? 'ollama').toLowerCase();
  if (value === 'gemini' || value === 'replay' || value === 'manual_chat') return value;
  if (value === 'openai_compatible' || value === 'openai-compatible' || value === 'local') return 'openai_compatible';
  return 'ollama';
}

const gatewayCache = new Map<GatewayProviderName, LLMGateway>();

/** One cached gateway per active provider. Manual chat deliberately has no hidden live gateway. */
export function getLLMGateway(): LLMGateway {
  const provider = activeProviderName();
  if (provider === 'manual_chat') {
    throw new Error('Manual chat mode has no live model gateway. Export a trainer prompt package and import the validated JSON response.');
  }
  const cached = gatewayCache.get(provider);
  if (cached) return cached;
  const gateway: LLMGateway =
    provider === 'gemini'
      ? new GeminiProvider()
      : provider === 'replay'
        ? new ReplayProvider()
        : provider === 'openai_compatible'
          ? new OpenAICompatibleProvider()
          : new OllamaProvider();
  gatewayCache.set(provider, gateway);
  return gateway;
}

/** Active provider and model names from local configuration only; no secrets or network calls. */
export function getActiveAiRuntime(): ActiveAiRuntime {
  const provider = activeProviderName();
  if (provider === 'replay') {
    return { provider, heavyModel: 'Demo replay', fastModel: 'Demo replay', runtimeLabel: 'Demo replay' };
  }
  if (provider === 'manual_chat') {
    return { provider, heavyModel: 'External chat import', fastModel: 'Not available', runtimeLabel: 'Manual chat' };
  }
  if (provider === 'gemini') {
    return {
      provider,
      heavyModel: envValue('GEMINI_HEAVY_MODEL') ?? DEFAULT_GEMINI_HEAVY_MODEL,
      fastModel: envValue('GEMINI_FAST_MODEL') ?? DEFAULT_GEMINI_FAST_MODEL,
    };
  }
  if (provider === 'openai_compatible') {
    return {
      provider,
      heavyModel: envValue('OPENAI_COMPATIBLE_HEAVY_MODEL') ?? 'Not configured',
      fastModel: envValue('OPENAI_COMPATIBLE_FAST_MODEL') ?? 'Not configured',
      runtimeLabel: envValue('LOCAL_RUNTIME_LABEL') ?? 'Local AI',
    };
  }
  return {
    provider,
    heavyModel: envValue('OLLAMA_HEAVY_MODEL') ?? DEFAULT_OLLAMA_HEAVY_MODEL,
    fastModel: envValue('OLLAMA_FAST_MODEL') ?? DEFAULT_OLLAMA_FAST_MODEL,
    runtimeLabel: 'Ollama',
  };
}
