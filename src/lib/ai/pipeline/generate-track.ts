/**
 * Staged Track build orchestrator (docs/04 §3): Pass 1 Blueprint -> Pass 2 Unit Builder (per Unit)
 * -> Pass 3 Sim Builder. Persists progress and the partial draft after each Unit, then writes the
 * complete draft TrackVersion and its secret rubrics. Server only.
 */
import { adminDb } from '@/lib/firebase/admin';
import {
  DRAFT_VERSION_ID,
  EvalRubricsDocSchema,
  TrackVersionDocSchema,
  type GenerationStep,
  type TrackDoc,
  type TrackUnit,
  type TrackVersionDoc,
} from '@/lib/schemas/curriculum';
import type { GenerateProgressEvent } from '@/lib/schemas/api';
import { LLMStructuredOutputError, type LLMGateway } from '@/lib/ai/types';
import { getLLMGateway } from '@/lib/ai/gateway';
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

export type ProgressListener = (event: GenerateProgressEvent) => void;

/** Plain-English message for a build failure. */
export function describeGenerationError(error: unknown): string {
  if (error instanceof LLMStructuredOutputError) {
    return `The AI model could not produce valid ${error.schemaName} content after ${error.attempts} attempts. Select Retry to build the Track again.`;
  }
  if (error instanceof Error && error.message) return error.message;
  return 'The Track build stopped because of an unknown error. Select Retry to build the Track again.';
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

    // Pass 1: Blueprint
    await report('BLUEPRINTING', 15, `Read ${pages.length} pages. Analyzing campaign rules...`);
    const blueprintRaw = await gateway.generateStructured({
      tier: 'heavy',
      systemPrompt: buildBlueprintSystemPrompt(track.divisionId),
      userPrompt: buildBlueprintUserPrompt({
        trackTitle: track.title,
        campaignCode: track.campaignCode,
        divisionId: track.divisionId,
        pages,
      }),
      schema: buildBlueprintSchema(pages.length),
      schemaName: BLUEPRINT_SCHEMA_NAME,
    });
    const blueprint = finalizeBlueprint(blueprintRaw, pages.length, track.campaignCode);
    const pillarIds = blueprint.competencyPillars.map((pillar) => pillar.id);
    const createdAt = Date.now();
    const versionNumber = nextDraftVersionNumber(track);

    const saveDraft = async (units: TrackUnit[], simScenarios: TrackVersionDoc['simScenarios']) => {
      const draft = TrackVersionDocSchema.parse({
        versionId: DRAFT_VERSION_ID,
        trackId,
        versionNumber,
        competencyPillars: blueprint.competencyPillars,
        units,
        simScenarios,
        publishedAt: null,
        createdAt,
      });
      await draftRef(trackId).set(draft);
      return draft;
    };

    await saveDraft([], []);
    await report(
      'BUILDING_UNITS',
      30,
      `Mapped ${blueprint.units.length} Checkpoints. Generating Briefing Cards & Drills...`,
    );

    // Pass 2: Unit Builder, one Unit at a time with only its mapped pages
    const units: TrackUnit[] = [];
    const unitTotal = blueprint.units.length;
    for (const [index, outline] of blueprint.units.entries()) {
      const unitPages = selectPages(pages, outline.sourcePages);
      const allowedPages = unitPages.map((page) => page.pageNumber);
      const ctx = { pillarIds, allowedPages };
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
          otherUnitTitles: blueprint.units.filter((other) => other.id !== outline.id).map((other) => other.title),
        }),
        schema: buildUnitGenerationSchema(ctx),
        schemaName: UNIT_SCHEMA_NAME,
      });
      units.push(finalizeUnit(outline, generated, ctx));
      await saveDraft(units, []);
      await report('BUILDING_UNITS', 30 + ((index + 1) * 45) / unitTotal, `Built Checkpoint ${index + 1}: ${outline.title}`);
    }

    // Pass 3: Sim Builder
    await report('BUILDING_SIMS', 80, 'Creating Live Call Simulation personas & grading rubrics...');
    const allPageNumbers = pages.map((page) => page.pageNumber);
    const simCtx = { pillarIds, allowedPages: allPageNumbers };
    const simRaw = await gateway.generateStructured({
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
        preferredPageOrder: pagesByCitation(units, pages),
      }),
      schema: buildSimGenerationSchema(simCtx),
      schemaName: SIM_SCHEMA_NAME,
    });
    const scenarios = finalizeScenarios(simRaw, simCtx);

    await commitDraft({ track, trackId, blueprint, units, scenarios, versionNumber, createdAt });
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
}
