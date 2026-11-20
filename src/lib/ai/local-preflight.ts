import { z } from 'zod';
import type { LLMGateway, ModelTier, StreamChatOptions } from '@/lib/ai/types';
import {
  LocalRuntimeProfileSchema,
  type CapabilityResult,
  type LocalCapability,
  type LocalRuntimeProfile,
} from '@/lib/ai/local-runtime';

export type LocalPreflightStatus = 'ready' | 'degraded' | 'blocked' | 'not_configured';

export interface LocalPreflightReport {
  profileId: string;
  provider: 'openai_compatible' | 'ollama';
  runtimeLabel?: string;
  baseUrl?: string;
  selectedModels: LocalRuntimeProfile['models'];
  status: LocalPreflightStatus;
  capabilities: CapabilityResult[];
  startedAt: string;
  completedAt: string;
}

export interface LocalPreflightOptions {
  heavyMaxOutputTokens?: number;
  cancellationDelayMs?: number;
  now?: () => Date;
  /**
   * "full" (default) exercises every capability (~10 model calls). "quick" runs only availability + basic chat
   * (cheap enough for UI health polling); the remaining capabilities are reported as not_tested.
   */
  mode?: 'full' | 'quick';
  /** Aborts in-flight checks; the preflight then rejects instead of returning a partial report. */
  signal?: AbortSignal;
}

type ChatGateway = LLMGateway & {
  generateChat?: (opts: StreamChatOptions) => Promise<string>;
  /** Optional: providers with an internal limiter expose its state so preflight can report queue leaks. */
  runtimeQueueState?: () => { active: number; pending: number };
};

interface ProviderHints {
  notConfigured: string;
  availability: string;
  basicChat: string;
  streaming: string;
  noStreamingModel: string;
  noStructuredModel: string;
}

/** Failure hints name the endpoints and environment variables of the provider actually being checked. */
export function preflightHintsFor(provider: LocalRuntimeProfile['provider'] | undefined): ProviderHints {
  if (provider === 'ollama') {
    return {
      notConfigured: 'Set OLLAMA_BASE_URL (default http://127.0.0.1:11434), OLLAMA_HEAVY_MODEL, and OLLAMA_FAST_MODEL, then rerun preflight.',
      availability:
        'Start Ollama ("ollama serve"), confirm OLLAMA_HEAVY_MODEL/OLLAMA_FAST_MODEL are installed ("ollama list") and report the "completion" capability ("ollama show <model>"), then rerun preflight.',
      basicChat: 'Select a chat-capable Ollama model (capabilities include "completion") and verify that POST /api/chat returns assistant text.',
      streaming: 'Verify NDJSON streaming from POST /api/chat on OLLAMA_FAST_MODEL.',
      noStreamingModel: 'Set OLLAMA_FAST_MODEL to an installed chat model, then rerun preflight.',
      noStructuredModel: 'Set OLLAMA_HEAVY_MODEL to an installed chat model that can produce nested JSON, then rerun preflight.',
    };
  }
  return {
    notConfigured: 'Set OPENAI_COMPATIBLE_BASE_URL, OPENAI_COMPATIBLE_HEAVY_MODEL, and OPENAI_COMPATIBLE_FAST_MODEL, then rerun preflight.',
    availability:
      'Start the loopback server (for MLX: ./mlx-runtime/start.sh), check OPENAI_COMPATIBLE_BASE_URL and the selected chat models, and rerun preflight.',
    basicChat: 'Select a chat-capable local model and verify that /v1/chat/completions returns assistant text.',
    streaming: 'Verify SSE streaming support, including fragmented events and [DONE], on the selected fast chat model.',
    noStreamingModel: 'Set OPENAI_COMPATIBLE_FAST_MODEL to a chat model with SSE support, then rerun preflight.',
    noStructuredModel: 'Set OPENAI_COMPATIBLE_HEAVY_MODEL to a model that can produce nested JSON, then rerun preflight.',
  };
}

const QUICK_MODE_NEXT_STEP = 'Run the full preflight (GET /api/system/ai-health?full=1 or npm run verify:local-ai) to test this capability.';

const ALL_CAPABILITIES: LocalCapability[] = [
  'availability',
  'basic_chat',
  'streaming_chat',
  'structured_output',
  'heavy_generation',
  'judge_evidence',
  'cancellation_timeout',
  'concurrency',
];

const NestedStructuredSchema = z.object({
  status: z.literal('ready'),
  course: z.object({
    title: z.string().min(1),
    modules: z
      .array(
        z.object({
          title: z.string().min(1),
          objectives: z.array(z.string().min(1)).min(1),
        }),
      )
      .min(1),
  }),
});

const HeavyGenerationSchema = z.object({
  trackTitle: z.string().min(1),
  stage: z.literal('curriculum_draft'),
  summary: z.string().min(20),
  units: z
    .array(
      z.object({
        title: z.string().min(1),
        estimatedMinutes: z.number().int().positive(),
        objectives: z.array(z.string().min(1)).min(2),
        sourceEvidence: z
          .array(z.object({ sourceId: z.string().min(1), excerpt: z.string().min(1) }))
          .min(1),
      }),
    )
    .min(2),
  trainerNotes: z.array(z.string().min(1)).min(1),
});

const JudgeEvidenceSchema = z.object({
  verdict: z.enum(['pass', 'needs_coaching', 'insufficient_evidence']),
  findings: z
    .array(
      z.object({
        criterion: z.string().min(1),
        assessment: z.string().min(1),
        evidenceIds: z.array(z.string().min(1)).min(1),
      }),
    )
    .min(1),
});

const HEAVY_PROMPT = `Create a realistic two-unit curriculum draft for a synthetic medication-support training track.
Use only these synthetic source excerpts:
SOURCE syn-policy-1: "The learner verifies the synthetic order reference before discussing next steps."
SOURCE syn-policy-2: "The learner offers the approved practice portal walkthrough and never confirms a real account change."
Return trackTitle, stage="curriculum_draft", a substantive summary, exactly two units, and trainerNotes.
Each unit needs estimatedMinutes, at least two objectives, and sourceEvidence containing the matching sourceId and a short exact excerpt.
All names and scenarios must remain synthetic. Return JSON only.`;

const JUDGE_TRANSCRIPT = `Synthetic transcript:
turn_1 (learner): "I will verify the practice order reference first."
turn_2 (learner): "I have not made any real account change."
Approved criterion: verification. Judge only the stated criterion and cite the supplied turn IDs.`;

function messageOf(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, ' ').slice(0, 600);
}

/** Thrown by withTimeout: the request did not finish in time (slow or queued), as opposed to failing. */
export class CapabilityTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CapabilityTimeoutError';
  }
}

async function withTimeout<T>(
  timeoutMs: number,
  task: (signal: AbortSignal) => Promise<T>,
  externalSignal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  let rejectCancelled: (error: Error) => void = () => undefined;
  const cancelled = new Promise<never>((_resolve, reject) => {
    rejectCancelled = reject;
  });
  cancelled.catch(() => undefined);
  const onAbort = () => {
    controller.abort();
    rejectCancelled(new Error('Local preflight was cancelled.'));
  };
  externalSignal?.addEventListener('abort', onAbort, { once: true });
  if (externalSignal?.aborted) onAbort();
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new CapabilityTimeoutError(`Capability request timed out after ${timeoutMs} ms. Check local server load and the configured task timeout.`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([task(controller.signal), timeout, cancelled]);
  } finally {
    clearTimeout(timer!);
    externalSignal?.removeEventListener('abort', onAbort);
  }
}

async function collectStream(gateway: LLMGateway, opts: StreamChatOptions): Promise<string> {
  let output = '';
  for await (const token of gateway.streamChat(opts)) output += token;
  if (!output.trim()) throw new Error('The selected model returned an empty chat stream. Select a chat-capable model and retry.');
  return output;
}

async function basicChatText(gateway: ChatGateway, opts: StreamChatOptions): Promise<string> {
  if (gateway.generateChat) {
    const output = await gateway.generateChat(opts);
    if (!output.trim()) throw new Error('The selected model returned empty chat text. Select a chat-capable model and retry.');
    return output;
  }
  return collectStream(gateway, opts);
}

function timeoutFor(profile: LocalRuntimeProfile, task: string, fallback: number): number {
  return profile.defaults.timeoutMsByTask[task] ?? fallback;
}

function temperatureFor(profile: LocalRuntimeProfile, task: string, fallback: number): number {
  return profile.defaults.temperatureByTask[task] ?? fallback;
}

function emptyModels(): LocalRuntimeProfile['models'] {
  return {};
}

/**
 * Exercise real gateway capabilities without model discovery, hosted fallback, or provider-specific prompts.
 * The report contains timings and sizes only; generated text and prompts are never copied into it.
 */
export async function runLocalCapabilityPreflight(
  profile: LocalRuntimeProfile | null,
  gateway?: LLMGateway,
  options: LocalPreflightOptions = {},
): Promise<LocalPreflightReport> {
  const now = options.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const results = new Map<LocalCapability, CapabilityResult>();
  const validProfile = profile ? LocalRuntimeProfileSchema.parse(profile) : null;
  const hints = preflightHintsFor(validProfile?.provider);
  const externalSignal = options.signal;
  const checkAborted = () => {
    if (externalSignal?.aborted) throw new Error('Local preflight was cancelled.');
  };
  const chatGateway = gateway as ChatGateway | undefined;
  const queueItems = () => {
    const state = chatGateway?.runtimeQueueState?.();
    return state ? state.active + state.pending : 0;
  };
  const BUSY_NEXT_STEP = 'The local runtime is serving other requests (one at a time). Live calls keep working; the check reruns shortly.';

  const recordNotTested = (capability: LocalCapability, error: string, nextStep: string, model?: string) => {
    results.set(capability, { capability, status: 'not_tested', model, latencyMs: 0, error, nextStep });
  };

  const finalize = (forcedStatus?: LocalPreflightStatus): LocalPreflightReport => {
    for (const capability of ALL_CAPABILITIES) {
      if (!results.has(capability)) {
        recordNotTested(capability, 'This capability was not tested.', 'Configure the corresponding model role and rerun local preflight.');
      }
    }
    const capabilities = ALL_CAPABILITIES.map((capability) => results.get(capability) as CapabilityResult);
    let status = forcedStatus;
    if (!status) {
      const availability = results.get('availability');
      const basic = results.get('basic_chat');
      if (availability?.status === 'failed' || basic?.status === 'failed') status = 'blocked';
      else if (capabilities.some((result) => result.status !== 'passed')) status = 'degraded';
      else status = 'ready';
    }
    return {
      profileId: validProfile?.id ?? 'openai-compatible-local',
      provider: validProfile?.provider ?? 'openai_compatible',
      runtimeLabel: validProfile?.runtimeLabel,
      baseUrl: validProfile?.baseUrl,
      selectedModels: validProfile?.models ?? emptyModels(),
      status,
      capabilities,
      startedAt,
      completedAt: now().toISOString(),
    };
  };

  if (!validProfile || !gateway) {
    recordNotTested(
      'availability',
      'No local runtime profile is configured.',
      hints.notConfigured,
    );
    return finalize('not_configured');
  }

  const configuredModels = [...new Set(Object.values(validProfile.models).filter((model): model is string => Boolean(model)))];
  if (configuredModels.length === 0) {
    recordNotTested(
      'availability',
      'The local runtime profile has no selected models.',
      hints.notConfigured,
    );
    return finalize('not_configured');
  }

  const execute = async (
    capability: LocalCapability,
    model: string | undefined,
    nextStep: string,
    timeoutMs: number,
    task: (signal: AbortSignal) => Promise<{ outputChars?: number; details?: CapabilityResult['details'] } | number | void>,
  ): Promise<boolean | 'busy'> => {
    checkAborted();
    const started = Date.now();
    try {
      const outcome = await withTimeout(
        timeoutMs,
        async (signal) => {
          const value = await task(signal);
          return typeof value === 'number' ? { outputChars: value } : value ?? {};
        },
        externalSignal,
      );
      results.set(capability, {
        capability,
        status: 'passed',
        model,
        latencyMs: Date.now() - started,
        outputChars: outcome.outputChars,
        details: outcome.details,
        lastSuccessAt: now().toISOString(),
      });
      return true;
    } catch (error) {
      checkAborted();
      // A slow answer (queued behind other work in this process or on the server) is not a broken runtime:
      // in the quick check it must never be cached as "blocked" and refuse every learner's call.
      if (options.mode === 'quick' && (error instanceof CapabilityTimeoutError || queueItems() > 0)) {
        results.set(capability, { capability, status: 'not_tested', model, latencyMs: Date.now() - started, error: messageOf(error), nextStep: BUSY_NEXT_STEP });
        return 'busy';
      }
      results.set(capability, {
        capability,
        status: 'failed',
        model,
        latencyMs: Date.now() - started,
        error: messageOf(error),
        nextStep,
      });
      return false;
    }
  };

  // Quick check while this process already has requests in the single slot: do not queue behind them.
  if (options.mode === 'quick' && queueItems() > 0) {
    recordNotTested('availability', `The local runtime is busy (${queueItems()} request(s) in flight or waiting); it was not re-tested.`, BUSY_NEXT_STEP);
    recordNotTested('basic_chat', 'Not tested while the local runtime is busy.', BUSY_NEXT_STEP);
    for (const capability of ALL_CAPABILITIES) {
      if (!results.has(capability)) recordNotTested(capability, 'Skipped by the quick health check.', QUICK_MODE_NEXT_STEP);
    }
    return finalize('degraded');
  }

  const availabilityOk = await execute(
    'availability',
    configuredModels.join(', '),
    hints.availability,
    timeoutFor(validProfile, 'availability', 30_000),
    async () => {
      const health = await gateway.healthCheck();
      if (!health.ok) throw new Error(health.error ?? 'The local provider failed its real chat health check.');
    },
  );
  if (availabilityOk === 'busy') return finalize('degraded');
  if (!availabilityOk) {
    return finalize('blocked');
  }

  const basicModel = validProfile.models.streamingChat ?? validProfile.models.structuredGeneration ?? validProfile.models.judge;
  const basicTier: ModelTier = basicModel === validProfile.models.streamingChat ? 'fast' : 'heavy';
  const basicOk = await execute(
    'basic_chat',
    basicModel,
    hints.basicChat,
    timeoutFor(validProfile, 'basicChat', 30_000),
    async (signal) =>
      basicChatText(gateway, {
        tier: basicTier,
        messages: [{ role: 'user', content: 'Reply with exactly READY.' }],
        temperature: temperatureFor(validProfile, 'basicChat', 0),
        maxOutputTokens: 16,
        signal,
      }).then((output) => output.length),
  );
  if (basicOk === 'busy') {
    for (const capability of ALL_CAPABILITIES) {
      if (!results.has(capability)) recordNotTested(capability, 'Skipped by the quick health check.', QUICK_MODE_NEXT_STEP);
    }
    return finalize('degraded');
  }
  if (!basicOk) return finalize('blocked');

  if (options.mode === 'quick') {
    for (const capability of ALL_CAPABILITIES) {
      if (!results.has(capability)) recordNotTested(capability, 'Skipped by the quick health check.', QUICK_MODE_NEXT_STEP);
    }
    return finalize('ready');
  }

  if (validProfile.models.streamingChat) {
    await execute(
      'streaming_chat',
      validProfile.models.streamingChat,
      hints.streaming,
      timeoutFor(validProfile, 'streamingChat', 60_000),
      async (signal) =>
        collectStream(gateway, {
          tier: 'fast',
          messages: [{ role: 'user', content: 'In one short sentence, describe a synthetic practice call.' }],
          temperature: temperatureFor(validProfile, 'streamingChat', 0.6),
          maxOutputTokens: 96,
          signal,
        }).then((output) => output.length),
    );
  } else {
    recordNotTested(
      'streaming_chat',
      'No streaming chat model is configured.',
      hints.noStreamingModel,
    );
  }

  if (validProfile.models.structuredGeneration) {
    await execute(
      'structured_output',
      validProfile.models.structuredGeneration,
      'Check JSON-only output and the shared Zod repair loop; native response_format and tools are not required.',
      timeoutFor(validProfile, 'structuredGeneration', 90_000),
      async (signal) => {
        const output = await gateway.generateStructured({
          tier: 'heavy',
          systemPrompt: 'You produce schema-valid synthetic curriculum JSON only.',
          userPrompt: 'Return status="ready" and a course titled "Synthetic Practice" with one module titled "Verification" and one objective.',
          schema: NestedStructuredSchema,
          schemaName: 'LocalPreflightNestedStructured',
          temperature: temperatureFor(validProfile, 'structuredGeneration', 0.2),
          maxOutputTokens: 500,
          signal,
        });
        return JSON.stringify(output).length;
      },
    );

    await execute(
      'heavy_generation',
      validProfile.models.structuredGeneration,
      'Check context and output budgets, then retry with a smaller curriculum stage if the model cannot complete this draft.',
      timeoutFor(validProfile, 'heavyGeneration', 180_000),
      async (signal) => {
        const estimatedPromptTokens = Math.ceil(HEAVY_PROMPT.length / 4);
        const contextBudget = validProfile.defaults.contextBudgetByTask.heavyGeneration ?? 16_384;
        if (estimatedPromptTokens > contextBudget) {
          throw new Error(`The heavy preflight prompt needs approximately ${estimatedPromptTokens} tokens but the configured context budget is ${contextBudget}.`);
        }
        const maxOutputTokens = options.heavyMaxOutputTokens ?? 1_200;
        const output = await gateway.generateStructured({
          tier: 'heavy',
          systemPrompt: 'You create grounded synthetic curriculum. Return JSON only and cite only supplied source IDs.',
          userPrompt: HEAVY_PROMPT,
          schema: HeavyGenerationSchema,
          schemaName: 'LocalPreflightHeavyCurriculum',
          temperature: temperatureFor(validProfile, 'heavyGeneration', 0.2),
          maxOutputTokens,
          signal,
        });
        return {
          outputChars: JSON.stringify(output).length,
          details: { estimatedPromptTokens, contextBudget, maxOutputTokens, budgetStatus: 'within_budget' },
        };
      },
    );
  } else {
    for (const capability of ['structured_output', 'heavy_generation'] as const) {
      recordNotTested(
        capability,
        'No structured generation model is configured.',
        hints.noStructuredModel,
      );
    }
  }

  if (validProfile.models.judge) {
    await execute(
      'judge_evidence',
      validProfile.models.judge,
      'Use the synthetic golden transcript, require known evidence IDs, and inspect judge output before enabling assessed use.',
      timeoutFor(validProfile, 'judge', 90_000),
      async (signal) => {
        const output = await gateway.generateStructured({
          tier: 'heavy',
          systemPrompt: 'You are a cautious coaching judge. Every finding must cite supplied evidence IDs; never invent them.',
          userPrompt: JUDGE_TRANSCRIPT,
          schema: JudgeEvidenceSchema,
          schemaName: 'LocalPreflightJudgeEvidence',
          temperature: temperatureFor(validProfile, 'judge', 0.1),
          maxOutputTokens: 500,
          signal,
        });
        const allowedEvidence = new Set(['turn_1', 'turn_2']);
        const references = output.findings.flatMap((finding) => finding.evidenceIds);
        if (references.some((id) => !allowedEvidence.has(id))) {
          throw new Error('The judge returned an evidence reference outside the golden transcript. Judge assistance remains blocked.');
        }
        return JSON.stringify(output).length;
      },
    );
  } else {
    recordNotTested(
      'judge_evidence',
      'No judge model is configured.',
      'Configure a judge role model and rerun the golden evidence check before enabling judge assistance.',
    );
  }

  checkAborted();
  const cancellationStarted = Date.now();
  const cancellationController = new AbortController();
  const cancellationDelayMs = options.cancellationDelayMs ?? 25;
  const cancellationTimer = setTimeout(() => cancellationController.abort(), cancellationDelayMs);
  try {
    await basicChatText(gateway, {
      tier: basicTier,
      messages: [{ role: 'user', content: 'Write a long synthetic training explanation.' }],
      temperature: 0.2,
      maxOutputTokens: 512,
      signal: cancellationController.signal,
    });
    results.set('cancellation_timeout', {
      capability: 'cancellation_timeout',
      status: 'failed',
      model: basicModel,
      latencyMs: Date.now() - cancellationStarted,
      error: 'A controlled request completed instead of observing cancellation.',
      nextStep: 'Verify that the local adapter propagates AbortSignal through queued requests, fetch, and stream reads.',
    });
  } catch (error) {
    const cancelled = cancellationController.signal.aborted && /abort|cancel/i.test(messageOf(error));
    results.set('cancellation_timeout', {
      capability: 'cancellation_timeout',
      status: cancelled ? 'passed' : 'failed',
      model: basicModel,
      latencyMs: Date.now() - cancellationStarted,
      details: cancelled ? { cancellationDelayMs, queueItemsAfterAbort: queueItems() } : undefined,
      lastSuccessAt: cancelled ? now().toISOString() : undefined,
      error: cancelled ? undefined : messageOf(error),
      nextStep: cancelled ? undefined : 'Verify AbortSignal propagation and ensure cancellation releases the local concurrency slot.',
    });
  } finally {
    clearTimeout(cancellationTimer);
  }

  // Concurrency: issue two streaming requests at once straight through the gateway (no preflight-side limiter)
  // and measure real overlap: a request counts as active from its first streamed token until its stream ends.
  // A gateway that serializes local work never has two streams producing tokens at the same time.
  checkAborted();
  const concurrencyStarted = Date.now();
  let streaming = 0;
  let maxObserved = 0;
  try {
    const outputs = await Promise.all(
      [0, 1].map((index) =>
        withTimeout(
          timeoutFor(validProfile, 'concurrency', 60_000),
          async (signal) => {
            let started = false;
            let output = '';
            try {
              for await (const token of gateway.streamChat({
                tier: basicTier,
                messages: [{ role: 'user', content: `Return one short synthetic concurrency check sentence (${index + 1}).` }],
                temperature: 0,
                maxOutputTokens: 48,
                signal,
              })) {
                if (!started) {
                  started = true;
                  streaming += 1;
                  maxObserved = Math.max(maxObserved, streaming);
                }
                output += token;
              }
            } finally {
              if (started) streaming -= 1;
            }
            if (!output.trim()) throw new Error('The selected model returned an empty chat stream during the concurrency check.');
            return output;
          },
          externalSignal,
        ),
      ),
    );
    const passed = maxObserved <= validProfile.defaults.maxConcurrency;
    results.set('concurrency', {
      capability: 'concurrency',
      status: passed ? 'passed' : 'failed',
      model: basicModel,
      latencyMs: Date.now() - concurrencyStarted,
      outputChars: outputs.reduce((sum, output) => sum + output.length, 0),
      details: { configuredLimit: validProfile.defaults.maxConcurrency, maxObserved, queueItemsAfterRun: queueItems() },
      lastSuccessAt: passed ? now().toISOString() : undefined,
      error: passed ? undefined : `Observed ${maxObserved} overlapping generations with a configured limit of ${validProfile.defaults.maxConcurrency}.`,
      nextStep: passed ? undefined : 'Route all local generation through LocalRuntimeLimiter and keep maxConcurrency at 1 until memory testing supports more.',
    });
  } catch (error) {
    checkAborted();
    results.set('concurrency', {
      capability: 'concurrency',
      status: 'failed',
      model: basicModel,
      latencyMs: Date.now() - concurrencyStarted,
      error: messageOf(error),
      nextStep: 'Verify that two local requests complete serially and that excess work waits without being dropped.',
    });
  }

  return finalize();
}

export const runLocalPreflight = runLocalCapabilityPreflight;
