import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ProvenanceRecordSchema } from '@/lib/ai/provenance';
import {
  GENERATION_CHECKPOINT_SCHEMA_VERSION,
  GenerationReliabilityExecutor,
  GenerationStageTimeoutError,
  GenerationStageValidationError,
  hashGenerationInput,
  type GenerationAttemptResult,
  type GenerationCheckpoint,
  type GenerationCheckpointIdentity,
  type GenerationCheckpointStore,
  type GenerationStageOptions,
} from '@/lib/ai/pipeline/generation-reliability';

const OutputSchema = z.object({ value: z.string().min(3), count: z.number().int().nonnegative() }).strict();
type StageInput = { prompt: string; version?: string };
type StageOutput = z.infer<typeof OutputSchema>;

class MemoryCheckpointStore implements GenerationCheckpointStore {
  readonly records = new Map<string, unknown>();
  readonly writes: GenerationCheckpoint[] = [];

  private key(identity: GenerationCheckpointIdentity): string {
    return JSON.stringify([identity.runId, identity.trackId, identity.stageKey]);
  }

  async getCheckpoint(identity: GenerationCheckpointIdentity): Promise<unknown> {
    const value = this.records.get(this.key(identity));
    return value === undefined ? null : structuredClone(value);
  }

  async putCheckpoint(checkpoint: GenerationCheckpoint): Promise<void> {
    this.writes.push(structuredClone(checkpoint));
    this.records.set(this.key(checkpoint), structuredClone(checkpoint));
  }

  raw(identity: GenerationCheckpointIdentity): unknown {
    return structuredClone(this.records.get(this.key(identity)));
  }

  seed(identity: GenerationCheckpointIdentity, value: unknown): void {
    this.records.set(this.key(identity), structuredClone(value));
  }
}

function provenance() {
  return ProvenanceRecordSchema.parse({
    source: 'local_ai',
    provider: 'synthetic_provider',
    model: 'synthetic_model',
    prompt: { templateId: 'synthetic_stage', templateVersion: 'v1' },
    schema: { name: 'SyntheticStage', version: 'v1' },
    runtime: { label: 'in_memory', profileId: 'synthetic-local' },
    recordedAt: '2026-01-02T03:04:05.000Z',
  });
}

function options(
  overrides: Partial<GenerationStageOptions<StageInput, typeof OutputSchema>> = {},
): GenerationStageOptions<StageInput, typeof OutputSchema> {
  return {
    runId: 'run-synthetic-1',
    trackId: 'track-synthetic-1',
    stageKey: 'unit-1',
    input: { prompt: 'Synthetic generation input', version: 'v1' },
    schema: OutputSchema,
    timeoutMs: 1_000,
    provenance: provenance(),
    task: async (input) => ({ output: { value: `Generated ${input.prompt}`, count: 1 } }),
    ...overrides,
  };
}

function identity(stageKey = 'unit-1'): GenerationCheckpointIdentity {
  return { runId: 'run-synthetic-1', trackId: 'track-synthetic-1', stageKey };
}

async function seedCheckpoint(store: MemoryCheckpointStore, stageKey = 'unit-1'): Promise<GenerationCheckpoint> {
  const executor = new GenerationReliabilityExecutor(store);
  const result = await executor.executeStage(options({ stageKey }));
  return result.checkpoint;
}

describe('deterministic generation input hashing', () => {
  it('is stable across object key order and changes when exact input changes', () => {
    const left = { b: [2, { d: true, c: null }], a: 'synthetic' };
    const right = { a: 'synthetic', b: [2, { c: null, d: true }] };
    expect(hashGenerationInput(left)).toBe(hashGenerationInput(right));
    expect(hashGenerationInput(left)).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(hashGenerationInput({ ...left, a: 'changed' })).not.toBe(hashGenerationInput(left));
  });

  it('rejects values that cannot be hashed deterministically', () => {
    expect(() => hashGenerationInput({ optional: undefined })).toThrow(/JSON-safe/);
    expect(() => hashGenerationInput({ value: Number.POSITIVE_INFINITY })).toThrow(/finite/);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => hashGenerationInput(cyclic)).toThrow(/cycle/);
  });
});

describe('checkpoint caching and resume', () => {
  it('reuses an exact-input checkpoint without a duplicate task call or write', async () => {
    const store = new MemoryCheckpointStore();
    const executor = new GenerationReliabilityExecutor(store);
    const task = vi.fn(async (): Promise<GenerationAttemptResult<StageOutput>> => ({
      output: { value: 'Synthetic valid output', count: 2 },
      usage: { inputTokens: 7, outputTokens: 5 },
    }));
    const stage = options({ task });

    const generated = await executor.executeStage(stage);
    const cached = await executor.executeStage(stage);

    expect(generated.cacheHit).toBe(false);
    expect(cached.cacheHit).toBe(true);
    expect(cached.output).toEqual(generated.output);
    expect(cached.checkpoint).toEqual(generated.checkpoint);
    expect(cached.budget).toMatchObject({ attempts: 0, modelCalls: 0, cacheHits: 1 });
    expect(task).toHaveBeenCalledTimes(1);
    expect(store.writes).toHaveLength(1);
    expect(generated.checkpoint).toMatchObject({
      schemaVersion: GENERATION_CHECKPOINT_SCHEMA_VERSION,
      runId: 'run-synthetic-1',
      trackId: 'track-synthetic-1',
      stageKey: 'unit-1',
      inputHash: hashGenerationInput(stage.input),
      output: { value: 'Synthetic valid output', count: 2 },
      provenance: { provider: 'synthetic_provider', model: 'synthetic_model' },
      usage: { inputTokens: 7, outputTokens: 5, totalTokens: 12 },
    });
    expect(Date.parse(generated.checkpoint.completedAt)).toBeGreaterThanOrEqual(Date.parse(generated.checkpoint.startedAt));
  });

  it('coalesces queued exact-input calls through the post-queue checkpoint check', async () => {
    const store = new MemoryCheckpointStore();
    const executor = new GenerationReliabilityExecutor(store);
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const task = vi.fn(async (): Promise<GenerationAttemptResult<StageOutput>> => {
      await gate;
      return { output: { value: 'Synthetic queued output', count: 1 } };
    });
    const stage = options({ task });

    const first = executor.executeStage(stage);
    const second = executor.executeStage(stage);
    await vi.waitFor(() => expect(task).toHaveBeenCalledTimes(1));
    release?.();
    const results = await Promise.all([first, second]);

    expect(task).toHaveBeenCalledTimes(1);
    expect(results.filter((result) => !result.cacheHit)).toHaveLength(1);
    expect(results.filter((result) => result.cacheHit)).toHaveLength(1);
    expect(store.writes).toHaveLength(1);
  });

  it('resumes from the last valid stage after a later-stage failure', async () => {
    const store = new MemoryCheckpointStore();
    const firstRun = new GenerationReliabilityExecutor(store);
    await firstRun.executeStage(options({ stageKey: 'blueprint', task: async () => ({ output: { value: 'Synthetic blueprint', count: 1 } }) }));
    const blueprintCheckpoint = store.raw(identity('blueprint'));
    const failedTask = vi.fn(async (): Promise<GenerationAttemptResult<StageOutput>> => {
      throw new Error('Synthetic later-stage failure');
    });
    await expect(firstRun.executeStage(options({ stageKey: 'unit-2', task: failedTask }))).rejects.toThrow('Synthetic later-stage failure');

    const resumedRun = new GenerationReliabilityExecutor(store);
    const duplicateBlueprintTask = vi.fn(options().task);
    const resumedBlueprint = await resumedRun.executeStage(
      options({ stageKey: 'blueprint', task: duplicateBlueprintTask }),
    );
    const completedUnit = await resumedRun.executeStage(
      options({ stageKey: 'unit-2', task: async () => ({ output: { value: 'Synthetic resumed unit', count: 2 } }) }),
    );

    expect(resumedBlueprint.cacheHit).toBe(true);
    expect(duplicateBlueprintTask).not.toHaveBeenCalled();
    expect(completedUnit.output.value).toBe('Synthetic resumed unit');
    expect(store.raw(identity('blueprint'))).toEqual(blueprintCheckpoint);
    expect(store.writes).toHaveLength(2);
  });
});

describe('fail-closed checkpoint reads', () => {
  it.each([
    {
      label: 'stale schema',
      reason: 'stale_schema' as const,
      mutate: (checkpoint: GenerationCheckpoint) => ({ ...checkpoint, schemaVersion: 999 }),
    },
    {
      label: 'corrupt output',
      reason: 'corrupt' as const,
      mutate: (checkpoint: GenerationCheckpoint) => ({ ...checkpoint, output: { value: 'x', count: -1 } }),
    },
    {
      label: 'wrong identity',
      reason: 'wrong_identity' as const,
      mutate: (checkpoint: GenerationCheckpoint) => ({ ...checkpoint, runId: 'another-run' }),
    },
  ])('rejects a $label checkpoint and regenerates instead of returning it', async ({ reason, mutate }) => {
    const store = new MemoryCheckpointStore();
    const checkpoint = await seedCheckpoint(store);
    store.seed(identity(), mutate(checkpoint));
    const task = vi.fn(async (): Promise<GenerationAttemptResult<StageOutput>> => ({
      output: { value: 'Synthetic replacement', count: 3 },
    }));

    const result = await new GenerationReliabilityExecutor(store).executeStage(options({ task }));

    expect(result.output.value).toBe('Synthetic replacement');
    expect(result.cacheHit).toBe(false);
    expect(result.checkpointRejection).toEqual({ reason });
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('rejects a valid checkpoint whose input hash no longer matches', async () => {
    const store = new MemoryCheckpointStore();
    await seedCheckpoint(store);
    const task = vi.fn(async (input: StageInput): Promise<GenerationAttemptResult<StageOutput>> => ({
      output: { value: `New ${input.prompt}`, count: 4 },
    }));

    const result = await new GenerationReliabilityExecutor(store).executeStage(
      options({ input: { prompt: 'Changed exact input', version: 'v1' }, task }),
    );

    expect(result.checkpointRejection).toEqual({ reason: 'wrong_input' });
    expect(result.output.value).toBe('New Changed exact input');
    expect(task).toHaveBeenCalledTimes(1);
  });
});

describe('attempt failure, timeout, and concurrency', () => {
  it('aborts the attempt signal on timeout and writes no checkpoint', async () => {
    const store = new MemoryCheckpointStore();
    let attemptSignal: AbortSignal | undefined;
    const task = vi.fn(
      (_input: StageInput, context: { signal: AbortSignal }): Promise<GenerationAttemptResult<StageOutput>> => {
        attemptSignal = context.signal;
        return new Promise((_resolve, reject) => {
          context.signal.addEventListener('abort', () => reject(context.signal.reason), { once: true });
        });
      },
    );

    await expect(
      new GenerationReliabilityExecutor(store).executeStage(options({ timeoutMs: 5, task })),
    ).rejects.toBeInstanceOf(GenerationStageTimeoutError);
    expect(attemptSignal?.aborted).toBe(true);
    expect(store.writes).toHaveLength(0);
  });

  it('serializes generation tasks with at most one in flight', async () => {
    const store = new MemoryCheckpointStore();
    const executor = new GenerationReliabilityExecutor(store);
    const started: string[] = [];
    const releases = new Map<string, () => void>();
    let active = 0;
    let maxActive = 0;
    const task = async (input: StageInput): Promise<GenerationAttemptResult<StageOutput>> => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      started.push(input.prompt);
      try {
        return await new Promise((resolve) => {
          releases.set(input.prompt, () => resolve({ output: { value: `Output ${input.prompt}`, count: 1 } }));
        });
      } finally {
        active -= 1;
      }
    };

    const first = executor.executeStage(options({ stageKey: 'one', input: { prompt: 'one' }, task }));
    const second = executor.executeStage(options({ stageKey: 'two', input: { prompt: 'two' }, task }));
    await vi.waitFor(() => expect(started).toEqual(['one']));
    expect(started).toHaveLength(1);
    releases.get('one')?.();
    await vi.waitFor(() => expect(started).toEqual(['one', 'two']));
    releases.get('two')?.();
    await Promise.all([first, second]);

    expect(maxActive).toBe(1);
    expect(store.writes).toHaveLength(2);
  });

  it('does not write invalid output', async () => {
    const store = new MemoryCheckpointStore();
    const task = async (): Promise<GenerationAttemptResult<StageOutput>> => ({
      output: { value: 'x', count: 1 },
    });

    await expect(new GenerationReliabilityExecutor(store).executeStage(options({ task }))).rejects.toBeInstanceOf(
      GenerationStageValidationError,
    );
    expect(store.writes).toHaveLength(0);
  });

  it('preserves a prior checkpoint when a changed-input attempt fails', async () => {
    const store = new MemoryCheckpointStore();
    const checkpoint = await seedCheckpoint(store);
    const writeCount = store.writes.length;
    const task = async (): Promise<GenerationAttemptResult<StageOutput>> => {
      throw new Error('Synthetic provider failure');
    };

    await expect(
      new GenerationReliabilityExecutor(store).executeStage(
        options({ input: { prompt: 'Changed before failure', version: 'v1' }, task }),
      ),
    ).rejects.toThrow('Synthetic provider failure');
    expect(store.writes).toHaveLength(writeCount);
    expect(store.raw(identity())).toEqual(checkpoint);
  });
});

describe('generation budget accounting', () => {
  it('reports tokens, characters, duration, model calls, and cache hits without estimating unknown tokens', async () => {
    const store = new MemoryCheckpointStore();
    const executor = new GenerationReliabilityExecutor(store);
    const budgets = { maxTokens: 19, maxCharacters: 10_000, maxDurationMs: 60_000 };
    const stage = options({
      budgets,
      task: async () => ({
        output: { value: 'Synthetic budget output', count: 5 },
        usage: { inputTokens: 12, outputTokens: 8 },
      }),
    });

    const generated = await executor.executeStage(stage);
    const cached = await executor.executeStage(options({ ...stage, budgets: { ...budgets, maxDurationMs: 0 } }));

    expect(generated.budget).toMatchObject({
      attempts: 1,
      modelCalls: 1,
      cacheHits: 0,
      tokens: { used: 20, limit: 19, status: 'exceeded' },
      characters: { limit: 10_000, status: 'within_budget' },
      duration: { limit: 60_000, status: 'within_budget' },
    });
    expect(generated.budget.characters.used).toBe(generated.budget.characters.input + generated.budget.characters.output);
    expect(generated.budget.characters.input).toBeGreaterThan(0);
    expect(generated.budget.characters.output).toBeGreaterThan(0);
    expect(cached.budget).toMatchObject({
      attempts: 0,
      modelCalls: 0,
      cacheHits: 1,
      tokens: { used: 20, limit: 19, status: 'exceeded' },
      duration: { used: 0, limit: 0, status: 'within_budget' },
    });

    const unknown = await executor.executeStage(
      options({ stageKey: 'unknown-usage', budgets: { maxTokens: 10 }, task: async () => ({ output: { value: 'No token usage', count: 0 } }) }),
    );
    expect(unknown.budget.tokens).toEqual({ used: null, limit: 10, status: 'unknown' });
  });
});
