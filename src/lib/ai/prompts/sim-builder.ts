/**
 * Pass 3 (Sim Builder): 2-3 Live Call Simulation scenarios. Each scenario is a learner-safe
 * PublicSimScenario plus a server-only SecretSimScenarioConfig (persona, hidden facts, rubric).
 * Also holds the single-scenario regeneration prompt.
 */
import { z } from 'zod';
import {
  PublicSimScenarioSchema,
  SecretSimScenarioConfigSchema,
  type CompetencyPillar,
  type PublicSimScenario,
  type SecretSimScenarioConfig,
} from '@/lib/schemas/curriculum';
import type { DivisionId } from '@/lib/schemas/domain';
import { CanonicalDispositionSchema } from '@/lib/schemas/source-truth';
import { TRAINING_POLICY } from '@/lib/policy/training-policy';
import {
  ScenarioContextSchema,
  ScenarioEvidenceRequirementsSchema,
  type ScenarioContext,
  type ScenarioEvidenceRequirements,
} from '@/lib/schemas/simulation-state';
import { ClaimEvidenceProposalSchema, finalizeEvidenceProposals } from '@/lib/ai/prompts/evidence';
import { DEFAULT_SIM_PASS_THRESHOLD } from '@/lib/schemas/constants';
import {
  EXACT_EVIDENCE_RULE,
  formatApprovedAssets,
  formatBudgetedSourcePages,
  formatSharedRulePacks,
  planSourceBudget,
  type SourceReviewPromptContext,
} from '@/lib/ai/pipeline/source-budget';
import { formatSourcePages, type ExtractedPage } from '@/lib/ai/pdf-extractor';
import { parseStructuredOutput } from '@/lib/ai/pipeline/structured-output';
import {
  CITATION_RULE,
  DIVISION_PROFILES,
  GROUNDING_RULE,
  LANGUAGE_RULE,
  clampText,
  describePageSet,
  describePillars,
  divisionLabel,
  invalidPages,
  sanitizePages,
  selectPagesWithinBudget,
} from '@/lib/ai/pipeline/shared';

export const SIM_SCHEMA_NAME = 'SimScenarios';
export const SINGLE_SIM_SCHEMA_NAME = 'SimScenario';
export const MIN_SIM_SCENARIOS = 2;
export const MAX_SIM_SCENARIOS = 3;
/** Character budget for SOURCE PAGE text in one Sim Builder prompt. */
export const SIM_SOURCE_CHAR_BUDGET = 30000;

export interface SimBuildContext {
  pillarIds: string[];
  allowedPages: number[];
  requireEvidence?: boolean;
  /**
   * Optional Track/source facts for the deterministic scenario context. Without them finalize uses safe
   * synthetic defaults, so a fresh draft can always start (no 409 SCENARIO_CONTEXT_REQUIRED).
   */
  scenarioDefaults?: {
    divisionId?: DivisionId;
    product?: string;
    sourceRevision?: string;
    curriculumVersion?: string;
  };
}

export interface SimScenarioPair {
  publicScenario: PublicSimScenario;
  secretConfig: SecretSimScenarioConfig;
}

/**
 * Recommended explicit output budget for one Sim Builder call (2-3 scenarios with rubrics and evidence).
 * Pass it as `maxOutputTokens` from the pipeline (generate-track / regenerate-item).
 */
export const SIM_BUILDER_MAX_OUTPUT_TOKENS = 8192;
/** Budget for regenerating a single scenario. */
export const SIM_SINGLE_SCENARIO_MAX_OUTPUT_TOKENS = 4096;

/** The only dispositions the Simulation engine accepts (server-validated at wrap-up). */
export const SIM_CANONICAL_DISPOSITIONS = CanonicalDispositionSchema.options;
export type SimCanonicalDisposition = (typeof SIM_CANONICAL_DISPOSITIONS)[number];

const DISPOSITION_SYNONYMS: Array<[RegExp, SimCanonicalDisposition]> = [
  [/^recover|^saved?\b|^sale|^sold|^converted|^payment (?:updated|recovered)|^resolved/i, 'Recovered'],
  [/callback|call back|follow[- ]?up|reschedul/i, 'Callback scheduled'],
  [/didn'?t reply|did not reply|no answer|no[- ]reply|voicemail|unreachable|no contact/i, "Didn't reply"],
  [/not interested|declined|refus|opt[- ]?out|do not call|dnc|cancel/i, 'Not interested'],
  [/organic|self[- ]serv|already (?:completed|done|ordered)/i, 'Organic'],
  [/^lost|expired|terminal|closed lost/i, 'Lost'],
];

/** Map a model-written disposition onto the canonical list (exact, case-insensitive, or a known synonym). */
export function toCanonicalDisposition(value: string): SimCanonicalDisposition | null {
  const text = value.trim().replace(/\s+/g, ' ');
  const exact = SIM_CANONICAL_DISPOSITIONS.find((option) => option.toLowerCase() === text.toLowerCase().replace(/’/g, "'"));
  if (exact) return exact;
  return DISPOSITION_SYNONYMS.find(([pattern]) => pattern.test(text))?.[1] ?? null;
}

const toNumber = (value: unknown) => (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : value);
const toUpperEnum = (value: unknown) => (typeof value === 'string' ? value.trim().toUpperCase().replace(/[\s-]+/g, '_') : value);
const toLowerEnum = (value: unknown) => (typeof value === 'string' ? value.trim().toLowerCase().replace(/[\s-]+/g, '_') : value);
const toList = (value: unknown) => (typeof value === 'string' ? [value] : value === null || value === undefined ? [] : value);

const citedPages = z.preprocess(toList, z.array(z.preprocess(toNumber, z.number().int().positive())).min(1));

/** Model-facing rubric criterion: lengths are trimmed in finalize, not rejected. */
const RubricGenerationSchema = z.object({
  competencyPillarId: z.string().min(1),
  criterionLabel: z.string().min(1),
  evaluationRule: z.string().min(1),
  weight: z.preprocess(toNumber, z.number().int().min(10).max(50)),
  sourcePages: citedPages,
  evidence: z.array(ClaimEvidenceProposalSchema).min(1).max(12).optional(),
});

/**
 * A 7B model often writes rubric evidence as excerpts only, without "claim" (the live R2d build failed a Sim on
 * this three times). The criterion's own evaluation rule is the claim that evidence supports, so it fills the gap.
 */
export function fillRubricEvidenceClaims(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const criterion = value as { evidence?: unknown; evaluationRule?: unknown; criterionLabel?: unknown };
  if (!Array.isArray(criterion.evidence)) return value;
  const fallback = [criterion.evaluationRule, criterion.criterionLabel].find((text): text is string => typeof text === 'string' && text.trim().length > 0);
  if (!fallback) return value;
  return {
    ...criterion,
    evidence: criterion.evidence.map((item) =>
      item && typeof item === 'object' && !Array.isArray(item) && !(typeof (item as { claim?: unknown }).claim === 'string' && (item as { claim: string }).claim.trim())
        ? { ...item, claim: fallback.trim() }
        : item),
  };
}

/** Optional structured call setup; invalid values are ignored and filled with Track defaults. */
const CallSetupSchema = z
  .object({
    direction: z.preprocess(toLowerEnum, ScenarioContextSchema.shape.direction).optional().catch(undefined),
    queue: z.preprocess(toLowerEnum, ScenarioContextSchema.shape.queue).optional().catch(undefined),
    contactState: z.preprocess(toLowerEnum, ScenarioContextSchema.shape.contactState).optional().catch(undefined),
    pricingPosture: z.preprocess(toLowerEnum, ScenarioContextSchema.shape.pricingPosture).optional().catch(undefined),
    product: z.string().optional().catch(undefined),
  })
  .partial();

/**
 * Model-facing scenario schema. Lenient for small local models: no tight `.max()` on text (finalize trims),
 * numeric strings are coerced, and dispositions are snapped to the canonical list. Hard constraints that a
 * model must fix (canonical expected disposition, rubric weights = 100, pillar ids, pages) stay in checkScenario.
 */
const ScenarioGenerationSchema = z.object({
  publicScenario: z.object({
    title: z.string().min(1),
    difficulty: z.preprocess(toUpperEnum, PublicSimScenarioSchema.shape.difficulty),
    counterpartyRoleLabel: z.string().min(1),
    contextTicketSummary: z.string().min(1),
    accountOnFile: z.preprocess(toList, z.array(z.string())).optional().catch(undefined),
    openingMessage: z.string().min(1),
    dispositionOptions: z.preprocess(toList, z.array(z.string())),
    maxTurns: z.preprocess(toNumber, z.number()).default(8),
    passScoreThreshold: z.preprocess(toNumber, z.number()).default(DEFAULT_SIM_PASS_THRESHOLD),
    callSetup: CallSetupSchema.optional().catch(undefined),
  }),
  secretConfig: z.object({
    personaName: z.string().min(1),
    personaBackstoryAndMood: z.string().min(1),
    hiddenFactsToRevealOnlyWhenAsked: z.preprocess(toList, z.array(z.string())),
    conditionalBehaviors: z.preprocess(toList, z.array(z.string())),
    expectedDisposition: z.string().min(1),
    autoFailTriggers: z.preprocess(toList, z.array(z.string())),
    rubricCriteria: z.array(z.preprocess(fillRubricEvidenceClaims, RubricGenerationSchema) as unknown as typeof RubricGenerationSchema).min(3).max(6),
  }),
});
export type ScenarioGeneration = z.input<typeof ScenarioGenerationSchema>;
type ParsedScenarioGeneration = z.output<typeof ScenarioGenerationSchema>;

type IssueSink = (path: (string | number)[], message: string) => void;

function checkScenario(scenario: ParsedScenarioGeneration, ctx: SimBuildContext, path: (string | number)[], report: IssueSink): void {
  const allowed = new Set(ctx.allowedPages);
  if (!toCanonicalDisposition(scenario.secretConfig.expectedDisposition)) {
    report(
      [...path, 'secretConfig', 'expectedDisposition'],
      `"expectedDisposition" must be exactly one of: ${SIM_CANONICAL_DISPOSITIONS.join(' | ')}.`,
    );
  }
  const total = scenario.secretConfig.rubricCriteria.reduce((sum, criterion) => sum + criterion.weight, 0);
  if (total !== 100) {
    report([...path, 'secretConfig', 'rubricCriteria'], `The rubric weights add up to ${total}. They must add up to exactly 100.`);
  }
  scenario.secretConfig.rubricCriteria.forEach((criterion, index) => {
    if (!ctx.pillarIds.includes(criterion.competencyPillarId)) {
      report(
        [...path, 'secretConfig', 'rubricCriteria', index, 'competencyPillarId'],
        `Use one of these CompetencyPillar ids: ${ctx.pillarIds.join(', ')}.`,
      );
    }
    if (ctx.requireEvidence && !criterion.evidence?.length) {
      report([...path, 'secretConfig', 'rubricCriteria', index, 'evidence'], 'Provide exact claim-to-excerpt evidence from the supplied source documents.');
    }
    const outside = invalidPages(criterion.sourcePages, allowed);
    if (outside.length > 0) {
      report(
        [...path, 'secretConfig', 'rubricCriteria', index, 'sourcePages'],
        `Pages ${outside.join(', ')} do not exist. Use pages from ${describePageSet(ctx.allowedPages)}.`,
      );
    }
  });
}

/** Zod output schema for Pass 3 (2-3 scenarios). */
export function buildSimGenerationSchema(ctx: SimBuildContext) {
  return z
    .object({ scenarios: z.array(ScenarioGenerationSchema).min(MIN_SIM_SCENARIOS).max(MAX_SIM_SCENARIOS) })
    .superRefine((value, zctx) => {
      const report: IssueSink = (path, message) => zctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
      value.scenarios.forEach((scenario, index) => checkScenario(scenario, ctx, ['scenarios', index], report));
    });
}
export type SimGeneration = z.infer<ReturnType<typeof buildSimGenerationSchema>>;

/** Zod output schema for regenerating one scenario (public + secret pair). */
export function buildSingleScenarioSchema(ctx: SimBuildContext) {
  return ScenarioGenerationSchema.superRefine((scenario, zctx) => {
    checkScenario(scenario, ctx, [], (path, message) => zctx.addIssue({ code: z.ZodIssueCode.custom, path, message }));
  });
}

export function buildSimSystemPrompt(divisionId: DivisionId): string {
  const profile = DIVISION_PROFILES[divisionId];
  const verbalOnly = TRAINING_POLICY.simulationInteractionMode === 'verbal_only';
  return [
    `You design ${verbalOnly ? 'Verbal Practice role-play scenarios' : 'Live Call Simulations'} for LogiCall Pulse, a training platform for ${divisionLabel(divisionId)} call-center agents (${profile.traineeDescription}).`,
    verbalOnly
      ? 'Agents practice strictly through verbal dialogue (no simulated dialer buttons, CRM tabs, or external tools). Every rubric rule must grade spoken Playbook knowledge, disclosures, empathy, and objection handling.'
      : '',
    `The simulated counterparty is ${profile.counterparty}. Use "${profile.counterpartyRoleLabel}" (or a close variant) as "counterpartyRoleLabel".`,
    'Each scenario has a PUBLIC part (shown to the agent) and a SECRET part (persona and grading rubric, never shown to the agent).',
    '',
    'GROUNDING RULES:',
    GROUNDING_RULE,
    'Every rubric "evaluationRule" must state the exact rule from the SOURCE PAGES that the agent must follow, so a judge can grade the transcript without the Playbook.',
    CITATION_RULE,
    EXACT_EVIDENCE_RULE,
    LANGUAGE_RULE,
    '',
    'PUBLIC PART ("publicScenario"):',
    '- "title" at most 80 characters. "difficulty": STANDARD, EDGE_CASE, or HIGH_PRESSURE. Use a different difficulty for each scenario when you write more than one.',
    '- "contextTicketSummary" at most 280 characters: queue, campaign, channel, and the reason for the contact, as a call ticket. Do not reveal the hidden facts.',
    '- "openingMessage" at most 350 characters: the first thing the caller says, in character.',
    `- "dispositionOptions": 3 to 6 call dispositions chosen ONLY from this exact list: ${SIM_CANONICAL_DISPOSITIONS.join(' | ')}. Exactly one is correct. Do not invent other dispositions.`,
    '- "callSetup" (optional): {"direction": outbound|inbound|callback, "queue": recovery|customer_support|medical_chat|renewals, "contactState": lead|existing_patient|third_party|voicemail, "pricingPosture": active|passive|not_applicable, "product": short product name}.',
    `- "maxTurns" 6 to 12 (usually 8). "passScoreThreshold" 60 to 95 (usually ${DEFAULT_SIM_PASS_THRESHOLD}).`,
    '',
    'SECRET PART ("secretConfig"):',
    '- "personaName": a synthetic first and last name. "personaBackstoryAndMood" at most 400 characters.',
    '- "accountOnFile": 2 to 4 short lines the agent\'s screen shows for this caller, for example "Name: Taylor Bennett", "DOB: 1984-07-12", "ZIP: 60611". Use synthetic values that MATCH the identity facts in hiddenFactsToRevealOnlyWhenAsked, so the agent can verify the caller. Never real people.',
    '- "hiddenFactsToRevealOnlyWhenAsked": facts the caller gives only when the agent asks (for example a synthetic order number, zip code, or the real reason for the call). Each at most 180 characters.',
    '- "conditionalBehaviors": how the caller reacts to what the agent does (for example "If the agent offers the first save offer, the caller refuses once."). Each at most 220 characters.',
    `- "expectedDisposition": the correct disposition, written exactly as one of "dispositionOptions" (one of ${SIM_CANONICAL_DISPOSITIONS.join(' | ')}).`,
    '- "autoFailTriggers": severe Playbook violations that fail the call at once. Each at most 180 characters.',
    '- "rubricCriteria": 3 to 6 criteria. Each has "competencyPillarId" (from the given ids), "criterionLabel" (at most 100 characters), "evaluationRule" (at most 300 characters), "weight" (integer 10 to 50), and "sourcePages". The weights of one scenario MUST add up to exactly 100.',
    '',
    'Return one JSON object that matches the schema. No markdown fences, no comments.',
  ].join('\n');
}

export interface SimPromptInput {
  trackTitle: string;
  campaignCode: string;
  divisionId: DivisionId;
  globalSummary: string;
  pillars: CompetencyPillar[];
  unitTitles: string[];
  pages: ExtractedPage[];
  sourceReview?: SourceReviewPromptContext;
  /** Citation frequency orders optional pages only; critical inputs are planned first. */
  preferredPageOrder: number[];
  /** Characters of SOURCE text for this call (local models pass localSourceCharBudget). Default SIM_SOURCE_CHAR_BUDGET. */
  sourceCharBudget?: number;
}

function simContext(input: SimPromptInput): string[] {
  const budget = input.sourceReview
    ? planSourceBudget({
        stage: 'simulations',
        pages: input.sourceReview.pages,
        rulePacks: input.sourceReview.rulePacks,
        assets: input.sourceReview.assets,
        preferredPageOrder: input.preferredPageOrder,
        charBudget: input.sourceCharBudget ?? SIM_SOURCE_CHAR_BUDGET,
      })
    : null;
  const legacyPages = budget ? [] : selectPagesWithinBudget(input.pages, input.preferredPageOrder, input.sourceCharBudget ?? SIM_SOURCE_CHAR_BUDGET);
  const allowedPages = budget ? budget.pages.map((page) => page.pageNumber) : input.pages.map((page) => page.pageNumber);
  return [
    `Track: ${input.trackTitle}${input.campaignCode ? ` (campaign ${input.campaignCode})` : ''}`,
    `Division: ${divisionLabel(input.divisionId)}`,
    '',
    'GLOBAL CAMPAIGN SUMMARY:',
    input.globalSummary || '(no summary)',
    '',
    'COMPETENCYPILLARS (use these ids in "competencyPillarId"):',
    describePillars(input.pillars),
    '',
    input.unitTitles.length > 0 ? `Units the agent completed before the Simulation: ${input.unitTitles.join('; ')}` : '',
    `Allowed sourcePages: ${describePageSet(allowedPages)}`,
    ...(input.sourceReview
      ? [
          '',
          'APPROVED SHARED RULES (inherit these exact rule IDs and statements):',
          formatSharedRulePacks(input.sourceReview.rulePacks),
          '',
          'APPROVED OPERATIONAL ASSETS (use these exact values in their declared context):',
          formatApprovedAssets(input.sourceReview.assets),
        ]
      : []),
    '',
    budget ? formatBudgetedSourcePages(budget.pages) : formatSourcePages(legacyPages),
  ];
}

export function buildSimUserPrompt(input: SimPromptInput & { scenarioCount?: number }): string {
  const count = Math.min(MAX_SIM_SCENARIOS, Math.max(MIN_SIM_SCENARIOS, input.scenarioCount ?? MAX_SIM_SCENARIOS));
  return [
    ...simContext(input),
    '',
    `Make ${count} ${TRAINING_POLICY.simulationInteractionMode === 'verbal_only' ? 'Verbal Practice scenarios' : 'Live Call Simulation scenarios'} now. Each scenario tests a different high-risk situation from the Playbook (for example a refund or save-offer path, an escalation, and a compliance boundary).`,
  ].join('\n');
}

/** One scenario per call (local providers): a smaller answer a 7B model can finish reliably. */
export function buildOneScenarioUserPrompt(
  input: SimPromptInput & { index: number; count: number; otherScenarioTitles: string[] },
): string {
  const situations = ['a refund or save-offer path', 'an escalation', 'a compliance boundary'];
  const label =
    TRAINING_POLICY.simulationInteractionMode === 'verbal_only'
      ? 'Verbal Practice scenario'
      : 'Live Call Simulation scenario';
  return [
    ...simContext(input),
    '',
    `TASK: Write ${label} ${input.index + 1} of ${input.count}. It tests ${situations[input.index % situations.length]} from the Playbook.`,
    input.otherScenarioTitles.length > 0 ? `Other scenarios (test a different situation): ${input.otherScenarioTitles.join('; ')}` : '',
    'Every rubric criterion needs "evidence": one claim with an excerpt copied word for word from a SOURCE PAGE.',
    'Return the JSON object with "publicScenario" and "secretConfig" only.',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

export function buildRegenerateScenarioUserPrompt(
  input: SimPromptInput & { current: PublicSimScenario; otherScenarioTitles: string[]; trainerHint?: string },
): string {
  const label =
    TRAINING_POLICY.simulationInteractionMode === 'verbal_only'
      ? 'Verbal Practice scenario'
      : 'Live Call Simulation scenario';
  return [
    ...simContext(input),
    '',
    `TASK: Write ONE new ${label} (public part and secret part) that replaces the current scenario below. Keep the same situation type unless the trainer instruction says otherwise.`,
    `Current scenario: ${JSON.stringify({ title: input.current.title, difficulty: input.current.difficulty, contextTicketSummary: input.current.contextTicketSummary })}`,
    input.otherScenarioTitles.length > 0 ? `Other scenarios (do not repeat them): ${input.otherScenarioTitles.join('; ')}` : '',
    input.trainerHint ? `Trainer instruction: ${input.trainerHint}` : '',
    'Return the JSON object with "publicScenario" and "secretConfig" only.',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

// ---------- Deterministic post-processing ----------

/** Fixed synthetic clock inside every lead-local calling window used by generated scenarios. */
export const GENERATED_SCENARIO_SYNTHETIC_NOW = '2026-01-15T17:00:00.000Z';
export const GENERATED_SCENARIO_TIMEZONE = 'America/Chicago';

function defaultDirection(divisionId: DivisionId | undefined): ScenarioContext['direction'] {
  return divisionId === 'INBOUND' ? 'inbound' : 'outbound';
}

/** Deterministic context + evidence checklist so every generated scenario is runnable and its expected disposition is reachable. */
export function generatedScenarioRuntime(input: {
  expectedDisposition: SimCanonicalDisposition;
  callSetup?: ParsedScenarioGeneration['publicScenario']['callSetup'];
  defaults?: SimBuildContext['scenarioDefaults'];
  divisionId?: DivisionId;
}): { context: ScenarioContext; evidenceRequirements: ScenarioEvidenceRequirements } {
  const setup = input.callSetup ?? {};
  const defaults = input.defaults ?? {};
  const divisionId = defaults.divisionId ?? input.divisionId;
  const queue = setup.queue ?? (divisionId === 'TELEHEALTH' ? 'customer_support' : 'recovery');
  const direction = setup.direction ?? defaultDirection(divisionId);
  const contactState = input.expectedDisposition === "Didn't reply" ? 'voicemail' : setup.contactState ?? (queue === 'recovery' ? 'lead' : 'existing_patient');
  const caseBranch = input.expectedDisposition === 'Lost' ? 'generated_expired' : `generated_${input.expectedDisposition.toLowerCase().replace(/[^a-z]+/g, '_')}`;
  const stage: ScenarioContext['stage'] =
    queue === 'renewals' ? 'renewal_declined' : queue === 'medical_chat' ? 'pending_info' : queue === 'customer_support' ? 'support_case' : 'checkout';
  const product = clampText((setup.product?.trim() || defaults.product?.trim() || 'Synthetic training product'), 60);
  const context = ScenarioContextSchema.parse({
    direction,
    queue,
    product,
    stage,
    contactState,
    pricingPosture: setup.pricingPosture ?? 'not_applicable',
    caseBranch,
    syntheticTimezone: GENERATED_SCENARIO_TIMEZONE,
    syntheticNow: GENERATED_SCENARIO_SYNTHETIC_NOW,
    sourceRevision: defaults.sourceRevision?.trim() || 'generated-draft',
    curriculumVersion: defaults.curriculumVersion?.trim() || 'draft',
  });
  // Outbound dials require a local-time check; Recovered (outside renewals/medical chat) needs the recovery action.
  const requiredWorkflowActions =
    input.expectedDisposition === 'Recovered' && queue !== 'renewals' && queue !== 'medical_chat' ? ['recovery_confirmed'] : [];
  const evidenceRequirements = ScenarioEvidenceRequirementsSchema.parse({
    minimumLearnerTurns: input.expectedDisposition === "Didn't reply" || input.expectedDisposition === 'Organic' ? 0 : 2,
    requiredInspections: direction === 'inbound' ? [] : ['local_time'],
    requiredWorkflowActions,
    requiredWrapUpEvidence: [],
    requiredGateIds: [],
    requiredCustomerConcerns: [],
    expectedDurationMinutes: null,
    gateSourceRefs: {},
    maximumCriticalFailures: 0,
    maximumMajorFailures: 0,
  });
  return { context, evidenceRequirements };
}

function cleanTextList(items: string[], max: number, limit: number): string[] {
  return items.map((item) => clampText(item, max)).filter(Boolean).slice(0, limit);
}

/**
 * Final public + secret pair with a stable id (`s1`), matching scenarioId, rubric ids `s1-r1`, trimmed lengths,
 * canonical dispositions, and a deterministic context + evidence checklist.
 */
export function finalizeScenario(input: ScenarioGeneration, id: string, ctx: SimBuildContext, divisionId?: DivisionId): SimScenarioPair {
  const generated: ParsedScenarioGeneration = ScenarioGenerationSchema.parse(input);
  const allowed = new Set(ctx.allowedPages);
  const pub = generated.publicScenario;
  const expectedDisposition = toCanonicalDisposition(generated.secretConfig.expectedDisposition) ?? 'Not interested';
  const canonicalOptions = [
    ...new Set([expectedDisposition, ...pub.dispositionOptions.map(toCanonicalDisposition).filter((o): o is SimCanonicalDisposition => o !== null)]),
  ];
  for (const fallback of SIM_CANONICAL_DISPOSITIONS) {
    if (canonicalOptions.length >= 3) break;
    if (!canonicalOptions.includes(fallback)) canonicalOptions.push(fallback);
  }
  // Keep the canonical display order so the correct answer is not always first.
  const dispositionOptions = SIM_CANONICAL_DISPOSITIONS.filter((option) => canonicalOptions.slice(0, 6).includes(option));
  const runtime = generatedScenarioRuntime({ expectedDisposition, callSetup: pub.callSetup, defaults: ctx.scenarioDefaults, divisionId });
  const publicScenario = PublicSimScenarioSchema.parse({
    id,
    title: clampText(pub.title, 80),
    difficulty: pub.difficulty,
    counterpartyRoleLabel: clampText(pub.counterpartyRoleLabel, 60),
    contextTicketSummary: clampText(pub.contextTicketSummary, 280),
    ...(pub.accountOnFile && pub.accountOnFile.length > 0 ? { accountOnFile: cleanTextList(pub.accountOnFile, 100, 6) } : {}),
    openingMessage: clampText(pub.openingMessage, 350),
    dispositionOptions,
    maxTurns: Math.min(12, Math.max(6, Math.round(Number.isFinite(pub.maxTurns) ? pub.maxTurns : 8))),
    passScoreThreshold: Math.min(95, Math.max(60, Math.round(Number.isFinite(pub.passScoreThreshold) ? pub.passScoreThreshold : DEFAULT_SIM_PASS_THRESHOLD))),
    context: runtime.context,
    evidenceRequirements: runtime.evidenceRequirements,
  });
  const secret = generated.secretConfig;
  const rubricCriteria = secret.rubricCriteria.slice(0, 6).map((criterion, index) => {
    const criterionId = `${id}-r${index + 1}`;
    return {
      id: criterionId,
      competencyPillarId: ctx.pillarIds.includes(criterion.competencyPillarId) ? criterion.competencyPillarId : ctx.pillarIds[0],
      criterionLabel: clampText(criterion.criterionLabel, 100),
      evaluationRule: clampText(criterion.evaluationRule, 300),
      weight: criterion.weight,
      sourcePages: sanitizePages(criterion.sourcePages, allowed, ctx.allowedPages.slice(0, 1)),
      ...(criterion.evidence ? { evidence: finalizeEvidenceProposals(criterion.evidence, criterionId) } : {}),
    };
  });
  const secretConfig = SecretSimScenarioConfigSchema.parse({
    scenarioId: id,
    personaName: clampText(secret.personaName, 60),
    personaBackstoryAndMood: clampText(secret.personaBackstoryAndMood, 400),
    hiddenFactsToRevealOnlyWhenAsked: cleanTextList(secret.hiddenFactsToRevealOnlyWhenAsked, 180, 8),
    conditionalBehaviors: cleanTextList(secret.conditionalBehaviors, 220, 8),
    expectedDisposition,
    autoFailTriggers: cleanTextList(secret.autoFailTriggers, 180, 6),
    rubricCriteria,
  });
  return { publicScenario, secretConfig };
}

export function finalizeScenarios(generated: SimGeneration, ctx: SimBuildContext, divisionId?: DivisionId): SimScenarioPair[] {
  return generated.scenarios.slice(0, MAX_SIM_SCENARIOS).map((scenario, index) => finalizeScenario(scenario, `s${index + 1}`, ctx, divisionId));
}

/**
 * Rubric weights that add up to exactly 100 with each weight in 10-50, keeping the model's relative
 * importance. Null when the criterion count cannot reach 100 inside those bounds.
 */
export function normalizeRubricWeights(weights: readonly number[]): number[] | null {
  const count = weights.length;
  if (count === 0 || count * 10 > 100 || count * 50 < 100) return null;
  const clean = weights.map((weight) => (Number.isFinite(weight) && weight > 0 ? weight : 10));
  const total = clean.reduce((sum, weight) => sum + weight, 0);
  const scaled = clean.map((weight) => Math.min(50, Math.max(10, Math.round((weight / total) * 100))));
  let diff = 100 - scaled.reduce((sum, weight) => sum + weight, 0);
  const order = scaled.map((_, index) => index).sort((left, right) => clean[right] - clean[left]);
  for (let guard = 0; diff !== 0 && guard < 200; guard++) {
    const step = diff > 0 ? 1 : -1;
    const at = order.find((index) => scaled[index] + step >= 10 && scaled[index] + step <= 50);
    if (at === undefined) return null;
    scaled[at] += step;
    diff -= step;
  }
  return diff === 0 ? scaled : null;
}

function coerceScenarioWeights(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const scenario = value as { secretConfig?: { rubricCriteria?: unknown } };
  const criteria = scenario.secretConfig?.rubricCriteria;
  if (!Array.isArray(criteria)) return value;
  const kept = criteria.slice(0, 6);
  const weights = kept.map((criterion) => Number((criterion as { weight?: unknown } | null)?.weight));
  const normalized = normalizeRubricWeights(weights);
  if (!normalized) return value;
  return {
    ...(value as object),
    secretConfig: {
      ...scenario.secretConfig,
      rubricCriteria: kept.map((criterion, index) => ({ ...(criterion as object), weight: normalized[index] })),
    },
  };
}

function rawScenarios(raw: string): unknown[] | null {
  const parsed = parseStructuredOutput(raw, z.unknown());
  if (!parsed.ok) return null;
  const value = parsed.data;
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.scenarios)) return record.scenarios;
    if (record.publicScenario && record.secretConfig) return [record];
  }
  return null;
}

/**
 * Salvage a Sim answer whose repair loop failed: validate each scenario on its own and keep the
 * valid ones. Rubric weights are rescaled to 100 (relative importance kept); missing or unmatched
 * evidence is NOT a reason to drop: the pipeline grounds it server-side or flags it for review.
 */
export function salvageScenarios(
  raw: string,
  ctx: SimBuildContext,
  idFor: (index: number) => string,
  divisionId?: DivisionId,
  limit = MAX_SIM_SCENARIOS,
): { items: SimScenarioPair[]; dropped: string[] } {
  const items = rawScenarios(raw);
  if (!items) return { items: [], dropped: ['The answer was not readable JSON.'] };
  const lenient: SimBuildContext = { ...ctx, requireEvidence: false };
  const pairs: SimScenarioPair[] = [];
  const dropped: string[] = [];
  items.forEach((item, index) => {
    if (pairs.length >= limit) return;
    const parsed = ScenarioGenerationSchema.safeParse(coerceScenarioWeights(item));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      dropped.push(`scenarios.${index}${issue?.path.length ? `.${issue.path.join('.')}` : ''}: ${issue?.message ?? 'invalid'}`);
      return;
    }
    const problems: string[] = [];
    checkScenario(parsed.data, lenient, [], (path, message) => problems.push(`${path.join('.') || 'scenario'}: ${message}`));
    if (problems.length > 0) {
      dropped.push(`scenarios.${index}.${problems[0]}`);
      return;
    }
    try {
      pairs.push(finalizeScenario(parsed.data, idFor(pairs.length), ctx, divisionId));
    } catch (error) {
      dropped.push(`scenarios.${index}: ${error instanceof Error ? error.message.slice(0, 160) : 'failed final checks'}`);
    }
  });
  return { items: pairs, dropped };
}

/** Rubric weights must sum to 100 for every secret config (used by PATCH validation). */
export function rubricWeightProblems(configs: SecretSimScenarioConfig[]): string[] {
  return configs
    .map((config) => ({ id: config.scenarioId, total: config.rubricCriteria.reduce((sum, criterion) => sum + criterion.weight, 0) }))
    .filter((entry) => entry.total !== 100)
    .map((entry) => `Scenario ${entry.id}: rubric weights add up to ${entry.total}, not 100.`);
}
