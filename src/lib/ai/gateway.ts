/** Environment factory for the replaceable LLMGateway provider boundary. */
import { AIUnavailableError, type LLMGateway } from '@/lib/ai/types';
import { DEFAULT_GEMINI_FAST_MODEL, DEFAULT_GEMINI_HEAVY_MODEL, GeminiProvider } from '@/lib/ai/gemini-provider';
import {
  DEFAULT_OLLAMA_BASE_URL,
  DEFAULT_OLLAMA_FAST_MODEL,
  DEFAULT_OLLAMA_HEAVY_MODEL,
  OLLAMA_KEEP_ALIVE,
  OLLAMA_NUM_CTX,
  OllamaProvider,
  normalizeOllamaBaseUrl,
} from '@/lib/ai/ollama-provider';
import {
  DEFAULT_OPENAI_COMPATIBLE_BASE_URL,
  DEFAULT_OPENAI_COMPATIBLE_TIMEOUT_MS,
  OpenAICompatibleProvider,
} from '@/lib/ai/openai-compatible-provider';
import { ReplayProvider } from '@/lib/ai/replay-provider';
import { DEFAULT_LOCAL_RUNTIME_DEFAULTS, normalizeLoopbackBaseUrl } from '@/lib/ai/local-runtime';
import { MAX_STRUCTURED_REPAIR_RETRIES } from '@/lib/ai/pipeline/structured-output';

export type AiProviderName = 'ollama' | 'gemini' | 'replay' | 'openai_compatible' | 'manual_chat';
export type GatewayProviderName = Exclude<AiProviderName, 'manual_chat'>;

export interface ActiveAiGenerationProfile {
  baseUrl?: string;
  structuredGeneration?: {
    temperature: number;
    maxRepairRetries: number;
    timeoutMs?: number;
    numCtx?: number;
    keepAlive?: string;
  };
}

export interface ActiveAiRuntime {
  provider: AiProviderName;
  heavyModel: string;
  fastModel: string;
  runtimeLabel?: string;
  /** Non-secret effective generation settings used only for exact-input cache identity. */
  generationProfile: ActiveAiGenerationProfile;
}

function envValue(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

/** Accepted AI_PROVIDER values (case-insensitive). Unset means "ollama". */
export const ACCEPTED_AI_PROVIDER_VALUES = [
  'ollama',
  'gemini',
  'openai_compatible',
  'openai-compatible',
  'local',
  'replay',
  'manual_chat',
] as const;

/**
 * Resolve AI_PROVIDER. An unrecognised value throws AIUnavailableError (code "invalid_provider") instead of
 * silently falling back to Ollama.
 */
export function activeProviderName(): AiProviderName {
  const raw = envValue('AI_PROVIDER');
  const value = (raw ?? 'ollama').toLowerCase();
  if (value === 'ollama' || value === 'gemini' || value === 'replay' || value === 'manual_chat') return value;
  if (value === 'openai_compatible' || value === 'openai-compatible' || value === 'local') return 'openai_compatible';
  throw new AIUnavailableError(
    `AI_PROVIDER="${raw}" is not supported. Use one of: ${ACCEPTED_AI_PROVIDER_VALUES.join(', ')} ` +
      '(openai-compatible and local are aliases of openai_compatible).',
    'invalid_provider',
  );
}

const gatewayCache = new Map<GatewayProviderName, LLMGateway>();

/** One cached gateway per active provider. Manual chat deliberately has no hidden live gateway. */
export function getLLMGateway(): LLMGateway {
  const provider = activeProviderName();
  if (provider === 'manual_chat') {
    throw new AIUnavailableError(
      'Manual chat mode has no live model gateway. Export a trainer prompt package and import the validated JSON response.',
      'manual_chat',
    );
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

function structuredGenerationProfile(
  overrides: Partial<NonNullable<ActiveAiGenerationProfile['structuredGeneration']>> = {},
): NonNullable<ActiveAiGenerationProfile['structuredGeneration']> {
  return {
    temperature: DEFAULT_LOCAL_RUNTIME_DEFAULTS.temperatureByTask.structuredGeneration,
    maxRepairRetries: MAX_STRUCTURED_REPAIR_RETRIES,
    ...overrides,
  };
}

/** Active provider, models, and non-secret generation settings from local configuration only; no network calls. */
export function getActiveAiRuntime(): ActiveAiRuntime {
  const provider = activeProviderName();
  if (provider === 'replay') {
    return { provider, heavyModel: 'Demo replay', fastModel: 'Demo replay', runtimeLabel: 'Demo replay', generationProfile: {} };
  }
  if (provider === 'manual_chat') {
    return { provider, heavyModel: 'External chat import', fastModel: 'Not available', runtimeLabel: 'Manual chat', generationProfile: {} };
  }
  if (provider === 'gemini') {
    return {
      provider,
      heavyModel: envValue('GEMINI_HEAVY_MODEL') ?? DEFAULT_GEMINI_HEAVY_MODEL,
      fastModel: envValue('GEMINI_FAST_MODEL') ?? DEFAULT_GEMINI_FAST_MODEL,
      generationProfile: { structuredGeneration: structuredGenerationProfile() },
    };
  }
  if (provider === 'openai_compatible') {
    return {
      provider,
      heavyModel: envValue('OPENAI_COMPATIBLE_HEAVY_MODEL') ?? 'Not configured',
      fastModel: envValue('OPENAI_COMPATIBLE_FAST_MODEL') ?? 'Not configured',
      runtimeLabel: envValue('LOCAL_RUNTIME_LABEL') ?? 'Local AI',
      generationProfile: {
        baseUrl: normalizeLoopbackBaseUrl(envValue('OPENAI_COMPATIBLE_BASE_URL') ?? DEFAULT_OPENAI_COMPATIBLE_BASE_URL),
        structuredGeneration: structuredGenerationProfile({ timeoutMs: DEFAULT_OPENAI_COMPATIBLE_TIMEOUT_MS }),
      },
    };
  }
  return {
    provider,
    heavyModel: envValue('OLLAMA_HEAVY_MODEL') ?? DEFAULT_OLLAMA_HEAVY_MODEL,
    fastModel: envValue('OLLAMA_FAST_MODEL') ?? DEFAULT_OLLAMA_FAST_MODEL,
    runtimeLabel: 'Ollama',
    generationProfile: {
      baseUrl: normalizeOllamaBaseUrl(envValue('OLLAMA_BASE_URL') ?? DEFAULT_OLLAMA_BASE_URL),
      structuredGeneration: structuredGenerationProfile({ numCtx: OLLAMA_NUM_CTX, keepAlive: OLLAMA_KEEP_ALIVE }),
    },
  };
}
