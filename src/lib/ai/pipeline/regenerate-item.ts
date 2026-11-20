/**
 * One-click regeneration of ONE BriefingCard, Drill, or Simulation scenario in a draft TrackVersion.
 * Heavy tier, grounded in the Unit's cited SOURCE PAGES (or all pages for a scenario). Server only.
 */
import { adminDb } from '@/lib/firebase/admin';
import {
  DRAFT_VERSION_ID,
  EvalRubricsDocSchema,
  TrackVersionDocSchema,
  type BriefingCard,
  type DrillItem,
  type PublicSimScenario,
  type TrackDoc,
  type TrackUnit,
  type TrackVersionDoc,
} from '@/lib/schemas/curriculum';
import type { RegenerateItemRequest } from '@/lib/schemas/api';
import { getActiveAiRuntime, getLLMGateway } from '@/lib/ai/gateway';
import { assertGeneratedClaimEvidence, isLocalProvider } from '@/lib/ai/pipeline/generate-track';
import { regroundStoredEvidence, sourcePageLabels, type EvidenceSource } from '@/lib/ai/prompts/evidence';
import { UNIT_OVERHEAD_TOKENS, localSourceCharBudget } from '@/lib/ai/pipeline/source-budget';
import { loadSourceReview, type SourceReviewData } from '@/lib/services/source-store';
import type { LLMGateway } from '@/lib/ai/types';
import { selectPages, type ExtractedPage } from '@/lib/ai/pdf-extractor';
import type { UnitOutline } from '@/lib/ai/prompts/blueprint';
import {
  BRIEFING_CARD_SCHEMA_NAME,
  DRILL_SCHEMA_NAME,
  cardsMaxOutputTokens,
  drillsMaxOutputTokens,
  buildCardGenerationSchema,
  buildDrillGenerationSchema,
  buildRegenerateCardUserPrompt,
  buildRegenerateDrillUserPrompt,
  buildUnitSystemPrompt,
  finalizeBriefingCard,
  finalizeDrill,
  type UnitBuildContext,
  type UnitPromptInput,
} from '@/lib/ai/prompts/unit-builder';
import {
  SINGLE_SIM_SCHEMA_NAME,
  buildRegenerateScenarioUserPrompt,
  buildSimSystemPrompt,
  SIM_SINGLE_SCENARIO_MAX_OUTPUT_TOKENS,
  buildSingleScenarioSchema,
  finalizeScenario,
} from '@/lib/ai/prompts/sim-builder';
import {
  draftRef,
  isGenerationRunning,
  loadSecrets,
  loadSourcePages,
  loadTrack,
  loadVersion,
  secretsRef,
  trackRef,
  unitCitedPages,
} from '@/lib/ai/pipeline/track-store';

/** Error with an HTTP status and a machine code for the route handler. */
export class RegenerateItemError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'RegenerateItemError';
  }
}

export type RegeneratedItem = BriefingCard | DrillItem | PublicSimScenario;

/** Short Track context in place of the Pass 1 global summary (which is not stored). */
function trackContextSummary(track: TrackDoc, draft: TrackVersionDoc): string {
  const unitLines = draft.units.map((unit, index) => `${index + 1}. ${unit.title}: ${unit.summary}`).join('\n');
  const keyTakeaways = draft.units
    .flatMap((unit) => unit.briefingCards.map((card) => `- ${card.keyTakeaway}`))
    .slice(0, 24)
    .join('\n');
  return [`Track "${track.title}" has these Units:`, unitLines, 'Key takeaways already taught:', keyTakeaways].join('\n');
}

function unitContext(
  track: TrackDoc,
  draft: TrackVersionDoc,
  unit: TrackUnit,
  allPages: ExtractedPage[],
  sourceReview?: SourceReviewData,
): UnitPromptInput {
  const cited = unitCitedPages(unit);
  const pages = cited.length > 0 ? selectPages(allPages, cited) : allPages;
  const pillarIds = [...new Set(unit.drills.map((drill) => drill.competencyPillarId))];
  const outline: UnitOutline = {
    id: unit.id,
    orderIndex: unit.orderIndex,
    title: unit.title,
    summary: unit.summary,
    focus: unit.briefingCards.map((card) => card.headline).join('; ') || unit.summary,
    sourcePages: pages.map((page) => page.pageNumber),
    pillarIds: pillarIds.length > 0 ? pillarIds : draft.competencyPillars.map((pillar) => pillar.id),
  };
  return {
    trackTitle: track.title,
    campaignCode: track.campaignCode,
    divisionId: track.divisionId,
    globalSummary: trackContextSummary(track, draft),
    pillars: draft.competencyPillars,
    outline,
    pages,
    sourceReview,
    otherUnitTitles: draft.units.filter((other) => other.id !== unit.id).map((other) => other.title),
    sourceCharBudget: isLocalProvider(getActiveAiRuntime().provider)
      ? localSourceCharBudget({ plannedOutputTokens: cardsMaxOutputTokens(1), overheadTokens: UNIT_OVERHEAD_TOKENS })
      : undefined,
  };
}

/** Re-read the draft inside the write transaction and replace only the regenerated item. */
async function commitItem(
  trackId: string,
  expectedSourceRevision: string | null | undefined,
  replace: (latest: TrackVersionDoc) => TrackVersionDoc,
): Promise<void> {
  await adminDb.runTransaction(async (tx) => {
    const latest = await loadVersion(trackId, DRAFT_VERSION_ID, tx);
    if (!latest) throw new RegenerateItemError(409, 'NO_DRAFT', 'The draft was removed while the item was regenerating. Reload the Studio.');
    if ((latest.sourceRevision ?? null) !== (expectedSourceRevision ?? null)) {
      throw new RegenerateItemError(409, 'SOURCE_REVISION_STALE', 'The draft changed to a different source revision while the item was regenerating. Reload the Studio.');
    }
    const next = replace(latest);
    tx.set(draftRef(trackId), TrackVersionDocSchema.parse(next));
    tx.update(trackRef(trackId), { updatedAt: Date.now() });
  });
}

function requireUnit(latest: TrackVersionDoc, unitId: string): TrackVersionDoc {
  if (!latest.units.some((existing) => existing.id === unitId)) throw itemGone('Unit');
  return latest;
}

function itemGone(kind: string): RegenerateItemError {
  return new RegenerateItemError(409, 'ITEM_CHANGED', `This ${kind} was removed from the draft while it was regenerating. Reload the Studio.`);
}

export async function regenerateDraftItem(
  trackId: string,
  request: RegenerateItemRequest,
  gateway: LLMGateway = getLLMGateway(),
): Promise<RegeneratedItem> {
  const [track, draft, secrets, allPages] = await Promise.all([
    loadTrack(trackId),
    loadVersion(trackId, DRAFT_VERSION_ID),
    loadSecrets(trackId, DRAFT_VERSION_ID),
    loadSourcePages(trackId),
  ]);
  if (!track) throw new RegenerateItemError(404, 'NOT_FOUND', 'This Track does not exist.');
  if (isGenerationRunning(track)) {
    throw new RegenerateItemError(409, 'GENERATION_RUNNING', 'A build is running for this Track. Wait for it to finish.');
  }
  if (!draft) throw new RegenerateItemError(409, 'NO_DRAFT', 'This Track has no draft yet. Build the Track first.');
  if (allPages.length === 0) {
    throw new RegenerateItemError(409, 'NO_SOURCE_PAGES', 'This Track has no Playbook pages. Upload the Playbook PDF again.');
  }
  const sourceReview = draft.sourceBundleId ? await loadSourceReview(trackId, draft.sourceBundleId) : undefined;
  if (sourceReview && draft.sourceRevision !== sourceReview.bundle.revisionHash) {
    throw new RegenerateItemError(409, 'SOURCE_REVISION_STALE', 'The source bundle changed. Start a new draft from the approved source revision before regenerating an item.');
  }
  const pillarIds = draft.competencyPillars.map((pillar) => pillar.id);
  const evidenceSource: EvidenceSource | undefined = sourceReview ? { pages: sourceReview.pages, conflicts: sourceReview.conflicts } : undefined;
  const sourceLabels = sourceReview ? sourcePageLabels(sourceReview.pages) : null;

  if (request.targetType === 'SCENARIO') {
    const index = draft.simScenarios.findIndex((scenario) => scenario.id === request.itemId);
    if (index === -1) throw new RegenerateItemError(404, 'NOT_FOUND', 'This Simulation scenario does not exist in the draft.');
    const current = draft.simScenarios[index];
    const currentSecret = secrets?.scenarios.find((config) => config.scenarioId === current.id);
    const preferred = [
      ...new Set([
        ...(currentSecret?.rubricCriteria.flatMap((criterion) => criterion.sourcePages) ?? []),
        ...draft.units.flatMap((unit) => unitCitedPages(unit)),
      ]),
    ];
    const ctx = {
      pillarIds,
      allowedPages: sourceLabels ?? allPages.map((page) => page.pageNumber),
      requireEvidence: Boolean(sourceReview),
      scenarioDefaults: {
        divisionId: track.divisionId,
        product: track.campaignCode || track.title,
        ...(draft.sourceRevision ? { sourceRevision: draft.sourceRevision } : {}),
      },
    };
    const generated = await gateway.generateStructured({
      tier: 'heavy',
      systemPrompt: buildSimSystemPrompt(track.divisionId),
      userPrompt: buildRegenerateScenarioUserPrompt({
        trackTitle: track.title,
        campaignCode: track.campaignCode,
        divisionId: track.divisionId,
        globalSummary: trackContextSummary(track, draft),
        pillars: draft.competencyPillars,
        unitTitles: draft.units.map((unit) => unit.title),
        pages: allPages,
        sourceReview,
        preferredPageOrder: preferred,
        current,
        otherScenarioTitles: draft.simScenarios.filter((scenario) => scenario.id !== current.id).map((scenario) => scenario.title),
        trainerHint: request.trainerHint,
      }),
      schema: buildSingleScenarioSchema(ctx),
      schemaName: SINGLE_SIM_SCHEMA_NAME,
      maxOutputTokens: SIM_SINGLE_SCENARIO_MAX_OUTPUT_TOKENS,
    });
    const finalized = finalizeScenario(generated, current.id, ctx, track.divisionId);
    const pair = evidenceSource
      ? {
          ...finalized,
          secretConfig: {
            ...finalized.secretConfig,
            rubricCriteria: finalized.secretConfig.rubricCriteria.map((criterion) => ({
              ...criterion,
              ...(criterion.evidence ? { evidence: regroundStoredEvidence(criterion.evidence, criterion.id, evidenceSource, ctx.allowedPages) } : {}),
            })),
          },
        }
      : finalized;
    if (sourceReview) {
      for (const criterion of pair.secretConfig.rubricCriteria) {
        assertGeneratedClaimEvidence(criterion.id, criterion.evidence, sourceReview);
      }
    }
    await adminDb.runTransaction(async (tx) => {
      const [latest, latestSecrets] = await Promise.all([
        loadVersion(trackId, DRAFT_VERSION_ID, tx),
        loadSecrets(trackId, DRAFT_VERSION_ID, tx),
      ]);
      if (!latest || (latest.sourceRevision ?? null) !== (draft.sourceRevision ?? null)) {
        throw new RegenerateItemError(409, 'SOURCE_REVISION_STALE', 'The draft changed while the scenario was regenerating. Reload the Studio.');
      }
      if (!latest.simScenarios.some((scenario) => scenario.id === current.id)) throw itemGone('Simulation scenario');
      const simScenarios = latest.simScenarios.map((scenario) => (scenario.id === current.id ? pair.publicScenario : scenario));
      const otherSecrets = (latestSecrets?.scenarios ?? []).filter((config) => config.scenarioId !== current.id);
      const secretOrder = new Map(simScenarios.map((scenario, i) => [scenario.id, i]));
      const scenarios = [...otherSecrets, pair.secretConfig].sort(
        (a, b) => (secretOrder.get(a.scenarioId) ?? 99) - (secretOrder.get(b.scenarioId) ?? 99),
      );
      const now = Date.now();
      tx.set(draftRef(trackId), TrackVersionDocSchema.parse({ ...latest, simScenarios }));
      tx.set(secretsRef(trackId, DRAFT_VERSION_ID), EvalRubricsDocSchema.parse({ trackId, versionId: DRAFT_VERSION_ID, scenarios, updatedAt: now }));
      tx.update(trackRef(trackId), { updatedAt: now });
    });
    return pair.publicScenario;
  }

  if (!request.unitId) throw new RegenerateItemError(400, 'VALIDATION_FAILED', 'Select the Unit that holds this item.');
  const unitIndex = draft.units.findIndex((unit) => unit.id === request.unitId);
  if (unitIndex === -1) throw new RegenerateItemError(404, 'NOT_FOUND', 'This Unit does not exist in the draft.');
  const unit = draft.units[unitIndex];
  const input = unitContext(track, draft, unit, allPages, sourceReview);
  // Approved-source drafts cite PAGE labels of the whole bundle (as in the full build).
  const allowedPages = sourceLabels ?? input.pages.map((page) => page.pageNumber);
  const requireEvidence = Boolean(sourceReview);
  let item: BriefingCard | DrillItem;

  if (request.targetType === 'CARD') {
    const cardIndex = unit.briefingCards.findIndex((card) => card.id === request.itemId);
    if (cardIndex === -1) throw new RegenerateItemError(404, 'NOT_FOUND', 'This BriefingCard does not exist in the Unit.');
    const current = unit.briefingCards[cardIndex];
    const generated = await gateway.generateStructured({
      tier: 'heavy',
      systemPrompt: buildUnitSystemPrompt(track.divisionId),
      userPrompt: buildRegenerateCardUserPrompt({
        ...input,
        current,
        siblingHeadlines: unit.briefingCards.filter((card) => card.id !== current.id).map((card) => card.headline),
        trainerHint: request.trainerHint,
      }),
      schema: buildCardGenerationSchema({ allowedPages, requireEvidence, evidenceSource }),
      schemaName: BRIEFING_CARD_SCHEMA_NAME,
      maxOutputTokens: cardsMaxOutputTokens(1),
    });
    const card = finalizeBriefingCard(generated, current.id, allowedPages, evidenceSource);
    if (sourceReview) assertGeneratedClaimEvidence(card.id, card.evidence, sourceReview);
    item = card;
    await commitItem(trackId, draft.sourceRevision, (latest) => ({
      ...requireUnit(latest, unit.id),
      units: latest.units.map((existing) => {
        if (existing.id !== unit.id) return existing;
        if (!existing.briefingCards.some((other) => other.id === card.id)) throw itemGone('BriefingCard');
        return { ...existing, briefingCards: existing.briefingCards.map((other) => (other.id === card.id ? card : other)) };
      }),
    }));
  } else {
    const drillIndex = unit.drills.findIndex((drill) => drill.id === request.itemId);
    if (drillIndex === -1) throw new RegenerateItemError(404, 'NOT_FOUND', 'This Drill does not exist in the Unit.');
    const current = unit.drills[drillIndex];
    const siblings = unit.drills.filter((drill) => drill.id !== current.id);
    // The new Drill must differ from the one it replaces and must not repeat another Drill of the Track.
    const ctx: UnitBuildContext = {
      pillarIds,
      allowedPages,
      requireEvidence,
      evidenceSource,
      replacing: current,
      avoidDrills: draft.units.flatMap((other) => other.drills).filter((drill) => drill.id !== current.id),
    };
    const generated = await gateway.generateStructured({
      tier: 'heavy',
      systemPrompt: buildUnitSystemPrompt(track.divisionId),
      userPrompt: buildRegenerateDrillUserPrompt({
        ...input,
        current,
        siblingPrompts: siblings.map((drill) => drill.prompt),
        trainerHint: request.trainerHint,
      }),
      schema: buildDrillGenerationSchema(current.kind, ctx),
      schemaName: DRILL_SCHEMA_NAME,
      maxOutputTokens: drillsMaxOutputTokens(1),
    });
    const drill = finalizeDrill(generated, current.id, ctx);
    if (sourceReview) assertGeneratedClaimEvidence(drill.id, drill.evidence, sourceReview);
    item = drill;
    await commitItem(trackId, draft.sourceRevision, (latest) => ({
      ...requireUnit(latest, unit.id),
      units: latest.units.map((existing) => {
        if (existing.id !== unit.id) return existing;
        if (!existing.drills.some((other) => other.id === drill.id)) throw itemGone('Drill');
        return { ...existing, drills: existing.drills.map((other) => (other.id === drill.id ? drill : other)) };
      }),
    }));
  }
  return item;
}
