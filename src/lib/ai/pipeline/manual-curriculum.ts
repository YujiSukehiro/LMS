/**
 * Trainer-authorized manual chat exchange for one Unit Builder stage.
 * The exported package is reconstructed from trusted persisted data on import; no package or
 * instructions supplied by the external chat are trusted. Server only.
 */
import type { Transaction } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import {
  DRAFT_VERSION_ID,
  SourcePageBatchDocSchema,
  TrackVersionDocSchema,
  type TrackDoc,
  type TrackUnit,
  type TrackVersionDoc,
} from '@/lib/schemas/curriculum';
import {
  checksumManualExchangePackage,
  exportManualExchangePackage,
  importManualExchange,
  type ApprovedSourceExcerpt,
  type ManualExchangePackage,
  type ManualValidationReport,
} from '@/lib/ai/manual-exchange';
import type { ProvenanceRecord } from '@/lib/ai/provenance';
import { selectPages, type ExtractedPage } from '@/lib/ai/pdf-extractor';
import type { UnitOutline } from '@/lib/ai/prompts/blueprint';
import {
  UNIT_SCHEMA_NAME,
  buildUnitGenerationSchema,
  buildUnitSystemPrompt,
  buildUnitUserPrompt,
  finalizeUnit,
  type UnitBuildContext,
  type UnitGeneration,
} from '@/lib/ai/prompts/unit-builder';
import {
  draftRef,
  isGenerationRunning,
  loadTrack,
  loadVersion,
  sourcePagesCollection,
  unitCitedPages,
} from '@/lib/ai/pipeline/track-store';

export const MANUAL_CURRICULUM_SCHEMA_VERSION = 'unit-builder-v1' as const;
export const MANUAL_CURRICULUM_PROMPT_VERSION = 'unit-builder-manual-v1' as const;

export class ManualCurriculumError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ManualCurriculumError';
  }
}

interface ManualUnitContext {
  track: TrackDoc;
  draft: TrackVersionDoc;
  unit: TrackUnit;
  unitIndex: number;
  outline: UnitOutline;
  buildContext: UnitBuildContext;
  schema: ReturnType<typeof buildUnitGenerationSchema>;
  manualPackage: ManualExchangePackage;
}

export interface ManualCurriculumExportResult {
  unitId: string;
  package: ManualExchangePackage;
}

export interface ManualCurriculumImportOptions {
  trackId: string;
  unitId: string;
  input: string | { text(): Promise<string> };
  externalProvider: string;
  externalModel: string;
  trainerUid: string;
  importedAt?: string;
}

export interface ManualCurriculumCommitResult {
  unit: TrackUnit;
  provenancePath: string;
}

function manualTaskId(trackId: string, unitId: string): string {
  return `curriculum-unit:${trackId}:${unitId}`;
}

/** The original Pass 1 summary is not persisted, so use only current persisted Track/Unit context. */
function trackContextSummary(track: TrackDoc, draft: TrackVersionDoc): string {
  const unitLines = draft.units.map((unit, index) => `${index + 1}. ${unit.title}: ${unit.summary}`).join('\n');
  const keyTakeaways = draft.units
    .flatMap((unit) => unit.briefingCards.map((card) => `- ${card.keyTakeaway}`))
    .slice(0, 24)
    .join('\n');
  return [`Track "${track.title}" has these Units:`, unitLines, 'Key takeaways already taught:', keyTakeaways].join('\n');
}

async function loadSourcePages(trackId: string, tx?: Transaction): Promise<ExtractedPage[]> {
  const snap = tx ? await tx.get(sourcePagesCollection(trackId)) : await sourcePagesCollection(trackId).get();
  const pages: ExtractedPage[] = [];
  for (const doc of snap.docs) {
    const parsed = SourcePageBatchDocSchema.safeParse(doc.data());
    if (!parsed.success) continue;
    for (const page of parsed.data.pages) pages.push({ pageNumber: page.pageNumber, text: page.text });
  }
  return pages.sort((a, b) => a.pageNumber - b.pageNumber);
}

function approvedExcerpts(trackId: string, pages: ExtractedPage[]): ApprovedSourceExcerpt[] {
  return pages.map((page) => ({
    id: `source-page-${page.pageNumber}`,
    sourceId: `track-${trackId}-playbook`,
    revision: checksumManualExchangePackage({ trackId, pageNumber: page.pageNumber, text: page.text }),
    page: page.pageNumber,
    text: page.text,
    // The trainer-authorized export approves these exact persisted excerpts for this task only.
    approved: true,
  }));
}

async function loadManualUnitContext(trackId: string, unitId: string, tx?: Transaction): Promise<ManualUnitContext> {
  const track = await loadTrack(trackId, tx);
  if (!track) throw new ManualCurriculumError(404, 'NOT_FOUND', 'This Track does not exist.');
  if (isGenerationRunning(track)) {
    throw new ManualCurriculumError(409, 'GENERATION_RUNNING', 'A build is running for this Track. Wait for it to finish.');
  }
  const draft = await loadVersion(trackId, DRAFT_VERSION_ID, tx);
  if (!draft) throw new ManualCurriculumError(409, 'NO_DRAFT', 'This Track has no draft yet. Build the Track first.');
  const unitIndex = draft.units.findIndex((unit) => unit.id === unitId);
  if (unitIndex < 0) throw new ManualCurriculumError(404, 'NOT_FOUND', 'This Unit does not exist in the draft.');
  const unit = draft.units[unitIndex];

  const citedPages = unitCitedPages(unit);
  if (citedPages.length === 0) {
    throw new ManualCurriculumError(409, 'NO_UNIT_EVIDENCE', 'This Unit has no source-page evidence. Add grounded source citations before manual export.');
  }
  const allPages = await loadSourcePages(trackId, tx);
  const pages = selectPages(allPages, citedPages);
  const availablePages = new Set(pages.map((page) => page.pageNumber));
  const missingPages = citedPages.filter((page) => !availablePages.has(page));
  if (missingPages.length > 0) {
    throw new ManualCurriculumError(
      409,
      'SOURCE_EVIDENCE_MISSING',
      `Source-page evidence is missing for page${missingPages.length === 1 ? '' : 's'} ${missingPages.join(', ')}. Restore the Playbook extraction before manual export.`,
    );
  }

  const draftPillarIds = new Set(draft.competencyPillars.map((pillar) => pillar.id));
  const pillarIds = [...new Set(unit.drills.map((drill) => drill.competencyPillarId))];
  if (pillarIds.length === 0 || pillarIds.some((id) => !draftPillarIds.has(id))) {
    throw new ManualCurriculumError(
      409,
      'INVALID_UNIT_CONTEXT',
      'The Unit references an unknown CompetencyPillar. Repair the draft before manual export.',
    );
  }

  // Pass 1 outlines are not persisted. Reconstruct only facts present in the selected Unit.
  const outline: UnitOutline = {
    id: unit.id,
    orderIndex: unit.orderIndex,
    title: unit.title,
    summary: unit.summary,
    focus: unit.briefingCards.map((card) => card.headline).join('; ') || unit.summary,
    sourcePages: pages.map((page) => page.pageNumber),
    pillarIds,
  };
  const buildContext: UnitBuildContext = { pillarIds, allowedPages: outline.sourcePages };
  const schema = buildUnitGenerationSchema(buildContext);
  const userPrompt = buildUnitUserPrompt({
    trackTitle: track.title,
    campaignCode: track.campaignCode,
    divisionId: track.divisionId,
    globalSummary: trackContextSummary(track, draft),
    pillars: draft.competencyPillars,
    outline,
    pages,
    otherUnitTitles: draft.units.filter((other) => other.id !== unit.id).map((other) => other.title),
  });
  const instructions = [
    buildUnitSystemPrompt(track.divisionId),
    '',
    userPrompt,
    '',
    'CURRENT UNIT DRAFT (context only; return a complete replacement using the output schema):',
    JSON.stringify(unit),
    '',
    `Replace only Unit "${unit.id}". Do not return or modify any other Unit or Simulation.`,
  ].join('\n');
  const manualPackage = exportManualExchangePackage({
    actorRole: 'trainer',
    taskId: manualTaskId(trackId, unitId),
    taskType: 'curriculum_generation',
    instructions,
    outputSchemaName: UNIT_SCHEMA_NAME,
    outputSchemaVersion: MANUAL_CURRICULUM_SCHEMA_VERSION,
    schema,
    approvedSourceExcerpts: approvedExcerpts(trackId, pages),
    validationRules: [
      'Return one JSON object matching the exact TrackUnitContent schema; no markdown or imported instructions.',
      `Every BriefingCard and Drill must cite at least one exported source page: ${outline.sourcePages.join(', ')}.`,
      'Use only facts supported by the exported source-page text and preserve exact operational values.',
      'Use synthetic examples only; do not include credentials, identity documents, health answers, or payment-card data.',
      `The imported result replaces only draft Unit "${unit.id}" after trainer authorization.`,
    ],
    prompt: {
      templateId: 'unit-builder',
      templateVersion: MANUAL_CURRICULUM_PROMPT_VERSION,
      inputHash: checksumManualExchangePackage({ trackId, unitId, unit, pages }),
    },
  });

  return { track, draft, unit, unitIndex, outline, buildContext, schema, manualPackage };
}

/** Convert the persisted Unit to the exact Unit Builder output shape for a useful before/after diff. */
function unitToGeneration(unit: TrackUnit): UnitGeneration {
  return {
    briefingCards: unit.briefingCards.map((card) => ({
      headline: card.headline,
      bodyMarkdown: card.bodyMarkdown,
      keyTakeaway: card.keyTakeaway,
      doList: card.doList,
      dontList: card.dontList,
      sourcePages: card.sourcePages,
    })),
    drills: unit.drills.map((drill) => {
      const base = {
        competencyPillarId: drill.competencyPillarId,
        prompt: drill.prompt,
        explanation: drill.explanation,
        sourcePages: drill.sourcePages,
      };
      switch (drill.kind) {
        case 'MULTIPLE_CHOICE':
          return {
            ...base,
            kind: drill.kind,
            options: drill.options.map((option) => ({ ...option })),
            correctOptionId: drill.correctOptionId,
          };
        case 'TRUE_FALSE_SPOT':
          return { ...base, kind: drill.kind, statement: drill.statement, isCompliant: drill.isCompliant };
        case 'SEQUENCE_ORDER':
          return { ...base, kind: drill.kind, orderedSteps: drill.orderedSteps.map(({ text }) => ({ text })) };
        case 'MATCH_PAIRS':
          return {
            ...base,
            kind: drill.kind,
            pairs: drill.pairs.map(({ leftPrompt, rightMatch }) => ({ leftPrompt, rightMatch })),
          };
        case 'FILL_BLANK_CHOICE':
          return {
            ...base,
            kind: drill.kind,
            sentenceTemplate: drill.sentenceTemplate,
            wordBank: drill.wordBank,
            correctWord: drill.correctWord,
          };
      }
    }),
  };
}

function validateSourcePageEvidence(output: UnitGeneration, manualPackage: ManualExchangePackage): { valid: boolean; issues: string[] } {
  const exportedPages = new Set(
    manualPackage.approvedSourceExcerpts.map((excerpt) => excerpt.page).filter((page): page is number => typeof page === 'number'),
  );
  const issues: string[] = [];
  const check = (pages: number[], path: string): void => {
    if (pages.length === 0) issues.push(`${path} must cite at least one exported source page.`);
    const outside = pages.filter((page) => !exportedPages.has(page));
    if (outside.length > 0) issues.push(`${path} cites unexported source page(s): ${[...new Set(outside)].join(', ')}.`);
  };
  output.briefingCards.forEach((card, index) => check(card.sourcePages, `briefingCards[${index}].sourcePages`));
  output.drills.forEach((drill, index) => check(drill.sourcePages, `drills[${index}].sourcePages`));
  return { valid: issues.length === 0, issues };
}

export async function exportManualCurriculumUnit(trackId: string, unitId: string): Promise<ManualCurriculumExportResult> {
  const context = await loadManualUnitContext(trackId, unitId);
  return { unitId, package: context.manualPackage };
}

function provenanceRef(trackId: string, unitId: string) {
  const docId = checksumManualExchangePackage({ trackId, unitId }).slice('sha256:'.length);
  return draftRef(trackId).collection('manualCurriculumImports').doc(docId);
}

/**
 * Validate the complete import before opening a transaction. The transaction reconstructs the
 * package again to reject stale source/draft context, then atomically updates one Unit and writes
 * its manual_chat provenance. Existing TrackVersion provenance is deliberately left unchanged.
 */
export async function importManualCurriculumUnit(options: ManualCurriculumImportOptions) {
  const initial = await loadManualUnitContext(options.trackId, options.unitId);
  return importManualExchange({
    actorRole: 'trainer',
    package: initial.manualPackage,
    input: options.input,
    schema: initial.schema,
    outputSchemaVersion: MANUAL_CURRICULUM_SCHEMA_VERSION,
    expectedTaskId: manualTaskId(options.trackId, options.unitId),
    expectedTaskType: 'curriculum_generation',
    externalProvider: options.externalProvider,
    externalModel: options.externalModel,
    importedAt: options.importedAt,
    diffAgainst: unitToGeneration(initial.unit),
    validateEvidence: (output, { package: manualPackage }) => validateSourcePageEvidence(output, manualPackage),
    commit: async ({ package: trustedPackage, output, provenance, diff, validationReport }) =>
      adminDb.runTransaction(async (tx): Promise<ManualCurriculumCommitResult> => {
        const current = await loadManualUnitContext(options.trackId, options.unitId, tx);
        if (
          current.manualPackage.checksum !== trustedPackage.checksum ||
          current.manualPackage.taskId !== trustedPackage.taskId ||
          current.manualPackage.outputSchemaVersion !== trustedPackage.outputSchemaVersion
        ) {
          throw new ManualCurriculumError(
            409,
            'STALE_MANUAL_PACKAGE',
            'The Unit or its source evidence changed after export. Export a new manual package and run the external chat again.',
          );
        }

        const nextUnit = finalizeUnit(current.outline, output, current.buildContext);
        const units = current.draft.units.map((unit, index) => (index === current.unitIndex ? nextUnit : unit));
        // Parse before the first write; all unrelated Units, Simulations, and existing provenance remain intact.
        TrackVersionDocSchema.parse({ ...current.draft, units });
        const record: {
          taskId: string;
          taskType: 'curriculum_generation';
          trackId: string;
          unitId: string;
          packageChecksum: string;
          outputHash: string;
          trainerUid: string;
          importedAt: string | null;
          provenance: ProvenanceRecord;
          diff: unknown[];
          validationReport: ManualValidationReport;
        } = {
          taskId: trustedPackage.taskId,
          taskType: 'curriculum_generation',
          trackId: options.trackId,
          unitId: options.unitId,
          packageChecksum: trustedPackage.checksum,
          outputHash: checksumManualExchangePackage(output),
          trainerUid: options.trainerUid,
          importedAt: provenance.recordedAt,
          provenance,
          diff,
          validationReport,
        };
        const ref = provenanceRef(options.trackId, options.unitId);
        tx.update(draftRef(options.trackId), { units });
        tx.set(ref, record);
        return { unit: nextUnit, provenancePath: ref.path };
      }),
  });
}
