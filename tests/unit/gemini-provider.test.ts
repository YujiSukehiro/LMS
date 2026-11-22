/**
 * GeminiProvider against a mocked @google/genai client (no network): abort signal, output-token limits,
 * MAX_TOKENS truncation handling and the optional fixed thinking budget.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const sdk = vi.hoisted(() => ({
  generateContent: vi.fn(),
  generateContentStream: vi.fn(),
  get: vi.fn(),
  constructed: [] as unknown[],
}));

vi.mock('@google/genai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@google/genai')>();
  class GoogleGenAI {
    models = { generateContent: sdk.generateContent, generateContentStream: sdk.generateContentStream, get: sdk.get };
    constructor(options: unknown) {
      sdk.constructed.push(options);
    }
  }
  return { ...actual, GoogleGenAI };
});

import { FinishReason } from '@google/genai';
import { BlockedReason } from '@google/genai';
import { GEMINI_RETRY_OPTIONS, GeminiProvider, geminiBlockReason, thinkingBudgetFromEnv } from '@/lib/ai/gemini-provider';
import { describeGenerationError } from '@/lib/ai/pipeline/generate-track';
import {
  AIUnavailableError,
  LLMContentBlockedError,
  LLMOutputTruncatedError,
  MAX_STRUCTURED_MAX_OUTPUT_TOKENS,
  isLLMContentBlockedError,
} from '@/lib/ai/types';

const schema = z.object({ answer: z.string() });

function response(text: string, finishReason: FinishReason = FinishReason.STOP) {
  return { text, candidates: [{ finishReason }] };
}

function structured(provider: GeminiProvider, signal?: AbortSignal, maxOutputTokens?: number) {
  return provider.generateStructured({
    tier: 'heavy', systemPrompt: 'system', userPrompt: 'user', schema, schemaName: 'Answer', maxOutputTokens, signal,
  });
}

beforeEach(() => {
  sdk.generateContent.mockReset();
  sdk.generateContentStream.mockReset();
  sdk.get.mockReset();
  sdk.constructed.length = 0;
  vi.unstubAllEnvs();
});

describe('GeminiProvider', () => {
  it('passes the abort signal, the caller output limit and the JSON schema to generateContent', async () => {
    sdk.generateContent.mockResolvedValueOnce(response('{"answer":"ok"}'));
    const controller = new AbortController();
    const provider = new GeminiProvider({ apiKey: 'test-key', heavyModel: 'heavy-model', fastModel: 'fast-model' });

    await expect(structured(provider, controller.signal, 3000)).resolves.toEqual({ answer: 'ok' });

    const params = sdk.generateContent.mock.calls[0][0];
    expect(params.model).toBe('heavy-model');
    expect(params.config.abortSignal).toBe(controller.signal);
    expect(params.config.maxOutputTokens).toBe(3000);
    expect(params.config.responseMimeType).toBe('application/json');
    expect(params.config.responseJsonSchema).toBeTruthy();
    expect(params.config.systemInstruction).toBe('system');
    expect(params.config.thinkingConfig).toBeUndefined();
  });

  it('falls back to a relaxed schema, then to no schema, when Gemini says the schema has too many states', async () => {
    const tooComplex = new Error('{"error":{"code":400,"message":"The specified schema produces a constraint that has too many states for serving."}}');
    const bounded = z.object({ items: z.array(z.string()).min(2).max(4) });
    sdk.generateContent
      .mockRejectedValueOnce(tooComplex)
      .mockRejectedValueOnce(tooComplex)
      .mockResolvedValueOnce(response('{"items":["a","b"]}'))
      .mockResolvedValueOnce(response('{"items":["c","d"]}'));
    const provider = new GeminiProvider({ apiKey: 'test-key', heavyModel: 'heavy-model' });
    const call = () =>
      provider.generateStructured({ tier: 'heavy', systemPrompt: 'system', userPrompt: 'user', schema: bounded, schemaName: 'Bounded' });

    await expect(call()).resolves.toEqual({ items: ['a', 'b'] });
    const [full, relaxed, none] = sdk.generateContent.mock.calls.map((c) => c[0]);
    expect(JSON.stringify(full.config.responseJsonSchema)).toContain('minItems');
    expect(JSON.stringify(relaxed.config.responseJsonSchema)).not.toContain('minItems');
    expect(none.config.responseJsonSchema).toBeUndefined();
    expect(none.config.systemInstruction).toContain('JSON Schema');

    // The fallback is remembered for this schema: the next call goes straight to JSON mode.
    await expect(call()).resolves.toEqual({ items: ['c', 'd'] });
    expect(sdk.generateContent).toHaveBeenCalledTimes(4);
    expect(sdk.generateContent.mock.calls[3][0].config.responseJsonSchema).toBeUndefined();
  });

  it('does not swallow other Gemini 400 errors', async () => {
    sdk.generateContent.mockRejectedValueOnce(new Error('{"error":{"code":400,"message":"API key not valid."}}'));
    const provider = new GeminiProvider({ apiKey: 'test-key' });
    await expect(structured(provider)).rejects.toThrow(/API key not valid/);
    expect(sdk.generateContent).toHaveBeenCalledTimes(1);
  });

  it('retries a MAX_TOKENS answer once at double the limit without a repair turn', async () => {
    sdk.generateContent
      .mockResolvedValueOnce(response('{"answer":"cut', FinishReason.MAX_TOKENS))
      .mockResolvedValueOnce(response('{"answer":"whole"}'));
    const provider = new GeminiProvider({ apiKey: 'test-key' });

    await expect(structured(provider, undefined, 4096)).resolves.toEqual({ answer: 'whole' });
    const [first, second] = sdk.generateContent.mock.calls.map((call) => call[0]);
    expect(first.config.maxOutputTokens).toBe(4096);
    expect(second.config.maxOutputTokens).toBe(8192);
    // Truncated JSON is never sent back as a repair turn.
    expect(second.contents).toHaveLength(1);
  });

  it('raises LLMOutputTruncatedError when the doubled limit is truncated too', async () => {
    sdk.generateContent.mockResolvedValue(response('', FinishReason.MAX_TOKENS));
    const provider = new GeminiProvider({ apiKey: 'test-key' });

    const error = await structured(provider, undefined, 8192).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(LLMOutputTruncatedError);
    expect((error as LLMOutputTruncatedError).maxOutputTokens).toBe(MAX_STRUCTURED_MAX_OUTPUT_TOKENS);
    expect(sdk.generateContent).toHaveBeenCalledTimes(2);
  });

  it('does not call the model once the signal is aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const provider = new GeminiProvider({ apiKey: 'test-key' });

    await expect(structured(provider, controller.signal, 1024)).rejects.toThrow();
    expect(sdk.generateContent).not.toHaveBeenCalled();
  });

  it('adds a fixed thinking budget on top of the visible output limit', async () => {
    sdk.generateContent.mockResolvedValueOnce(response('{"answer":"ok"}'));
    sdk.generateContentStream.mockResolvedValueOnce((async function* () { yield { text: 'Hello' }; })());
    const provider = new GeminiProvider({ apiKey: 'test-key', thinkingBudget: 0 });

    await structured(provider, undefined, 3000);
    expect(sdk.generateContent.mock.calls[0][0].config).toMatchObject({ maxOutputTokens: 3000, thinkingConfig: { thinkingBudget: 0 } });

    const withBudget = new GeminiProvider({ apiKey: 'test-key', thinkingBudget: 512 });
    const chunks: string[] = [];
    for await (const chunk of withBudget.streamChat({ tier: 'fast', messages: [{ role: 'user', content: 'Hi' }], maxOutputTokens: 160 })) chunks.push(chunk);
    expect(chunks).toEqual(['Hello']);
    expect(sdk.generateContentStream.mock.calls[0][0].config).toMatchObject({ maxOutputTokens: 672, thinkingConfig: { thinkingBudget: 512 } });
  });

  it('reads GEMINI_THINKING_BUDGET as a whole number only', () => {
    expect(thinkingBudgetFromEnv(undefined)).toBeUndefined();
    expect(thinkingBudgetFromEnv('')).toBeUndefined();
    expect(thinkingBudgetFromEnv('-1')).toBeUndefined();
    expect(thinkingBudgetFromEnv('abc')).toBeUndefined();
    expect(thinkingBudgetFromEnv('0')).toBe(0);
    expect(thinkingBudgetFromEnv(' 1024 ')).toBe(1024);
    vi.stubEnv('GEMINI_THINKING_BUDGET', '256');
    expect(new GeminiProvider({ apiKey: 'test-key' }).thinkingBudget).toBe(256);
  });

  it('streams chat with the signal and the caller limit, and stops after an abort', async () => {
    const controller = new AbortController();
    sdk.generateContentStream.mockResolvedValueOnce((async function* () {
      yield { text: 'Hello' };
      controller.abort();
      yield { text: ' there' };
    })());
    const provider = new GeminiProvider({ apiKey: 'test-key', fastModel: 'fast-model' });

    const chunks: string[] = [];
    for await (const chunk of provider.streamChat({
      tier: 'fast',
      messages: [{ role: 'system', content: 'Be a caller.' }, { role: 'user', content: 'Hi' }],
      maxOutputTokens: 160,
      signal: controller.signal,
    })) chunks.push(chunk);

    expect(chunks).toEqual(['Hello']);
    const params = sdk.generateContentStream.mock.calls[0][0];
    expect(params.model).toBe('fast-model');
    expect(params.config).toMatchObject({ maxOutputTokens: 160, abortSignal: controller.signal, systemInstruction: 'Be a caller.' });
    expect(params.contents).toEqual([{ role: 'user', parts: [{ text: 'Hi' }] }]);
  });

  it('throws AIUnavailableError (not_configured) without an API key', async () => {
    vi.stubEnv('GEMINI_API_KEY', '');
    const provider = new GeminiProvider();
    const error = await structured(provider).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AIUnavailableError);
    expect((error as AIUnavailableError).code).toBe('not_configured');
    expect(sdk.constructed).toHaveLength(0);
  });

  it('configures SDK retries for transient 429/5xx failures with bounded backoff', async () => {
    sdk.generateContent.mockResolvedValueOnce(response('{"answer":"ok"}'));
    await structured(new GeminiProvider({ apiKey: 'test-key' }));
    expect(sdk.constructed).toEqual([{ apiKey: 'test-key', httpOptions: { retryOptions: GEMINI_RETRY_OPTIONS } }]);
    expect(GEMINI_RETRY_OPTIONS.attempts).toBeGreaterThan(1);
    expect(GEMINI_RETRY_OPTIONS.attempts).toBeLessThanOrEqual(4);
    expect(GEMINI_RETRY_OPTIONS.maxDelay).toBeLessThanOrEqual(10);
    // Default retryable codes (408, 429, 5xx) are kept; 4xx request errors are never retried.
    expect(GEMINI_RETRY_OPTIONS.httpStatusCodes).toBeUndefined();
  });

  it.each([
    ['SAFETY finish', { text: undefined, candidates: [{ finishReason: FinishReason.SAFETY }] }, 'SAFETY'],
    ['RECITATION finish', { text: '{"answer":"par', candidates: [{ finishReason: FinishReason.RECITATION }] }, 'RECITATION'],
    ['blocked prompt', { text: undefined, candidates: [], promptFeedback: { blockReason: BlockedReason.PROHIBITED_CONTENT } }, 'prompt:PROHIBITED_CONTENT'],
  ])('throws LLMContentBlockedError on a %s without running the repair loop', async (_label, blockedResponse, reason) => {
    sdk.generateContent.mockResolvedValue(blockedResponse);
    const error = await structured(new GeminiProvider({ apiKey: 'test-key', heavyModel: 'heavy-model' }), undefined, 2048)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(LLMContentBlockedError);
    expect(isLLMContentBlockedError(error)).toBe(true);
    expect((error as LLMContentBlockedError).reason).toBe(reason);
    expect((error as LLMContentBlockedError).schemaName).toBe('Answer');
    expect(sdk.generateContent).toHaveBeenCalledTimes(1);
    // The Track build shows the provider's message as is (no "invalid JSON after 3 attempts").
    const shown = describeGenerationError(error, 'Checkpoint 1 of 3');
    expect(shown).toMatch(/^Checkpoint 1 of 3: Gemini \(heavy-model\) blocked/);
    expect(shown).not.toMatch(/valid .* content after/);
  });

  it('does not treat a normal or truncated finish as blocked', () => {
    expect(geminiBlockReason({ candidates: [{ finishReason: FinishReason.STOP }] })).toBeNull();
    expect(geminiBlockReason({ candidates: [{ finishReason: FinishReason.MAX_TOKENS }] })).toBeNull();
    expect(geminiBlockReason({})).toBeNull();
  });

  it('streamChat throws on a block before any text, and ends quietly after partial text', async () => {
    const provider = new GeminiProvider({ apiKey: 'test-key' });
    const read = async () => {
      const chunks: string[] = [];
      for await (const chunk of provider.streamChat({ tier: 'fast', messages: [{ role: 'user', content: 'Hi' }], maxOutputTokens: 160 })) chunks.push(chunk);
      return chunks;
    };

    sdk.generateContentStream.mockResolvedValueOnce((async function* () {
      yield { text: undefined, promptFeedback: { blockReason: BlockedReason.SAFETY } };
    })());
    await expect(read()).rejects.toBeInstanceOf(LLMContentBlockedError);

    sdk.generateContentStream.mockResolvedValueOnce((async function* () {
      yield { text: 'Well, I' };
      yield { text: undefined, candidates: [{ finishReason: FinishReason.SAFETY }] };
      yield { text: ' never sent' };
    })());
    await expect(read()).resolves.toEqual(['Well, I']);
  });
});
