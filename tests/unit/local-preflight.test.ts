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
  /** When false, streams are not serialized, so the concurrency check must observe real overlap. */
  serializeStreams = true;
  private readonly streamLimiter = new LocalRuntimeLimiter();
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
    const release = this.serializeStreams ? await this.streamLimiter.acquire(opts.signal) : () => undefined;
    try {
      await new Promise((resolve) => setTimeout(resolve, 2));
      yield 'Synthetic ';
      await new Promise((resolve) => setTimeout(resolve, 2));
      yield 'stream';
    } finally {
      release();
    }
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
    // Unset base URL uses the provider's MLX default (never the Firestore emulator port 8080).
    expect(openAICompatibleProfileFromEnv({}).baseUrl).toBe('http://127.0.0.1:8081');
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

  it('fails the concurrency check when the gateway lets two generations overlap', async () => {
    const gateway = new SyntheticGateway();
    gateway.serializeStreams = false;
    const report = await runLocalCapabilityPreflight(profile(), gateway, { cancellationDelayMs: 5 });
    const concurrency = report.capabilities.find((result) => result.capability === 'concurrency');
    expect(concurrency).toMatchObject({ status: 'failed', details: { maxObserved: 2 } });
    expect(report.status).toBe('degraded');
  });

  it('quick mode runs only availability and basic chat', async () => {
    const gateway = new SyntheticGateway();
    const report = await runLocalCapabilityPreflight(profile(), gateway, { mode: 'quick' });
    expect(report.status).toBe('ready');
    expect(gateway.structuredRequests).toHaveLength(0);
    const statuses = Object.fromEntries(report.capabilities.map((result) => [result.capability, result.status]));
    expect(statuses).toMatchObject({ availability: 'passed', basic_chat: 'passed', structured_output: 'not_tested', concurrency: 'not_tested' });
  });

  it('rejects when the caller aborts', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(runLocalCapabilityPreflight(profile(), new SyntheticGateway(), { signal: controller.signal })).rejects.toThrow(/cancelled/i);
  });

  it('uses Ollama-specific hints for an Ollama profile', async () => {
    const gateway = new SyntheticGateway();
    gateway.healthFails = true;
    const ollamaProfile = createLocalRuntimeProfile({
      provider: 'ollama',
      baseUrl: 'http://192.168.1.20:11434/',
      models: { structuredGeneration: 'synthetic-heavy', streamingChat: 'synthetic-fast' },
    });
    expect(ollamaProfile.baseUrl).toBe('http://192.168.1.20:11434');
    const report = await runLocalCapabilityPreflight(ollamaProfile, gateway);
    const nextStep = report.capabilities.find((result) => result.capability === 'availability')?.nextStep ?? '';
    expect(nextStep).toMatch(/ollama serve/);
    expect(nextStep).toMatch(/OLLAMA_HEAVY_MODEL/);
    expect(nextStep).not.toMatch(/OPENAI_COMPATIBLE/);
  });

  it('returns not_configured without a profile or live gateway', async () => {
    const report = await runLocalCapabilityPreflight(null);
    expect(report.status).toBe('not_configured');
    expect(report.capabilities.every((result) => result.status === 'not_tested')).toBe(true);
    expect(report.capabilities[0].nextStep).toContain('OPENAI_COMPATIBLE_BASE_URL');
  });
});

describe('quick health check on a busy single-slot runtime', () => {
  class BusyGateway extends SyntheticGateway {
    queue = { active: 0, pending: 0 };
    hangBasicChat = false;
    healthCalls = 0;
    runtimeQueueState() {
      return this.queue;
    }
    override async healthCheck(): Promise<LLMHealth> {
      this.healthCalls += 1;
      return super.healthCheck();
    }
    override async generateChat(opts: StreamChatOptions): Promise<string> {
      if (this.hangBasicChat) {
        return new Promise<string>((_resolve, reject) => opts.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
      }
      return super.generateChat(opts);
    }
  }
  const shortTimeouts = () => {
    const base = profile();
    return { ...base, defaults: { ...base.defaults, timeoutMsByTask: { ...base.defaults.timeoutMsByTask, availability: 50, basicChat: 50 } } };
  };

  it('reports degraded (not blocked) without queueing when this process already holds the slot', async () => {
    const gateway = new BusyGateway();
    gateway.queue = { active: 1, pending: 2 };
    const report = await runLocalCapabilityPreflight(profile(), gateway, { mode: 'quick' });
    expect(report.status).toBe('degraded');
    expect(gateway.healthCalls).toBe(0);
    expect(report.capabilities.find((c) => c.capability === 'availability')).toMatchObject({ status: 'not_tested' });
  });

  it('turns a quick-check timeout (queued on the server) into degraded, never blocked', async () => {
    const gateway = new BusyGateway();
    gateway.hangBasicChat = true;
    const report = await runLocalCapabilityPreflight(shortTimeouts(), gateway, { mode: 'quick' });
    expect(report.status).toBe('degraded');
    expect(report.capabilities.find((c) => c.capability === 'basic_chat')).toMatchObject({ status: 'not_tested' });
  });

  it('still blocks on a real failure, and the full check still reports a timeout as failed', async () => {
    const failing = new BusyGateway();
    failing.healthFails = true;
    expect((await runLocalCapabilityPreflight(profile(), failing, { mode: 'quick' })).status).toBe('blocked');
    const slow = new BusyGateway();
    slow.hangBasicChat = true;
    expect((await runLocalCapabilityPreflight(shortTimeouts(), slow, { mode: 'full', cancellationDelayMs: 5 })).status).toBe('blocked');
  });
});
