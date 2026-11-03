/**
 * Staged Track build orchestrator (docs/04 §3): Pass 1 Blueprint -> Pass 2 Unit Builder (per Unit)
 * -> Pass 3 Sim Builder. Persists progress and the partial draft after each Unit, then writes the
 * complete draft TrackVersion and its secret rubrics. Server only.
 */
import { z } from 'zod';
import { adminDb } from '@/lib/firebase/admin';
import {
  DRAFT_VERSION_ID,
  EvalRubricsDocSchema,
  PublicSimScenarioSchema,
  SecretSimScenarioConfigSchema,
  TrackUnitSchema,
  TrackVersionDocSchema,
  type GenerationStep,
  type TrackDoc,
  type TrackUnit,
  type TrackVersionDoc,
} from '@/lib/schemas/curriculum';
import type { GenerateProgressEvent } from '@/lib/schemas/api';
import { LLMStructuredOutputError, type LLMGateway } from '@/lib/ai/types';
import { getActiveAiRuntime, getLLMGateway } from '@/lib/ai/gateway';
import { createProvenance, type ProvenanceRecord } from '@/lib/ai/provenance';
import { selectPages, type ExtractedPage } from '@/lib/ai/pdf-extractor';
import {
  BLUEPRINT_SCHEMA_NAME,
  buildBlueprintSchema,
  buildBlueprintSystemPrompt,
  buildBlueprintUserPrompt,
  finalizeBlueprint,
  type TrackBlueprint,
} from '@/lib/ai/prompts/blueprint';
import {
  UNIT_SCHEMA_NAME,
  buildUnitGenerationSchema,
  buildUnitSystemPrompt,
  buildUnitUserPrompt,
  finalizeUnit,
} from '@/lib/ai/prompts/unit-builder';
import {
  SIM_SCHEMA_NAME,
  buildSimGenerationSchema,
  buildSimSystemPrompt,
  buildSimUserPrompt,
  finalizeScenarios,
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
import type { SourceReviewPromptContext } from '@/lib/ai/pipeline/source-budget';
import {
  GenerationReliabilityExecutor,
  hashGenerationInput,
  type GenerationBudgetReport,
  type GenerationCheckpoint,
  type GenerationCheckpointIdentity,
  type GenerationCheckpointStore,
} from '@/lib/ai/pipeline/generation-reliability';
import { LocalRuntimeLimiter } from '@/lib/ai/local-runtime';

const generationLimiter = new LocalRuntimeLimiter();
const GENERATION_STAGE_TIMEOUT_MS = 180_000;
const GENERATION_STAGE_CHARACTER_BUDGET = 2_000_000;

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

/** Plain-English message for a build failure. */
export function describeGenerationError(error: unknown): string {
  if (error instanceof LLMStructuredOutputError) {
    return `The AI model could not produce valid ${error.schemaName} content after ${error.attempts} attempts. Select Retry to build the Track again.`;
  }
  if (error instanceof Error && error.message) return error.message;
  return 'The Track build stopped because of an unknown error. Select Retry to build the Track again.';
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

function assertUnitEvidence(unit: TrackUnit, source: SourceGenerationContext): void {
  for (const card of unit.briefingCards) assertGeneratedClaimEvidence(card.id, card.evidence, source);
  for (const drill of unit.drills) assertGeneratedClaimEvidence(drill.id, drill.evidence, source);
}

function assertScenarioEvidence(scenarios: ReturnType<typeof finalizeScenarios>, source: SourceGenerationContext): void {
  for (const scenario of scenarios) {
    for (const criterion of scenario.secretConfig.rubricCriteria) {
      assertGeneratedClaimEvidence(criterion.id, criterion.evidence, source);
    }
  }
}

/** Page numbers ordered by how often the Units cite them (most cited first). */
function pagesByCitation(units: TrackUnit[], pages: ExtractedPage[]): number[] {
  const counts = new Map<number, number>();
  for (const unit of units) {
    for (const card of unit.briefingCards) card.sourcePages.forEach((page) => counts.set(page, (counts.get(page) ?? 0) + 1));
    for (const drill of unit.drills) drill.sourcePages.forEach((page) => counts.set(page, (counts.get(page) ?? 0) + 1));
  }
  return pages
    .map((page) => page.pageNumber)
    .sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || a - b);
}

/**
 * Run the full build for a Track whose generation lock the caller already holds.
 * Emits progress events and persists them on the Track. Throws on failure after it marks the Track FAILED.
 */
export async function runTrackGeneration(trackId: string, onProgress: ProgressListener, gateway: LLMGateway = getLLMGateway()): Promise<void> {
  let lastPercent = 0;
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

    const createdAt = Date.now();
    const versionNumber = nextDraftVersionNumber(track);
    const runtime = getActiveAiRuntime();
    const provenance = createProvenance({
      source: runtime.provider === 'replay' ? 'replay' : runtime.provider === 'gemini' ? 'hosted_ai' : runtime.provider === 'manual_chat' ? 'manual_chat' : 'local_ai',
      provider: runtime.provider,
      model: runtime.heavyModel,
      prompt: { templateId: 'staged-track-generation', templateVersion: source ? 'v2' : 'v1' },
      schema: { name: 'TrackVersion', version: source ? 'v2' : 'v1' },
      runtime: { label: runtime.runtimeLabel ?? runtime.provider, profileId: `${runtime.provider}-local` },
      recordedAt: new Date(createdAt).toISOString(),
    });
    // Runtime and authoring-contract identity is part of every stage hash. A cache hit can never
    // be relabeled as output from a different provider/model/prompt/schema/runtime profile.
    const cacheIdentity = {
      contractVersion: 'staged-track-generation-2026-11-02-v1',
      source: provenance.source,
      provider: provenance.provider,
      model: provenance.model,
      prompt: provenance.prompt,
      schema: provenance.schema,
      runtime: provenance.runtime,
      generationProfile: runtime.generationProfile,
    };
    const executor = new GenerationReliabilityExecutor(new FirestoreGenerationCheckpointStore(), generationLimiter);
    const runId = `track-${trackId}`;
    const budgets: Record<string, GenerationBudgetReport> = { ...(track.generationBudgets ?? {}) };
    const stageConfig = {
      runId,
      trackId,
      timeoutMs: GENERATION_STAGE_TIMEOUT_MS,
      budgets: { maxCharacters: GENERATION_STAGE_CHARACTER_BUDGET, maxDurationMs: GENERATION_STAGE_TIMEOUT_MS },
      provenance,
    } as const;
    const recordBudget = async (stageKey: string, budget: GenerationBudgetReport) => {
      budgets[stageKey] = budget;
      await trackRef(trackId).update({ generationBudgets: budgets, updatedAt: Date.now() });
    };

    // Pass 1: resume an exact-input blueprint checkpoint before making another model call.
    await report('BLUEPRINTING', 15, `Read ${pages.length} pages. Analyzing campaign rules...`);
    const blueprintResult = await executor.executeStage({
      ...stageConfig,
      stageKey: 'blueprint',
      input: {
        cacheIdentity,
        templateVersion: source ? 'v2' : 'v1',
        trackTitle: track.title,
        campaignCode: track.campaignCode,
        divisionId: track.divisionId,
        pages,
        sourceReview: source,
      },
      schema: z.custom<TrackBlueprint>((value) => Boolean(value && typeof value === 'object')),
      task: async (_input, { signal }) => {
        const raw = await gateway.generateStructured({
          tier: 'heavy',
          systemPrompt: buildBlueprintSystemPrompt(track.divisionId),
          userPrompt: buildBlueprintUserPrompt({
            trackTitle: track.title,
            campaignCode: track.campaignCode,
            divisionId: track.divisionId,
            pages,
            sourceReview: source ?? undefined,
          }),
          schema: buildBlueprintSchema(pages.length),
          schemaName: BLUEPRINT_SCHEMA_NAME,
          signal,
        });
        return { output: finalizeBlueprint(raw, pages.length, track.campaignCode) };
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
    await report(
      'BUILDING_UNITS',
      30,
      `Mapped ${blueprint.units.length} Checkpoints. Generating Briefing Cards & Drills...`,
    );

    // Pass 2: persist each finalized, evidence-checked Unit before starting the next one.
    const units: TrackUnit[] = [];
    const unitTotal = blueprint.units.length;
    for (const [index, outline] of blueprint.units.entries()) {
      const unitPages = selectPages(pages, outline.sourcePages);
      const allowedPages = [...new Set((source?.pages ?? unitPages).map((page) => page.pageNumber))];
      const ctx = { pillarIds, allowedPages, requireEvidence: source !== null };
      const stageKey = `unit:${outline.id}`;
      const unitResult = await executor.executeStage({
        ...stageConfig,
        stageKey,
        input: {
          cacheIdentity,
          templateVersion: source ? 'v2' : 'v1',
          trackTitle: track.title,
          campaignCode: blueprint.campaignCode,
          divisionId: track.divisionId,
          outline,
          globalSummary: blueprint.globalSummary,
          pillars: blueprint.competencyPillars,
          unitPages,
          sourceReview: source,
          otherUnitTitles: blueprint.units.filter((other) => other.id !== outline.id).map((other) => other.title),
        },
        schema: TrackUnitSchema,
        task: async (_input, { signal }) => {
          const generated = await gateway.generateStructured({
            tier: 'heavy',
            systemPrompt: buildUnitSystemPrompt(track.divisionId),
            userPrompt: buildUnitUserPrompt({
              trackTitle: track.title,
              campaignCode: blueprint.campaignCode,
              divisionId: track.divisionId,
              globalSummary: blueprint.globalSummary,
              pillars: blueprint.competencyPillars,
              outline,
              pages: unitPages,
              sourceReview: source ?? undefined,
              otherUnitTitles: blueprint.units.filter((other) => other.id !== outline.id).map((other) => other.title),
            }),
            schema: buildUnitGenerationSchema(ctx),
            schemaName: UNIT_SCHEMA_NAME,
            signal,
          });
          const unit = finalizeUnit(outline, generated, ctx);
          if (source) assertUnitEvidence(unit, source);
          return { output: unit };
        },
      });
      units.push(unitResult.output);
      await recordBudget(stageKey, unitResult.budget);
      await saveDraft(units, []);
      await report(
        'BUILDING_UNITS',
        30 + ((index + 1) * 45) / unitTotal,
        `${unitResult.cacheHit ? 'Resumed' : 'Built'} Checkpoint ${index + 1}: ${outline.title}`,
      );
    }

    // Pass 3: cache only fully finalized scenarios with server-verified evidence.
    await report('BUILDING_SIMS', 80, 'Creating Live Call Simulation personas & grading rubrics...');
    const allPageNumbers = [...new Set((source?.pages ?? pages).map((page) => page.pageNumber))];
    const simCtx = { pillarIds, allowedPages: allPageNumbers, requireEvidence: source !== null };
    const simResult = await executor.executeStage({
      ...stageConfig,
      stageKey: 'simulations',
      input: {
        cacheIdentity,
        templateVersion: source ? 'v2' : 'v1',
        trackTitle: track.title,
        campaignCode: blueprint.campaignCode,
        divisionId: track.divisionId,
        globalSummary: blueprint.globalSummary,
        pillars: blueprint.competencyPillars,
        unitTitles: units.map((unit) => unit.title),
        pages,
        sourceReview: source,
        preferredPageOrder: pagesByCitation(units, pages),
      },
      schema: z.array(z.object({ publicScenario: PublicSimScenarioSchema, secretConfig: SecretSimScenarioConfigSchema })),
      task: async (_input, { signal }) => {
        const raw = await gateway.generateStructured({
          tier: 'heavy',
          systemPrompt: buildSimSystemPrompt(track.divisionId),
          userPrompt: buildSimUserPrompt({
            trackTitle: track.title,
            campaignCode: blueprint.campaignCode,
            divisionId: track.divisionId,
            globalSummary: blueprint.globalSummary,
            pillars: blueprint.competencyPillars,
            unitTitles: units.map((unit) => unit.title),
            pages,
            sourceReview: source ?? undefined,
            preferredPageOrder: pagesByCitation(units, pages),
          }),
          schema: buildSimGenerationSchema(simCtx),
          schemaName: SIM_SCHEMA_NAME,
          signal,
        });
        const scenarios = finalizeScenarios(raw, simCtx);
        if (source) assertScenarioEvidence(scenarios, source);
        return { output: scenarios };
      },
    });
    const scenarios = simResult.output;
    await recordBudget('simulations', simResult.budget);

    await commitDraft({ track, trackId, blueprint, units, scenarios, versionNumber, createdAt, provenance, source });
    lastPercent = 100;
    onProgress({ step: 'READY', percent: 100, message: 'Track Ready! Redirecting to Preview Studio...' });
  } catch (error) {
    const message = describeGenerationError(error);
    await trackRef(trackId)
      .update({ generationProgress: { step: 'FAILED', percent: lastPercent, message }, updatedAt: Date.now() })
      .catch(() => undefined);
    throw new Error(message, { cause: error });
  } finally {
    clearInterval(heartbeat);
  }
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
}): Promise<void> {
  const now = Date.now();
  const simScenarios = input.scenarios.map((pair) => pair.publicScenario);
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
    publishedAt: null,
    createdAt: input.createdAt,
  });
  const secrets = EvalRubricsDocSchema.parse({
    trackId: input.trackId,
    versionId: DRAFT_VERSION_ID,
    scenarios: input.scenarios.map((pair) => pair.secretConfig),
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
    generationProgress: { step: 'READY', percent: 100, message: 'Track Ready! Redirecting to Preview Studio...' },
    updatedAt: now,
  });
  await batch.commit();
  await adminDb.collection('generationWorkingDrafts').doc(input.trackId).delete().catch(() => undefined);
}
