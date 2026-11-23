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
  maxOutputTokens?: number;
  signal?: AbortSignal;
  /**
   * 'planning' marks the one call that plans a whole Track (the blueprint). Providers that support it may use a
   * stronger model or more thinking for it (Gemini: GEMINI_PLANNING_MODEL / GEMINI_PLANNING_THINKING_BUDGET).
   */
  purpose?: 'planning';
  /**
   * A leading part of `userPrompt` that several calls share word for word (a Unit's source pages and rules).
   * Providers that support it (Gemini context caching) bill it once per cache instead of on every call; others
   * ignore it, since it is already inside `userPrompt`. Ignored unless `userPrompt` starts with it.
   */
  cacheablePrefix?: string;
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
  readonly providerName: 'ollama' | 'gemini' | 'openai_compatible' | 'replay';
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

/** Default output budget for structured calls when the caller does not pass `maxOutputTokens`. */
export const DEFAULT_STRUCTURED_MAX_OUTPUT_TOKENS = 8192;
/** Ceiling for the single automatic retry after a truncated (finish_reason "length") structured response. */
export const MAX_STRUCTURED_MAX_OUTPUT_TOKENS = 16384;

/**
 * Thrown when the model stopped because it hit the output-token limit (finish_reason / done_reason "length",
 * Gemini MAX_TOKENS). Truncated JSON is never schema-repaired: raise the limit instead.
 */
export class LLMOutputTruncatedError extends Error {
  override readonly name = 'LLMOutputTruncatedError';

  constructor(
    message: string,
    /** The largest max-output-token value that was attempted. */
    public readonly maxOutputTokens: number,
    /** Character length of the truncated raw output. */
    public readonly rawLength: number,
    public readonly schemaName?: string,
  ) {
    super(message);
  }
}

export type AIUnavailableCode =
  /** AI_PROVIDER=manual_chat: there is deliberately no live gateway. */
  | 'manual_chat'
  /** AI_PROVIDER is set to a value the app does not recognise. */
  | 'invalid_provider'
  /** A required setting (model name, API key) is missing. */
  | 'not_configured'
  /** The runtime could not be reached (connection refused, DNS, network failure). */
  | 'unreachable'
  /** The local runtime did not answer within the request timeout. */
  | 'timeout'
  /** The configured model is installed but cannot chat (e.g. an Ollama model without the "completion" capability). */
  | 'model_cannot_chat';

/**
 * The AI runtime cannot serve requests right now. Routes should map this to HTTP 503 with `message`
 * (use `isAIUnavailableError`, which also works across duplicated module instances).
 */
export class AIUnavailableError extends Error {
  override readonly name = 'AIUnavailableError';

  constructor(
    message: string,
    public readonly code: AIUnavailableCode,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

export function isAIUnavailableError(error: unknown): error is AIUnavailableError {
  return error instanceof AIUnavailableError || (error instanceof Error && error.name === 'AIUnavailableError' && 'code' in error);
}

export function isLLMOutputTruncatedError(error: unknown): error is LLMOutputTruncatedError {
  return error instanceof LLMOutputTruncatedError || (error instanceof Error && error.name === 'LLMOutputTruncatedError');
}

/**
 * Thrown when the hosted model refused to answer (Gemini SAFETY / RECITATION / BLOCKLIST / PROHIBITED_CONTENT
 * finish, or a blocked prompt). Retrying the same prompt gives the same result, so this is never schema-repaired;
 * the message is written for the person who started the request.
 */
export class LLMContentBlockedError extends Error {
  override readonly name = 'LLMContentBlockedError';

  constructor(
    message: string,
    /** The provider's reason, e.g. "SAFETY", "RECITATION" or "prompt:PROHIBITED_CONTENT". */
    public readonly reason: string,
    public readonly schemaName?: string,
  ) {
    super(message);
  }
}

export function isLLMContentBlockedError(error: unknown): error is LLMContentBlockedError {
  return error instanceof LLMContentBlockedError || (error instanceof Error && error.name === 'LLMContentBlockedError');
}
