/**
 * Iteration 2 LLMGateway adapter: Google Gemini API through the official `@google/genai` SDK.
 */
import { GoogleGenAI, type Content } from '@google/genai';
import type { z } from 'zod';
import {
  LLMStructuredOutputError,
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
  toGeminiJsonSchema,
  toJsonSchema,
} from '@/lib/ai/pipeline/structured-output';

export const DEFAULT_GEMINI_HEAVY_MODEL = 'gemini-2.5-flash';
export const DEFAULT_GEMINI_FAST_MODEL = 'gemini-2.5-flash-lite';

export interface GeminiProviderConfig {
  apiKey?: string;
  heavyModel?: string;
  fastModel?: string;
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function textContent(role: 'user' | 'model', text: string): Content {
  return { role, parts: [{ text }] };
}

export class GeminiProvider implements LLMGateway {
  readonly providerName = 'gemini' as const;
  readonly heavyModel: string;
  readonly fastModel: string;
  private readonly apiKey: string | undefined;
  private client: GoogleGenAI | null = null;

  constructor(config: GeminiProviderConfig = {}) {
    this.apiKey = config.apiKey ?? nonEmpty(process.env.GEMINI_API_KEY);
    this.heavyModel = config.heavyModel ?? nonEmpty(process.env.GEMINI_HEAVY_MODEL) ?? DEFAULT_GEMINI_HEAVY_MODEL;
    this.fastModel = config.fastModel ?? nonEmpty(process.env.GEMINI_FAST_MODEL) ?? DEFAULT_GEMINI_FAST_MODEL;
  }

  modelFor(tier: ModelTier): string {
    return tier === 'heavy' ? this.heavyModel : this.fastModel;
  }

  private getClient(): GoogleGenAI {
    if (!this.apiKey) {
      throw new Error('GEMINI_API_KEY is not set. Add it to the environment or set AI_PROVIDER=ollama.');
    }
    if (!this.client) this.client = new GoogleGenAI({ apiKey: this.apiKey });
    return this.client;
  }

  async generateStructured<T extends z.ZodTypeAny>(opts: GenerateStructuredOptions<T>): Promise<z.infer<T>> {
    const ai = this.getClient();
    const model = this.modelFor(opts.tier);
    const responseJsonSchema = toGeminiJsonSchema(toJsonSchema(opts.schema));
    const contents: Content[] = [textContent('user', opts.userPrompt)];
    const maxAttempts = MAX_STRUCTURED_REPAIR_RETRIES + 1;
    let lastRaw = '';
    let lastProblem = '';

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const response = await ai.models.generateContent({
        model,
        contents,
        config: {
          systemInstruction: opts.systemPrompt,
          temperature: opts.temperature ?? 0.2,
          responseMimeType: 'application/json',
          responseJsonSchema,
        },
      });
      lastRaw = response.text ?? '';

      const parsed = parseStructuredOutput(lastRaw, opts.schema);
      if (parsed.ok) return parsed.data;
      lastProblem = parsed.problem;

      if (attempt < maxAttempts) {
        contents.push(textContent('model', lastRaw));
        contents.push(textContent('user', buildRepairMessage(opts.schemaName, parsed.problem)));
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
    const ai = this.getClient();
    const systemParts = opts.messages.filter((turn) => turn.role === 'system').map((turn) => turn.content);
    const contents: Content[] = opts.messages
      .filter((turn) => turn.role !== 'system')
      .map((turn) => textContent(turn.role === 'assistant' ? 'model' : 'user', turn.content));
    if (contents.length === 0) contents.push(textContent('user', 'Begin.'));

    const stream = await ai.models.generateContentStream({
      model: this.modelFor(opts.tier),
      contents,
      config: {
        systemInstruction: systemParts.length > 0 ? systemParts.join('\n\n') : undefined,
        temperature: opts.temperature ?? 0.6,
        maxOutputTokens: opts.maxOutputTokens,
        abortSignal: opts.signal,
      },
    });

    for await (const chunk of stream) {
      if (opts.signal?.aborted) return;
      const token = chunk.text;
      if (token) yield token;
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
