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
import { getLLMGateway } from '@/lib/ai/gateway';
import type { LLMGateway } from '@/lib/ai/types';
import { selectPages, type ExtractedPage } from '@/lib/ai/pdf-extractor';
import type { UnitOutline } from '@/lib/ai/prompts/blueprint';
import {
  BRIEFING_CARD_SCHEMA_NAME,
  DRILL_SCHEMA_NAME,
  buildCardGenerationSchema,
  buildDrillGenerationSchema,
  buildRegenerateCardUserPrompt,
  buildRegenerateDrillUserPrompt,
  buildUnitSystemPrompt,
  finalizeBriefingCard,
  finalizeDrill,
  type UnitPromptInput,
} from '@/lib/ai/prompts/unit-builder';
import {
  SINGLE_SIM_SCHEMA_NAME,
  buildRegenerateScenarioUserPrompt,
  buildSimSystemPrompt,
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

function unitContext(track: TrackDoc, draft: TrackVersionDoc, unit: TrackUnit, allPages: ExtractedPage[]): UnitPromptInput {
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
    otherUnitTitles: draft.units.filter((other) => other.id !== unit.id).map((other) => other.title),
  };
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
  const pillarIds = draft.competencyPillars.map((pillar) => pillar.id);
  const now = Date.now();

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
    const ctx = { pillarIds, allowedPages: allPages.map((page) => page.pageNumber) };
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
        preferredPageOrder: preferred,
        current,
        otherScenarioTitles: draft.simScenarios.filter((scenario) => scenario.id !== current.id).map((scenario) => scenario.title),
        trainerHint: request.trainerHint,
      }),
      schema: buildSingleScenarioSchema(ctx),
      schemaName: SINGLE_SIM_SCHEMA_NAME,
    });
    const pair = finalizeScenario(generated, current.id, ctx);
    const simScenarios = draft.simScenarios.map((scenario, i) => (i === index ? pair.publicScenario : scenario));
    const otherSecrets = (secrets?.scenarios ?? []).filter((config) => config.scenarioId !== current.id);
    const secretOrder = new Map(simScenarios.map((scenario, i) => [scenario.id, i]));
    const scenarios = [...otherSecrets, pair.secretConfig].sort(
      (a, b) => (secretOrder.get(a.scenarioId) ?? 99) - (secretOrder.get(b.scenarioId) ?? 99),
    );
    const nextDraft = TrackVersionDocSchema.parse({ ...draft, simScenarios });
    const nextSecrets = EvalRubricsDocSchema.parse({ trackId, versionId: DRAFT_VERSION_ID, scenarios, updatedAt: now });
    const batch = adminDb.batch();
    batch.set(draftRef(trackId), nextDraft);
    batch.set(secretsRef(trackId, DRAFT_VERSION_ID), nextSecrets);
    batch.update(trackRef(trackId), { updatedAt: now });
    await batch.commit();
    return pair.publicScenario;
  }

  if (!request.unitId) throw new RegenerateItemError(400, 'VALIDATION_FAILED', 'Select the Unit that holds this item.');
  const unitIndex = draft.units.findIndex((unit) => unit.id === request.unitId);
  if (unitIndex === -1) throw new RegenerateItemError(404, 'NOT_FOUND', 'This Unit does not exist in the draft.');
  const unit = draft.units[unitIndex];
  const input = unitContext(track, draft, unit, allPages);
  const allowedPages = input.pages.map((page) => page.pageNumber);
  let item: BriefingCard | DrillItem;
  let nextUnit: TrackUnit;

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
      schema: buildCardGenerationSchema({ allowedPages }),
      schemaName: BRIEFING_CARD_SCHEMA_NAME,
    });
    const card = finalizeBriefingCard(generated, current.id, allowedPages);
    item = card;
    nextUnit = { ...unit, briefingCards: unit.briefingCards.map((existing, i) => (i === cardIndex ? card : existing)) };
  } else {
    const drillIndex = unit.drills.findIndex((drill) => drill.id === request.itemId);
    if (drillIndex === -1) throw new RegenerateItemError(404, 'NOT_FOUND', 'This Drill does not exist in the Unit.');
    const current = unit.drills[drillIndex];
    const ctx = { pillarIds, allowedPages };
    const generated = await gateway.generateStructured({
      tier: 'heavy',
      systemPrompt: buildUnitSystemPrompt(track.divisionId),
      userPrompt: buildRegenerateDrillUserPrompt({
        ...input,
        current,
        siblingPrompts: unit.drills.filter((drill) => drill.id !== current.id).map((drill) => drill.prompt),
        trainerHint: request.trainerHint,
      }),
      schema: buildDrillGenerationSchema(current.kind, ctx),
      schemaName: DRILL_SCHEMA_NAME,
    });
    const drill = finalizeDrill(generated, current.id, ctx);
    item = drill;
    nextUnit = { ...unit, drills: unit.drills.map((existing, i) => (i === drillIndex ? drill : existing)) };
  }

  const nextDraft = TrackVersionDocSchema.parse({
    ...draft,
    units: draft.units.map((existing, i) => (i === unitIndex ? nextUnit : existing)),
  });
  const batch = adminDb.batch();
  batch.set(draftRef(trackId), nextDraft);
  batch.update(trackRef(trackId), { updatedAt: now });
  await batch.commit();
  return item;
}
