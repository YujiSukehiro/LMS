import { createHash } from 'node:crypto';
import { z } from 'zod';
import { LocalRuntimeLimiter } from '@/lib/ai/local-runtime';
import { ProvenanceRecordSchema, type ProvenanceRecord } from '@/lib/ai/provenance';

export const GENERATION_CHECKPOINT_SCHEMA_VERSION = 1 as const;

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;

export interface GenerationCheckpointIdentity {
  runId: string;
  trackId: string;
  stageKey: string;
}

/** The store boundary is deliberately small so a Firestore document adapter can implement it directly. */
export interface GenerationCheckpointStore {
  getCheckpoint(identity: GenerationCheckpointIdentity): Promise<unknown>;
  putCheckpoint(checkpoint: GenerationCheckpoint): Promise<void>;
}

export interface GenerationConcurrencyLimiter {
  run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T>;
}

export interface GenerationTokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export const GenerationCheckpointUsageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative().nullable(),
    outputTokens: z.number().int().nonnegative().nullable(),
    totalTokens: z.number().int().nonnegative().nullable(),
    durationMs: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((usage, context) => {
    if (
      usage.inputTokens !== null &&
      usage.outputTokens !== null &&
      usage.totalTokens !== null &&
      usage.totalTokens !== usage.inputTokens + usage.outputTokens
    ) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['totalTokens'], message: 'Total tokens must equal input plus output tokens.' });
    }
  });

export type GenerationCheckpointUsage = z.infer<typeof GenerationCheckpointUsageSchema>;

export const GenerationCheckpointSchema = z
  .object({
    schemaVersion: z.literal(GENERATION_CHECKPOINT_SCHEMA_VERSION),
    runId: z.string().min(1),
    trackId: z.string().min(1),
    stageKey: z.string().min(1),
    inputHash: z.string().regex(SHA256_PATTERN),
    output: z.unknown(),
    provenance: ProvenanceRecordSchema,
    startedAt: z.string().datetime(),
    completedAt: z.string().datetime(),
    usage: GenerationCheckpointUsageSchema,
  })
  .strict()
  .superRefine((checkpoint, context) => {
    if (Date.parse(checkpoint.completedAt) < Date.parse(checkpoint.startedAt)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['completedAt'], message: 'Completion cannot precede the attempt start.' });
    }
  });

export type GenerationCheckpoint = z.infer<typeof GenerationCheckpointSchema>;

export interface GenerationAttemptResult<TOutput> {
  output: TOutput;
  /** Provider-reported usage only. Unreported token counts remain null in reports and checkpoints. */
  usage?: GenerationTokenUsage;
}

export interface GenerationAttemptContext {
  signal: AbortSignal;
  attempt: 1;
}

export type GenerationStageTask<TInput, TOutput> = (
  input: TInput,
  context: GenerationAttemptContext,
) => Promise<GenerationAttemptResult<TOutput>>;

export interface GenerationBudgets {
  /** Compared with total provider-reported tokens; unknown usage is reported as unknown, never estimated. */
  maxTokens?: number;
  /** Compared with canonical input characters plus canonical output characters. */
  maxCharacters?: number;
  /** Reporting only. The independent timeoutMs option enforces cancellation. */
  maxDurationMs?: number;
}

export interface GenerationStageOptions<TInput, TSchema extends z.ZodTypeAny> extends GenerationCheckpointIdentity {
  input: TInput;
  schema: TSchema;
  timeoutMs: number;
  task: GenerationStageTask<TInput, z.input<TSchema>>;
  provenance: ProvenanceRecord | (() => ProvenanceRecord | Promise<ProvenanceRecord>);
  budgets?: GenerationBudgets;
  signal?: AbortSignal;
}

export type GenerationBudgetStatus = 'within_budget' | 'exceeded' | 'unknown' | 'not_configured';

export interface GenerationBudgetMetric {
  used: number | null;
  limit: number | null;
  status: GenerationBudgetStatus;
}

export interface GenerationCharacterBudgetMetric extends GenerationBudgetMetric {
  used: number;
  input: number;
  output: number;
}

export interface GenerationBudgetReport {
  attempts: number;
  modelCalls: number;
  cacheHits: number;
  tokens: GenerationBudgetMetric;
  characters: GenerationCharacterBudgetMetric;
  /** On a cache hit this invocation performs no generation work, so duration used is zero. */
  duration: GenerationBudgetMetric;
}

export type GenerationCheckpointRejectionReason = 'stale_schema' | 'corrupt' | 'wrong_identity' | 'wrong_input';

export interface GenerationCheckpointRejection {
  reason: GenerationCheckpointRejectionReason;
}

export interface GenerationStageResult<TOutput> {
  output: TOutput;
  checkpoint: GenerationCheckpoint;
  cacheHit: boolean;
  checkpointRejection: GenerationCheckpointRejection | null;
  budget: GenerationBudgetReport;
}

export class GenerationStageTimeoutError extends Error {
  constructor(
    public readonly stageKey: string,
    public readonly timeoutMs: number,
  ) {
    super(`Generation stage "${stageKey}" timed out after ${timeoutMs} ms; no checkpoint was written.`);
    this.name = 'GenerationStageTimeoutError';
  }
}

export class GenerationStageCancelledError extends Error {
  constructor(public readonly stageKey: string) {
    super(`Generation stage "${stageKey}" was cancelled; no checkpoint was written.`);
    this.name = 'GenerationStageCancelledError';
  }
}

export class GenerationStageValidationError extends Error {
  constructor(
    public readonly stageKey: string,
    public readonly part: 'attempt_result' | 'output' | 'usage' | 'provenance',
    public readonly issues: string[] = [],
  ) {
    super(`Generation stage "${stageKey}" produced invalid ${part}; no checkpoint was written.`);
    this.name = 'GenerationStageValidationError';
  }
}

const IdentitySchema = z.object({
  runId: z.string().min(1),
  trackId: z.string().min(1),
  stageKey: z.string().min(1),
}).strict();

const BudgetsSchema = z.object({
  maxTokens: z.number().int().nonnegative().optional(),
  maxCharacters: z.number().int().nonnegative().optional(),
  maxDurationMs: z.number().int().nonnegative().optional(),
}).strict();

const TokenUsageInputSchema = z.object({
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  totalTokens: z.number().int().nonnegative().optional(),
}).strict();

function canonicalize(value: unknown, path = '$', ancestors = new Set<object>()): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError(`Generation value at ${path} must be a finite number.`);
      return Object.is(value, -0) ? '0' : JSON.stringify(value);
    case 'undefined':
    case 'function':
    case 'symbol':
    case 'bigint':
      throw new TypeError(`Generation value at ${path} must contain only deterministic JSON-safe values.`);
    case 'object':
      break;
    default:
      throw new TypeError(`Generation value at ${path} is unsupported.`);
  }

  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) throw new TypeError(`Generation value at ${path} contains an invalid Date.`);
    return JSON.stringify(value.toISOString());
  }
  if (ancestors.has(value)) throw new TypeError(`Generation value at ${path} contains a cycle.`);

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((item, index) => canonicalize(item, `${path}[${index}]`, ancestors)).join(',')}]`;
    }
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`Generation value at ${path} must be a plain object, array, Date, or JSON primitive.`);
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new TypeError(`Generation value at ${path} must not contain symbol keys.`);
    }
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key], `${path}.${key}`, ancestors)}`);
    return `{${entries.join(',')}}`;
  } finally {
    ancestors.delete(value);
  }
}

/** SHA-256 over sorted, canonical JSON-compatible input. Include prompt/schema/source versions in input when they affect validity. */
export function hashGenerationInput(input: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalize(input), 'utf8').digest('hex')}`;
}

function zodIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => `${issue.path.join('.') || 'value'}: ${issue.message}`);
}

function normalizeUsage(value: GenerationTokenUsage | undefined, durationMs: number, stageKey: string): GenerationCheckpointUsage {
  const parsed = TokenUsageInputSchema.safeParse(value ?? {});
  if (!parsed.success) throw new GenerationStageValidationError(stageKey, 'usage', zodIssues(parsed.error));
  const { inputTokens = null, outputTokens = null } = parsed.data;
  let totalTokens = parsed.data.totalTokens ?? null;
  if (totalTokens === null && inputTokens !== null && outputTokens !== null) totalTokens = inputTokens + outputTokens;
  const usage = { inputTokens, outputTokens, totalTokens, durationMs };
  const validated = GenerationCheckpointUsageSchema.safeParse(usage);
  if (!validated.success) throw new GenerationStageValidationError(stageKey, 'usage', zodIssues(validated.error));
  return validated.data;
}

function metric(used: number | null, limit: number | undefined): GenerationBudgetMetric {
  if (limit === undefined) return { used, limit: null, status: 'not_configured' };
  if (used === null) return { used, limit, status: 'unknown' };
  return { used, limit, status: used <= limit ? 'within_budget' : 'exceeded' };
}

function budgetReport(input: {
  inputCharacters: number;
  outputCharacters: number;
  usage: GenerationCheckpointUsage;
  durationMs: number;
  attempts: number;
  modelCalls: number;
  cacheHits: number;
  budgets?: GenerationBudgets;
}): GenerationBudgetReport {
  const charactersUsed = input.inputCharacters + input.outputCharacters;
  const characterMetric = metric(charactersUsed, input.budgets?.maxCharacters);
  return {
    attempts: input.attempts,
    modelCalls: input.modelCalls,
    cacheHits: input.cacheHits,
    tokens: metric(input.usage.totalTokens, input.budgets?.maxTokens),
    characters: { ...characterMetric, used: charactersUsed, input: input.inputCharacters, output: input.outputCharacters },
    duration: metric(input.durationMs, input.budgets?.maxDurationMs),
  };
}

function throwIfCancelled(stageKey: string, signal?: AbortSignal): void {
  if (signal?.aborted) throw new GenerationStageCancelledError(stageKey);
}

async function runAttemptWithTimeout<TInput, TOutput>(input: {
  stageKey: string;
  timeoutMs: number;
  inputValue: TInput;
  task: GenerationStageTask<TInput, TOutput>;
  signal?: AbortSignal;
}): Promise<GenerationAttemptResult<TOutput>> {
  throwIfCancelled(input.stageKey, input.signal);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  let rejectAbort: (error: GenerationStageCancelledError) => void = () => undefined;
  const onAbort = () => {
    const error = new GenerationStageCancelledError(input.stageKey);
    rejectAbort(error);
    controller.abort(error);
  };

  const abortPromise = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
    if (input.signal?.aborted) onAbort();
    else input.signal?.addEventListener('abort', onAbort, { once: true });
  });
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = new GenerationStageTimeoutError(input.stageKey, input.timeoutMs);
      reject(error);
      controller.abort(error);
    }, input.timeoutMs);
  });

  try {
    const taskPromise = Promise.resolve().then(() =>
      input.task(input.inputValue, { signal: controller.signal, attempt: 1 }),
    );
    return await Promise.race([taskPromise, timeoutPromise, abortPromise]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    input.signal?.removeEventListener('abort', onAbort);
  }
}

type CheckpointRead<TOutput> =
  | { status: 'missing' }
  | { status: 'rejected'; rejection: GenerationCheckpointRejection }
  | { status: 'valid'; checkpoint: GenerationCheckpoint; output: TOutput };

/**
 * Provider-neutral generation-stage executor. One instance serializes generation tasks; inject a shared
 * limiter when multiple executor instances must share the same local concurrency slot.
 */
export class GenerationReliabilityExecutor {
  private readonly limiter: GenerationConcurrencyLimiter;

  constructor(
    private readonly store: GenerationCheckpointStore,
    limiter?: GenerationConcurrencyLimiter,
  ) {
    this.limiter = limiter ?? new LocalRuntimeLimiter();
  }

  private async readCheckpoint<TSchema extends z.ZodTypeAny>(
    identity: GenerationCheckpointIdentity,
    inputHash: string,
    schema: TSchema,
  ): Promise<CheckpointRead<z.output<TSchema>>> {
    const raw = await this.store.getCheckpoint(identity);
    if (raw === null || raw === undefined) return { status: 'missing' };
    if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
      const schemaVersion = (raw as Record<string, unknown>).schemaVersion;
      if (schemaVersion !== undefined && schemaVersion !== GENERATION_CHECKPOINT_SCHEMA_VERSION) {
        return { status: 'rejected', rejection: { reason: 'stale_schema' } };
      }
    }

    const parsed = GenerationCheckpointSchema.safeParse(raw);
    if (!parsed.success) return { status: 'rejected', rejection: { reason: 'corrupt' } };
    const checkpoint = parsed.data;
    if (checkpoint.runId !== identity.runId || checkpoint.trackId !== identity.trackId || checkpoint.stageKey !== identity.stageKey) {
      return { status: 'rejected', rejection: { reason: 'wrong_identity' } };
    }
    if (checkpoint.inputHash !== inputHash) return { status: 'rejected', rejection: { reason: 'wrong_input' } };

    const output = schema.safeParse(checkpoint.output);
    if (!output.success) return { status: 'rejected', rejection: { reason: 'corrupt' } };
    try {
      canonicalize(output.data);
    } catch {
      return { status: 'rejected', rejection: { reason: 'corrupt' } };
    }
    return { status: 'valid', checkpoint, output: output.data };
  }

  private cachedResult<TOutput>(
    read: Extract<CheckpointRead<TOutput>, { status: 'valid' }>,
    inputCharacters: number,
    budgets?: GenerationBudgets,
  ): GenerationStageResult<TOutput> {
    return {
      output: read.output,
      checkpoint: read.checkpoint,
      cacheHit: true,
      checkpointRejection: null,
      budget: budgetReport({
        inputCharacters,
        outputCharacters: canonicalize(read.output).length,
        usage: read.checkpoint.usage,
        durationMs: 0,
        attempts: 0,
        modelCalls: 0,
        cacheHits: 1,
        budgets,
      }),
    };
  }

  async executeStage<TInput, TSchema extends z.ZodTypeAny>(
    options: GenerationStageOptions<TInput, TSchema>,
  ): Promise<GenerationStageResult<z.output<TSchema>>> {
    const identity = IdentitySchema.parse({ runId: options.runId, trackId: options.trackId, stageKey: options.stageKey });
    const timeoutMs = z.number().int().positive().max(2_147_483_647).parse(options.timeoutMs);
    const budgets = options.budgets === undefined ? undefined : BudgetsSchema.parse(options.budgets);
    throwIfCancelled(identity.stageKey, options.signal);

    const canonicalInput = canonicalize(options.input);
    const inputHash = hashGenerationInput(options.input);
    const inputCharacters = canonicalInput.length;
    const firstRead = await this.readCheckpoint(identity, inputHash, options.schema);
    if (firstRead.status === 'valid') return this.cachedResult(firstRead, inputCharacters, budgets);

    return this.limiter.run(async () => {
      throwIfCancelled(identity.stageKey, options.signal);
      // A queued identical request can reuse the checkpoint written by the task ahead of it.
      const queuedRead = await this.readCheckpoint(identity, inputHash, options.schema);
      if (queuedRead.status === 'valid') return this.cachedResult(queuedRead, inputCharacters, budgets);
      const rejection = queuedRead.status === 'rejected' ? queuedRead.rejection : null;

      const startedMs = Date.now();
      const startedAt = new Date(startedMs).toISOString();
      const attempt = await runAttemptWithTimeout({
        stageKey: identity.stageKey,
        timeoutMs,
        inputValue: options.input,
        task: options.task,
        signal: options.signal,
      });
      const durationMs = Math.max(0, Date.now() - startedMs);
      const completedAt = new Date().toISOString();
      throwIfCancelled(identity.stageKey, options.signal);

      if (!attempt || typeof attempt !== 'object' || !('output' in attempt)) {
        throw new GenerationStageValidationError(identity.stageKey, 'attempt_result');
      }
      const parsedOutput = options.schema.safeParse(attempt.output);
      if (!parsedOutput.success) {
        throw new GenerationStageValidationError(identity.stageKey, 'output', zodIssues(parsedOutput.error));
      }
      let outputCharacters: number;
      try {
        outputCharacters = canonicalize(parsedOutput.data).length;
      } catch (error) {
        throw new GenerationStageValidationError(identity.stageKey, 'output', [error instanceof Error ? error.message : 'Non-deterministic output.']);
      }
      const usage = normalizeUsage(attempt.usage, durationMs, identity.stageKey);
      const proposedProvenance = typeof options.provenance === 'function' ? await options.provenance() : options.provenance;
      const provenance = ProvenanceRecordSchema.safeParse(proposedProvenance);
      if (!provenance.success) {
        throw new GenerationStageValidationError(identity.stageKey, 'provenance', zodIssues(provenance.error));
      }

      const checkpoint = GenerationCheckpointSchema.parse({
        schemaVersion: GENERATION_CHECKPOINT_SCHEMA_VERSION,
        ...identity,
        inputHash,
        output: parsedOutput.data,
        provenance: provenance.data,
        startedAt,
        completedAt,
        usage,
      });
      throwIfCancelled(identity.stageKey, options.signal);
      await this.store.putCheckpoint(checkpoint);

      return {
        output: parsedOutput.data,
        checkpoint,
        cacheHit: false,
        checkpointRejection: rejection,
        budget: budgetReport({
          inputCharacters,
          outputCharacters,
          usage,
          durationMs,
          attempts: 1,
          modelCalls: 1,
          cacheHits: 0,
          budgets,
        }),
      };
    }, options.signal);
  }
}
