import { z } from 'zod';

export type ModelTier = 'heavy' | 'fast';

export interface ChatTurn {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface GenerateStructuredOptions<T extends z.ZodTypeAny> {
  tier: ModelTier;
  systemPrompt: string;
  userPrompt: string;
  schema: T;
  schemaName: string;
  temperature?: number; // Default 0.2 for deterministic grounded curriculum/grading
}

export interface StreamChatOptions {
  tier: ModelTier;
  messages: ChatTurn[];
  temperature?: number; // Default 0.6 for natural caller/patient conversation
  maxOutputTokens?: number;
  signal?: AbortSignal;
}

export interface LLMHealth {
  ok: boolean;
  provider: string;
  models: string[];
  error?: string;
}

export interface LLMGateway {
  readonly providerName: 'ollama' | 'gemini';
  generateStructured<T extends z.ZodTypeAny>(opts: GenerateStructuredOptions<T>): Promise<z.infer<T>>;
  streamChat(opts: StreamChatOptions): AsyncGenerator<string, void, unknown>;
  healthCheck(): Promise<LLMHealth>;
}

/** Thrown by a provider when structured output still fails validation after all self-repair retries. */
export class LLMStructuredOutputError extends Error {
  constructor(
    message: string,
    public readonly schemaName: string,
    public readonly attempts: number,
    public readonly lastRawOutput: string,
  ) {
    super(message);
    this.name = 'LLMStructuredOutputError';
  }
}
