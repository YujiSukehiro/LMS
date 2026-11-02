/**
 * Iteration 1 LLMGateway adapter: local Ollama daemon (`/api/chat` with JSON Schema `format` and NDJSON streaming).
 */
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

export const DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
export const DEFAULT_OLLAMA_HEAVY_MODEL = 'clef:27b-mxfp8';
export const DEFAULT_OLLAMA_FAST_MODEL = 'clef-flash:9b-mxfp8';

const KEEP_ALIVE = '15m';
const NUM_CTX = 16384;

export interface OllamaProviderConfig {
  baseUrl?: string;
  heavyModel?: string;
  fastModel?: string;
  fetchImpl?: typeof fetch;
}

interface OllamaChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OllamaChatResponse {
  message?: { role?: string; content?: string };
  done?: boolean;
  error?: string;
}

interface OllamaTagsResponse {
  models?: Array<{ name?: string; model?: string }>;
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** Ollama names without a tag mean ":latest". */
function normalizeModelName(name: string): string {
  return name.includes(':') ? name : `${name}:latest`;
}

export class OllamaProvider implements LLMGateway {
  readonly providerName = 'ollama' as const;
  readonly baseUrl: string;
  readonly heavyModel: string;
  readonly fastModel: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: OllamaProviderConfig = {}) {
    const baseUrl = config.baseUrl ?? nonEmpty(process.env.OLLAMA_BASE_URL) ?? DEFAULT_OLLAMA_BASE_URL;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.heavyModel = config.heavyModel ?? nonEmpty(process.env.OLLAMA_HEAVY_MODEL) ?? DEFAULT_OLLAMA_HEAVY_MODEL;
    this.fastModel = config.fastModel ?? nonEmpty(process.env.OLLAMA_FAST_MODEL) ?? DEFAULT_OLLAMA_FAST_MODEL;
    this.fetchImpl = config.fetchImpl ?? ((input, init) => fetch(input, init));
  }

  modelFor(tier: ModelTier): string {
    return tier === 'heavy' ? this.heavyModel : this.fastModel;
  }

  async generateStructured<T extends z.ZodTypeAny>(opts: GenerateStructuredOptions<T>): Promise<z.infer<T>> {
    const model = this.modelFor(opts.tier);
    const format = toJsonSchema(opts.schema);
    const messages: OllamaChatMessage[] = [
      { role: 'system', content: opts.systemPrompt },
      { role: 'user', content: opts.userPrompt },
    ];
    const maxAttempts = MAX_STRUCTURED_REPAIR_RETRIES + 1;
    let lastRaw = '';
    let lastProblem = '';

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const response = await this.post('/api/chat', {
        model,
        messages,
        stream: false,
        format,
        keep_alive: KEEP_ALIVE,
        options: { temperature: opts.temperature ?? 0.2, num_ctx: NUM_CTX },
      });
      const body = (await response.json()) as OllamaChatResponse;
      if (body.error) throw new Error(`Ollama returned an error for model "${model}": ${body.error}`);
      lastRaw = body.message?.content ?? '';

      const parsed = parseStructuredOutput(lastRaw, opts.schema);
      if (parsed.ok) return parsed.data;
      lastProblem = parsed.problem;

      if (attempt < maxAttempts) {
        messages.push({ role: 'assistant', content: lastRaw });
        messages.push({ role: 'user', content: buildRepairMessage(opts.schemaName, parsed.problem) });
      }
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
    const options: Record<string, number> = { temperature: opts.temperature ?? 0.6, num_ctx: NUM_CTX };
    if (opts.maxOutputTokens !== undefined) options.num_predict = opts.maxOutputTokens;

    const response = await this.post(
      '/api/chat',
      {
        model,
        messages: opts.messages.map((turn: ChatTurn) => ({ role: turn.role, content: turn.content })),
        stream: true,
        keep_alive: KEEP_ALIVE,
        options,
      },
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
            if (chunk.error) throw new Error(`Ollama stream error: ${chunk.error}`);
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
        if (chunk.error) throw new Error(`Ollama stream error: ${chunk.error}`);
        const token = chunk.message?.content;
        if (token) yield token;
      }
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
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
    const missing = [this.heavyModel, this.fastModel].filter((name) => !installedSet.has(normalizeModelName(name)));
    if (missing.length > 0) {
      return {
        ok: false,
        provider: this.providerName,
        models: installed,
        error: `Missing Ollama model(s): ${missing.join(', ')}. Run ${missing.map((name) => `"ollama pull ${name}"`).join(' and ')}.`,
      };
    }
    return { ok: true, provider: this.providerName, models: installed };
  }

  /** Names of every model the Ollama daemon has installed (GET /api/tags). */
  async listInstalledModels(): Promise<string[]> {
    const response = await this.fetchImpl(`${this.baseUrl}/api/tags`, { method: 'GET', cache: 'no-store' });
    if (!response.ok) throw new Error(`GET /api/tags returned HTTP ${response.status}`);
    const body = (await response.json()) as OllamaTagsResponse;
    return (body.models ?? [])
      .map((entry) => entry.name ?? entry.model ?? '')
      .filter((name): name is string => name.length > 0);
  }

  private async post(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
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
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Cannot reach Ollama at ${this.baseUrl} (${reason}). Start it with "ollama serve".`);
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Ollama ${path} returned HTTP ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ''}`);
    }
    return response;
  }
}
