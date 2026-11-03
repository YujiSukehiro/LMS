import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { finalizeUnit, type UnitGeneration } from '@/lib/ai/prompts/unit-builder';
import { finalizeScenario, type ScenarioGeneration } from '@/lib/ai/prompts/sim-builder';
import { assertGeneratedClaimEvidence, runTrackGeneration } from '@/lib/ai/pipeline/generate-track';
import type { LLMGateway } from '@/lib/ai/types';
import type { TrackDoc, TrackVersionDoc } from '@/lib/schemas/curriculum';
import {
  ClaimEvidenceSchema,
  SharedRulePackSchema,
  SourceBundleSchema,
  SourcePageEvidenceSchema,
  type ClaimEvidence,
  type SourcePageEvidence,
} from '@/lib/schemas/source-truth';

const mocks = vi.hoisted(() => ({
  draftWrites: [] as TrackVersionDoc[],
  workingDraftWrites: [] as TrackVersionDoc[],
  secretWrites: [] as unknown[],
  batchCommits: 0,
  checkpoints: new Map<string, unknown>(),
  budgetWrites: [] as Array<Record<string, unknown>>,
  calls: { blueprint: 0, units: 0, simulations: 0 },
  model: 'fixture-model',
  generationProfile: {
    baseUrl: 'http://127.0.0.1:11434',
    structuredGeneration: { temperature: 0.2, maxRepairRetries: 2, numCtx: 16384, keepAlive: '15m' },
  },
  loadSourceReview: vi.fn(),
}));

vi.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (name: string) => {
      if (name !== 'generationCheckpoints' && name !== 'generationWorkingDrafts') {
        throw new Error(`Unexpected collection ${name}`);
      }
      return {
        doc: (id: string) => ({
          get: async () => ({
            exists: mocks.checkpoints.has(id),
            data: () => structuredClone(mocks.checkpoints.get(id)),
          }),
          set: async (value: unknown) => {
            if (name === 'generationCheckpoints') mocks.checkpoints.set(id, structuredClone(value));
            else mocks.workingDraftWrites.push(structuredClone((value as { draft: TrackVersionDoc }).draft));
          },
          delete: async () => undefined,
        }),
      };
    },
    batch: () => ({
      set: (ref: { kind: string }, value: unknown) => {
        if (ref.kind === 'draft') mocks.draftWrites.push(structuredClone(value) as TrackVersionDoc);
        else mocks.secretWrites.push(structuredClone(value));
      },
      update: () => undefined,
      commit: async () => { mocks.batchCommits += 1; },
    }),
  },
}));

vi.mock('@/lib/ai/pipeline/track-store', () => ({
  GENERATION_HEARTBEAT_MS: 60_000,
  draftRef: () => ({ kind: 'draft', set: async (value: TrackVersionDoc) => { mocks.draftWrites.push(structuredClone(value)); } }),
  secretsRef: () => ({ kind: 'secrets' }),
  trackRef: () => ({
    update: async (value: { generationBudgets?: Record<string, unknown> }) => {
      if (value.generationBudgets) mocks.budgetWrites.push(structuredClone(value.generationBudgets));
    },
  }),
  estimateTrackMinutes: () => 10,
  loadSourcePages: async () => [{ pageNumber: 1, text: sourceText }],
  loadTrack: async () => track,
  nextDraftVersionNumber: () => 1,
}));

vi.mock('@/lib/ai/gateway', () => ({
  getActiveAiRuntime: () => ({
    provider: 'replay', heavyModel: mocks.model, runtimeLabel: 'fixture', generationProfile: mocks.generationProfile,
  }),
  getLLMGateway: () => { throw new Error('A test gateway must be supplied.'); },
}));

vi.mock('@/lib/services/source-store', () => ({ loadSourceReview: mocks.loadSourceReview }));

const HASH = `sha256:${'b'.repeat(64)}`;
const sourceText = 'Compliance: Identify yourself as an AI agent and honor opt-out requests immediately.';

function sourcePage(overrides: Partial<SourcePageEvidence> = {}): SourcePageEvidence {
  return SourcePageEvidenceSchema.parse({
    id: 'ED-page-1',
    documentId: 'ED',
    revisionId: 'ED-rev1',
    pageNumber: 1,
    rawText: sourceText,
    normalizedText: sourceText,
    contentHash: HASH,
    characterCount: sourceText.length,
    extractionFlags: [],
    transcription: null,
    approvedExcerpts: [],
    ...overrides,
  });
}

function evidence(overrides: Partial<ClaimEvidence> = {}): ClaimEvidence {
  return ClaimEvidenceSchema.parse({
    id: 'model-proposal',
    claim: 'Identify as an AI agent and honor opt-out requests.',
    ruleIds: ['shared-identity'],
    support: 'supported',
    approvalStatus: 'approved',
    reviewerUid: 'untrusted-model',
    reviewedAt: 123,
    critical: true,
    requiresInterfaceDetails: false,
    excerpts: [{
      documentId: 'ED', revisionId: 'ED-rev1', pageNumber: 1, exactText: sourceText, fromApprovedTranscription: false,
    }],
    ...overrides,
  });
}

function unitGeneration(mutate?: (generated: UnitGeneration) => void): UnitGeneration {
  const card = (index: number) => ({
    headline: `Compliance rule ${index}`,
    bodyMarkdown: 'Identify yourself as an AI agent and honor opt-out requests immediately.',
    keyTakeaway: 'Identity and opt out are mandatory.',
    doList: ['Identify yourself.', 'Honor opt out.'],
    dontList: ['Do not conceal AI status.', 'Do not keep calling after opt out.'],
    sourcePages: [1],
    evidence: [evidence()],
  });
  const base = {
    competencyPillarId: 'pillar_compliance_boundaries',
    prompt: 'Which action follows the compliance rule?',
    explanation: 'The source requires AI identification and immediate opt-out handling.',
    sourcePages: [1],
    evidence: [evidence()],
  };
  const generated: UnitGeneration = {
    briefingCards: [card(1), card(2), card(3)],
    drills: [
      {
        ...base, kind: 'MULTIPLE_CHOICE',
        options: [
          { id: 'a', text: 'Identify as AI and honor opt out.' },
          { id: 'b', text: 'Hide AI status.' },
          { id: 'c', text: 'Ignore opt out.' },
          { id: 'd', text: 'Invent a compliance rule.' },
        ],
        correctOptionId: 'a',
      },
      { ...base, kind: 'TRUE_FALSE_SPOT', statement: 'The agent identifies as AI and honors opt out.', isCompliant: true },
      { ...base, kind: 'SEQUENCE_ORDER', orderedSteps: [{ text: 'Identify as AI.' }, { text: 'Listen for opt out.' }, { text: 'Suppress the lead.' }] },
      {
        ...base, kind: 'MATCH_PAIRS',
        pairs: [
          { leftPrompt: 'Opening', rightMatch: 'Identify as AI' },
          { leftPrompt: 'Opt out', rightMatch: 'Stop contact' },
          { leftPrompt: 'Suppression', rightMatch: 'Make it permanent' },
        ],
      },
      {
        ...base, kind: 'FILL_BLANK_CHOICE', sentenceTemplate: 'Always honor {{BLANK}} immediately.',
        wordBank: ['opt out', 'discounts', 'diagnosis', 'urgency'], correctWord: 'opt out',
      },
    ],
  };
  mutate?.(generated);
  return generated;
}

const outline = {
  id: 'u1', orderIndex: 0, title: 'Compliance', summary: 'Follow mandatory identity and opt-out rules.',
  focus: 'Identity and opt out.', sourcePages: [1], pillarIds: ['pillar_compliance_boundaries'],
};
const pillars = [
  { id: 'pillar_compliance_boundaries', key: 'compliance_boundaries', label: 'Compliance', description: 'Follow mandatory compliance rules.' },
  { id: 'pillar_verification_crm', key: 'verification_crm', label: 'Verification', description: 'Verify the synthetic lead.' },
  { id: 'pillar_retention_objection', key: 'retention_objection', label: 'Retention', description: 'Handle objections within policy.' },
  { id: 'pillar_closing_next_steps', key: 'closing_next_steps', label: 'Closing', description: 'Close with correct next steps.' },
];

function scenarioGeneration(id: number): ScenarioGeneration {
  const criterion = (index: number, weight: number) => ({
    competencyPillarId: 'pillar_compliance_boundaries',
    criterionLabel: `Compliance criterion ${index}`,
    evaluationRule: 'The agent must identify as AI and honor opt-out requests immediately.',
    weight,
    sourcePages: [1],
    evidence: [evidence()],
  });
  return {
    publicScenario: {
      title: `Synthetic compliance call ${id}`, difficulty: 'STANDARD', counterpartyRoleLabel: 'Outbound Lead',
      contextTicketSummary: 'Synthetic ED recovery call.', openingMessage: 'I want to discuss my account.',
      dispositionOptions: ['Recovered', 'Not interested', 'Callback scheduled'], maxTurns: 8, passScoreThreshold: 80,
    },
    secretConfig: {
      personaName: `Synthetic Caller ${id}`, personaBackstoryAndMood: 'A synthetic lead with a calm mood.',
      hiddenFactsToRevealOnlyWhenAsked: ['The synthetic lead prefers no further calls.'],
      conditionalBehaviors: ['The synthetic lead ends the call after opt out.'], expectedDisposition: 'Not interested',
      autoFailTriggers: ['The agent ignores an opt-out request.'],
      rubricCriteria: [criterion(1, 50), criterion(2, 30), criterion(3, 20)],
    },
  };
}

const track: TrackDoc = {
  id: 'ED', title: 'ED Track', campaignCode: 'ED', divisionId: 'OUTBOUND', status: 'GENERATING',
  generationProgress: { step: 'BLUEPRINTING', percent: 0, message: 'Starting.' },
  sourcePdfStoragePath: 'synthetic/ed.pdf', sourcePdfFileName: 'ed.pdf', sourcePageCount: 1,
  activeSourceBundleId: 'bundle-ED', currentDraftVersionId: 'draft', publishedVersionId: null,
  assignedCohortIds: [], competencyPillars: pillars, unitCount: 0, simScenarioCount: 0, estimatedTotalMinutes: 0,
  createdByUid: 'trainer-1', createdAt: 1, updatedAt: 1,
};

const bundle = SourceBundleSchema.parse({
  id: 'bundle-ED', trackId: 'ED', status: 'approved', revisionHash: HASH, approvedSourceRevision: HASH,
  approvedByUid: 'trainer-1', approvedAt: 1, createdAt: 1, updatedAt: 1,
  documents: [{
    id: 'ED', revisionId: 'ED-rev1', bundleId: 'bundle-ED', trackId: 'ED', role: 'product', fileName: 'ed.pdf',
    storagePath: 'synthetic/ed.pdf', sourceVersion: 'v1', effectiveDate: null, uploadedAt: 1, uploadedByUid: 'trainer-1',
    contentHash: HASH, pageCount: 1, inheritanceOrder: 0, excluded: false, exclusionReason: null,
  }],
  sharedRulePackIds: ['shared-pack'], precedencePolicyId: 'standard-meds-precedence-v1', conflictIds: [],
});

const rulePack = SharedRulePackSchema.parse({
  id: 'shared-pack', revision: 'rules-rev1', title: 'Shared foundation', sourceDocumentIds: ['ED'], approvalStatus: 'approved',
  createdAt: 1, updatedAt: 1,
  rules: [{
    id: 'shared-identity', packId: 'shared-pack', title: 'Identity and opt out',
    statement: 'Identify as AI and honor opt out immediately.', severity: 'critical', applicableTrackIds: ['ED'],
    channels: ['voice'], stages: ['opening'], requiredKnowledge: true, requiredScenarioCoverage: true,
    sourceRevision: 'ED-rev1', approvalStatus: 'approved', approvedByUid: 'trainer-1', approvedAt: 1,
    evidence: evidence(),
  }],
});

function gateway(mutateSecondUnit = false): LLMGateway {
  let unitIndex = 0;
  return {
    providerName: 'replay',
    generateStructured: async <T extends z.ZodTypeAny>(opts: {
      schema: T; schemaName: string; tier: 'heavy' | 'fast'; systemPrompt: string; userPrompt: string;
    }): Promise<z.infer<T>> => {
      let raw: unknown;
      if (opts.schemaName === 'TrackBlueprint') {
        mocks.calls.blueprint += 1;
        raw = {
          campaignCode: 'ED', globalSummary: 'This synthetic ED track teaches agents to identify themselves as AI and honor every opt-out request immediately.',
          competencyPillars: pillars.map(({ key, label, description }) => ({ key, label, description })),
          units: [0, 1, 2].map((index) => ({ title: `Compliance ${index + 1}`, summary: 'Learn mandatory identity and opt-out behavior.', focus: 'Identify as AI and honor opt out.', sourcePages: [1], pillarKeys: ['compliance_boundaries'] })),
        };
      } else if (opts.schemaName === 'TrackUnitContent') {
        unitIndex += 1;
        mocks.calls.units += 1;
        raw = unitGeneration(mutateSecondUnit && unitIndex === 2 ? (generated) => {
          generated.briefingCards[0].evidence = [evidence({
            excerpts: [{ documentId: 'ED', revisionId: 'ED-rev1', pageNumber: 1, exactText: 'This exact passage does not occur on the existing page.', fromApprovedTranscription: false }],
          })];
        } : undefined);
      } else if (opts.schemaName === 'SimScenarios') {
        mocks.calls.simulations += 1;
        raw = { scenarios: [scenarioGeneration(1), scenarioGeneration(2)] };
      } else {
        throw new Error(`Unexpected schema ${opts.schemaName}`);
      }
      return opts.schema.parse(raw) as z.infer<T>;
    },
    streamChat: async function* () { yield ''; },
    healthCheck: async () => ({ ok: true, provider: 'replay', models: ['fixture'] }),
  };
}

beforeEach(() => {
  mocks.draftWrites.length = 0;
  mocks.workingDraftWrites.length = 0;
  mocks.secretWrites.length = 0;
  mocks.batchCommits = 0;
  mocks.checkpoints.clear();
  mocks.budgetWrites.length = 0;
  mocks.calls = { blueprint: 0, units: 0, simulations: 0 };
  mocks.model = 'fixture-model';
  mocks.generationProfile.baseUrl = 'http://127.0.0.1:11434';
  mocks.generationProfile.structuredGeneration.temperature = 0.2;
  track.title = 'ED Track';
  mocks.loadSourceReview.mockReset();
  mocks.loadSourceReview.mockResolvedValue({ bundle, pages: [sourcePage()], rulePacks: [rulePack], assets: [], conflicts: [] });
});

describe('generated evidence proposals', () => {
  it('persists exact evidence for BriefingCards and every Drill variant without trusting model approval', () => {
    const unit = finalizeUnit(outline, unitGeneration(), { pillarIds: ['pillar_compliance_boundaries'], allowedPages: [1], requireEvidence: true });
    const items = [...unit.briefingCards, ...unit.drills];
    expect(items).toHaveLength(8);
    expect(new Set(unit.drills.map((drill) => drill.kind)).size).toBe(5);
    for (const item of items) {
      expect(item.evidence).toHaveLength(1);
      expect(item.evidence?.[0]).toMatchObject({
        id: `${item.id}-e1`, support: 'unsupported', approvalStatus: 'draft', reviewerUid: null, reviewedAt: null,
        excerpts: [{ documentId: 'ED', revisionId: 'ED-rev1', pageNumber: 1, exactText: sourceText }],
      });
    }
  });

  it('persists exact evidence for rubric criteria as draft proposals', () => {
    const pair = finalizeScenario(scenarioGeneration(1), 's1', { pillarIds: ['pillar_compliance_boundaries'], allowedPages: [1], requireEvidence: true });
    for (const criterion of pair.secretConfig.rubricCriteria) {
      expect(criterion.evidence?.[0]).toMatchObject({ support: 'unsupported', approvalStatus: 'draft', reviewerUid: null, reviewedAt: null });
      expect(criterion.evidence?.[0].excerpts[0].exactText).toBe(sourceText);
    }
  });

  it('rejects a wrong-page citation even when the cited page exists', () => {
    const pages = [sourcePage(), sourcePage({ id: 'ED-page-2', pageNumber: 2, normalizedText: 'A different existing page.', rawText: 'A different existing page.' })];
    const wrongPage = evidence({
      excerpts: [{ documentId: 'ED', revisionId: 'ED-rev1', pageNumber: 2, exactText: sourceText, fromApprovedTranscription: false }],
    });
    expect(() => assertGeneratedClaimEvidence('u1-c1', [wrongPage], { pages, conflicts: [] })).toThrow(/unsupported/);
  });

  it('rejects caption-only interface claims without an approved transcription', () => {
    const caption = 'Screenshot of the disposition menu.';
    const lowDensity = sourcePage({
      normalizedText: caption, rawText: caption, extractionFlags: ['low_text_density'],
    });
    const interfaceClaim = evidence({
      requiresInterfaceDetails: true,
      excerpts: [{ documentId: 'ED', revisionId: 'ED-rev1', pageNumber: 1, exactText: caption, fromApprovedTranscription: false }],
    });
    expect(() => assertGeneratedClaimEvidence('u1-d1', [interfaceClaim], { pages: [lowDensity], conflicts: [] })).toThrow(/unsupported/);

    const transcribed = sourcePage({
      normalizedText: caption,
      rawText: caption,
      extractionFlags: ['low_text_density'],
      transcription: { text: 'Select Not interested in the disposition menu.', approvedByUid: 'trainer-1', approvedAt: 1 },
    });
    const approvedClaim = evidence({
      requiresInterfaceDetails: true,
      excerpts: [{ documentId: 'ED', revisionId: 'ED-rev1', pageNumber: 1, exactText: 'Select Not interested in the disposition menu.', fromApprovedTranscription: true }],
    });
    expect(() => assertGeneratedClaimEvidence('u1-d1', [approvedClaim], { pages: [transcribed], conflicts: [] })).not.toThrow();
  });
});

describe('source-aware generation checkpoints', () => {
  it('persists source revision, inherited rules, and provenance on working and final drafts', async () => {
    await runTrackGeneration('ED', () => undefined, gateway());

    expect(mocks.workingDraftWrites).toHaveLength(4);
    expect(mocks.draftWrites).toHaveLength(1);
    for (const draft of [...mocks.workingDraftWrites, ...mocks.draftWrites]) {
      expect(draft).toMatchObject({
        sourceBundleId: 'bundle-ED', sourceRevision: HASH, requiredRuleIds: ['shared-identity'],
        provenance: {
          provider: 'replay', model: 'fixture-model', prompt: { templateId: 'staged-track-generation', templateVersion: 'v2' },
          schema: { name: 'TrackVersion', version: 'v2' },
        },
      });
    }
    expect(mocks.batchCommits).toBe(1);
    const secrets = mocks.secretWrites[0] as { scenarios: Array<{ rubricCriteria: Array<{ evidence?: ClaimEvidence[] }> }> };
    expect(secrets.scenarios[0].rubricCriteria[0].evidence?.[0].approvalStatus).toBe('draft');
  });

  it('rejects invalid later-stage evidence and preserves the previous valid working Unit checkpoint', async () => {
    await expect(runTrackGeneration('ED', () => undefined, gateway(true))).rejects.toThrow(/previous valid draft was preserved/);

    expect(mocks.draftWrites).toHaveLength(0);
    expect(mocks.workingDraftWrites).toHaveLength(2);
    expect(mocks.workingDraftWrites[0].units).toHaveLength(0);
    expect(mocks.workingDraftWrites[1].units).toHaveLength(1);
    expect(mocks.workingDraftWrites[1].sourceRevision).toBe(HASH);
    expect(mocks.batchCommits).toBe(0);
  });

  it('resumes the real pipeline from valid exact-input checkpoints, records budgets, and rebuilds changed inputs', async () => {
    const progress: string[] = [];
    await expect(runTrackGeneration('ED', (event) => { progress.push(event.step); }, gateway(true)))
      .rejects.toThrow(/previous valid draft was preserved/);

    expect(mocks.calls).toEqual({ blueprint: 1, units: 2, simulations: 0 });
    expect(mocks.checkpoints.size).toBe(2);
    expect(mocks.workingDraftWrites.at(-1)?.units).toHaveLength(1);
    expect(mocks.draftWrites).toHaveLength(0);
    expect(mocks.batchCommits).toBe(0);
    expect(progress.at(-1)).not.toBe('READY');

    await runTrackGeneration('ED', (event) => { progress.push(event.step); }, gateway());

    // Blueprint and Unit 1 came from checkpoints. Only the failed Unit 2, Unit 3, and Sims called the model again.
    expect(mocks.calls).toEqual({ blueprint: 1, units: 4, simulations: 1 });
    expect(mocks.checkpoints.size).toBe(5);
    expect(mocks.draftWrites.at(-1)?.units).toHaveLength(3);
    expect(mocks.draftWrites.at(-1)?.simScenarios).toHaveLength(2);
    expect(mocks.batchCommits).toBe(1);
    expect(progress.at(-1)).toBe('READY');

    const budgets = mocks.budgetWrites.at(-1)!;
    expect(Object.keys(budgets).sort()).toEqual(['blueprint', 'simulations', 'unit:u1', 'unit:u2', 'unit:u3']);
    expect(budgets.blueprint).toMatchObject({ attempts: 0, modelCalls: 0, cacheHits: 1 });
    expect(budgets['unit:u1']).toMatchObject({ attempts: 0, modelCalls: 0, cacheHits: 1 });
    expect(budgets['unit:u2']).toMatchObject({ attempts: 1, modelCalls: 1, cacheHits: 0 });
    expect(budgets.simulations).toMatchObject({ attempts: 1, modelCalls: 1, cacheHits: 0 });

    track.title = 'ED Track changed source-generation input';
    await runTrackGeneration('ED', () => undefined, gateway());

    // The fixture returns an identical blueprint, but the title is effective Unit/Sim prompt metadata.
    // Every descendant must therefore regenerate instead of reusing its previous canonical input.
    expect(mocks.calls).toEqual({ blueprint: 2, units: 7, simulations: 2 });
    expect(mocks.checkpoints.size).toBe(5);
    expect(mocks.batchCommits).toBe(2);
  });

  it('invalidates every stage when only the runtime endpoint changes', async () => {
    await runTrackGeneration('ED', () => undefined, gateway());
    expect(mocks.calls).toEqual({ blueprint: 1, units: 3, simulations: 1 });

    mocks.generationProfile.baseUrl = 'http://127.0.0.1:21434';
    await runTrackGeneration('ED', () => undefined, gateway());

    expect(mocks.calls).toEqual({ blueprint: 2, units: 6, simulations: 2 });
    expect(mocks.checkpoints.size).toBe(5);
    expect(mocks.draftWrites[1].provenance).toMatchObject({
      provider: 'replay', model: 'fixture-model', runtime: { label: 'fixture', profileId: 'replay-local' },
    });
  });

  it('invalidates every stage when only effective structured-generation settings change', async () => {
    await runTrackGeneration('ED', () => undefined, gateway());
    expect(mocks.calls).toEqual({ blueprint: 1, units: 3, simulations: 1 });

    mocks.generationProfile.structuredGeneration.temperature = 0.3;
    await runTrackGeneration('ED', () => undefined, gateway());

    expect(mocks.calls).toEqual({ blueprint: 2, units: 6, simulations: 2 });
    expect(mocks.checkpoints.size).toBe(5);
    expect(mocks.draftWrites[1].provenance?.model).toBe('fixture-model');
  });

  it('invalidates cached output for a changed model and preserves the last complete draft on failure', async () => {
    await runTrackGeneration('ED', () => undefined, gateway());
    const complete = mocks.draftWrites[0];
    expect(complete.provenance?.model).toBe('fixture-model');

    mocks.model = 'fixture-model-v2';
    await expect(runTrackGeneration('ED', () => undefined, gateway(true))).rejects.toThrow(/previous valid draft was preserved/);

    expect(mocks.calls).toEqual({ blueprint: 2, units: 5, simulations: 1 });
    expect(mocks.draftWrites).toEqual([complete]);
    expect(mocks.workingDraftWrites.at(-1)?.units).toHaveLength(1);
    expect(mocks.workingDraftWrites.at(-1)?.provenance?.model).toBe('fixture-model-v2');

    await runTrackGeneration('ED', () => undefined, gateway());
    expect(mocks.calls).toEqual({ blueprint: 2, units: 7, simulations: 2 });
    expect(mocks.draftWrites).toHaveLength(2);
    expect(mocks.draftWrites[1].provenance?.model).toBe('fixture-model-v2');
    expect(mocks.draftWrites[1].units).toHaveLength(3);
    expect(mocks.draftWrites[1].simScenarios).toHaveLength(2);
  });
});
