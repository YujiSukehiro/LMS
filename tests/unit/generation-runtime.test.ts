import { afterEach, describe, expect, it, vi } from 'vitest';
import { getActiveAiRuntime } from '@/lib/ai/gateway';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('active AI generation runtime profile', () => {
  it('exposes the normalized Ollama endpoint and effective structured-generation settings', () => {
    vi.stubEnv('AI_PROVIDER', 'ollama');
    vi.stubEnv('OLLAMA_BASE_URL', 'http://localhost:11434/');
    const first = getActiveAiRuntime();

    vi.stubEnv('OLLAMA_BASE_URL', 'http://127.0.0.1:21434///');
    const second = getActiveAiRuntime();

    expect(first.generationProfile).toEqual({
      baseUrl: 'http://localhost:11434',
      structuredGeneration: { temperature: 0.2, maxRepairRetries: 2, numCtx: 16384, keepAlive: '15m' },
    });
    expect(second.generationProfile).toEqual({
      ...first.generationProfile,
      baseUrl: 'http://127.0.0.1:21434',
    });
    expect(second.heavyModel).toBe(first.heavyModel);
    expect(second.runtimeLabel).toBe(first.runtimeLabel);
  });

  it('exposes the normalized OpenAI-compatible endpoint and provider timeout without credentials', () => {
    vi.stubEnv('AI_PROVIDER', 'openai_compatible');
    vi.stubEnv('OPENAI_COMPATIBLE_BASE_URL', 'http://localhost:8080/');
    const first = getActiveAiRuntime();

    vi.stubEnv('OPENAI_COMPATIBLE_BASE_URL', 'http://[::1]:18080/');
    const second = getActiveAiRuntime();

    expect(first.generationProfile).toEqual({
      baseUrl: 'http://localhost:8080',
      structuredGeneration: { temperature: 0.2, maxRepairRetries: 2, timeoutMs: 180_000 },
    });
    expect(second.generationProfile).toEqual({
      ...first.generationProfile,
      baseUrl: 'http://[::1]:18080',
    });
    expect(second.heavyModel).toBe(first.heavyModel);
    expect(second.runtimeLabel).toBe(first.runtimeLabel);
  });
});
