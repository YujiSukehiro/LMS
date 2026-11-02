import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import type { GenerateStructuredOptions, LLMGateway, LLMHealth, StreamChatOptions } from '@/lib/ai/types';
import {
  LocalRuntimeLimiter,
  LocalRuntimeProfileSchema,
  createLocalRuntimeProfile,
  openAICompatibleProfileFromEnv,
} from '@/lib/ai/local-runtime';
import { runLocalCapabilityPreflight } from '@/lib/ai/local-preflight';

class SyntheticGateway implements LLMGateway {
  readonly providerName = 'openai_compatible' as const;
  healthFails = false;
  basicChatFails = false;
  invalidJudgeEvidence = false;
  readonly structuredRequests: GenerateStructuredOptions<z.ZodTypeAny>[] = [];

  async healthCheck(): Promise<LLMHealth> {
    return this.healthFails
      ? { ok: false, provider: this.providerName, models: [], error: 'Synthetic chat unavailable' }
      : { ok: true, provider: this.providerName, models: ['synthetic-heavy', 'synthetic-fast'] };
  }

  async generateChat(opts: StreamChatOptions): Promise<string> {
    const prompt = opts.messages.at(-1)?.content ?? '';
    if (prompt.includes('long synthetic')) {
      return new Promise<string>((_resolve, reject) => {
        const onAbort = () => reject(new Error('Synthetic request cancelled'));
        if (opts.signal?.aborted) onAbort();
        else opts.signal?.addEventListener('abort', onAbort, { once: true });
      });
    }
    if (this.basicChatFails && prompt.includes('READY')) throw new Error('Synthetic basic chat failure');
    await new Promise((resolve) => setTimeout(resolve, 2));
    return prompt.includes('READY') ? 'READY' : `Synthetic response ${prompt.length}`;
  }

  async *streamChat(opts: StreamChatOptions): AsyncGenerator<string, void, unknown> {
    if (opts.signal?.aborted) throw new Error('Synthetic stream cancelled');
    yield 'Synthetic ';
    yield 'stream';
  }

  async generateStructured<T extends z.ZodTypeAny>(opts: GenerateStructuredOptions<T>): Promise<z.infer<T>> {
    this.structuredRequests.push(opts);
    let value: unknown;
    if (opts.schemaName === 'LocalPreflightNestedStructured') {
      value = {
        status: 'ready',
        course: { title: 'Synthetic Practice', modules: [{ title: 'Verification', objectives: ['Verify a practice order'] }] },
      };
    } else if (opts.schemaName === 'LocalPreflightHeavyCurriculum') {
      value = {
        trackTitle: 'Synthetic Medication Support',
        stage: 'curriculum_draft',
        summary: 'A sufficiently detailed synthetic curriculum summary for preflight.',
        units: [1, 2].map((number) => ({
          title: `Synthetic unit ${number}`,
          estimatedMinutes: 15,
          objectives: ['Verify synthetic information', 'Use only approved practice steps'],
          sourceEvidence: [{ sourceId: `syn-policy-${number}`, excerpt: number === 1 ? 'The learner verifies' : 'The learner offers' }],
        })),
        trainerNotes: ['Synthetic content only; trainer review required.'],
      };
    } else if (opts.schemaName === 'LocalPreflightJudgeEvidence') {
      value = {
        verdict: 'pass',
        findings: [
          {
            criterion: 'verification',
            assessment: 'The learner stated the synthetic verification step.',
            evidenceIds: [this.invalidJudgeEvidence ? 'invented_turn' : 'turn_1'],
          },
        ],
      };
    } else {
      throw new Error(`Unexpected synthetic schema: ${opts.schemaName}`);
    }
    return opts.schema.parse(value) as z.infer<T>;
  }
}

function profile() {
  return createLocalRuntimeProfile({
    provider: 'openai_compatible',
    runtimeLabel: 'Synthetic Runtime',
    baseUrl: 'http://127.0.0.1:8080',
    models: {
      structuredGeneration: 'synthetic-heavy',
      streamingChat: 'synthetic-fast',
      judge: 'synthetic-heavy',
    },
    now: new Date('2026-01-02T03:04:05.000Z'),
  });
}

describe('local runtime profiles', () => {
  it('maps heavy and fast environment models into separate role configuration', () => {
    const result = openAICompatibleProfileFromEnv(
      {
        OPENAI_COMPATIBLE_BASE_URL: 'http://localhost:9000/',
        OPENAI_COMPATIBLE_HEAVY_MODEL: 'synthetic-heavy',
        OPENAI_COMPATIBLE_FAST_MODEL: 'synthetic-fast',
        LOCAL_RUNTIME_LABEL: 'Synthetic Label',
      },
      new Date('2026-01-02T03:04:05.000Z'),
    );
    expect(result).toMatchObject({
      provider: 'openai_compatible',
      runtimeLabel: 'Synthetic Label',
      baseUrl: 'http://localhost:9000',
      models: {
        structuredGeneration: 'synthetic-heavy',
        streamingChat: 'synthetic-fast',
        judge: 'synthetic-heavy',
      },
      defaults: { maxConcurrency: 1 },
    });
    expect(openAICompatibleProfileFromEnv({})).toBeNull();
  });

  it('requires a loopback URL and concurrency 1', () => {
    expect(() => createLocalRuntimeProfile({ ...profile(), baseUrl: 'https://api.openai.com' })).toThrow(/loopback|Hosted/i);
    const invalid = { ...profile(), defaults: { ...profile().defaults, maxConcurrency: 2 } };
    expect(LocalRuntimeProfileSchema.safeParse(invalid).success).toBe(false);
  });
});

describe('LocalRuntimeLimiter', () => {
  it('serializes excess work and removes cancelled waiters', async () => {
    const limiter = new LocalRuntimeLimiter();
    const releaseFirst = await limiter.acquire();
    const controller = new AbortController();
    const waiting = limiter.acquire(controller.signal);
    expect(limiter.pendingCount).toBe(1);
    controller.abort();
    await expect(waiting).rejects.toThrow(/cancelled.*waiting/i);
    expect(limiter.pendingCount).toBe(0);
    releaseFirst();
    expect(limiter.activeCount).toBe(0);
  });
});

describe('runLocalCapabilityPreflight', () => {
  it('passes independent chat, streaming, nested, heavy, judge, cancellation, and concurrency checks', async () => {
    const gateway = new SyntheticGateway();
    const report = await runLocalCapabilityPreflight(profile(), gateway, { cancellationDelayMs: 5 });

    expect(report.status).toBe('ready');
    expect(report.capabilities).toHaveLength(8);
    expect(report.capabilities.every((result) => result.status === 'passed')).toBe(true);
    expect(gateway.structuredRequests.map((request) => request.schemaName)).toEqual([
      'LocalPreflightNestedStructured',
      'LocalPreflightHeavyCurriculum',
      'LocalPreflightJudgeEvidence',
    ]);
    const heavy = report.capabilities.find((result) => result.capability === 'heavy_generation');
    expect(heavy?.details).toMatchObject({ budgetStatus: 'within_budget', maxOutputTokens: 1200 });
    const concurrency = report.capabilities.find((result) => result.capability === 'concurrency');
    expect(concurrency?.details).toMatchObject({ configuredLimit: 1, maxObserved: 1, queueItemsAfterRun: 0 });
    expect(JSON.stringify(report)).not.toContain('A sufficiently detailed synthetic curriculum summary');
  });

  it('marks basic chat failure blocked and leaves dependent capabilities not tested', async () => {
    const gateway = new SyntheticGateway();
    gateway.basicChatFails = true;
    const report = await runLocalCapabilityPreflight(profile(), gateway, { cancellationDelayMs: 5 });

    expect(report.status).toBe('blocked');
    expect(report.capabilities.find((result) => result.capability === 'basic_chat')).toMatchObject({
      status: 'failed',
      error: 'Synthetic basic chat failure',
    });
    expect(report.capabilities.find((result) => result.capability === 'heavy_generation')?.status).toBe('not_tested');
    expect(report.capabilities.find((result) => result.capability === 'basic_chat')?.nextStep).toMatch(/chat-capable/i);
  });

  it('rejects invented judge evidence and reports degraded rather than ready', async () => {
    const gateway = new SyntheticGateway();
    gateway.invalidJudgeEvidence = true;
    const report = await runLocalCapabilityPreflight(profile(), gateway, { cancellationDelayMs: 5 });

    expect(report.status).toBe('degraded');
    expect(report.capabilities.find((result) => result.capability === 'judge_evidence')).toMatchObject({
      status: 'failed',
    });
    expect(report.capabilities.find((result) => result.capability === 'judge_evidence')?.error).toMatch(/outside the golden transcript/i);
  });

  it('returns not_configured without a profile or live gateway', async () => {
    const report = await runLocalCapabilityPreflight(null);
    expect(report.status).toBe('not_configured');
    expect(report.capabilities.every((result) => result.status === 'not_tested')).toBe(true);
    expect(report.capabilities[0].nextStep).toContain('OPENAI_COMPATIBLE_BASE_URL');
  });
});
