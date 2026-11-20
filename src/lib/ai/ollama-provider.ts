/**
 * Iteration 1 LLMGateway adapter: local Ollama daemon (`/api/chat` with JSON Schema `format` and NDJSON streaming).
 */
import type { z } from 'zod';
import {
  AIUnavailableError,
  type ChatTurn,
  type GenerateStructuredOptions,
  type LLMGateway,
  type LLMHealth,
  type ModelTier,
  type StreamChatOptions,
} from '@/lib/ai/types';
import { runStructuredRepairLoop, toJsonSchema } from '@/lib/ai/pipeline/structured-output';
import { LocalRuntimeLimiter, normalizeHttpBaseUrl } from '@/lib/ai/local-runtime';

export const DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
export const DEFAULT_OLLAMA_HEAVY_MODEL = 'clef:27b-mxfp8';
export const DEFAULT_OLLAMA_FAST_MODEL = 'clef-flash:9b-mxfp8';
export const OLLAMA_KEEP_ALIVE = '15m';
export const OLLAMA_NUM_CTX = 16384;
/** Per-request ceiling for one non-streaming structured call (large local models are slow). */
export const DEFAULT_OLLAMA_TIMEOUT_MS = 300_000;

export interface OllamaProviderConfig {
  baseUrl?: string;
  heavyModel?: string;
  fastModel?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

interface OllamaChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OllamaChatResponse {
  message?: { role?: string; content?: string };
  done?: boolean;
  done_reason?: string;
  error?: string;
}

interface OllamaTagsResponse {
  models?: Array<{ name?: string; model?: string }>;
}

interface OllamaShowResponse {
  capabilities?: unknown;
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** Ollama names without a tag mean ":latest". */
function normalizeModelName(name: string): string {
  return name.includes(':') ? name : `${name}:latest`;
}

/** Same validation the Ollama local-runtime profile uses (http/https, no credentials/query/fragment). */
export function normalizeOllamaBaseUrl(value: string): string {
  return normalizeHttpBaseUrl(value);
}

/** Actionable message for a model that is installed but lacks Ollama's "completion" (chat) capability. */
export function ollamaCannotChatMessage(model: string, capabilities: readonly string[] | null): string {
  const list = capabilities && capabilities.length > 0 ? capabilities.join(', ') : 'unknown';
  return (
    `Ollama model "${model}" is installed but cannot chat (capabilities: ${list}). ` +
    'Set OLLAMA_HEAVY_MODEL/OLLAMA_FAST_MODEL to a chat model (e.g. qwen2.5:7b-instruct or gemma3) ' +
    'or use the MLX profile (npm run dev:mlx).'
  );
}

function parseOllamaErrorBody(text: string): string {
  try {
    const parsed = JSON.parse(text) as { error?: unknown };
    if (typeof parsed.error === 'string') return parsed.error;
  } catch {
    // Not JSON; use the raw text.
  }
  return text;
}

export class OllamaProvider implements LLMGateway {
  readonly providerName = 'ollama' as const;
  readonly baseUrl: string;
  readonly heavyModel: string;
  readonly fastModel: string;
  readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  /** One in-flight generation at a time, matching the local profile's maxConcurrency of 1. */
  private readonly limiter = new LocalRuntimeLimiter();

  constructor(config: OllamaProviderConfig = {}) {
    const baseUrl = config.baseUrl ?? nonEmpty(process.env.OLLAMA_BASE_URL) ?? DEFAULT_OLLAMA_BASE_URL;
    this.baseUrl = normalizeOllamaBaseUrl(baseUrl);
    this.heavyModel = config.heavyModel ?? nonEmpty(process.env.OLLAMA_HEAVY_MODEL) ?? DEFAULT_OLLAMA_HEAVY_MODEL;
    this.fastModel = config.fastModel ?? nonEmpty(process.env.OLLAMA_FAST_MODEL) ?? DEFAULT_OLLAMA_FAST_MODEL;
    const envTimeout = Number(nonEmpty(process.env.OLLAMA_TIMEOUT_MS));
    this.timeoutMs = config.timeoutMs ?? (Number.isFinite(envTimeout) && envTimeout > 0 ? envTimeout : DEFAULT_OLLAMA_TIMEOUT_MS);
    this.fetchImpl = config.fetchImpl ?? ((input, init) => fetch(input, init));
  }

  modelFor(tier: ModelTier): string {
    return tier === 'heavy' ? this.heavyModel : this.fastModel;
  }

  /** Requests currently holding / waiting for this provider's single slot (used by preflight). */
  runtimeQueueState(): { active: number; pending: number } {
    return { active: this.limiter.activeCount, pending: this.limiter.pendingCount };
  }

  async generateStructured<T extends z.ZodTypeAny>(opts: GenerateStructuredOptions<T>): Promise<z.infer<T>> {
    const model = this.modelFor(opts.tier);
    const format = toJsonSchema(opts.schema);
    const release = await this.limiter.acquire(opts.signal);
    try {
      return await runStructuredRepairLoop({
        model,
        schema: opts.schema,
        schemaName: opts.schemaName,
        maxOutputTokens: opts.maxOutputTokens,
        signal: opts.signal,
        baseMessages: [
          { role: 'system', content: opts.systemPrompt },
          { role: 'user', content: opts.userPrompt },
        ],
        call: async (messages: OllamaChatMessage[], maxTokens) => {
          const body = await this.postJsonWithTimeout<OllamaChatResponse>(
            '/api/chat',
            {
              model,
              messages,
              stream: false,
              format,
              keep_alive: OLLAMA_KEEP_ALIVE,
              options: { temperature: opts.temperature ?? 0.2, num_ctx: OLLAMA_NUM_CTX, num_predict: maxTokens },
            },
            model,
            opts.signal,
          );
          if (body.error) throw await this.chatError(model, body.error);
          return { raw: body.message?.content ?? '', truncated: body.done_reason === 'length' };
        },
      });
    } finally {
      release();
    }
  }

  async *streamChat(opts: StreamChatOptions): AsyncGenerator<string, void, unknown> {
    const model = this.modelFor(opts.tier);
    const options: Record<string, number> = { temperature: opts.temperature ?? 0.6, num_ctx: OLLAMA_NUM_CTX };
    if (opts.maxOutputTokens !== undefined) options.num_predict = opts.maxOutputTokens;

    const release = await this.limiter.acquire(opts.signal);
    try {
      const response = await this.post(
        '/api/chat',
        {
          model,
          messages: opts.messages.map((turn: ChatTurn) => ({ role: turn.role, content: turn.content })),
          stream: true,
          keep_alive: OLLAMA_KEEP_ALIVE,
          options,
        },
        model,
        opts.signal,
      );
      if (!response.body) throw new Error('Ollama returned an empty stream.');

      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = '';
      try {
        while (true) {
          if (opts.signal?.aborted) return;
          const { value, done } = await reader.read();
          if (done) break;
          buffer += value;
          let newline = buffer.indexOf('\n');
          while (newline !== -1) {
            const line = buffer.slice(0, newline).trim();
            buffer = buffer.slice(newline + 1);
            if (line) {
              const chunk = JSON.parse(line) as OllamaChatResponse;
              if (chunk.error) throw await this.chatError(model, chunk.error, 'Ollama stream error');
              const token = chunk.message?.content;
              if (token) yield token;
              if (chunk.done) return;
            }
            newline = buffer.indexOf('\n');
          }
        }
        const tail = buffer.trim();
        if (tail) {
          const chunk = JSON.parse(tail) as OllamaChatResponse;
          if (chunk.error) throw await this.chatError(model, chunk.error, 'Ollama stream error');
          const token = chunk.message?.content;
          if (token) yield token;
        }
      } finally {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
    } finally {
      release();
    }
  }

  async healthCheck(): Promise<LLMHealth> {
    let installed: string[];
    try {
      installed = await this.listInstalledModels();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        provider: this.providerName,
        models: [],
        error: `Cannot reach Ollama at ${this.baseUrl} (${reason}). Start it with "ollama serve".`,
      };
    }
    const installedSet = new Set(installed.map(normalizeModelName));
    const required = [...new Set([this.heavyModel, this.fastModel])];
    const missing = required.filter((name) => !installedSet.has(normalizeModelName(name)));
    if (missing.length > 0) {
      return {
        ok: false,
        provider: this.providerName,
        models: installed,
        error: `Missing Ollama model(s): ${missing.join(', ')}. Run ${missing.map((name) => `"ollama pull ${name}"`).join(' and ')}.`,
      };
    }
    const cannotChat: string[] = [];
    for (const model of required) {
      const capabilities = await this.getModelCapabilities(model).catch(() => null);
      // Older Ollama versions do not report capabilities; the real chat checks in preflight still apply.
      if (capabilities && !capabilities.includes('completion')) cannotChat.push(ollamaCannotChatMessage(model, capabilities));
    }
    if (cannotChat.length > 0) {
      return { ok: false, provider: this.providerName, models: installed, error: cannotChat.join(' ') };
    }
    return { ok: true, provider: this.providerName, models: installed };
  }

  /** Names of every model the Ollama daemon has installed (GET /api/tags). */
  async listInstalledModels(): Promise<string[]> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/api/tags`, { method: 'GET', cache: 'no-store' });
    } catch (error) {
      throw this.unreachable(error);
    }
    if (!response.ok) throw new Error(`GET /api/tags returned HTTP ${response.status}`);
    const body = (await response.json()) as OllamaTagsResponse;
    return (body.models ?? [])
      .map((entry) => entry.name ?? entry.model ?? '')
      .filter((name): name is string => name.length > 0);
  }

  /**
   * Capabilities reported by POST /api/show (e.g. ["completion", "vision"]), or null when this Ollama version
   * does not report them. A chat model must include "completion".
   */
  async getModelCapabilities(model: string, signal?: AbortSignal): Promise<string[] | null> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/api/show`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model }),
        signal,
        cache: 'no-store',
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw this.unreachable(error);
    }
    if (!response.ok) {
      const detail = parseOllamaErrorBody(await response.text().catch(() => ''));
      throw new Error(`Ollama /api/show returned HTTP ${response.status} for model "${model}"${detail ? `: ${detail.slice(0, 300)}` : ''}`);
    }
    const body = (await response.json()) as OllamaShowResponse;
    return Array.isArray(body.capabilities) ? body.capabilities.filter((entry): entry is string => typeof entry === 'string') : null;
  }

  private unreachable(error: unknown): AIUnavailableError {
    const reason = error instanceof Error ? error.message : String(error);
    return new AIUnavailableError(
      `Cannot reach Ollama at ${this.baseUrl} (${reason}). Start it with "ollama serve", or set OLLAMA_BASE_URL.`,
      'unreachable',
      { cause: error },
    );
  }

  /** Map an Ollama error string to an actionable error; "does not support chat" becomes AIUnavailableError. */
  private async chatError(model: string, detail: string, prefix = `Ollama returned an error for model "${model}"`): Promise<Error> {
    if (/does not support chat/i.test(detail)) {
      const capabilities = await this.getModelCapabilities(model).catch(() => null);
      return new AIUnavailableError(ollamaCannotChatMessage(model, capabilities), 'model_cannot_chat');
    }
    return new Error(`${prefix}: ${detail.slice(0, 300)}`);
  }

  /** Non-streaming POST with a per-request timeout; the whole body is read before the timer is cleared. */
  private async postJsonWithTimeout<T>(path: string, body: unknown, model: string, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) throw new Error(`Ollama request for model "${model}" was cancelled.`);
    const controller = new AbortController();
    let timedOut = false;
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);
    try {
      const response = await this.post(path, body, model, controller.signal);
      return (await response.json()) as T;
    } catch (error) {
      if (timedOut) {
        throw new AIUnavailableError(
          `Ollama request for model "${model}" timed out after ${this.timeoutMs} ms. Check Ollama load, or raise OLLAMA_TIMEOUT_MS.`,
          'timeout',
          { cause: error },
        );
      }
      if (signal?.aborted) throw new Error(`Ollama request for model "${model}" was cancelled.`);
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  private async post(path: string, body: unknown, model: string, signal?: AbortSignal): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
        cache: 'no-store',
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw this.unreachable(error);
    }
    if (!response.ok) {
      const detail = parseOllamaErrorBody(await response.text().catch(() => ''));
      if (/does not support chat/i.test(detail)) throw await this.chatError(model, detail);
      throw new Error(`Ollama ${path} returned HTTP ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ''}`);
    }
    return response;
  }
}
