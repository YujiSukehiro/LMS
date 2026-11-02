/**
 * Pass 3 (Sim Builder): 2-3 Live Call Simulation scenarios. Each scenario is a learner-safe
 * PublicSimScenario plus a server-only SecretSimScenarioConfig (persona, hidden facts, rubric).
 * Also holds the single-scenario regeneration prompt.
 */
import { z } from 'zod';
import {
  PublicSimScenarioSchema,
  RubricCriterionSchema,
  SecretSimScenarioConfigSchema,
  type CompetencyPillar,
  type PublicSimScenario,
  type SecretSimScenarioConfig,
} from '@/lib/schemas/curriculum';
import type { DivisionId } from '@/lib/schemas/domain';
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
}

export interface SimScenarioPair {
  publicScenario: PublicSimScenario;
  secretConfig: SecretSimScenarioConfig;
}

const citedPages = z.array(z.number().int().positive()).min(1).max(10);

const RubricGenerationSchema = RubricCriterionSchema.omit({ id: true }).extend({
  sourcePages: citedPages,
  evidence: z.array(ClaimEvidenceProposalSchema).min(1).max(12).optional(),
});

const ScenarioGenerationSchema = z.object({
  publicScenario: PublicSimScenarioSchema.omit({ id: true }).extend({
    maxTurns: z.number().int().min(6).max(12),
    passScoreThreshold: z.number().int().min(60).max(95),
  }),
  secretConfig: SecretSimScenarioConfigSchema.omit({ scenarioId: true, rubricCriteria: true }).extend({
    personaName: z.string().min(2).max(60),
    hiddenFactsToRevealOnlyWhenAsked: z.array(z.string().max(180)).min(1).max(8),
    conditionalBehaviors: z.array(z.string().max(220)).min(1).max(8),
    expectedDisposition: z.string().max(80),
    autoFailTriggers: z.array(z.string().max(180)).min(1).max(6),
    rubricCriteria: z.array(RubricGenerationSchema).min(3).max(6),
  }),
});
export type ScenarioGeneration = z.infer<typeof ScenarioGenerationSchema>;

type IssueSink = (path: (string | number)[], message: string) => void;

function checkScenario(scenario: ScenarioGeneration, ctx: SimBuildContext, path: (string | number)[], report: IssueSink): void {
  const allowed = new Set(ctx.allowedPages);
  const options = scenario.publicScenario.dispositionOptions.map((option) => option.trim().toLowerCase());
  if (new Set(options).size !== options.length) {
    report([...path, 'publicScenario', 'dispositionOptions'], 'Each disposition option must be different.');
  }
  if (!options.includes(scenario.secretConfig.expectedDisposition.trim().toLowerCase())) {
    report(
      [...path, 'secretConfig', 'expectedDisposition'],
      `"expectedDisposition" must be exactly one of "dispositionOptions": ${scenario.publicScenario.dispositionOptions.join(' | ')}.`,
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
  return [
    `You design Live Call Simulations for LogiCall Pulse, a training platform for ${divisionLabel(divisionId)} call-center agents (${profile.traineeDescription}).`,
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
    '- "dispositionOptions": 3 to 6 call dispositions (each at most 80 characters) that the Playbook uses or implies. Exactly one is correct.',
    `- "maxTurns" 6 to 12 (usually 8). "passScoreThreshold" 60 to 95 (usually ${DEFAULT_SIM_PASS_THRESHOLD}).`,
    '',
    'SECRET PART ("secretConfig"):',
    '- "personaName": a synthetic first and last name. "personaBackstoryAndMood" at most 400 characters.',
    '- "hiddenFactsToRevealOnlyWhenAsked": facts the caller gives only when the agent asks (for example a synthetic order number, zip code, or the real reason for the call). Each at most 180 characters.',
    '- "conditionalBehaviors": how the caller reacts to what the agent does (for example "If the agent offers the first save offer, the caller refuses once."). Each at most 220 characters.',
    '- "expectedDisposition": the correct disposition, written exactly as one of "dispositionOptions".',
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
}

function simContext(input: SimPromptInput): string[] {
  const budget = input.sourceReview
    ? planSourceBudget({
        stage: 'simulations',
        pages: input.sourceReview.pages,
        rulePacks: input.sourceReview.rulePacks,
        assets: input.sourceReview.assets,
        preferredPageOrder: input.preferredPageOrder,
        charBudget: SIM_SOURCE_CHAR_BUDGET,
      })
    : null;
  const legacyPages = budget ? [] : selectPagesWithinBudget(input.pages, input.preferredPageOrder, SIM_SOURCE_CHAR_BUDGET);
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
    `Make ${count} Live Call Simulation scenarios now. Each scenario tests a different high-risk situation from the Playbook (for example a refund or save-offer path, an escalation, and a compliance boundary).`,
  ].join('\n');
}

export function buildRegenerateScenarioUserPrompt(
  input: SimPromptInput & { current: PublicSimScenario; otherScenarioTitles: string[]; trainerHint?: string },
): string {
  return [
    ...simContext(input),
    '',
    'TASK: Write ONE new Live Call Simulation scenario (public part and secret part) that replaces the current scenario below. Keep the same situation type unless the trainer instruction says otherwise.',
    `Current scenario: ${JSON.stringify({ title: input.current.title, difficulty: input.current.difficulty, contextTicketSummary: input.current.contextTicketSummary })}`,
    input.otherScenarioTitles.length > 0 ? `Other scenarios (do not repeat them): ${input.otherScenarioTitles.join('; ')}` : '',
    input.trainerHint ? `Trainer instruction: ${input.trainerHint}` : '',
    'Return the JSON object with "publicScenario" and "secretConfig" only.',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

// ---------- Deterministic post-processing ----------

/** Final public + secret pair with a stable id (`s1`), matching scenarioId, rubric ids `s1-r1`, clamped lengths. */
export function finalizeScenario(generated: ScenarioGeneration, id: string, ctx: SimBuildContext): SimScenarioPair {
  const allowed = new Set(ctx.allowedPages);
  const pub = generated.publicScenario;
  const dispositionOptions = pub.dispositionOptions.slice(0, 6).map((option) => clampText(option, 80));
  const expectedIndex = pub.dispositionOptions.findIndex(
    (option) => option.trim().toLowerCase() === generated.secretConfig.expectedDisposition.trim().toLowerCase(),
  );
  const publicScenario = PublicSimScenarioSchema.parse({
    id,
    title: clampText(pub.title, 80),
    difficulty: pub.difficulty,
    counterpartyRoleLabel: clampText(pub.counterpartyRoleLabel, 60),
    contextTicketSummary: clampText(pub.contextTicketSummary, 280),
    openingMessage: clampText(pub.openingMessage, 350),
    dispositionOptions,
    maxTurns: Math.min(12, Math.max(6, Math.round(pub.maxTurns))),
    passScoreThreshold: Math.min(95, Math.max(60, Math.round(pub.passScoreThreshold))),
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
    hiddenFactsToRevealOnlyWhenAsked: secret.hiddenFactsToRevealOnlyWhenAsked.map((fact) => clampText(fact, 180)),
    conditionalBehaviors: secret.conditionalBehaviors.map((behavior) => clampText(behavior, 220)),
    expectedDisposition: dispositionOptions[expectedIndex >= 0 ? expectedIndex : 0],
    autoFailTriggers: secret.autoFailTriggers.map((trigger) => clampText(trigger, 180)),
    rubricCriteria,
  });
  return { publicScenario, secretConfig };
}

export function finalizeScenarios(generated: SimGeneration, ctx: SimBuildContext): SimScenarioPair[] {
  return generated.scenarios.slice(0, MAX_SIM_SCENARIOS).map((scenario, index) => finalizeScenario(scenario, `s${index + 1}`, ctx));
}

/** Rubric weights must sum to 100 for every secret config (used by PATCH validation). */
export function rubricWeightProblems(configs: SecretSimScenarioConfig[]): string[] {
  return configs
    .map((config) => ({ id: config.scenarioId, total: config.rubricCriteria.reduce((sum, criterion) => sum + criterion.weight, 0) }))
    .filter((entry) => entry.total !== 100)
    .map((entry) => `Scenario ${entry.id}: rubric weights add up to ${entry.total}, not 100.`);
}
