/**
 * Iteration 2 LLMGateway adapter: Google Gemini API through the official `@google/genai` SDK.
 */
import { FinishReason, GoogleGenAI, type Content, type GenerateContentResponse, type HttpRetryOptions } from '@google/genai';
import { createHash } from 'node:crypto';
import type { z } from 'zod';
import {
  AIUnavailableError,
  LLMContentBlockedError,
  type GenerateStructuredOptions,
  type LLMGateway,
  type LLMHealth,
  type ModelTier,
  type StreamChatOptions,
} from '@/lib/ai/types';
import {
  isGeminiSchemaTooComplexError,
  relaxGeminiJsonSchema,
  runStructuredRepairLoop,
  toGeminiJsonSchema,
  toJsonSchema,
} from '@/lib/ai/pipeline/structured-output';

export const DEFAULT_GEMINI_HEAVY_MODEL = 'gemini-3.8-flash';
export const DEFAULT_GEMINI_FAST_MODEL = 'gemini-3.5-flash-lite';

export interface GeminiProviderConfig {
  apiKey?: string;
  heavyModel?: string;
  fastModel?: string;
  /** Fixed thinking budget in tokens (GEMINI_THINKING_BUDGET). Unset keeps the model's default thinking. */
  thinkingBudget?: number;
}

/**
 * GEMINI_THINKING_BUDGET: a whole number of tokens (0 turns thinking off on 2.5 Flash / Flash-Lite).
 * Anything else (unset, blank, negative, not a number) keeps the model default.
 */
export function thinkingBudgetFromEnv(value: string | undefined = process.env.GEMINI_THINKING_BUDGET): number | undefined {
  const trimmed = value?.trim();
  if (!trimmed || !/^\d+$/.test(trimmed)) return undefined;
  return Number.parseInt(trimmed, 10);
}

/**
 * SDK-level retry for transient HTTP failures (408, 429, 500, 502, 503, 504): 3 attempts in all, exponential
 * backoff from 1 s capped at 8 s, with jitter. Off by default in @google/genai, so a single 429 during a Track
 * build would otherwise fail the stage. An aborted signal stops further attempts.
 */
export const GEMINI_RETRY_OPTIONS: HttpRetryOptions = { attempts: 3, initialDelay: 1, maxDelay: 8, expBase: 2, jitter: 1 };

/** Finish reasons where Gemini refused or withheld the answer. The same prompt gives the same result. */
const BLOCKED_FINISH_REASONS = new Set<string>([
  FinishReason.SAFETY,
  FinishReason.RECITATION,
  FinishReason.BLOCKLIST,
  FinishReason.PROHIBITED_CONTENT,
  FinishReason.SPII,
  FinishReason.IMAGE_SAFETY,
  FinishReason.IMAGE_PROHIBITED_CONTENT,
]);

/** The block reason of a Gemini response (blocked prompt, or a blocked finish), or null when it was answered. */
export function geminiBlockReason(response: Pick<GenerateContentResponse, 'candidates' | 'promptFeedback'>): string | null {
  const promptBlock = response.promptFeedback?.blockReason;
  if (promptBlock) return `prompt:${promptBlock}`;
  const finish = response.candidates?.[0]?.finishReason;
  return finish && BLOCKED_FINISH_REASONS.has(finish) ? finish : null;
}

function blockedError(reason: string, model: string, schemaName?: string): LLMContentBlockedError {
  const what = reason.startsWith('prompt:') ? 'the request' : 'its answer';
  const why = reason === FinishReason.RECITATION
    ? 'it would repeat copyrighted or memorized text'
    : `content filter (${reason.replace(/^prompt:/, '')})`;
  return new LLMContentBlockedError(
    `Gemini (${model}) blocked ${what}${schemaName ? ` for ${schemaName}` : ''}: ${why}. Retrying the same input gives the same result. ` +
      'Check the source pages or the item for wording that trips the filter, edit it, then select Retry.',
    reason,
    schemaName,
  );
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** GEMINI_LOG_USAGE=1 prints one JSON line of token usage per Gemini call (cost measurement). */
function logGeminiUsage(model: string, label: string, usage: GenerateContentResponse['usageMetadata']): void {
  if (process.env.GEMINI_LOG_USAGE !== '1' || !usage) return;
  console.info(`[gemini-usage] ${JSON.stringify({
    t: Date.now(),
    model,
    label,
    prompt: usage.promptTokenCount ?? 0,
    cached: usage.cachedContentTokenCount ?? 0,
    output: usage.candidatesTokenCount ?? 0,
    thoughts: usage.thoughtsTokenCount ?? 0,
    total: usage.totalTokenCount ?? 0,
  })}`);
}

/**
 * Gemini context caching (Connor 2026-11-23: "the cost is crazy"). A Unit's cards and Drill batches all start with
 * the same ~20k tokens of source pages and rules; caching that prefix once bills it at the cached rate on every
 * later call. Prefixes below this size are sent normally (Gemini rejects small caches and the saving is small).
 */
export const MIN_CACHEABLE_PREFIX_CHARS = 12_000;
/** Cache lifetime on Gemini's side; a Unit's calls finish well inside it. Reused locally for a little less. */
const CONTEXT_CACHE_TTL_SECONDS = 900;
const CONTEXT_CACHE_REUSE_MS = 12 * 60_000;

interface ContextCacheEntry {
  createdAt: number;
  name: Promise<string | null>;
}

/** HTTP status of a @google/genai error, when it has one. */
function errorStatus(error: unknown): number | undefined {
  const status = (error as { status?: unknown })?.status;
  return typeof status === 'number' ? status : undefined;
}

function textContent(role: 'user' | 'model', text: string): Content {
  return { role, parts: [{ text }] };
}

export class GeminiProvider implements LLMGateway {
  readonly providerName = 'gemini' as const;
  readonly heavyModel: string;
  readonly fastModel: string;
  readonly thinkingBudget: number | undefined;
  /** Model and thinking budget for planning calls (the Track blueprint). Default: the heavy model and budget. */
  readonly planningModel: string;
  readonly planningThinkingBudget: number | undefined;
  private readonly apiKey: string | undefined;
  private client: GoogleGenAI | null = null;
  /**
   * Schema names Gemini rejected as too complex: 1 = send the relaxed schema (no length or number bounds),
   * 2 = send no response schema (JSON mode, schema in the instructions). Zod still validates every answer.
   */
  private readonly schemaFallback = new Map<string, 1 | 2>();
  /** Context caches by model + system prompt + prefix. A null name means caching failed: send the full prompt. */
  private readonly contextCaches = new Map<string, ContextCacheEntry>();
  /** Models Gemini said do not support explicit caching (gemini-4-neon): not asked again. */
  private readonly noCacheModels = new Set<string>();

  constructor(config: GeminiProviderConfig = {}) {
    this.apiKey = config.apiKey ?? nonEmpty(process.env.GEMINI_API_KEY);
    this.heavyModel = config.heavyModel ?? nonEmpty(process.env.GEMINI_HEAVY_MODEL) ?? DEFAULT_GEMINI_HEAVY_MODEL;
    this.fastModel = config.fastModel ?? nonEmpty(process.env.GEMINI_FAST_MODEL) ?? DEFAULT_GEMINI_FAST_MODEL;
    this.thinkingBudget = config.thinkingBudget ?? thinkingBudgetFromEnv();
    this.planningModel = nonEmpty(process.env.GEMINI_PLANNING_MODEL) ?? this.heavyModel;
    this.planningThinkingBudget = thinkingBudgetFromEnv(process.env.GEMINI_PLANNING_THINKING_BUDGET) ?? this.thinkingBudget;
  }

  /**
   * On Gemini 2.5 thinking models, thinking tokens count toward `maxOutputTokens`. With a fixed thinking budget the
   * budget is added on top, so the caller's limit stays the limit for the visible answer. Without one the model's
   * default (dynamic) thinking shares the caller's limit; a truncated structured answer is retried once at double.
   */
  private outputConfig(
    maxOutputTokens: number | undefined,
    budget: number | undefined = this.thinkingBudget,
  ): { maxOutputTokens?: number; thinkingConfig?: { thinkingBudget: number } } {
    if (budget === undefined) return { maxOutputTokens };
    return {
      maxOutputTokens: maxOutputTokens === undefined ? undefined : maxOutputTokens + budget,
      thinkingConfig: { thinkingBudget: budget },
    };
  }

  modelFor(tier: ModelTier): string {
    return tier === 'heavy' ? this.heavyModel : this.fastModel;
  }

  private getClient(): GoogleGenAI {
    if (!this.apiKey) {
      throw new AIUnavailableError('GEMINI_API_KEY is not set. Add it to the environment or set AI_PROVIDER=ollama.', 'not_configured');
    }
    if (!this.client) this.client = new GoogleGenAI({ apiKey: this.apiKey, httpOptions: { retryOptions: GEMINI_RETRY_OPTIONS } });
    return this.client;
  }

  /**
   * The name of a context cache holding `systemInstruction` and the shared `prefix`, created on first use. Null when
   * caching is off (GEMINI_CONTEXT_CACHE=off), the prefix is small, or Gemini refused the cache: callers then send
   * the whole prompt, so caching can only save money, never fail a build.
   */
  private contextCacheFor(model: string, systemInstruction: string, prefix: string): Promise<string | null> {
    if (process.env.GEMINI_CONTEXT_CACHE === 'off' || prefix.length < MIN_CACHEABLE_PREFIX_CHARS || this.noCacheModels.has(model)) {
      return Promise.resolve(null);
    }
    const now = Date.now();
    for (const [key, entry] of this.contextCaches) {
      if (now - entry.createdAt > CONTEXT_CACHE_REUSE_MS) this.contextCaches.delete(key);
    }
    const key = createHash('sha256').update(`${model}\0${systemInstruction}\0${prefix}`).digest('hex');
    const existing = this.contextCaches.get(key);
    if (existing) return existing.name;
    const name = this.getClient()
      .caches.create({
        model,
        config: {
          systemInstruction,
          contents: [textContent('user', prefix)],
          ttl: `${CONTEXT_CACHE_TTL_SECONDS}s`,
          displayName: 'pulse-unit-context',
        },
      })
      .then((cache) => cache.name ?? null)
      .catch((error: unknown) => {
        if (error instanceof Error && /caching is not supported/i.test(error.message)) this.noCacheModels.add(model);
        console.warn('[gemini] context cache not created; sending the full prompt', {
          model,
          status: errorStatus(error),
          message: error instanceof Error ? error.message.slice(0, 200) : String(error),
        });
        return null;
      });
    this.contextCaches.set(key, { createdAt: now, name });
    return name;
  }

  private dropContextCache(name: string): void {
    for (const [key, entry] of this.contextCaches) {
      void entry.name.then((value) => {
        if (value === name) this.contextCaches.delete(key);
      });
    }
  }

  async generateStructured<T extends z.ZodTypeAny>(opts: GenerateStructuredOptions<T>): Promise<z.infer<T>> {
    const ai = this.getClient();
    const planning = opts.purpose === 'planning';
    const model = opts.modelOverride ?? (planning ? this.planningModel : this.modelFor(opts.tier));
    const budget = planning ? this.planningThinkingBudget : this.thinkingBudget;
    const fullSchema = toGeminiJsonSchema(toJsonSchema(opts.schema));
    const fallbackKey = `${model}:${opts.schemaName ?? 'structured'}`;
    const schemaFor = (level: 0 | 1 | 2) => (level === 0 ? fullSchema : level === 1 ? relaxGeminiJsonSchema(fullSchema) : undefined);
    const systemFor = (level: 0 | 1 | 2) =>
      level === 2
        ? `${opts.systemPrompt}\n\nReturn ONLY JSON that matches this JSON Schema:\n${JSON.stringify(relaxGeminiJsonSchema(fullSchema))}`
        : opts.systemPrompt;
    const prefix = opts.cacheablePrefix && opts.userPrompt.startsWith(opts.cacheablePrefix) ? opts.cacheablePrefix : undefined;
    return runStructuredRepairLoop({
      model,
      schema: opts.schema,
      schemaName: opts.schemaName,
      maxOutputTokens: opts.maxOutputTokens,
      signal: opts.signal,
      baseMessages: [{ role: 'user', content: opts.userPrompt }],
      call: async (messages, maxOutputTokens) => {
        const contents: Content[] = messages
          .filter((turn) => turn.role !== 'system')
          .map((turn) => textContent(turn.role === 'assistant' ? 'model' : 'user', turn.content));
        if (opts.audioParts?.length && contents[0]) {
          // Audio rides on the first user turn, after the text prompt; repair turns stay text only.
          contents[0] = {
            role: 'user',
            parts: [
              ...(contents[0].parts ?? []),
              ...opts.audioParts.flatMap((clip) => [{ text: clip.label }, { inlineData: { mimeType: clip.mimeType, data: clip.base64 } }]),
            ],
          };
        }
        let level: 0 | 1 | 2 = this.schemaFallback.get(fallbackKey) ?? 0;
        // The cache holds the system prompt and the shared prefix; JSON mode (level 2) changes the system prompt.
        let cacheName = prefix && level < 2 ? await this.contextCacheFor(model, opts.systemPrompt, prefix) : null;
        let response: GenerateContentResponse;
        for (;;) {
          const cached = cacheName !== null && level < 2 && contents[0]?.parts?.[0]?.text?.startsWith(prefix ?? '\0');
          const callContents: Content[] = cached
            ? [textContent('user', contents[0].parts![0].text!.slice(prefix!.length).trim() || 'Continue.'), ...contents.slice(1)]
            : contents;
          try {
            response = await ai.models.generateContent({
              model,
              contents: callContents,
              config: {
                ...(cached ? { cachedContent: cacheName! } : { systemInstruction: systemFor(level) }),
                temperature: opts.temperature ?? 0.2,
                responseMimeType: 'application/json',
                ...(level < 2 ? { responseJsonSchema: schemaFor(level) } : {}),
                ...this.outputConfig(maxOutputTokens, budget),
                abortSignal: opts.signal,
              },
            });
            break;
          } catch (error) {
            // An expired or rejected cache never fails the call: drop it and send the full prompt.
            if (cached && !opts.signal?.aborted && errorStatus(error) !== 429) {
              console.warn('[gemini] cached call failed; retrying with the full prompt', {
                model,
                status: errorStatus(error),
                message: error instanceof Error ? error.message.slice(0, 200) : String(error),
              });
              this.dropContextCache(cacheName!);
              cacheName = null;
              continue;
            }
            if (level === 2 || !isGeminiSchemaTooComplexError(error)) throw error;
            level = (level + 1) as 1 | 2;
            this.schemaFallback.set(fallbackKey, level);
            console.warn('[gemini] response schema too complex; retrying with a simpler schema', { model, schemaName: opts.schemaName, level });
          }
        }
        logGeminiUsage(model, opts.schemaName ?? 'structured', response.usageMetadata);
        const blocked = geminiBlockReason(response);
        // Not repairable: an error thrown by the call leaves the JSON repair loop at once.
        if (blocked) throw blockedError(blocked, model, opts.schemaName);
        return { raw: response.text ?? '', truncated: response.candidates?.[0]?.finishReason === FinishReason.MAX_TOKENS };
      },
    });
  }

  async *streamChat(opts: StreamChatOptions): AsyncGenerator<string, void, unknown> {
    const ai = this.getClient();
    const systemParts = opts.messages.filter((turn) => turn.role === 'system').map((turn) => turn.content);
    const contents: Content[] = opts.messages
      .filter((turn) => turn.role !== 'system')
      .map((turn) => textContent(turn.role === 'assistant' ? 'model' : 'user', turn.content));
    if (contents.length === 0) contents.push(textContent('user', 'Begin.'));

    const model = this.modelFor(opts.tier);
    const stream = await ai.models.generateContentStream({
      model,
      contents,
      config: {
        systemInstruction: systemParts.length > 0 ? systemParts.join('\n\n') : undefined,
        temperature: opts.temperature ?? 0.6,
        ...this.outputConfig(opts.maxOutputTokens),
        abortSignal: opts.signal,
      },
    });

    let yielded = false;
    let usage: GenerateContentResponse['usageMetadata'];
    try {
    for await (const chunk of stream) {
      if (chunk.usageMetadata) usage = chunk.usageMetadata;
      if (opts.signal?.aborted) return;
      const token = chunk.text;
      if (token) {
        yielded = true;
        yield token;
      }
      const blocked = geminiBlockReason(chunk);
      if (blocked) {
        // Nothing usable was said: report the block. After partial text, end the reply where it stopped.
        if (!yielded) throw blockedError(blocked, model);
        return;
      }
    }
    } finally {
      logGeminiUsage(model, 'chat', usage);
    }
  }

  async healthCheck(): Promise<LLMHealth> {
    const models = [this.heavyModel, this.fastModel];
    if (!this.apiKey) {
      return {
        ok: false,
        provider: this.providerName,
        models,
        error: 'GEMINI_API_KEY is not set. Add it to the environment or set AI_PROVIDER=ollama.',
      };
    }
    try {
      const ai = this.getClient();
      await ai.models.get({ model: this.fastModel });
      if (this.heavyModel !== this.fastModel) await ai.models.get({ model: this.heavyModel });
      return { ok: true, provider: this.providerName, models };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        provider: this.providerName,
        models,
        error: `Gemini API check failed: ${reason.slice(0, 300)}`,
      };
    }
  }
}
