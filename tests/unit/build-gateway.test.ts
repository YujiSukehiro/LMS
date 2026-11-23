/** Connor 2026-11-23: Neon writes Tracks, Flash runs Verbal Practice. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getBuildGateway, getLLMGateway } from '@/lib/ai/gateway';
import { GeminiProvider } from '@/lib/ai/gemini-provider';

afterEach(() => vi.unstubAllEnvs());

describe('build gateway', () => {
  it('uses GEMINI_BUILD_MODEL for every Track-building tier and leaves practice on the main models', () => {
    vi.stubEnv('AI_PROVIDER', 'gemini');
    vi.stubEnv('GEMINI_HEAVY_MODEL', 'gemini-3.8-flash');
    vi.stubEnv('GEMINI_FAST_MODEL', 'gemini-3.5-flash-lite');
    vi.stubEnv('GEMINI_BUILD_MODEL', 'gemini-4-neon');
    vi.stubEnv('GEMINI_BUILD_THINKING_BUDGET', '2048');
    const build = getBuildGateway() as GeminiProvider;
    expect(build.modelFor('heavy')).toBe('gemini-4-neon');
    expect(build.modelFor('fast')).toBe('gemini-4-neon');
    expect(build.planningModel).toBe('gemini-4-neon');
    expect(build.thinkingBudget).toBe(2048);
    const practice = getLLMGateway() as GeminiProvider;
    expect(practice.modelFor('heavy')).toBe('gemini-3.8-flash');
    expect(practice.modelFor('fast')).toBe('gemini-3.5-flash-lite');
  });

  it('is the normal gateway when no build model is set', () => {
    vi.stubEnv('AI_PROVIDER', 'gemini');
    vi.stubEnv('GEMINI_BUILD_MODEL', '');
    expect(getBuildGateway()).toBe(getLLMGateway());
  });
});
