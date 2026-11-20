import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LLMGateway } from '@/lib/ai/types';

const healthCheck = vi.fn<LLMGateway['healthCheck']>();
const generateChat = vi.fn(async () => 'READY');

vi.mock('@/lib/ai/gateway', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/gateway')>();
  return {
    ...actual,
    getLLMGateway: () => ({ providerName: 'openai_compatible', healthCheck, generateChat, streamChat: vi.fn(), generateStructured: vi.fn() }),
  };
});

const availability = await import('@/lib/ai/availability');

beforeEach(() => {
  availability.resetAiAvailabilityCache();
  healthCheck.mockReset();
  generateChat.mockClear();
  vi.stubEnv('AI_PROVIDER', 'openai_compatible');
  vi.stubEnv('OPENAI_COMPATIBLE_HEAVY_MODEL', 'synthetic-heavy');
  vi.stubEnv('OPENAI_COMPATIBLE_FAST_MODEL', 'synthetic-fast');
  vi.stubEnv('OPENAI_COMPATIBLE_BASE_URL', '');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('cached AI availability', () => {
  it('is unknown before any check and not_local for hosted providers', () => {
    expect(availability.getCachedAiAvailability().status).toBe('unknown');
    vi.stubEnv('AI_PROVIDER', 'gemini');
    expect(availability.getCachedAiAvailability().status).toBe('not_local');
    vi.stubEnv('AI_PROVIDER', 'manual_chat');
    expect(availability.getCachedAiAvailability().status).toBe('blocked');
    vi.stubEnv('AI_PROVIDER', 'bogus');
    expect(availability.getCachedAiAvailability()).toMatchObject({ status: 'blocked', message: expect.stringMatching(/not supported/) });
  });

  it('runs one cheap check for concurrent callers, caches success, and reports ready', async () => {
    healthCheck.mockResolvedValue({ ok: true, provider: 'openai_compatible', models: ['synthetic-heavy'] });
    const [first, second] = await Promise.all([availability.getCachedAiHealth(), availability.getCachedAiHealth()]);
    expect(first).toBe(second);
    expect(first.status).toBe('ready');
    expect(healthCheck).toHaveBeenCalledTimes(1);
    expect(generateChat).toHaveBeenCalledTimes(1); // basic chat only, no structured/heavy/judge calls
    await availability.getCachedAiHealth();
    expect(healthCheck).toHaveBeenCalledTimes(1);
    expect(availability.getCachedAiAvailability().status).toBe('ready');
  });

  it('caches failures briefly and then expires to unknown', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    healthCheck.mockResolvedValue({ ok: false, provider: 'openai_compatible', models: [], error: 'server down' });
    const body = await availability.getCachedAiHealth();
    expect(body.status).toBe('blocked');
    expect(availability.getCachedAiAvailability()).toMatchObject({ status: 'blocked', message: expect.stringMatching(/server down/) });
    vi.setSystemTime(Date.now() + availability.AI_AVAILABILITY_FAILURE_TTL_MS + 1);
    expect(availability.getCachedAiAvailability().status).toBe('unknown');
  });

  it('does not cache a check cancelled by its only caller', async () => {
    healthCheck.mockImplementation(() => new Promise(() => undefined));
    const controller = new AbortController();
    const pending = availability.getCachedAiHealth({ signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toThrow(/cancelled/);
    expect(availability.getCachedAiAvailability().status).toBe('unknown');
  });
});

describe('cached AI availability cancellation', () => {
  it('does not leak an unhandled rejection when the only caller is already aborted', async () => {
    healthCheck.mockImplementation(() => new Promise(() => undefined));
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      const controller = new AbortController();
      controller.abort();
      await expect(availability.getCachedAiHealth({ signal: controller.signal })).rejects.toThrow(/cancelled/);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});
