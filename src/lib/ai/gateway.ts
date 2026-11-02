/**
 * Environment factory for the LLMGateway (AI_PROVIDER=ollama | gemini).
 */
import type { LLMGateway } from '@/lib/ai/types';
import { DEFAULT_GEMINI_FAST_MODEL, DEFAULT_GEMINI_HEAVY_MODEL, GeminiProvider } from '@/lib/ai/gemini-provider';
import { DEFAULT_OLLAMA_FAST_MODEL, DEFAULT_OLLAMA_HEAVY_MODEL, OllamaProvider } from '@/lib/ai/ollama-provider';
import { ReplayProvider } from '@/lib/ai/replay-provider';

export type AiProviderName = 'ollama' | 'gemini' | 'replay';

export interface ActiveAiRuntime {
  provider: 'ollama' | 'gemini';
  heavyModel: string;
  fastModel: string;
}

function envValue(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function activeProviderName(): AiProviderName {
  const value = (envValue('AI_PROVIDER') ?? 'ollama').toLowerCase();
  if (value === 'gemini' || value === 'replay') return value;
  return 'ollama';
}

const gatewayCache = new Map<AiProviderName, LLMGateway>();

/** The LLMGateway for the active provider. One instance per provider for the process lifetime. */
export function getLLMGateway(): LLMGateway {
  const provider = activeProviderName();
  const cached = gatewayCache.get(provider);
  if (cached) return cached;
  const gateway: LLMGateway =
    provider === 'gemini' ? new GeminiProvider() : provider === 'replay' ? new ReplayProvider() : new OllamaProvider();
  gatewayCache.set(provider, gateway);
  return gateway;
}

/** Active provider and model names from the environment only (no network call). */
export function getActiveAiRuntime(): ActiveAiRuntime {
  const provider = activeProviderName();
  // The demo replay stand-in shows the Gemini models it imitates.
  if (provider === 'gemini' || provider === 'replay') {
    return {
      provider: 'gemini',
      heavyModel: envValue('GEMINI_HEAVY_MODEL') ?? DEFAULT_GEMINI_HEAVY_MODEL,
      fastModel: envValue('GEMINI_FAST_MODEL') ?? DEFAULT_GEMINI_FAST_MODEL,
    };
  }
  return {
    provider,
    heavyModel: envValue('OLLAMA_HEAVY_MODEL') ?? DEFAULT_OLLAMA_HEAVY_MODEL,
    fastModel: envValue('OLLAMA_FAST_MODEL') ?? DEFAULT_OLLAMA_FAST_MODEL,
  };
}
