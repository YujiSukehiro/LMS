/**
 * Production (hosted Gemini) Track generation path. Tonight's pipeline work targeted local providers
 * (per-scenario Sims, local depth limits, local source budgets, drill batches of 3); these tests pin
 * that the hosted path still uses the hosted limits, one batch Sim call, the hosted source budgets
 * and the per-stage output-token sizes, and still commits a complete draft.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';
import { GenerationPausedError, runTrackGeneration, generationStageTimeoutMs, isLocalProvider } from '@/lib/ai/pipeline/generate-track';
import { DEPTH_LIMITS, LOCAL_DEPTH_LIMITS, depthLimitsForProvider } from '@/lib/ai/pipeline/content-depth';
import { localSourceCharBudget, UNIT_OVERHEAD_TOKENS } from '@/lib/ai/pipeline/source-budget';
import {
  BLUEPRINT_SCHEMA_NAME,
  blueprintMaxOutputTokens,
  blueprintUnitRange,
} from '@/lib/ai/prompts/blueprint';
import {
  UNIT_CARDS_SCHEMA_NAME,
  UNIT_DRILLS_SCHEMA_NAME,
  cardsMaxOutputTokens,
  drillsMaxOutputTokens,
} from '@/lib/ai/prompts/unit-builder';
import {
  MAX_SIM_SCENARIOS,
  SIM_BUILDER_MAX_OUTPUT_TOKENS,
  SIM_SCHEMA_NAME,
  SIM_SOURCE_CHAR_BUDGET,
  SINGLE_SIM_SCHEMA_NAME,
} from '@/lib/ai/prompts/sim-builder';
import { LLMStructuredOutputError, type GenerateStructuredOptions, type LLMGateway } from '@/lib/ai/types';
import type { TrackDoc, TrackVersionDoc } from '@/lib/schemas/curriculum';

const mocks = vi.hoisted(() => ({
  draftWrites: [] as TrackVersionDoc[],
  secretWrites: [] as unknown[],
  checkpoints: new Map<string, unknown>(),
  provider: 'gemini' as string,
}));

vi.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (name: string) => {
      if (name !== 'generationCheckpoints' && name !== 'generationWorkingDrafts') throw new Error(`Unexpected collection ${name}`);
      return {
        doc: (id: string) => ({
          get: async () => ({ exists: mocks.checkpoints.has(id), data: () => structuredClone(mocks.checkpoints.get(id)) }),
          set: async (value: unknown) => {
            if (name === 'generationCheckpoints') mocks.checkpoints.set(id, structuredClone(value));
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
      commit: async () => undefined,
    }),
  },
}));

vi.mock('@/lib/ai/pipeline/track-store', () => ({
  GENERATION_HEARTBEAT_MS: 60_000,
  draftRef: () => ({ kind: 'draft', set: async (value: TrackVersionDoc) => { mocks.draftWrites.push(structuredClone(value)); } }),
  secretsRef: () => ({ kind: 'secrets' }),
  trackRef: () => ({ update: async () => undefined }),
  estimateTrackMinutes: () => 10,
  loadSourcePages: async () => pages,
  loadTrack: async () => track,
  nextDraftVersionNumber: () => 1,
}));

vi.mock('@/lib/ai/gateway', () => ({
  getActiveAiRuntime: () => ({
    provider: mocks.provider,
    heavyModel: 'gemini-2.5-flash',
    fastModel: 'gemini-2.5-flash-lite',
    runtimeLabel: undefined,
    generationProfile: { structuredGeneration: { maxRepairRetries: 2 } },
  }),
  getLLMGateway: () => { throw new Error('A test gateway must be supplied.'); },
}));

vi.mock('@/lib/services/source-store', () => ({ loadSourceReview: vi.fn() }));

// ~22.5k characters of rule-dense text over 9 pages: above every local source budget, inside the hosted ones.
const PAGE_COUNT = 9;
const pages = Array.from({ length: PAGE_COUNT }, (_, index) => {
  const n = index + 1;
  const lines = Array.from({ length: 6 }, (_, line) =>
    `Agents must always confirm the caller identity and never promise discounts on page ${n} line ${line + 1} marker PAGEMARK${n}.`,
  );
  return { pageNumber: n, text: lines.join('\n') + '\n' + 'Background prose about the campaign. '.repeat(50) };
});

const track: TrackDoc = {
  id: 'HOSTED', title: 'Hosted Track', campaignCode: 'HST', divisionId: 'OUTBOUND', status: 'GENERATING',
  generationProgress: { step: 'BLUEPRINTING', percent: 0, message: 'Starting.' },
  sourcePdfStoragePath: 'synthetic/hosted.pdf', sourcePdfFileName: 'hosted.pdf', sourcePageCount: PAGE_COUNT,
  activeSourceBundleId: null, currentDraftVersionId: 'draft', publishedVersionId: null,
  assignedCohortIds: [], competencyPillars: [], unitCount: 0, simScenarioCount: 0, estimatedTotalMinutes: 0,
  createdByUid: 'trainer-1', createdAt: 1, updatedAt: 1,
};

const pillarDefs = [
  { key: 'compliance_boundaries', label: 'Compliance', description: 'Follow mandatory compliance rules.' },
  { key: 'verification_crm', label: 'Verification', description: 'Verify the synthetic lead.' },
  { key: 'retention_objection', label: 'Retention', description: 'Handle objections within policy.' },
  { key: 'closing_next_steps', label: 'Closing', description: 'Close with correct next steps.' },
];

/** Distinct content words per call, so the near-duplicate Drill filter never drops the fixture Drills. */
function uniqueWords(seed: number): string {
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  return Array.from({ length: 12 }, (_, i) => {
    let value = seed * 31 + i * 7 + 1;
    let word = '';
    for (let k = 0; k < 5; k++) { word += letters[value % 26]; value = Math.floor(value / 26) + k + i; }
    return `${word}${letters[i]}x`;
  }).join(' ');
}

let seed = 0;
function drillOfKind(kind: string): Record<string, unknown> {
  seed += 1;
  const base = {
    competencyPillarId: 'pillar_compliance_boundaries',
    prompt: `Which action follows the rule ${uniqueWords(seed)}?`,
    explanation: 'The Playbook requires the agent to confirm identity and never promise discounts.',
    sourcePages: [1],
  };
  switch (kind) {
    case 'MULTIPLE_CHOICE':
      return {
        ...base, kind,
        options: [
          { id: 'a', text: 'Confirm identity first.' },
          { id: 'b', text: 'Promise a discount.' },
          { id: 'c', text: 'Skip the identity check.' },
          { id: 'd', text: 'Invent a new policy.' },
        ],
        correctOptionId: 'a',
      };
    case 'TRUE_FALSE_SPOT':
      return { ...base, kind, statement: 'The agent confirms the caller identity before discussing the account.', isCompliant: true };
    case 'SEQUENCE_ORDER':
      return { ...base, kind, orderedSteps: [{ text: 'Greet the caller.' }, { text: 'Confirm identity.' }, { text: 'Discuss the account.' }] };
    case 'MATCH_PAIRS':
      return {
        ...base, kind,
        pairs: [
          { leftPrompt: 'Opening', rightMatch: 'Confirm identity' },
          { leftPrompt: 'Discount request', rightMatch: 'Decline politely' },
          { leftPrompt: 'Closing', rightMatch: 'Confirm next steps' },
        ],
      };
    case 'FILL_BLANK_CHOICE':
      return {
        ...base, kind, sentenceTemplate: 'Always confirm the caller {{BLANK}} first.',
        wordBank: ['identity', 'discount', 'diagnosis', 'urgency'], correctWord: 'identity',
      };
    default:
      throw new Error(`Unexpected kind ${kind}`);
  }
}

function card(index: number): Record<string, unknown> {
  return {
    headline: `Identity rule ${index}`,
    bodyMarkdown: 'Agents must always confirm the caller identity and never promise discounts.',
    keyTakeaway: 'Confirm identity; never promise discounts.',
    doList: ['Confirm identity.', 'Decline discount requests.'],
    dontList: ['Do not promise discounts.', 'Do not skip identity checks.'],
    sourcePages: [1],
  };
}

function scenario(id: number): Record<string, unknown> {
  const criterion = (index: number, weight: number) => ({
    competencyPillarId: 'pillar_compliance_boundaries',
    criterionLabel: `Compliance criterion ${index}`,
    evaluationRule: 'The agent must confirm identity and never promise discounts.',
    weight,
    sourcePages: [1],
  });
  return {
    publicScenario: {
      title: `Synthetic hosted call ${id}`, difficulty: 'STANDARD', counterpartyRoleLabel: 'Outbound Lead',
      contextTicketSummary: 'Synthetic outbound call.', openingMessage: 'Hello, who is this?',
      dispositionOptions: ['Not interested', 'Callback scheduled'], maxTurns: 8, passScoreThreshold: 80,
    },
    secretConfig: {
      personaName: `Synthetic Caller ${id}`, personaBackstoryAndMood: 'A synthetic lead with a calm mood.',
      hiddenFactsToRevealOnlyWhenAsked: ['The synthetic lead asks for a discount.'],
      conditionalBehaviors: ['The synthetic lead hangs up if pressured.'], expectedDisposition: 'Not interested',
      autoFailTriggers: ['The agent promises a discount.'],
      rubricCriteria: [criterion(1, 50), criterion(2, 30), criterion(3, 20)],
    },
  };
}

const ALL_KINDS = ['MULTIPLE_CHOICE', 'TRUE_FALSE_SPOT', 'SEQUENCE_ORDER', 'MATCH_PAIRS', 'FILL_BLANK_CHOICE'];
const unitRange = blueprintUnitRange(pages);

interface RecordedCall {
  schemaName: string;
  maxOutputTokens: number | undefined;
  userPrompt: string;
  hasSignal: boolean;
}

function hostedGateway(calls: RecordedCall[]): LLMGateway {
  return {
    providerName: 'gemini',
    generateStructured: async <T extends z.ZodTypeAny>(opts: GenerateStructuredOptions<T>): Promise<z.infer<T>> => {
      calls.push({ schemaName: opts.schemaName, maxOutputTokens: opts.maxOutputTokens, userPrompt: opts.userPrompt, hasSignal: opts.signal instanceof AbortSignal });
      let raw: unknown;
      if (opts.schemaName === BLUEPRINT_SCHEMA_NAME) {
        const unitCount = unitRange.min;
        raw = {
          campaignCode: 'HST',
          globalSummary: 'This synthetic hosted Track teaches agents to confirm caller identity and never promise discounts on any outbound call.',
          competencyPillars: pillarDefs,
          units: Array.from({ length: unitCount }, (_, index) => ({
            title: `Identity ${index + 1}`, summary: 'Learn the identity and discount rules.', focus: 'Confirm identity; no discounts.',
            // Unit 1 cites every page so its content plan is as deep as the source allows; every Unit cites page 1.
            sourcePages: index === 0 ? pages.map((page) => page.pageNumber) : [1, Math.min(PAGE_COUNT, index + 1)],
            pillarKeys: ['compliance_boundaries'],
          })),
        };
      } else if (opts.schemaName === UNIT_CARDS_SCHEMA_NAME) {
        raw = { briefingCards: Array.from({ length: 8 }, (_, index) => card(index + 1)) };
      } else if (opts.schemaName === UNIT_DRILLS_SCHEMA_NAME) {
        raw = { drills: ALL_KINDS.map(drillOfKind) };
      } else if (opts.schemaName === SIM_SCHEMA_NAME) {
        raw = { scenarios: [scenario(1), scenario(2), scenario(3)] };
      } else {
        throw new Error(`Unexpected schema ${opts.schemaName}`);
      }
      const parsed = opts.schema.safeParse(raw);
      if (!parsed.success) {
        throw new LLMStructuredOutputError(
          `invalid ${opts.schemaName}: ${parsed.error.issues.slice(0, 3).map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`,
          opts.schemaName, 3, JSON.stringify(raw),
        );
      }
      return parsed.data as z.infer<T>;
    },
    streamChat: async function* () { yield ''; },
    healthCheck: async () => ({ ok: true, provider: 'gemini', models: ['gemini-2.5-flash'] }),
  };
}

beforeEach(() => {
  mocks.draftWrites.length = 0;
  mocks.secretWrites.length = 0;
  mocks.checkpoints.clear();
  mocks.provider = 'gemini';
  seed = 0;
});

describe('hosted (Gemini) generation path', () => {
  it('uses the hosted depth limits, timeouts and provider classification', () => {
    expect(isLocalProvider('gemini')).toBe(false);
    expect(depthLimitsForProvider('gemini')).toEqual(DEPTH_LIMITS);
    expect(depthLimitsForProvider('ollama')).toEqual(LOCAL_DEPTH_LIMITS);
    // Hosted attempts get 180 s each (no local tokens-per-second sizing), times the attempts.
    expect(generationStageTimeoutMs({ provider: 'gemini', maxOutputTokens: 16_384, attempts: 3 })).toBe(3 * 180_000);
  });

  it('builds a complete draft with batch Sims, hosted budgets and per-stage output tokens', async () => {
    const calls: RecordedCall[] = [];
    await runTrackGeneration('HOSTED', () => undefined, hostedGateway(calls));

    // Every model call carries an abort signal and an explicit output budget.
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((call) => call.hasSignal && typeof call.maxOutputTokens === 'number')).toBe(true);

    // Blueprint: sized from the measured Unit range.
    const blueprint = calls.filter((call) => call.schemaName === BLUEPRINT_SCHEMA_NAME);
    expect(blueprint).toHaveLength(1);
    expect(blueprint[0].maxOutputTokens).toBe(blueprintMaxOutputTokens(unitRange.max));

    // Units: one cards call per Unit, Drill batches of up to 5 (hosted), never the local batch of 3.
    const cardCalls = calls.filter((call) => call.schemaName === UNIT_CARDS_SCHEMA_NAME);
    const drillCalls = calls.filter((call) => call.schemaName === UNIT_DRILLS_SCHEMA_NAME);
    expect(cardCalls).toHaveLength(unitRange.min);
    for (const call of cardCalls) {
      expect(call.maxOutputTokens).toBeLessThanOrEqual(cardsMaxOutputTokens(DEPTH_LIMITS.maxCards));
      expect(call.maxOutputTokens).toBeGreaterThanOrEqual(cardsMaxOutputTokens(DEPTH_LIMITS.minCards));
    }
    const drillTokenSizes = new Set(drillCalls.map((call) => call.maxOutputTokens));
    expect([...drillTokenSizes].every((tokens) => [1, 2, 3, 4, 5].some((n) => drillsMaxOutputTokens(n) === tokens))).toBe(true);
    expect(drillTokenSizes.has(drillsMaxOutputTokens(5))).toBe(true);

    // Unit 1 cites every page; hosted depth limits allow more cards than the local cap of 5.
    const draft = mocks.draftWrites.at(-1)!;
    expect(draft).toBeDefined();
    expect(draft.units).toHaveLength(unitRange.min);
    expect(Math.max(...draft.units.map((unit) => unit.briefingCards.length))).toBeGreaterThan(LOCAL_DEPTH_LIMITS.maxCards);
    for (const unit of draft.units) {
      expect(unit.briefingCards.length).toBeGreaterThanOrEqual(DEPTH_LIMITS.minCards);
      expect(unit.drills.length).toBeGreaterThanOrEqual(DEPTH_LIMITS.minDrills);
      expect(new Set(unit.drills.map((drill) => drill.id)).size).toBe(unit.drills.length);
    }

    // Sims: one batch call (not per scenario), the full batch output budget, the hosted 30k source budget.
    expect(calls.filter((call) => call.schemaName === SINGLE_SIM_SCHEMA_NAME)).toHaveLength(0);
    const simCalls = calls.filter((call) => call.schemaName === SIM_SCHEMA_NAME);
    expect(simCalls).toHaveLength(1);
    expect(simCalls[0].maxOutputTokens).toBe(SIM_BUILDER_MAX_OUTPUT_TOKENS);
    const totalSource = pages.reduce((sum, page) => sum + page.text.length, 0);
    const localSimBudget = localSourceCharBudget({ plannedOutputTokens: 4096, overheadTokens: UNIT_OVERHEAD_TOKENS });
    expect(totalSource).toBeGreaterThan(localSimBudget);
    expect(totalSource).toBeLessThan(SIM_SOURCE_CHAR_BUDGET);
    for (const page of pages) expect(simCalls[0].userPrompt).toContain(`PAGEMARK${page.pageNumber}.`);

    expect(draft.simScenarios).toHaveLength(MAX_SIM_SCENARIOS);
    expect(draft.provenance?.source).toBe('hosted_ai');
    expect(draft.provenance?.provider).toBe('gemini');
    expect(mocks.secretWrites).toHaveLength(1);
  });

  it('pauses at a stage boundary when the step deadline passes, then resumes from checkpoints', async () => {
    // Deadline already past: nothing runs, nothing is written, and it is a pause, not a failure.
    const none: RecordedCall[] = [];
    await expect(runTrackGeneration('HOSTED', () => undefined, hostedGateway(none), { deadlineAt: Date.now() - 1 })).rejects.toBeInstanceOf(GenerationPausedError);
    expect(none).toHaveLength(0);
    expect(mocks.draftWrites).toHaveLength(0);

    // The clock passes the deadline after 3 model calls: the step pauses before its next stage.
    const realNow = Date.now.bind(Date);
    const first: RecordedCall[] = [];
    const base = hostedGateway(first);
    const clockJumper: LLMGateway = {
      ...base,
      generateStructured: async (opts) => {
        const out = await base.generateStructured(opts);
        if (first.length >= 3) vi.spyOn(Date, 'now').mockImplementation(() => realNow() + 10 * 60_000);
        return out;
      },
    };
    await expect(runTrackGeneration('HOSTED', () => undefined, clockJumper, { deadlineAt: realNow() + 60_000 })).rejects.toBeInstanceOf(GenerationPausedError);
    vi.restoreAllMocks();
    expect(first.length).toBeGreaterThanOrEqual(3);
    expect(mocks.draftWrites.filter((draft) => draft.simScenarios.length > 0)).toHaveLength(0);

    // The next step (no deadline) finishes; the stages saved before the pause are not asked again.
    const second: RecordedCall[] = [];
    await runTrackGeneration('HOSTED', () => undefined, hostedGateway(second));
    const full: RecordedCall[] = [];
    mocks.checkpoints.clear();
    await runTrackGeneration('HOSTED', () => undefined, hostedGateway(full));
    expect(second.length).toBe(full.length - first.length);
  });
});
