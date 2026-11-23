/**
 * Staged Track build orchestrator (docs/04 §3): Pass 1 Blueprint -> Pass 2 Unit Builder (per Unit)
 * -> Pass 3 Sim Builder. Persists progress and the partial draft after each Unit, then writes the
 * complete draft TrackVersion and its secret rubrics. Server only.
 */
import { normalizeVerbalScenarioPairs } from '@/lib/services/verbal-defaults';
import { VERBAL_ONLY } from '@/lib/policy/training-policy';
import { z } from 'zod';
import { adminDb } from '@/lib/firebase/admin';
import {
  BriefingCardSchema,
  DRAFT_VERSION_ID,
  DrillItemSchema,
  EvalRubricsDocSchema,
  PublicSimScenarioSchema,
  SecretSimScenarioConfigSchema,
  TrackUnitSchema,
  TrackVersionDocSchema,
  DRILL_KINDS,
  type BriefingCard,
  type DrillItem,
  type DrillKind,
  type GenerationStep,
  type TrackDoc,
  type TrackUnit,
  type TrackVersionDoc,
} from '@/lib/schemas/curriculum';
import type { GenerateProgressEvent } from '@/lib/schemas/api';
import { LLMStructuredOutputError, type GenerateStructuredOptions, type LLMGateway } from '@/lib/ai/types';
import { MAX_STRUCTURED_REPAIR_RETRIES, parseStructuredOutput } from '@/lib/ai/pipeline/structured-output';
import { getActiveAiRuntime, getLLMGateway } from '@/lib/ai/gateway';
import { createProvenance, type ProvenanceRecord } from '@/lib/ai/provenance';
import { selectPages } from '@/lib/ai/pdf-extractor';
import {
  CONTENT_SIZING_VERSION,
  clampPlanToLimits,
  depthLimitsForProvider,
  unitCountNote,
  unitRangeForTarget,
} from '@/lib/ai/pipeline/content-depth';
import {
  BLUEPRINT_MAX_UNITS,
  BLUEPRINT_SCHEMA_NAME,
  blueprintMaxOutputTokens,
  blueprintUnitRange,
  buildBlueprintSchema,
  buildBlueprintSystemPrompt,
  buildBlueprintUserPrompt,
  finalizeBlueprint,
  type TrackBlueprint,
  type UnitOutline,
} from '@/lib/ai/prompts/blueprint';
import {
  UNIT_CARDS_SCHEMA_NAME,
  UNIT_DRILLS_SCHEMA_NAME,
  UNIT_SCHEMA_NAME,
  batchDrillKinds,
  buildUnitCardsSchema,
  buildUnitCardsUserPrompt,
  buildUnitDrillBatchSchema,
  buildUnitDrillsUserPrompt,
  buildUnitGenerationSchema,
  buildUnitSystemPrompt,
  buildUnitUserPrompt,
  cardsMaxOutputTokens,
  drillsMaxOutputTokens,
  estimateUnitMinutes,
  finalizeBriefingCard,
  cardsTopUpPlan,
  dropRepeatedDrills,
  finalizeDrill,
  finalizeUnit,
  pickPlannedDrills,
  planDrillKinds,
  salvageCards,
  salvageDrillBatch,
  type SalvageResult,
  unitMaxOutputTokens,
  type UnitBuildContext,
  type UnitPromptInput,
} from '@/lib/ai/prompts/unit-builder';
import {
  evidenceProblems,
  groundOrFlagEvidence,
  sourcePageLabels,
  unsupportedEvidenceIds,
  type ClaimEvidenceProposal,
  type EvidenceSource,
} from '@/lib/ai/prompts/evidence';
import { clampText } from '@/lib/ai/pipeline/shared';
import {
  MAX_SIM_SCENARIOS,
  MIN_SIM_SCENARIOS,
  SIM_BUILDER_MAX_OUTPUT_TOKENS,
  SIM_SCHEMA_NAME,
  SIM_SINGLE_SCENARIO_MAX_OUTPUT_TOKENS,
  SINGLE_SIM_SCHEMA_NAME,
  buildOneScenarioUserPrompt,
  buildSimGenerationSchema,
  buildSimSystemPrompt,
  buildSimUserPrompt,
  buildSingleScenarioSchema,
  finalizeScenario,
  finalizeScenarios,
  salvageScenarios,
  type SimScenarioPair,
} from '@/lib/ai/prompts/sim-builder';
import {
  GENERATION_HEARTBEAT_MS,
  draftRef,
  estimateTrackMinutes,
  loadSourcePages,
  loadTrack,
  nextDraftVersionNumber,
  secretsRef,
  trackRef,
} from '@/lib/ai/pipeline/track-store';
import { clampPct } from '@/lib/utils';
import { loadSourceReview } from '@/lib/services/source-store';
import { verifyClaimEvidence } from '@/lib/services/source-evidence';
import type { ClaimEvidence, SourceConflict } from '@/lib/schemas/source-truth';
import {
  BLUEPRINT_OVERHEAD_TOKENS,
  CriticalSourceInputError,
  UNIT_OVERHEAD_TOKENS,
  localSourceCharBudget,
  planSourceBudget,
  type SourceReviewPromptContext,
} from '@/lib/ai/pipeline/source-budget';
import {
  GenerationReliabilityExecutor,
  type GenerationConcurrencyLimiter,
  GenerationStageTimeoutError,
  GenerationStageValidationError,
  hashGenerationInput,
  type GenerationBudgetReport,
  type GenerationCheckpoint,
  type GenerationCheckpointIdentity,
  type GenerationCheckpointStore,
  type GenerationStageOptions,
  type GenerationStageResult,
} from '@/lib/ai/pipeline/generation-reliability';
import { LocalRuntimeLimiter } from '@/lib/ai/local-runtime';

const generationLimiter = new LocalRuntimeLimiter();
/** Hosted providers (Gemini) serve parallel builds; only a single-slot local runtime needs serializing. */
export const unlimitedLimiter: GenerationConcurrencyLimiter = { run: (task) => task() };

export function limiterFor(provider: string): GenerationConcurrencyLimiter {
  return isLocalProvider(provider) ? generationLimiter : unlimitedLimiter;
}
/** Hosted default for ONE model attempt (the repair loop makes up to 3). */
const HOSTED_ATTEMPT_TIMEOUT_MS = 180_000;
/** Local floor for one attempt: prompt processing on a laptop GPU plus a few thousand tokens. */
const LOCAL_ATTEMPT_TIMEOUT_MS = 240_000;
/** Conservative local decode speed used to size attempt timeouts (Qwen2.5-7B 4-bit MLX does ~30 tok/s). */
const LOCAL_TOKENS_PER_SECOND = 15;
const GENERATION_STAGE_CHARACTER_BUDGET = 2_000_000;
const LOCAL_PROVIDERS = new Set(['ollama', 'openai_compatible']);
/** Drills per call in the split Unit stage. */
const LOCAL_DRILL_BATCH = 3;
const HOSTED_DRILL_BATCH = 5;

export function isLocalProvider(provider: string): boolean {
  return LOCAL_PROVIDERS.has(provider);
}

function positiveEnvMs(name: string, env: NodeJS.ProcessEnv): number | null {
  const raw = env[name]?.trim();
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
}

/**
 * Timeout for one generation stage. The executor wraps the provider's whole repair loop, so the
 * budget is per attempt x attempts. Local models get a longer per-attempt default sized from the
 * planned output. GENERATION_STAGE_TIMEOUT_MS overrides the whole stage; GENERATION_ATTEMPT_TIMEOUT_MS
 * overrides one attempt.
 */
export function generationStageTimeoutMs(input: {
  provider: string;
  maxOutputTokens: number;
  attempts?: number;
  env?: NodeJS.ProcessEnv;
}): number {
  const env = input.env ?? process.env;
  const stage = positiveEnvMs('GENERATION_STAGE_TIMEOUT_MS', env);
  if (stage) return stage;
  const attempts = Math.max(1, input.attempts ?? MAX_STRUCTURED_REPAIR_RETRIES + 1);
  const perAttempt =
    positiveEnvMs('GENERATION_ATTEMPT_TIMEOUT_MS', env) ??
    (isLocalProvider(input.provider)
      ? Math.max(LOCAL_ATTEMPT_TIMEOUT_MS, 60_000 + Math.ceil((input.maxOutputTokens / LOCAL_TOKENS_PER_SECOND) * 1000))
      : HOSTED_ATTEMPT_TIMEOUT_MS);
  return Math.min(2_147_483_647, perAttempt * attempts);
}

class FirestoreGenerationCheckpointStore implements GenerationCheckpointStore {
  private ref(identity: GenerationCheckpointIdentity) {
    const { runId, trackId, stageKey } = identity;
    const id = hashGenerationInput({ runId, trackId, stageKey }).replace('sha256:', '');
    return adminDb.collection('generationCheckpoints').doc(`checkpoint_${id}`);
  }

  async getCheckpoint(identity: GenerationCheckpointIdentity): Promise<unknown> {
    const snap = await this.ref(identity).get();
    return snap.exists ? snap.data() : null;
  }

  async putCheckpoint(checkpoint: GenerationCheckpoint): Promise<void> {
    await this.ref(checkpoint).set(checkpoint);
  }
}

export type ProgressListener = (event: GenerateProgressEvent) => void;

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : '';
}

/** The first concrete problem in a structured-output failure message, for the trainer. */
export function firstStructuredIssue(message: string): string | null {
  const issue = message.split('\n').map((line) => line.trim()).find((line) => line.startsWith('- '));
  if (issue) return clampText(issue.slice(2), 220);
  const json = /not valid JSON[^.]*\.?/i.exec(message);
  if (json) return clampText(json[0], 220);
  return null;
}

/** Plain-English message for a build failure, with the real cause. `stage` names the failed step. */
export function describeGenerationError(error: unknown, stage?: string): string {
  const prefix = stage ? `${stage}: ` : '';
  const name = errorName(error);
  const message = error instanceof Error ? error.message : '';
  if (name === 'LLMOutputTruncatedError') {
    const schemaName = (error as { schemaName?: string }).schemaName;
    return `${prefix}The AI model's answer${schemaName ? ` for ${schemaName}` : ''} was cut off at its output token limit before the JSON was complete. Select Retry; if it happens again, choose fewer Checkpoints on the Content map or use a model with a larger output limit.`;
  }
  if (name === 'AIUnavailableError') {
    return `${prefix}The AI model is unavailable: ${clampText(message || 'no response', 220)} Check that the AI provider is running and reachable, then select Retry.`;
  }
  if (error instanceof LLMStructuredOutputError || name === 'LLMStructuredOutputError') {
    const structured = error as LLMStructuredOutputError;
    const issue = firstStructuredIssue(message);
    return `${prefix}The AI model could not produce valid ${structured.schemaName} content after ${structured.attempts} attempts${issue ? ` (first problem: ${issue})` : ''}. Select Retry to build the Track again.`;
  }
  if (error instanceof GenerationStageTimeoutError || name === 'GenerationStageTimeoutError') {
    const timeoutMs = (error as GenerationStageTimeoutError).timeoutMs;
    return `${prefix}The AI model did not finish within ${Math.round(timeoutMs / 60_000)} minutes. Select Retry (finished steps are kept), or raise GENERATION_ATTEMPT_TIMEOUT_MS for a slow local model.`;
  }
  if (error instanceof GenerationStageValidationError && error.issues.length > 0) {
    return `${prefix}${message} First problem: ${clampText(error.issues[0], 220)}`;
  }
  if (error instanceof CriticalSourceInputError) return `${prefix}${message}`;
  if (error instanceof Error && error.message) return `${prefix}${error.message}`;
  return `${prefix}The Track build stopped because of an unknown error. Select Retry to build the Track again.`;
}

interface SourceGenerationContext extends SourceReviewPromptContext {
  sourceBundleId: string;
  sourceRevision: string;
  requiredRuleIds: string[];
  conflicts: SourceConflict[];
}

async function loadApprovedSourceContext(track: TrackDoc): Promise<SourceGenerationContext | null> {
  if (!track.activeSourceBundleId) return null;
  const review = await loadSourceReview(track.id, track.activeSourceBundleId);
  const { bundle } = review;
  if (
    (bundle.status !== 'approved' && bundle.status !== 'published') ||
    !bundle.approvedSourceRevision ||
    bundle.approvedSourceRevision !== bundle.revisionHash
  ) {
    throw new Error('The active source bundle must be approved at its exact current revision before generation.');
  }
  const rulePacks = review.rulePacks.filter((pack) => bundle.sharedRulePackIds.includes(pack.id));
  const missingPackIds = bundle.sharedRulePackIds.filter((id) => !rulePacks.some((pack) => pack.id === id));
  if (missingPackIds.length > 0 || rulePacks.some((pack) => pack.approvalStatus !== 'approved')) {
    throw new Error(`Approved shared rule packs are required before generation (${missingPackIds.join(', ') || 'unapproved pack'}).`);
  }
  return {
    pages: review.pages,
    rulePacks,
    assets: review.assets,
    conflicts: review.conflicts,
    sourceBundleId: bundle.id,
    sourceRevision: bundle.revisionHash,
    requiredRuleIds: rulePacks.flatMap((pack) => pack.rules.map((rule) => rule.id)),
  };
}

/** Recompute exact support on the server; generated support and approval labels are never trusted. */
export function assertGeneratedClaimEvidence(
  ownerId: string,
  evidence: ClaimEvidence[] | undefined,
  source: Pick<SourceGenerationContext, 'pages' | 'conflicts'>,
): void {
  if (!evidence?.length) throw new Error(`${ownerId} is missing exact claim-to-excerpt evidence.`);
  for (const proposal of evidence) {
    const verified = verifyClaimEvidence(proposal, source.pages, source.conflicts);
    if (verified.support !== 'supported') {
      throw new Error(`${ownerId} evidence ${proposal.id} is ${verified.support.replaceAll('_', ' ')}; the previous valid draft was preserved.`);
    }
  }
}

/**
 * Items whose evidence is not exactly supported. They are kept (stored as unsupported, unapproved
 * evidence) so the Track still builds; the publication gate blocks them until a trainer fixes them.
 * A missing evidence array is still a hard failure: the stage schema requires evidence.
 */
function itemsNeedingEvidenceReview(
  items: Array<{ id: string; evidence?: ClaimEvidence[] }>,
  source: Pick<SourceGenerationContext, 'pages' | 'conflicts'>,
): string[] {
  const flagged: string[] = [];
  for (const item of items) {
    if (!item.evidence?.length) throw new Error(`${item.id} is missing exact claim-to-excerpt evidence; the previous valid draft was preserved.`);
    const verified = item.evidence.map((evidence) => verifyClaimEvidence(evidence, source.pages, source.conflicts));
    if (unsupportedEvidenceIds(verified).length > 0) flagged.push(item.id);
  }
  return flagged;
}

/** Page numbers ordered by how often the Units cite them (most cited first). */
function pagesByCitation(units: TrackUnit[], pageNumbers: number[]): number[] {
  const counts = new Map<number, number>();
  for (const unit of units) {
    for (const card of unit.briefingCards) card.sourcePages.forEach((page) => counts.set(page, (counts.get(page) ?? 0) + 1));
    for (const drill of unit.drills) drill.sourcePages.forEach((page) => counts.set(page, (counts.get(page) ?? 0) + 1));
  }
  return [...pageNumbers].sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || a - b);
}

/**
 * Call the model with the strict schema (exact-evidence problems go to the repair turn). If every
 * attempt still fails, accept the last answer when it passes the lenient schema, which differs only
 * in accepting unresolvable excerpts; those items are stored unsupported for trainer review.
 */
async function generateWithEvidenceFallback<S extends z.ZodTypeAny>(
  gateway: LLMGateway,
  opts: GenerateStructuredOptions<S>,
  lenient: z.ZodTypeAny | null,
): Promise<{ output: z.infer<S>; relaxed: boolean }> {
  try {
    return { output: await gateway.generateStructured(opts), relaxed: false };
  } catch (error) {
    if (lenient && errorName(error) === 'LLMStructuredOutputError') {
      const raw = (error as { lastRawOutput?: unknown }).lastRawOutput;
      if (typeof raw === 'string' && raw.trim()) {
        const parsed = parseStructuredOutput(raw, lenient);
        if (parsed.ok) return { output: parsed.data as z.infer<S>, relaxed: true };
      }
    }
    throw error;
  }
}

/** Kinds for a top-up batch: kinds the Unit lacks first, then the usual rotation. */
export function topUpDrillKinds(existing: readonly Pick<DrillItem, 'kind'>[], count: number, unitOrderIndex: number): DrillKind[] {
  const have = new Set(existing.map((drill) => drill.kind));
  const rotation = planDrillKinds(DRILL_KINDS.length, unitOrderIndex + existing.length);
  const ordered = [...rotation.filter((kind) => !have.has(kind)), ...rotation.filter((kind) => have.has(kind))];
  return Array.from({ length: count }, (_, index) => ordered[index % ordered.length]);
}

/** Trainer-visible notes for a Unit the build could only partly fill. */
/**
 * Trainer note when the Sim stage wrote fewer scenarios than required. Per-scenario (local) builds plan
 * an exact count; a batch call (hosted or replay) may validly return MIN..MAX scenarios, so only a result
 * below MIN_SIM_SCENARIOS is a shortfall.
 */
export function simShortfallNotes(written: number, planned: number, perScenario: boolean): string[] {
  const required = perScenario ? planned : Math.min(planned, MIN_SIM_SCENARIOS);
  return written < required
    ? [`Needs more Live Call Sims: ${written} written, ${required} planned. Retry the build to add the missing Sim.`]
    : [];
}

export function shortfallNotes(cards: number, minCards: number, drills: number, minDrills: number): string[] {
  const notes: string[] = [];
  if (cards < minCards) notes.push(`Needs more Briefing Cards: ${cards} written, ${minCards} planned at minimum.`);
  if (drills < minDrills) notes.push(`Needs more Drills: ${drills} written, ${minDrills} planned at minimum.`);
  return notes;
}

interface SalvageOptions<S extends z.ZodTypeAny, T> {
  lenient: z.ZodTypeAny | null;
  finalize: (output: z.infer<S>) => T[];
  salvage: (raw: string) => SalvageResult<T>;
  /** True lets a batch return no items (the caller tops up); false rethrows the model error. */
  allowEmpty: boolean;
  log: { trackId: string; stage: string };
}

/**
 * Strict call with repair; then the lenient-evidence re-parse; then per-item salvage of the last
 * answer, so one malformed item never sinks the whole batch (and with it the Track).
 */
/** Cross-Checkpoint repeats put back (in order) only as far as needed to reach the Checkpoint's minimum. */
export function restoreRepeatsToMinimum<T>(drills: readonly T[], repeats: readonly T[], minimum: number): T[] {
  return repeats.slice(0, Math.max(0, minimum - drills.length));
}

const RAW_PREVIEW_CHARS = 600;

/** Temperature of the one fresh attempt after a failed repair loop (the default is 0.2). */
export const FRESH_ATTEMPT_TEMPERATURE = 0.1;

/** Output failures a fresh, repair-free call can fix: unparseable or schema-invalid JSON and truncation. */
export function isFreshAttemptError(error: unknown): boolean {
  const name = errorName(error);
  return name === 'LLMStructuredOutputError' || name === 'LLMOutputTruncatedError';
}

/**
 * Run `attempt` once more (a clean prompt with no repair history, at a lower temperature) when it fails with an
 * output error, so one bad 7B answer does not need a manual Retry. Bounded: at most one extra attempt per stage.
 */
export async function withFreshAttempt<T>(
  attempt: (temperature: number | undefined, previousError?: unknown) => Promise<T>,
  log: { trackId: string; stage: string },
): Promise<T> {
  try {
    return await attempt(undefined);
  } catch (error) {
    if (!isFreshAttemptError(error)) throw error;
    console.warn('[track-generation] fresh attempt after failed repair loop', { ...log, firstError: errorName(error) });
    return attempt(FRESH_ATTEMPT_TEMPERATURE, error);
  }
}

/** Output-token headroom of a fresh attempt after the first answer was cut off at the limit. */
export const TRUNCATION_RETRY_TOKEN_FACTOR = 1.5;

/** Options of the fresh attempt: lower temperature, and more output tokens if the first answer was truncated. */
export function freshAttemptOptions<O extends { maxOutputTokens?: number; temperature?: number }>(opts: O, temperature: number, previousError: unknown): O {
  const truncated = errorName(previousError) === 'LLMOutputTruncatedError' && typeof opts.maxOutputTokens === 'number';
  return {
    ...opts,
    temperature,
    ...(truncated ? { maxOutputTokens: Math.ceil(opts.maxOutputTokens! * TRUNCATION_RETRY_TOKEN_FACTOR) } : {}),
  };
}

export async function generateOrSalvage<S extends z.ZodTypeAny, T>(
  gateway: LLMGateway,
  opts: GenerateStructuredOptions<S>,
  options: SalvageOptions<S, T>,
): Promise<SalvageResult<T>> {
  return withFreshAttempt(
    (temperature, previousError) => generateOrSalvageOnce(gateway, temperature === undefined ? opts : freshAttemptOptions(opts, temperature, previousError), options),
    { trackId: options.log.trackId, stage: options.log.stage },
  );
}

async function generateOrSalvageOnce<S extends z.ZodTypeAny, T>(
  gateway: LLMGateway,
  opts: GenerateStructuredOptions<S>,
  options: SalvageOptions<S, T>,
): Promise<SalvageResult<T>> {
  try {
    const { output } = await generateWithEvidenceFallback(gateway, opts, options.lenient);
    return { items: options.finalize(output), dropped: [] };
  } catch (error) {
    const raw = (error as { lastRawOutput?: unknown } | null)?.lastRawOutput;
    if (errorName(error) !== 'LLMStructuredOutputError' || typeof raw !== 'string' || !raw.trim()) throw error;
    const salvaged = options.salvage(raw);
    console.warn('[track-generation] salvaged items after failed repair', {
      ...options.log,
      kept: salvaged.items.length,
      dropped: salvaged.dropped.slice(0, 10),
      rawOutputLength: raw.length,
      // The head of the raw answer shows what the model actually wrote (synthetic training content only).
      rawOutputPreview: raw.slice(0, RAW_PREVIEW_CHARS),
    });
    if (salvaged.items.length === 0 && !options.allowEmpty) throw error;
    return salvaged;
  }
}

/** Add exact-evidence problems for every rubric criterion to a Sim schema, so the repair turn sees them. */
export function withRubricEvidenceCheck<S extends z.ZodTypeAny>(
  schema: S,
  evidenceSource: EvidenceSource | undefined,
  allowedLabels: readonly number[],
  many: boolean,
): z.ZodTypeAny {
  if (!evidenceSource) return schema;
  return schema.superRefine((value: unknown, zctx) => {
    const scenarios = many ? ((value as { scenarios?: unknown[] }).scenarios ?? []) : [value];
    scenarios.forEach((scenario, scenarioIndex) => {
      const criteria = (scenario as { secretConfig?: { rubricCriteria?: Array<{ evidence?: ClaimEvidenceProposal[] }> } }).secretConfig?.rubricCriteria ?? [];
      criteria.forEach((criterion, criterionIndex) => {
        for (const problem of evidenceProblems(criterion.evidence, evidenceSource, allowedLabels)) {
          zctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [...(many ? ['scenarios', scenarioIndex] : []), 'secretConfig', 'rubricCriteria', criterionIndex, 'evidence', ...problem.path],
            message: problem.message,
          });
        }
      });
    });
  });
}

/**
 * Server-side evidence for every rubric criterion: re-resolve model quotes, else ground the
 * criterion's own rule text in its cited pages, else store unsupported draft evidence (flagged; the
 * publication gate blocks it until a trainer fixes it).
 */
export function groundScenarioEvidence(pair: SimScenarioPair, evidenceSource: EvidenceSource, allowedLabels: readonly number[]): SimScenarioPair {
  return {
    ...pair,
    secretConfig: {
      ...pair.secretConfig,
      rubricCriteria: pair.secretConfig.rubricCriteria.map((criterion) => ({
        ...criterion,
        evidence: groundOrFlagEvidence({
          ownerId: criterion.id,
          claim: criterion.evaluationRule,
          evidence: criterion.evidence,
          citedLabels: criterion.sourcePages,
          source: evidenceSource,
          allowedLabels,
        }),
      })),
    },
  };
}

/** Model-output failures that skip one item (a Drill batch, one Sim) instead of failing the Track. */
/** Provenance profile id: hosted runs are labelled "<provider>-hosted" (no local checkpoints to invalidate). */
export function runtimeProfileId(provider: string): string {
  return isLocalProvider(provider) || provider === 'replay' || provider === 'manual_chat'
    ? `${provider}-local`
    : `${provider}-hosted`;
}

export function isSkippableItemError(error: unknown): boolean {
  const name = errorName(error);
  // A hosted SAFETY/RECITATION block on one Drill batch or Sim is skipped and refilled like a bad batch.
  return name === 'LLMStructuredOutputError' || name === 'LLMOutputTruncatedError' || name === 'LLMContentBlockedError';
}

function logStageFailure(trackId: string, stage: string, error: unknown): void {
  const raw = (error as { lastRawOutput?: unknown } | null)?.lastRawOutput;
  const rawLength = typeof raw === 'string' ? raw.length : (error as { rawLength?: unknown } | null)?.rawLength;
  console.error('[track-generation] stage failed', {
    trackId,
    stage,
    name: errorName(error) || typeof error,
    message: error instanceof Error ? error.message.slice(0, 2_000) : String(error),
    rawOutputLength: typeof rawLength === 'number' ? rawLength : null,
    cause: error instanceof Error && error.cause instanceof Error ? error.cause.message.slice(0, 500) : undefined,
  });
}

/**
 * Run the full build for a Track whose generation lock the caller already holds.
 * Emits progress events and persists them on the Track. Throws on failure after it marks the Track FAILED.
 */
/** Thrown when a build step reaches its time budget at a stage boundary. Not a failure: the next step resumes. */
export class GenerationPausedError extends Error {
  constructor() {
    super('The build step reached its time budget; the next step continues from saved checkpoints.');
    this.name = 'GenerationPausedError';
  }
}

export function isGenerationPausedError(error: unknown): error is GenerationPausedError {
  return error instanceof GenerationPausedError;
}

/** Executor that refuses to START a stage after the step's deadline (a running stage always finishes). */
class DeadlineExecutor extends GenerationReliabilityExecutor {
  constructor(
    store: ConstructorParameters<typeof GenerationReliabilityExecutor>[0],
    limiter: ConstructorParameters<typeof GenerationReliabilityExecutor>[1],
    private readonly deadlineAt: number | undefined,
  ) {
    super(store, limiter);
  }

  override async executeStage<TInput, TSchema extends z.ZodTypeAny>(
    options: GenerationStageOptions<TInput, TSchema>,
  ): Promise<GenerationStageResult<z.output<TSchema>>> {
    if (this.deadlineAt !== undefined && Date.now() >= this.deadlineAt) throw new GenerationPausedError();
    return super.executeStage(options);
  }
}

export interface RunTrackGenerationOptions {
  /** Epoch ms. No new stage starts after it; the build pauses (generationPausedAt) for the next step to resume. */
  deadlineAt?: number;
}

export async function runTrackGeneration(
  trackId: string,
  onProgress: ProgressListener,
  gateway: LLMGateway = getLLMGateway(),
  options: RunTrackGenerationOptions = {},
): Promise<void> {
  let lastPercent = 0;
  let stageLabel = 'Preparing the build';
  const heartbeat = setInterval(() => {
    void trackRef(trackId)
      .update({ updatedAt: Date.now() })
      .catch(() => undefined);
  }, GENERATION_HEARTBEAT_MS);

  const report = async (step: GenerationStep, percent: number, message: string) => {
    lastPercent = clampPct(percent);
    const event: GenerateProgressEvent = { step, percent: lastPercent, message };
    await trackRef(trackId).update({ generationProgress: event, updatedAt: Date.now() });
    onProgress(event);
  };

  try {
    const track = await loadTrack(trackId);
    if (!track) throw new Error('This Track does not exist.');
    const pages = await loadSourcePages(trackId);
    if (pages.length === 0) throw new Error('This Track has no extracted Playbook pages. Upload the Playbook PDF again.');
    const source = await loadApprovedSourceContext(track);
    const evidenceSource: EvidenceSource | undefined = source ? { pages: source.pages, conflicts: source.conflicts } : undefined;
    const sourceLabels = source ? sourcePageLabels(source.pages) : null;

    const createdAt = Date.now();
    const versionNumber = nextDraftVersionNumber(track);
    const runtime = getActiveAiRuntime();
    const local = isLocalProvider(runtime.provider);
    const limits = depthLimitsForProvider(runtime.provider);
    // Demo replay serves one recorded TrackUnitContent per Unit; live providers split the Unit stage.
    const unitMode: 'single' | 'split' = runtime.provider === 'replay' ? 'single' : 'split';
    const drillBatchSize = local ? LOCAL_DRILL_BATCH : HOSTED_DRILL_BATCH;
    const attempts = (runtime.generationProfile.structuredGeneration?.maxRepairRetries ?? MAX_STRUCTURED_REPAIR_RETRIES) + 1;
    const provenance = createProvenance({
      source: runtime.provider === 'replay' ? 'replay' : runtime.provider === 'gemini' ? 'hosted_ai' : runtime.provider === 'manual_chat' ? 'manual_chat' : 'local_ai',
      provider: runtime.provider,
      model: runtime.heavyModel,
      prompt: { templateId: 'staged-track-generation', templateVersion: source ? 'v2' : 'v1' },
      schema: { name: 'TrackVersion', version: source ? 'v2' : 'v1' },
      // Local profile ids stay "<provider>-local": they are part of the cache identity of existing checkpoints.
      runtime: { label: runtime.runtimeLabel ?? runtime.provider, profileId: runtimeProfileId(runtime.provider) },
      recordedAt: new Date(createdAt).toISOString(),
    });
    // Runtime and authoring-contract identity is part of every stage hash. A cache hit can never
    // be relabeled as output from a different provider/model/prompt/schema/runtime profile.
    const cacheIdentity = {
      contractVersion: 'staged-track-generation-2026-11-04-v2',
      source: provenance.source,
      provider: provenance.provider,
      model: provenance.model,
      prompt: provenance.prompt,
      schema: provenance.schema,
      runtime: provenance.runtime,
      generationProfile: runtime.generationProfile,
      unitMode,
      drillBatchSize,
      depthLimits: limits,
    };
    const executor = new DeadlineExecutor(new FirestoreGenerationCheckpointStore(), limiterFor(runtime.provider), options.deadlineAt);
    const runId = `track-${trackId}`;
    const budgets: Record<string, GenerationBudgetReport> = { ...(track.generationBudgets ?? {}) };
    const stageConfig = (maxOutputTokens: number) => {
      // Twice the repair loop: a stage may make one fresh attempt after its repair loop fails (withFreshAttempt).
      const timeoutMs = generationStageTimeoutMs({ provider: runtime.provider, maxOutputTokens, attempts: attempts * 2 });
      return {
        runId,
        trackId,
        timeoutMs,
        budgets: { maxCharacters: GENERATION_STAGE_CHARACTER_BUDGET, maxDurationMs: timeoutMs },
        provenance,
      } as const;
    };
    const recordBudget = async (stageKey: string, budget: GenerationBudgetReport) => {
      budgets[stageKey] = budget;
      await trackRef(trackId).update({ generationBudgets: budgets, updatedAt: Date.now() });
    };

    // Size the Track from the measured source depth. Demo replay serves fixed recorded output,
    // so it keeps the absolute limits and the default per-Unit sizes.
    const sizeFromDepth = runtime.provider !== 'replay';
    const unitRange = !sizeFromDepth
      ? undefined
      : track.unitTarget
        ? unitRangeForTarget(track.unitTarget)
        : blueprintUnitRange(pages);
    const blueprintTokens = blueprintMaxOutputTokens(unitRange?.max ?? BLUEPRINT_MAX_UNITS);
    // Local prompts are budgeted against the 16k context window minus the planned output.
    const blueprintCharBudget = local
      ? localSourceCharBudget({ plannedOutputTokens: blueprintTokens, overheadTokens: BLUEPRINT_OVERHEAD_TOKENS })
      : undefined;
    const cardTokens = cardsMaxOutputTokens(limits.maxCards);
    const drillTokens = drillsMaxOutputTokens(drillBatchSize);
    const unitCharBudget = local
      ? localSourceCharBudget({ plannedOutputTokens: Math.max(cardTokens, drillTokens), overheadTokens: UNIT_OVERHEAD_TOKENS })
      : undefined;

    // Check the inherited source inputs once, before any model time is spent: approved shared-rule
    // and asset excerpts go into every Unit prompt, so they must fit one Unit prompt on their own.
    if (source) {
      stageLabel = 'Source check';
      planSourceBudget({
        stage: 'preflight',
        pages: source.pages,
        rulePacks: source.rulePacks,
        assets: source.assets,
        selectedPageNumbers: [],
        charBudget: unitCharBudget ?? 32_000,
      });
    }

    // Pass 1: resume an exact-input blueprint checkpoint before making another model call.
    stageLabel = 'Blueprint';
    await report('BLUEPRINTING', 15, `Read ${pages.length} pages. Analyzing campaign rules...`);
    const blueprintResult = await executor.executeStage({
      ...stageConfig(blueprintTokens),
      stageKey: 'blueprint',
      input: {
        cacheIdentity,
        templateVersion: source ? 'v3' : 'v2',
        sizing: CONTENT_SIZING_VERSION,
        unitRange: unitRange ?? null,
        trackTitle: track.title,
        campaignCode: track.campaignCode,
        divisionId: track.divisionId,
        pages,
        sourceReview: source,
        charBudget: blueprintCharBudget ?? null,
      },
      schema: z.custom<TrackBlueprint>((value) => Boolean(value && typeof value === 'object')),
      task: async (_input, { signal }) => {
        const blueprintOptions = {
          tier: 'heavy' as const,
          systemPrompt: buildBlueprintSystemPrompt(track.divisionId),
          userPrompt: buildBlueprintUserPrompt({
            trackTitle: track.title,
            campaignCode: track.campaignCode,
            divisionId: track.divisionId,
            pages,
            sourceReview: source ?? undefined,
            unitRange,
            charBudget: blueprintCharBudget,
          }),
          schema: buildBlueprintSchema(pages.length, unitRange),
          schemaName: BLUEPRINT_SCHEMA_NAME,
          maxOutputTokens: blueprintTokens,
          signal,
        };
        const raw = await withFreshAttempt(
          (temperature, previousError) => gateway.generateStructured(
            temperature === undefined ? blueprintOptions : freshAttemptOptions(blueprintOptions, temperature, previousError),
          ),
          { trackId, stage: 'blueprint' },
        );
        return { output: finalizeBlueprint(raw, pages.length, track.campaignCode, sizeFromDepth ? pages : undefined, limits) };
      },
    });
    const blueprint = blueprintResult.output;
    await recordBudget('blueprint', blueprintResult.budget);
    const pillarIds = blueprint.competencyPillars.map((pillar) => pillar.id);

    const saveDraft = async (units: TrackUnit[], simScenarios: TrackVersionDoc['simScenarios']) => {
      const draft = TrackVersionDocSchema.parse({
        versionId: DRAFT_VERSION_ID,
        trackId,
        versionNumber,
        competencyPillars: blueprint.competencyPillars,
        units,
        simScenarios,
        provenance,
        ...(source
          ? { sourceBundleId: source.sourceBundleId, sourceRevision: source.sourceRevision, requiredRuleIds: source.requiredRuleIds }
          : {}),
        publishedAt: null,
        createdAt,
      });
      // Keep partial work separate from the last complete Studio draft. A failed rebuild must not
      // replace a previously usable draft; the working copy is removed only after final commit.
      await adminDb.collection('generationWorkingDrafts').doc(trackId).set({
        schemaVersion: 1,
        trackId,
        draft,
        updatedAt: Date.now(),
      });
      return draft;
    };

    await saveDraft([], []);
    const unitTotal = blueprint.units.length;
    await report('BUILDING_UNITS', 30, `Mapped ${unitTotal} Checkpoints. Writing Checkpoint 1 of ${unitTotal}...`);

    // Pass 2: persist each finalized, evidence-resolved Unit before starting the next one.
    const units: TrackUnit[] = [];
    const flaggedItems: string[] = [];
    for (const [index, rawOutline] of blueprint.units.entries()) {
      const outline: UnitOutline = rawOutline.contentPlan
        ? { ...rawOutline, contentPlan: clampPlanToLimits(rawOutline.contentPlan, limits) }
        : rawOutline;
      const n = index + 1;
      const checkpointLabel = `Checkpoint ${n} of ${unitTotal}`;
      const unitPages = selectPages(pages, outline.sourcePages);
      const allowedPages = sourceLabels ?? [...new Set(unitPages.map((page) => page.pageNumber))];
      const ctx: UnitBuildContext = {
        pillarIds,
        allowedPages,
        requireEvidence: source !== null,
        contentPlan: outline.contentPlan,
        evidenceSource,
      };
      const lenientCtx: UnitBuildContext = { ...ctx, strictEvidence: false };
      const otherUnitTitles = blueprint.units.filter((other) => other.id !== outline.id).map((other) => other.title);
      const promptInput: UnitPromptInput = {
        trackTitle: track.title,
        campaignCode: blueprint.campaignCode,
        divisionId: track.divisionId,
        globalSummary: blueprint.globalSummary,
        pillars: blueprint.competencyPillars,
        outline,
        pages: unitPages,
        sourceReview: source ?? undefined,
        otherUnitTitles,
        sourceCharBudget: unitCharBudget,
      };
      const stageInput = {
        cacheIdentity,
        templateVersion: source ? 'v3' : 'v2',
        sizing: CONTENT_SIZING_VERSION,
        trackTitle: track.title,
        campaignCode: blueprint.campaignCode,
        divisionId: track.divisionId,
        outline,
        globalSummary: blueprint.globalSummary,
        pillars: blueprint.competencyPillars,
        unitPages,
        sourceReview: source,
        otherUnitTitles,
        sourceCharBudget: unitCharBudget ?? null,
      };
      const progressAt = (fraction: number) => 30 + ((index + fraction) * 45) / unitTotal;
      let unit: TrackUnit;
      let allCached = true;

      if (unitMode === 'single') {
        stageLabel = `${checkpointLabel} (${outline.title})`;
        await report('BUILDING_UNITS', progressAt(0), `Writing ${checkpointLabel}: ${outline.title}`);
        const plan = outline.contentPlan;
        const stageKey = `unit:${outline.id}`;
        const unitResult = await executor.executeStage({
          ...stageConfig(plan ? unitMaxOutputTokens(plan) : 8192),
          stageKey,
          input: stageInput,
          schema: TrackUnitSchema,
          task: async (_input, { signal }) => {
            const { output } = await generateWithEvidenceFallback(
              gateway,
              {
                tier: 'heavy',
                systemPrompt: buildUnitSystemPrompt(track.divisionId),
                userPrompt: buildUnitUserPrompt(promptInput),
                schema: buildUnitGenerationSchema(ctx),
                schemaName: UNIT_SCHEMA_NAME,
                maxOutputTokens: plan ? unitMaxOutputTokens(plan) : 8192,
                signal,
              },
              evidenceSource ? buildUnitGenerationSchema(lenientCtx) : null,
            );
            return { output: finalizeUnit(outline, output, ctx) };
          },
        });
        allCached = unitResult.cacheHit;
        await recordBudget(stageKey, unitResult.budget);
        unit = unitResult.output;
      } else {
        const plan = outline.contentPlan ?? clampPlanToLimits({ cards: { min: 3, target: 4, max: 5 }, drills: { min: 5, target: 6, max: 7 }, ruleSignals: 0 }, limits);
        // Call 1: every BriefingCard of the Unit.
        stageLabel = `${checkpointLabel} Briefing Cards (${outline.title})`;
        await report('BUILDING_UNITS', progressAt(0), `Writing ${checkpointLabel}: Briefing Cards for ${outline.title}`);
        const cardsKey = `unit:${outline.id}:cards`;
        const cardsTokens = cardsMaxOutputTokens(plan.cards.max);
        const cardId = (cardIndex: number) => `${outline.id}-c${cardIndex + 1}`;
        const cardsResult = await executor.executeStage({
          ...stageConfig(cardsTokens),
          stageKey: cardsKey,
          input: { ...stageInput, part: 'cards' },
          schema: z.array(BriefingCardSchema).min(1),
          task: async (_input, { signal }) => {
            const { items } = await generateOrSalvage(
              gateway,
              {
                tier: 'heavy',
                systemPrompt: buildUnitSystemPrompt(track.divisionId),
                userPrompt: buildUnitCardsUserPrompt(promptInput),
                schema: buildUnitCardsSchema(ctx),
                schemaName: UNIT_CARDS_SCHEMA_NAME,
                maxOutputTokens: cardsTokens,
                signal,
              },
              {
                lenient: evidenceSource ? buildUnitCardsSchema(lenientCtx) : null,
                finalize: (output) =>
                  output.briefingCards
                    .slice(0, plan.cards.max + 2)
                    .map((card, cardIndex) => finalizeBriefingCard(card, cardId(cardIndex), ctx.allowedPages, ctx.evidenceSource)),
                salvage: (raw) => salvageCards(raw, ctx, cardId),
                allowEmpty: false,
                log: { trackId, stage: cardsKey },
              },
            );
            return { output: items.slice(0, plan.cards.max + 2) };
          },
        });
        allCached &&= cardsResult.cacheHit;
        await recordBudget(cardsKey, cardsResult.budget);
        const cards: BriefingCard[] = [...cardsResult.output];

        // One cards top-up (like the Drill top-up) when the call came back below the publish minimum.
        if (cards.length < plan.cards.min) {
          const missing = plan.cards.min - cards.length;
          const topUpKey = `unit:${outline.id}:cards:topup`;
          const topUpPlan = cardsTopUpPlan(plan, missing);
          const topUpCtx: UnitBuildContext = { ...ctx, contentPlan: topUpPlan };
          const offset = cards.length;
          stageLabel = `${checkpointLabel} extra Briefing Cards (${outline.title})`;
          await report('BUILDING_UNITS', progressAt(0.05), `Writing ${checkpointLabel}: ${missing} more Briefing Card${missing === 1 ? '' : 's'} for ${outline.title}`);
          try {
            const existingHeadlines = cards.map((card) => card.headline);
            const topUp = await executor.executeStage({
              ...stageConfig(cardsMaxOutputTokens(missing)),
              stageKey: topUpKey,
              input: { ...stageInput, part: 'cards-topup', missing, existingHeadlines },
              schema: z.array(BriefingCardSchema).min(1),
              task: async (_input, { signal }) => {
                const topUpId = (cardIndex: number) => cardId(offset + cardIndex);
                const { items } = await generateOrSalvage(
                  gateway,
                  {
                    tier: 'heavy',
                    systemPrompt: buildUnitSystemPrompt(track.divisionId),
                    userPrompt: buildUnitCardsUserPrompt({ ...promptInput, outline: { ...promptInput.outline, contentPlan: topUpPlan }, existingHeadlines }),
                    schema: buildUnitCardsSchema(topUpCtx),
                    schemaName: UNIT_CARDS_SCHEMA_NAME,
                    maxOutputTokens: cardsMaxOutputTokens(missing),
                    signal,
                  },
                  {
                    lenient: evidenceSource ? buildUnitCardsSchema({ ...topUpCtx, strictEvidence: false }) : null,
                    finalize: (output) =>
                      output.briefingCards.slice(0, missing).map((card, cardIndex) => finalizeBriefingCard(card, topUpId(cardIndex), ctx.allowedPages, ctx.evidenceSource)),
                    salvage: (raw) => salvageCards(raw, topUpCtx, topUpId),
                    allowEmpty: false,
                    log: { trackId, stage: topUpKey },
                  },
                );
                return { output: items.slice(0, missing) };
              },
            });
            allCached &&= topUp.cacheHit;
            await recordBudget(topUpKey, topUp.budget);
            const seen = new Set(cards.map((card) => card.headline.trim().toLowerCase()));
            cards.push(...topUp.output.filter((card) => !seen.has(card.headline.trim().toLowerCase())));
          } catch (error) {
            // A failed top-up keeps the cards already written; the review note below asks the trainer.
            if (!isSkippableItemError(error)) throw error;
            logStageFailure(trackId, stageLabel, error);
          }
        }

        // Calls 2..n: Drills in small batches of planned kinds (at least 4 kinds per Unit). A batch
        // with malformed Drills keeps its valid ones; one top-up batch refills a shortfall.
        const kinds = batchDrillKinds(planDrillKinds(plan.drills.target, outline.orderIndex), drillBatchSize);
        const drills: DrillItem[] = [];
        // Ids count every Drill a batch wrote, so dropping a repeat never lets a later batch reuse its id.
        let drillsWritten = 0;
        const crossUnitRepeats: DrillItem[] = [];
        const runDrillBatch = async (stageKey: string, batchKinds: DrillKind[], batchIndex: number, batchCount: number) => {
          const batchTokens = drillsMaxOutputTokens(batchKinds.length);
          const offset = drillsWritten;
          const drillId = (drillIndex: number) => `${outline.id}-d${offset + drillIndex + 1}`;
          // Earlier Checkpoints' Drills are checked after the call, not listed in the prompt: the live R2d build
          // showed Qwen2.5-7B copying listed prompts verbatim into every later Checkpoint (31 near-duplicate pairs).
          const earlierDrills = units.flatMap((done) => done.drills);
          const previousDrillPrompts = drills.map((drill) => drill.prompt);
          // Repeats inside this Checkpoint go back to repair. Repeats of earlier Checkpoints are only dropped
          // afterwards (and restored if the Checkpoint would fall short): a local model that keeps restating a
          // rule the Playbook repeats on several pages must not fail the whole build.
          const batchCtx: UnitBuildContext = { ...ctx, avoidDrills: drills };
          const batchLenientCtx: UnitBuildContext = { ...lenientCtx, avoidDrills: drills };
          const drillResult = await executor.executeStage({
            ...stageConfig(batchTokens),
            stageKey,
            input: { ...stageInput, part: 'drills', batchKinds, cards, previousDrillPrompts },
            schema: z.array(DrillItemSchema),
            task: async (_input, { signal }) => {
              const { items } = await generateOrSalvage(
                gateway,
                {
                  tier: 'heavy',
                  systemPrompt: buildUnitSystemPrompt(track.divisionId),
                  userPrompt: buildUnitDrillsUserPrompt({
                    ...promptInput,
                    cards,
                    kinds: batchKinds,
                    previousDrillPrompts,
                    batchIndex,
                    batchCount,
                  }),
                  schema: buildUnitDrillBatchSchema(batchCtx, batchKinds),
                  schemaName: UNIT_DRILLS_SCHEMA_NAME,
                  maxOutputTokens: batchTokens,
                  signal,
                },
                {
                  lenient: evidenceSource ? buildUnitDrillBatchSchema(batchLenientCtx, batchKinds) : null,
                  finalize: (output) => pickPlannedDrills(output.drills, batchKinds).map((drill, drillIndex) => finalizeDrill(drill, drillId(drillIndex), ctx)),
                  salvage: (raw) => salvageDrillBatch(raw, batchCtx, batchKinds, drillId),
                  // An empty batch throws so no empty checkpoint is cached: Retry asks again.
                  allowEmpty: false,
                  log: { trackId, stage: stageKey },
                },
              );
              return { output: items };
            },
          });
          allCached &&= drillResult.cacheHit;
          await recordBudget(stageKey, drillResult.budget);
          drillsWritten += drillResult.output.length;
          // A small model often repeats an earlier batch's Drill despite the "already written" list.
          const fresh = dropRepeatedDrills(drills, drillResult.output);
          const novel = dropRepeatedDrills(earlierDrills, fresh);
          crossUnitRepeats.push(...fresh.filter((drill) => !novel.includes(drill)));
          drills.push(...novel);
        };
        const tryDrillBatch = async (...args: Parameters<typeof runDrillBatch>) => {
          try {
            await runDrillBatch(...args);
          } catch (error) {
            // A batch with no usable Drill is skipped; the top-up batch or a later Retry refills it.
            if (!isSkippableItemError(error)) throw error;
            logStageFailure(trackId, stageLabel, error);
          }
        };
        for (const [batchIndex, batchKinds] of kinds.entries()) {
          stageLabel = `${checkpointLabel} Drills ${batchIndex + 1}/${kinds.length} (${outline.title})`;
          await report(
            'BUILDING_UNITS',
            progressAt((batchIndex + 1) / (kinds.length + 1)),
            `Writing ${checkpointLabel}: Drills (batch ${batchIndex + 1} of ${kinds.length}) for ${outline.title}`,
          );
          await tryDrillBatch(`unit:${outline.id}:drills:${batchIndex + 1}`, batchKinds, batchIndex, kinds.length);
        }
        if (drills.length < plan.drills.min) {
          // Ask for one more than missing (within a batch): a single dropped Drill must not leave it short again.
          const missing = Math.min(drillBatchSize, plan.drills.min - drills.length + 1);
          stageLabel = `${checkpointLabel} extra Drills (${outline.title})`;
          await report('BUILDING_UNITS', progressAt(0.95), `Writing ${checkpointLabel}: ${missing} more Drill${missing === 1 ? '' : 's'} for ${outline.title}`);
          await tryDrillBatch(`unit:${outline.id}:drills:topup`, topUpDrillKinds(drills, missing, outline.orderIndex), kinds.length, kinds.length + 1);
        }
        const restored = restoreRepeatsToMinimum(drills, crossUnitRepeats, plan.drills.min);
        drills.push(...restored);
        if (drills.length === 0) {
          throw new Error(`The AI model wrote no valid Drills for this Checkpoint after ${kinds.length + 1} batches. Select Retry.`);
        }
        const reviewNotes = [
          ...shortfallNotes(cards.length, plan.cards.min, drills.length, plan.drills.min),
          ...(restored.length > 0 ? [`${restored.length} Drill${restored.length === 1 ? ' repeats' : 's repeat'} another Checkpoint (kept to reach the minimum): ${restored.map((drill) => drill.id).join(', ')}.`] : []),
        ];
        unit = TrackUnitSchema.parse({
          id: outline.id,
          orderIndex: outline.orderIndex,
          title: clampText(outline.title, 80),
          summary: clampText(outline.summary, 180),
          estimatedMinutes: estimateUnitMinutes(cards.length, drills.length),
          briefingCards: cards.slice(0, 8),
          drills: drills.slice(0, 10),
          ...(reviewNotes.length > 0 ? { reviewNotes } : {}),
        });
      }

      const flagged = source ? itemsNeedingEvidenceReview([...unit.briefingCards, ...unit.drills], source) : [];
      flaggedItems.push(...flagged, ...(unit.reviewNotes ?? []).map((note) => `${unit.id}: ${note}`));
      units.push(unit);
      await saveDraft(units, []);
      await report(
        'BUILDING_UNITS',
        progressAt(1),
        `${allCached ? 'Resumed' : 'Built'} ${checkpointLabel}: ${outline.title}${flagged.length > 0 ? ` (${flagged.length} item${flagged.length === 1 ? '' : 's'} need evidence review)` : ''}${unit.reviewNotes?.length ? ` (${unit.reviewNotes.join(' ')})` : ''}`,
      );
    }

    // Pass 3: cache only fully finalized scenarios with server-resolved evidence.
    stageLabel = 'Live Call Sims';
    await report('BUILDING_SIMS', 80, 'Creating Live Call Simulation personas & grading rubrics...');
    const allPageNumbers = sourceLabels ?? [...new Set(pages.map((page) => page.pageNumber))];
    const simCtx = {
      pillarIds,
      allowedPages: allPageNumbers,
      requireEvidence: source !== null,
      scenarioDefaults: {
        divisionId: track.divisionId,
        product: blueprint.campaignCode || track.title,
        ...(source ? { sourceRevision: source.sourceRevision } : {}),
      },
    };
    const simPromptBase = {
      trackTitle: track.title,
      campaignCode: blueprint.campaignCode,
      divisionId: track.divisionId,
      globalSummary: blueprint.globalSummary,
      pillars: blueprint.competencyPillars,
      unitTitles: units.map((unit) => unit.title),
      pages,
      sourceReview: source ?? undefined,
      preferredPageOrder: pagesByCitation(units, allPageNumbers),
    };
    // Local models write one scenario per call (smaller answers, budgeted to the 16k context).
    const simPerScenario = local;
    const simTokens = simPerScenario ? SIM_SINGLE_SCENARIO_MAX_OUTPUT_TOKENS : SIM_BUILDER_MAX_OUTPUT_TOKENS;
    const simCharBudget = local
      ? localSourceCharBudget({ plannedOutputTokens: simTokens, overheadTokens: UNIT_OVERHEAD_TOKENS })
      : undefined;
    const plannedSims = simPerScenario ? MIN_SIM_SCENARIOS : MAX_SIM_SCENARIOS;
    const lenientSimCtx = { ...simCtx, requireEvidence: false };
    const simStageInput = {
      cacheIdentity,
      templateVersion: source ? 'v4' : 'v3',
      ...simPromptBase,
      sourceReview: source,
      sourceCharBudget: simCharBudget ?? null,
    };
    const pairSchema = z.array(z.object({ publicScenario: PublicSimScenarioSchema, secretConfig: SecretSimScenarioConfigSchema }));
    const groundScenario = (pair: SimScenarioPair): SimScenarioPair =>
      evidenceSource ? groundScenarioEvidence(pair, evidenceSource, allPageNumbers) : pair;
    const scenarios: SimScenarioPair[] = [];

    if (simPerScenario) {
      for (let index = 0; index < plannedSims; index++) {
        const stageKey = `simulations:${index + 1}`;
        const scenarioId = `s${index + 1}`;
        const otherScenarioTitles = scenarios.map((pair) => pair.publicScenario.title);
        stageLabel = `Live Call Sim ${index + 1} of ${plannedSims}`;
        await report('BUILDING_SIMS', 80 + (index * 15) / plannedSims, `Creating Live Call Sim ${index + 1} of ${plannedSims}...`);
        try {
          const result = await executor.executeStage({
            ...stageConfig(simTokens),
            stageKey,
            input: { ...simStageInput, index, plannedSims, otherScenarioTitles },
            schema: pairSchema.min(1),
            task: async (_input, { signal }) => {
              const { items } = await generateOrSalvage(
                gateway,
                {
                  tier: 'heavy',
                  systemPrompt: buildSimSystemPrompt(track.divisionId),
                  userPrompt: buildOneScenarioUserPrompt({ ...simPromptBase, sourceCharBudget: simCharBudget, index, count: plannedSims, otherScenarioTitles }),
                  schema: withRubricEvidenceCheck(buildSingleScenarioSchema(simCtx), evidenceSource, allPageNumbers, false),
                  schemaName: SINGLE_SIM_SCHEMA_NAME,
                  maxOutputTokens: simTokens,
                  signal,
                },
                {
                  lenient: buildSingleScenarioSchema(lenientSimCtx),
                  finalize: (output) => [finalizeScenario(output, scenarioId, simCtx, track.divisionId)],
                  salvage: (raw) => salvageScenarios(raw, simCtx, () => scenarioId, track.divisionId, 1),
                  allowEmpty: false,
                  log: { trackId, stage: stageKey },
                },
              );
              return { output: items.slice(0, 1).map(groundScenario) };
            },
          });
          await recordBudget(stageKey, result.budget);
          scenarios.push(...result.output);
        } catch (error) {
          // One unusable scenario does not sink the Track; it is retried on the next build.
          if (!isSkippableItemError(error)) throw error;
          logStageFailure(trackId, stageLabel, error);
        }
      }
    } else {
      const simResult = await executor.executeStage({
        ...stageConfig(simTokens),
        stageKey: 'simulations',
        input: simStageInput,
        schema: pairSchema.min(1),
        task: async (_input, { signal }) => {
          const { items } = await generateOrSalvage(
            gateway,
            {
              tier: 'heavy',
              systemPrompt: buildSimSystemPrompt(track.divisionId),
              userPrompt: buildSimUserPrompt({ ...simPromptBase, sourceCharBudget: simCharBudget }),
              schema: withRubricEvidenceCheck(buildSimGenerationSchema(simCtx), evidenceSource, allPageNumbers, true),
              schemaName: SIM_SCHEMA_NAME,
              maxOutputTokens: simTokens,
              signal,
            },
            {
              lenient: buildSimGenerationSchema(lenientSimCtx),
              finalize: (output) => finalizeScenarios(output, simCtx, track.divisionId),
              salvage: (raw) => salvageScenarios(raw, simCtx, (index) => `s${index + 1}`, track.divisionId),
              allowEmpty: false,
              log: { trackId, stage: 'simulations' },
            },
          );
          return { output: items.map(groundScenario) };
        },
      });
      await recordBudget('simulations', simResult.budget);
      scenarios.push(...simResult.output);
    }
    if (scenarios.length === 0) {
      throw new Error('The AI model wrote no usable Live Call Simulation. Select Retry; finished Checkpoints are kept.');
    }
    const draftNotes = simShortfallNotes(scenarios.length, plannedSims, simPerScenario);
    flaggedItems.push(...draftNotes);
    if (source) {
      flaggedItems.push(...itemsNeedingEvidenceReview(scenarios.flatMap((pair) => pair.secretConfig.rubricCriteria), source));
    }
    if (flaggedItems.length > 0) {
      console.warn('[track-generation] items stored with unsupported evidence for trainer review', { trackId, items: flaggedItems });
    }

    stageLabel = 'Saving the draft';
    await commitDraft({ track, trackId, blueprint, units, scenarios, versionNumber, createdAt, provenance, source, flaggedCount: flaggedItems.length, reviewNotes: draftNotes });
    lastPercent = 100;
    onProgress({ step: 'READY', percent: 100, message: readyMessage(flaggedItems.length, unitCountNote(units.length, track.unitTarget)) });
  } catch (error) {
    if (isGenerationPausedError(error)) {
      // Keep the progress the trainer sees; the next step clears generationPausedAt when it takes over.
      await trackRef(trackId).update({ generationPausedAt: Date.now(), updatedAt: Date.now() }).catch(() => undefined);
      throw error;
    }
    logStageFailure(trackId, stageLabel, error);
    const message = describeGenerationError(error, stageLabel);
    await trackRef(trackId)
      .update({ generationProgress: { step: 'FAILED', percent: lastPercent, message }, updatedAt: Date.now() })
      .catch(() => undefined);
    throw new Error(message, { cause: error });
  } finally {
    clearInterval(heartbeat);
  }
}

function readyMessage(flaggedCount: number, countNote: string | null = null): string {
  const note = countNote ? ` ${countNote}` : '';
  return flaggedCount > 0
    ? `Track Ready!${note} ${flaggedCount} item${flaggedCount === 1 ? '' : 's'} need trainer review before publishing. Redirecting to Preview Studio...`
    : `Track Ready!${note} Redirecting to Preview Studio...`;
}

async function commitDraft(input: {
  track: TrackDoc;
  trackId: string;
  blueprint: TrackBlueprint;
  units: TrackUnit[];
  scenarios: ReturnType<typeof finalizeScenarios>;
  versionNumber: number;
  createdAt: number;
  provenance: ProvenanceRecord;
  source: SourceGenerationContext | null;
  flaggedCount?: number;
  reviewNotes?: string[];
}): Promise<void> {
  const now = Date.now();
  // Verbal Practice hides the Studio QA editor, so a freshly built Track must already carry canonical
  // verbal context and scripted QA fixtures; otherwise publishing needs a dummy edit first.
  const verbal = VERBAL_ONLY
    ? normalizeVerbalScenarioPairs({
        scenarios: input.scenarios.map((pair) => pair.publicScenario),
        secrets: input.scenarios.map((pair) => pair.secretConfig),
        defaults: {
          divisionId: input.track.divisionId,
          product: input.track.title,
          sourceRevision: input.source?.sourceRevision ?? null,
          curriculumVersion: DRAFT_VERSION_ID,
        },
      })
    : null;
  const simScenarios = verbal ? verbal.scenarios : input.scenarios.map((pair) => pair.publicScenario);
  const draft = TrackVersionDocSchema.parse({
    versionId: DRAFT_VERSION_ID,
    trackId: input.trackId,
    versionNumber: input.versionNumber,
    competencyPillars: input.blueprint.competencyPillars,
    units: input.units,
    simScenarios,
    provenance: input.provenance,
    ...(input.source
      ? {
          sourceBundleId: input.source.sourceBundleId,
          sourceRevision: input.source.sourceRevision,
          requiredRuleIds: input.source.requiredRuleIds,
        }
      : {}),
    ...(input.reviewNotes?.length ? { reviewNotes: input.reviewNotes } : {}),
    publishedAt: null,
    createdAt: input.createdAt,
  });
  const secrets = EvalRubricsDocSchema.parse({
    trackId: input.trackId,
    versionId: DRAFT_VERSION_ID,
    scenarios: verbal ? verbal.secrets : input.scenarios.map((pair) => pair.secretConfig),
    updatedAt: now,
  });
  const batch = adminDb.batch();
  batch.set(draftRef(input.trackId), draft);
  batch.set(secretsRef(input.trackId, DRAFT_VERSION_ID), secrets);
  const published = input.track.publishedVersionId !== null;
  batch.update(trackRef(input.trackId), {
    // A Track with a published TrackVersion stays visible to learners while its new draft waits for re-certification.
    // Its header counts and CompetencyPillars keep describing the published TrackVersion until the next publish.
    status: published ? 'PUBLISHED' : 'DRAFT',
    campaignCode: input.track.campaignCode.trim() ? input.track.campaignCode : input.blueprint.campaignCode,
    ...(published
      ? {}
      : {
          competencyPillars: input.blueprint.competencyPillars,
          unitCount: input.units.length,
          simScenarioCount: simScenarios.length,
          estimatedTotalMinutes: estimateTrackMinutes(input.units, simScenarios.length),
        }),
    currentDraftVersionId: DRAFT_VERSION_ID,
    generationProgress: { step: 'READY', percent: 100, message: readyMessage(input.flaggedCount ?? 0, unitCountNote(input.units.length, input.track.unitTarget)) },
    updatedAt: now,
  });
  await batch.commit();
  await adminDb.collection('generationWorkingDrafts').doc(input.trackId).delete().catch(() => undefined);
}
