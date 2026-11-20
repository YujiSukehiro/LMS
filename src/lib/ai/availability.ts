/**
 * Cached AI runtime availability.
 *
 * The full local capability preflight makes ~10 model calls and, on a single-concurrency local server, queues
 * ahead of real work. UI health polling therefore uses a cheap check (provider health + one basic chat), shares
 * one in-flight run between concurrent callers, and caches the result briefly. The full preflight only runs on
 * explicit request (GET /api/system/ai-health?full=1, npm run verify:local-ai).
 */
import type { AiHealthResponse } from '@/lib/schemas/api';
import { activeProviderName, getActiveAiRuntime, getLLMGateway, type AiProviderName } from '@/lib/ai/gateway';
import { createLocalRuntimeProfile, openAICompatibleProfileFromEnv, type LocalRuntimeProfile } from '@/lib/ai/local-runtime';
import { runLocalCapabilityPreflight, type LocalPreflightReport } from '@/lib/ai/local-preflight';
import { DEFAULT_OLLAMA_BASE_URL } from '@/lib/ai/ollama-provider';
import { isAIUnavailableError } from '@/lib/ai/types';

/** Cache lifetime for a passing cheap check. */
export const AI_AVAILABILITY_SUCCESS_TTL_MS = 60_000;
/** Cache lifetime for a failing cheap check (short, so a fixed runtime is noticed quickly). */
export const AI_AVAILABILITY_FAILURE_TTL_MS = 15_000;

export type AiAvailabilityStatus = 'ready' | 'blocked' | 'unknown' | 'not_local';

export interface AiAvailability {
  /**
   * ready: the last cheap check passed (still fresh).
   * blocked: the last cheap check failed (still fresh), or the provider can never serve live AI (manual_chat, invalid AI_PROVIDER).
   * unknown: no fresh check result; callers should proceed and let the request itself fail if it must.
   * not_local: hosted/demo provider (gemini, replay) that this cache does not track.
   */
  status: AiAvailabilityStatus;
  message: string;
  provider: string;
  checkedAt?: string;
}

interface CacheEntry {
  provider: AiProviderName;
  body: AiHealthResponse;
  checkedAt: number;
  expiresAt: number;
}

let cache: CacheEntry | null = null;
interface InFlightRun {
  promise: Promise<AiHealthResponse>;
  controller: AbortController;
  waiters: number;
}

let inFlight: InFlightRun | null = null;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'The AI health check failed. Check the selected local runtime and retry.';
}

/** The local runtime profile for the active provider, built with the same defaults the providers use. */
export function activeLocalRuntimeProfile(provider: AiProviderName = activeProviderName()): LocalRuntimeProfile | null {
  if (provider === 'openai_compatible') return openAICompatibleProfileFromEnv();
  if (provider === 'ollama') {
    const runtimeInfo = getActiveAiRuntime();
    return createLocalRuntimeProfile({
      provider: 'ollama',
      runtimeLabel: 'Ollama',
      baseUrl: process.env.OLLAMA_BASE_URL?.trim() || DEFAULT_OLLAMA_BASE_URL,
      models: { structuredGeneration: runtimeInfo.heavyModel, streamingChat: runtimeInfo.fastModel, judge: runtimeInfo.heavyModel },
    });
  }
  return null;
}

function reportToBody(report: LocalPreflightReport): AiHealthResponse {
  return {
    ok: report.status === 'ready',
    provider: report.provider,
    models: [...new Set(Object.values(report.selectedModels).filter((model): model is string => Boolean(model)))],
    status: report.status,
    runtimeLabel: report.runtimeLabel,
    capabilities: report.capabilities,
    error: report.capabilities.find((capability) => capability.status === 'failed')?.error
      ?? (report.status === 'not_configured' ? report.capabilities[0]?.nextStep : undefined),
  };
}

/** Run a health check now (no caching). `full` runs every capability; otherwise the cheap check. */
export async function runAiHealthCheck(options: { full?: boolean; signal?: AbortSignal } = {}): Promise<AiHealthResponse> {
  let provider: AiProviderName;
  try {
    provider = activeProviderName();
  } catch (error) {
    return { ok: false, provider: process.env.AI_PROVIDER?.trim() || 'unknown', models: [], status: 'blocked', error: errorText(error) };
  }
  if (provider === 'manual_chat') {
    return { ok: true, provider, models: [], status: 'manual', runtimeLabel: 'Manual chat', capabilities: [] };
  }
  const runtimeInfo = getActiveAiRuntime();
  try {
    if (provider === 'openai_compatible' || provider === 'ollama') {
      const report = await runLocalCapabilityPreflight(activeLocalRuntimeProfile(provider), getLLMGateway(), {
        mode: options.full ? 'full' : 'quick',
        signal: options.signal,
      });
      return reportToBody(report);
    }
    const health = await getLLMGateway().healthCheck();
    return {
      ...health,
      status: provider === 'replay' ? 'demo' : health.ok ? 'ready' : 'blocked',
      runtimeLabel: provider === 'replay' ? 'Demo replay' : 'Gemini',
    };
  } catch (error) {
    if (options.signal?.aborted) throw error;
    return {
      ok: false,
      provider: runtimeInfo.provider,
      models: [],
      status: 'blocked',
      runtimeLabel: runtimeInfo.runtimeLabel,
      error: errorText(error),
    };
  }
}

function freshCache(provider: AiProviderName): CacheEntry | null {
  if (!cache || cache.provider !== provider || Date.now() >= cache.expiresAt) return null;
  return cache;
}

/**
 * Cheap health check with a module-level cache and a single shared in-flight run. A caller's `signal` only
 * detaches that caller; the shared run is cancelled once every waiting caller has gone. Cancelled runs are not cached.
 */
export async function getCachedAiHealth(options: { signal?: AbortSignal; forceRefresh?: boolean } = {}): Promise<AiHealthResponse> {
  let provider: AiProviderName;
  try {
    provider = activeProviderName();
  } catch (error) {
    return { ok: false, provider: process.env.AI_PROVIDER?.trim() || 'unknown', models: [], status: 'blocked', error: errorText(error) };
  }
  const fresh = options.forceRefresh ? null : freshCache(provider);
  if (fresh) return fresh.body;

  if (!inFlight) {
    const controller = new AbortController();
    const run: InFlightRun = {
      controller,
      waiters: 0,
      promise: runAiHealthCheck({ signal: controller.signal })
        .then((body) => {
          const checkedAt = Date.now();
          const ok = body.status === 'ready' || body.status === 'demo' || body.status === 'manual';
          cache = {
            provider,
            body,
            checkedAt,
            expiresAt: checkedAt + (ok ? AI_AVAILABILITY_SUCCESS_TTL_MS : AI_AVAILABILITY_FAILURE_TTL_MS),
          };
          return body;
        })
        .finally(() => {
          if (inFlight === run) inFlight = null;
        }),
    };
    // Waiters attach their own handlers, but a run aborted before any handler is attached (for example a caller
    // whose signal was already aborted) must not surface as an unhandledRejection.
    run.promise.catch(() => undefined);
    inFlight = run;
  }

  const run = inFlight;
  run.waiters += 1;
  const signal = options.signal;
  if (!signal) {
    try {
      return await run.promise;
    } finally {
      run.waiters -= 1;
    }
  }
  return new Promise<AiHealthResponse>((resolve, reject) => {
    let settled = false;
    const detach = () => {
      if (settled) return;
      settled = true;
      run.waiters -= 1;
      signal.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      detach();
      if (run.waiters <= 0) {
        run.controller.abort();
        if (inFlight === run) inFlight = null;
      }
      reject(new Error('AI health check request was cancelled.'));
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
    run.promise.then(
      (body) => {
        detach();
        resolve(body);
      },
      (error: unknown) => {
        detach();
        reject(error);
      },
    );
  });
}

/**
 * Synchronous, network-free view of the cached cheap check, for routes that must refuse to start live AI work
 * (for example, starting a Simulation) when the runtime is known to be blocked. Returns "unknown" when there is
 * no fresh result; it never triggers a check. Use `refreshAiAvailability()` to force one.
 */
export function getCachedAiAvailability(): AiAvailability {
  let provider: AiProviderName;
  try {
    provider = activeProviderName();
  } catch (error) {
    return { status: 'blocked', message: errorText(error), provider: process.env.AI_PROVIDER?.trim() || 'unknown' };
  }
  if (provider === 'manual_chat') {
    return {
      status: 'blocked',
      message: 'Manual chat mode has no live model gateway. Export a trainer prompt package and import the validated JSON response.',
      provider,
    };
  }
  if (provider === 'gemini' || provider === 'replay') {
    return { status: 'not_local', message: `${provider === 'replay' ? 'Demo replay' : 'Gemini'} is not tracked by the local health cache.`, provider };
  }
  const fresh = freshCache(provider);
  if (!fresh) return { status: 'unknown', message: 'No recent AI health check result is available.', provider };
  return availabilityFromBody(provider, fresh.body, fresh.checkedAt);
}

function availabilityFromBody(provider: AiProviderName, body: AiHealthResponse, checkedAt: number): AiAvailability {
  const at = new Date(checkedAt).toISOString();
  if (body.status === 'ready' || body.status === 'degraded') {
    return { status: 'ready', message: `${body.runtimeLabel ?? provider} passed its health check.`, provider, checkedAt: at };
  }
  return {
    status: 'blocked',
    message: body.error ?? `${body.runtimeLabel ?? provider} failed its health check. Check the local AI runtime and retry.`,
    provider,
    checkedAt: at,
  };
}

/** Force a cheap check (shared with any in-flight one) and return the resulting availability. */
export async function refreshAiAvailability(signal?: AbortSignal): Promise<AiAvailability> {
  await getCachedAiHealth({ signal, forceRefresh: true });
  return getCachedAiAvailability();
}

/** Record a live failure (for example AIUnavailableError from a provider) so the cache reflects it immediately. */
export function noteAiUnavailable(error: unknown): void {
  if (!isAIUnavailableError(error)) return;
  let provider: AiProviderName;
  try {
    provider = activeProviderName();
  } catch {
    return;
  }
  const checkedAt = Date.now();
  cache = {
    provider,
    body: { ok: false, provider, models: [], status: 'blocked', error: error.message },
    checkedAt,
    expiresAt: checkedAt + AI_AVAILABILITY_FAILURE_TTL_MS,
  };
}

/** Test helper. */
export function resetAiAvailabilityCache(): void {
  cache = null;
  inFlight = null;
}
