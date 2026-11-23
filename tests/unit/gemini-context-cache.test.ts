/**
 * Gemini context caching (2026-11-23): a Unit's shared prompt prefix is cached once and later calls send only the
 * rest. Any cache failure falls back to the full prompt.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const sdk = vi.hoisted(() => ({ generateContent: vi.fn(), createCache: vi.fn() }));

vi.mock('@google/genai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@google/genai')>();
  class GoogleGenAI {
    models = { generateContent: sdk.generateContent };
    caches = { create: sdk.createCache };
  }
  return { ...actual, GoogleGenAI };
});

import { FinishReason } from '@google/genai';
import { GeminiProvider, MIN_CACHEABLE_PREFIX_CHARS } from '@/lib/ai/gemini-provider';

const schema = z.object({ answer: z.string() });
const prefix = 'SOURCE PAGES '.repeat(Math.ceil(MIN_CACHEABLE_PREFIX_CHARS / 13) + 1);
const ok = { text: '{"answer":"ok"}', candidates: [{ finishReason: FinishReason.STOP }] };

function call(provider: GeminiProvider, task: string, cacheablePrefix: string | undefined = prefix) {
  return provider.generateStructured({
    tier: 'heavy', systemPrompt: 'system', userPrompt: `${prefix}\nTASK ${task}`, schema, schemaName: 'Answer', cacheablePrefix,
  });
}

beforeEach(() => {
  sdk.generateContent.mockReset();
  sdk.createCache.mockReset();
  vi.unstubAllEnvs();
});

describe('Gemini context cache', () => {
  it('creates one cache for a shared prefix and sends only the task on each call', async () => {
    sdk.createCache.mockResolvedValue({ name: 'cachedContents/abc' });
    sdk.generateContent.mockResolvedValue(ok);
    const provider = new GeminiProvider({ apiKey: 'k', heavyModel: 'm' });
    await call(provider, 'cards');
    await call(provider, 'drills 1');
    expect(sdk.createCache).toHaveBeenCalledTimes(1);
    const cacheArgs = sdk.createCache.mock.calls[0][0];
    expect(cacheArgs.config.systemInstruction).toBe('system');
    expect(cacheArgs.config.contents[0].parts[0].text).toBe(prefix);
    for (const [params] of sdk.generateContent.mock.calls) {
      expect(params.config.cachedContent).toBe('cachedContents/abc');
      expect(params.config.systemInstruction).toBeUndefined();
      expect(params.contents[0].parts[0].text.startsWith('TASK')).toBe(true);
    }
  });

  it('sends the full prompt when the cache cannot be created', async () => {
    sdk.createCache.mockRejectedValue(Object.assign(new Error('model does not support caching'), { status: 400 }));
    sdk.generateContent.mockResolvedValue(ok);
    await call(new GeminiProvider({ apiKey: 'k', heavyModel: 'm' }), 'cards');
    const [params] = sdk.generateContent.mock.calls[0];
    expect(params.config.cachedContent).toBeUndefined();
    expect(params.config.systemInstruction).toBe('system');
    expect(params.contents[0].parts[0].text.startsWith(prefix)).toBe(true);
  });

  it('retries with the full prompt when a cached call fails', async () => {
    sdk.createCache.mockResolvedValue({ name: 'cachedContents/gone' });
    sdk.generateContent.mockRejectedValueOnce(Object.assign(new Error('cache not found'), { status: 404 })).mockResolvedValue(ok);
    await call(new GeminiProvider({ apiKey: 'k', heavyModel: 'm' }), 'cards');
    expect(sdk.generateContent).toHaveBeenCalledTimes(2);
    const retry = sdk.generateContent.mock.calls[1][0];
    expect(retry.config.cachedContent).toBeUndefined();
    expect(retry.contents[0].parts[0].text.startsWith(prefix)).toBe(true);
  });

  it('does not cache small prefixes, or when turned off', async () => {
    sdk.generateContent.mockResolvedValue(ok);
    await call(new GeminiProvider({ apiKey: 'k', heavyModel: 'm' }), 'cards', 'SOURCE');
    vi.stubEnv('GEMINI_CONTEXT_CACHE', 'off');
    await call(new GeminiProvider({ apiKey: 'k', heavyModel: 'm' }), 'cards');
    expect(sdk.createCache).not.toHaveBeenCalled();
  });
});
