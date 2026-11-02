import type { z } from 'zod';
import {
  LLMStructuredOutputError,
  type ChatTurn,
  type GenerateStructuredOptions,
  type LLMGateway,
  type LLMHealth,
  type ModelTier,
  type StreamChatOptions,
} from '@/lib/ai/types';
import {
  MAX_STRUCTURED_REPAIR_RETRIES,
  buildRepairMessage,
  parseStructuredOutput,
  toJsonSchema,
} from '@/lib/ai/pipeline/structured-output';
import { LocalRuntimeLimiter, normalizeLoopbackBaseUrl } from '@/lib/ai/local-runtime';

export const DEFAULT_OPENAI_COMPATIBLE_BASE_URL = 'http://127.0.0.1:8080';
export const DEFAULT_OPENAI_COMPATIBLE_TIMEOUT_MS = 180_000;

export interface OpenAICompatibleProviderConfig {
  baseUrl?: string;
  heavyModel?: string;
  fastModel?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

interface OpenAIChatResponse {
  choices?: Array<{
    message?: { content?: unknown };
    delta?: { content?: unknown };
  }>;
  error?: string | { message?: string };
}

interface RequestContext {
  response: Response;
  model: string;
  signal?: AbortSignal;
  didTimeout: () => boolean;
  cleanup: () => void;
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function safeDetail(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
}

export class OpenAICompatibleProvider implements LLMGateway {
  readonly providerName = 'openai_compatible' as const;
  readonly baseUrl: string;
  readonly heavyModel: string;
  readonly fastModel: string;
  readonly timeoutMs: number;
  readonly maxConcurrency = 1 as const;
  private readonly fetchImpl: typeof fetch;
  private readonly limiter = new LocalRuntimeLimiter();
  private readonly chatCompletionsUrl: string;

  constructor(config: OpenAICompatibleProviderConfig = {}) {
    this.baseUrl = normalizeLoopbackBaseUrl(
      config.baseUrl ?? nonEmpty(process.env.OPENAI_COMPATIBLE_BASE_URL) ?? DEFAULT_OPENAI_COMPATIBLE_BASE_URL,
    );
    this.heavyModel = config.heavyModel ?? nonEmpty(process.env.OPENAI_COMPATIBLE_HEAVY_MODEL) ?? '';
    this.fastModel = config.fastModel ?? nonEmpty(process.env.OPENAI_COMPATIBLE_FAST_MODEL) ?? '';
    this.timeoutMs = config.timeoutMs ?? DEFAULT_OPENAI_COMPATIBLE_TIMEOUT_MS;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new Error('OpenAI-compatible timeout must be a positive number of milliseconds.');
    }
    this.fetchImpl = config.fetchImpl ?? ((input, init) => fetch(input, init));
    this.chatCompletionsUrl = this.baseUrl.endsWith('/v1')
      ? `${this.baseUrl}/chat/completions`
      : `${this.baseUrl}/v1/chat/completions`;
  }

  modelFor(tier: ModelTier): string {
    const model = tier === 'heavy' ? this.heavyModel : this.fastModel;
    if (!model) {
      const variable = tier === 'heavy' ? 'OPENAI_COMPATIBLE_HEAVY_MODEL' : 'OPENAI_COMPATIBLE_FAST_MODEL';
      throw new Error(`No ${tier} model is configured for the OpenAI-compatible local provider. Set ${variable} and retry.`);
    }
    return model;
  }

  /** A non-streaming chat helper used by health and capability preflight. */
  async generateChat(opts: StreamChatOptions): Promise<string> {
    const model = this.modelFor(opts.tier);
    const release = await this.limiter.acquire(opts.signal);
    try {
      const context = await this.postChat(
        {
          model,
          messages: opts.messages.map((turn: ChatTurn) => ({ role: turn.role, content: turn.content })),
          stream: false,
          temperature: opts.temperature ?? 0.6,
          ...(opts.maxOutputTokens !== undefined ? { max_tokens: opts.maxOutputTokens } : {}),
        },
        opts.signal,
      );
      return await this.readNonStreamingContent(context);
    } finally {
      release();
    }
  }

  async generateStructured<T extends z.ZodTypeAny>(opts: GenerateStructuredOptions<T>): Promise<z.infer<T>> {
    const model = this.modelFor(opts.tier);
    const release = await this.limiter.acquire(opts.signal);
    const messages: ChatTurn[] = [
      {
        role: 'system',
        content: [
          opts.systemPrompt,
          `Return one complete JSON object for "${opts.schemaName}" only. Do not use markdown fences or prose.`,
          `The required JSON Schema is: ${JSON.stringify(toJsonSchema(opts.schema))}`,
        ].join('\n\n'),
      },
      { role: 'user', content: opts.userPrompt },
    ];
    const maxAttempts = MAX_STRUCTURED_REPAIR_RETRIES + 1;
    let lastRaw = '';
    let lastProblem = '';

    try {
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const context = await this.postChat(
          {
            model,
            messages,
            stream: false,
            temperature: opts.temperature ?? 0.2,
            ...(opts.maxOutputTokens !== undefined ? { max_tokens: opts.maxOutputTokens } : {}),
          },
          opts.signal,
        );
        lastRaw = await this.readNonStreamingContent(context);
        const parsed = parseStructuredOutput(lastRaw, opts.schema);
        if (parsed.ok) return parsed.data;
        lastProblem = parsed.problem;
        if (attempt < maxAttempts) {
          messages.push({ role: 'assistant', content: lastRaw });
          messages.push({ role: 'user', content: buildRepairMessage(opts.schemaName, parsed.problem) });
        }
      }
    } finally {
      release();
    }

    throw new LLMStructuredOutputError(
      `Model "${model}" did not return valid "${opts.schemaName}" JSON after ${maxAttempts} attempts. ${lastProblem}`,
      opts.schemaName,
      maxAttempts,
      lastRaw,
    );
  }

  async *streamChat(opts: StreamChatOptions): AsyncGenerator<string, void, unknown> {
    const model = this.modelFor(opts.tier);
    const release = await this.limiter.acquire(opts.signal);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let context: RequestContext | undefined;
    try {
      context = await this.postChat(
        {
          model,
          messages: opts.messages,
          stream: true,
          temperature: opts.temperature ?? 0.6,
          ...(opts.maxOutputTokens !== undefined ? { max_tokens: opts.maxOutputTokens } : {}),
        },
        opts.signal,
      );
      if (!context.response.body) throw new Error('OpenAI-compatible local server returned an empty SSE stream. Check that the selected model supports streaming chat.');
      reader = context.response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let eventData: string[] = [];
      let sawDone = false;
      let sawText = false;

      const dispatchEvent = (): { done: boolean; tokens: string[] } => {
        if (eventData.length === 0) return { done: false, tokens: [] };
        const data = eventData.join('\n').trim();
        eventData = [];
        if (data === '[DONE]') return { done: true, tokens: [] };
        let chunk: OpenAIChatResponse;
        try {
          chunk = JSON.parse(data) as OpenAIChatResponse;
        } catch {
          throw new Error(`OpenAI-compatible local server returned malformed SSE JSON for model "${model}". Check its /v1/chat/completions streaming compatibility.`);
        }
        if (chunk.error) {
          const detail = typeof chunk.error === 'string' ? chunk.error : chunk.error.message ?? 'unknown stream error';
          throw new Error(`OpenAI-compatible local stream failed for model "${model}": ${safeDetail(detail)}. Check the selected model and local server.`);
        }
        const content = chunk.choices?.[0]?.delta?.content;
        if (content !== undefined && typeof content !== 'string') {
          throw new Error(`OpenAI-compatible local stream returned non-text content for model "${model}". Select a text chat model and retry.`);
        }
        return { done: false, tokens: typeof content === 'string' && content ? [content] : [] };
      };

      const consumeLine = (line: string): { done: boolean; tokens: string[] } => {
        const normalized = line.endsWith('\r') ? line.slice(0, -1) : line;
        if (normalized === '') return dispatchEvent();
        if (normalized.startsWith(':')) return { done: false, tokens: [] };
        if (normalized === 'data') eventData.push('');
        else if (normalized.startsWith('data:')) eventData.push(normalized.slice(5).trimStart());
        return { done: false, tokens: [] };
      };

      while (!sawDone) {
        let read: ReadableStreamReadResult<Uint8Array>;
        try {
          read = await reader.read();
        } catch (error) {
          throw this.requestError(error, model, opts.signal, context.didTimeout());
        }
        if (read.done) break;
        buffer += decoder.decode(read.value, { stream: true });
        let newline = buffer.indexOf('\n');
        while (newline !== -1) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          const event = consumeLine(line);
          for (const token of event.tokens) {
            if (token.trim()) sawText = true;
            yield token;
          }
          if (event.done) {
            sawDone = true;
            break;
          }
          newline = buffer.indexOf('\n');
        }
      }

      if (!sawDone) {
        buffer += decoder.decode();
        if (buffer) {
          const event = consumeLine(buffer);
          for (const token of event.tokens) {
            if (token.trim()) sawText = true;
            yield token;
          }
          sawDone = event.done;
        }
        if (!sawDone && eventData.length > 0) {
          const event = dispatchEvent();
          for (const token of event.tokens) {
            if (token.trim()) sawText = true;
            yield token;
          }
          sawDone = event.done;
        }
      }
      if (!sawDone) {
        throw new Error(`OpenAI-compatible local stream for model "${model}" ended before [DONE]. The response may be truncated; retry and check server logs.`);
      }
      if (!sawText) {
        throw new Error(`OpenAI-compatible local stream for model "${model}" completed without text. Select a chat-capable model and retry.`);
      }
    } finally {
      if (reader) {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
      context?.cleanup();
      release();
    }
  }

  /** Health deliberately performs real chat completions; model-list endpoints are optional and not used. */
  async healthCheck(): Promise<LLMHealth> {
    const models = [...new Set([this.heavyModel, this.fastModel].filter(Boolean))];
    if (models.length === 0) {
      return {
        ok: false,
        provider: this.providerName,
        models: [],
        error: 'No local chat model is configured. Set OPENAI_COMPATIBLE_HEAVY_MODEL and OPENAI_COMPATIBLE_FAST_MODEL, then retry.',
      };
    }
    for (const model of models) {
      try {
        await this.generateChat({
          tier: model === this.fastModel ? 'fast' : 'heavy',
          messages: [{ role: 'user', content: 'Reply with exactly OK.' }],
          temperature: 0,
          maxOutputTokens: 8,
        });
      } catch (error) {
        return {
          ok: false,
          provider: this.providerName,
          models,
          error: `Local chat preflight failed for model "${model}": ${errorMessage(error)} Check that the local server is running and the selected model supports chat.`,
        };
      }
    }
    return { ok: true, provider: this.providerName, models };
  }

  private async readNonStreamingContent(context: RequestContext): Promise<string> {
    try {
      let text: string;
      try {
        text = await context.response.text();
      } catch (error) {
        throw this.requestError(error, context.model, context.signal, context.didTimeout());
      }
      if (!text.trim()) {
        throw new Error(`OpenAI-compatible local server returned an empty response for model "${context.model}". Check that the selected model supports chat completions.`);
      }
      let body: OpenAIChatResponse;
      try {
        body = JSON.parse(text) as OpenAIChatResponse;
      } catch {
        throw new Error(`OpenAI-compatible local server returned invalid JSON for model "${context.model}". Verify the /v1/chat/completions endpoint.`);
      }
      if (body.error) {
        const detail = typeof body.error === 'string' ? body.error : body.error.message ?? 'unknown completion error';
        throw new Error(`OpenAI-compatible local completion failed for model "${context.model}": ${safeDetail(detail)}. Check the selected model and local server.`);
      }
      const content = body.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || !content.trim()) {
        throw new Error(`OpenAI-compatible local server returned no assistant text for model "${context.model}". Select a text chat model and retry.`);
      }
      return content;
    } finally {
      context.cleanup();
    }
  }

  private async postChat(body: unknown, signal?: AbortSignal): Promise<RequestContext> {
    const model = (body as { model: string }).model;
    if (signal?.aborted) throw new Error(`OpenAI-compatible local request for model "${model}" was cancelled.`);
    const controller = new AbortController();
    let timedOut = false;
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };

    let response: Response;
    try {
      response = await this.fetchImpl(this.chatCompletionsUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
        body: JSON.stringify(body),
        signal: controller.signal,
        cache: 'no-store',
      });
    } catch (error) {
      cleanup();
      throw this.requestError(error, model, signal, timedOut);
    }
    if (!response.ok) {
      let detail = '';
      try {
        detail = safeDetail(await response.text());
      } catch {
        // The status remains actionable even when the error body cannot be read.
      }
      cleanup();
      throw new Error(`OpenAI-compatible /v1/chat/completions returned HTTP ${response.status} for model "${model}"${detail ? `: ${detail}` : ''}. Check the local server and selected model.`);
    }
    return { response, model, signal, didTimeout: () => timedOut, cleanup };
  }

  private requestError(error: unknown, model: string, signal: AbortSignal | undefined, timedOut: boolean): Error {
    if (timedOut) {
      return new Error(`OpenAI-compatible local request for model "${model}" timed out after ${this.timeoutMs} ms. Retry or increase the local timeout after checking server load.`);
    }
    if (signal?.aborted) return new Error(`OpenAI-compatible local request for model "${model}" was cancelled.`);
    return new Error(`Cannot reach the OpenAI-compatible local chat endpoint for model "${model}" (${errorMessage(error)}). Check that the loopback server is running and retry.`);
  }
}
