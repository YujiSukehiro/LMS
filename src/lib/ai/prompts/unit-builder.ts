/**
 * Pass 2 (Unit Builder): one Unit outline + only its SOURCE PAGES + global summary
 * -> 3-5 BriefingCards and 5-7 Drills (at least 4 distinct Drill kinds).
 * Also holds the single-item regeneration prompts for one BriefingCard or one Drill.
 */
import { z } from 'zod';
import {
  BriefingCardSchema,
  DRILL_KINDS,
  FILL_BLANK_TOKEN,
  FillBlankChoiceDrillSchema,
  MatchPairsDrillSchema,
  MultipleChoiceDrillSchema,
  SequenceOrderDrillSchema,
  TrackUnitSchema,
  TrueFalseSpotDrillSchema,
  type BriefingCard,
  type CompetencyPillar,
  type DrillItem,
  type DrillKind,
  type TrackUnit,
} from '@/lib/schemas/curriculum';
import type { DivisionId } from '@/lib/schemas/domain';
import { formatSourcePages, type ExtractedPage } from '@/lib/ai/pdf-extractor';
import type { UnitOutline } from '@/lib/ai/prompts/blueprint';
import {
  CITATION_RULE,
  DIVISION_PROFILES,
  GROUNDING_RULE,
  LANGUAGE_RULE,
  clampMultiline,
  clampText,
  describePageSet,
  describePillars,
  divisionLabel,
  fitPagesToBudget,
  invalidPages,
  sanitizePages,
} from '@/lib/ai/pipeline/shared';

export const UNIT_SCHEMA_NAME = 'TrackUnitContent';
export const BRIEFING_CARD_SCHEMA_NAME = 'BriefingCard';
export const DRILL_SCHEMA_NAME = 'Drill';
export const MIN_BRIEFING_CARDS = 3;
export const MAX_BRIEFING_CARDS = 5;
export const MIN_DRILLS = 5;
export const MAX_DRILLS = 7;
export const MIN_DISTINCT_DRILL_KINDS = 4;
/** Character budget for verbatim SOURCE PAGE text in one Unit Builder prompt (fits num_ctx 16384 with output room). */
export const UNIT_SOURCE_CHAR_BUDGET = 32000;

export interface UnitBuildContext {
  /** CompetencyPillar ids the Drills may reference. */
  pillarIds: string[];
  /** Page numbers the items may cite. */
  allowedPages: number[];
}

const citedPages = z.array(z.number().int().positive()).min(1).max(10);

const CardGenerationSchema = BriefingCardSchema.omit({ id: true }).extend({ sourcePages: citedPages });

const MultipleChoiceGenerationSchema = MultipleChoiceDrillSchema.omit({ id: true }).extend({ sourcePages: citedPages });
const TrueFalseGenerationSchema = TrueFalseSpotDrillSchema.omit({ id: true }).extend({ sourcePages: citedPages });
const SequenceGenerationSchema = SequenceOrderDrillSchema.omit({ id: true, orderedSteps: true }).extend({
  sourcePages: citedPages,
  orderedSteps: z
    .array(z.object({ text: z.string().max(140) }))
    .min(3)
    .max(5)
    .describe('Steps in the CORRECT order'),
});
const MatchPairsGenerationSchema = MatchPairsDrillSchema.omit({ id: true, pairs: true }).extend({
  sourcePages: citedPages,
  pairs: z
    .array(z.object({ leftPrompt: z.string().max(100), rightMatch: z.string().max(100) }))
    .min(3)
    .max(4),
});
const FillBlankGenerationSchema = FillBlankChoiceDrillSchema.omit({ id: true }).extend({ sourcePages: citedPages });

const DrillGenerationSchema = z.discriminatedUnion('kind', [
  MultipleChoiceGenerationSchema,
  TrueFalseGenerationSchema,
  SequenceGenerationSchema,
  MatchPairsGenerationSchema,
  FillBlankGenerationSchema,
]);

export type CardGeneration = z.infer<typeof CardGenerationSchema>;
export type DrillGeneration = z.infer<typeof DrillGenerationSchema>;

const DRILL_GENERATION_SCHEMAS = {
  MULTIPLE_CHOICE: MultipleChoiceGenerationSchema,
  TRUE_FALSE_SPOT: TrueFalseGenerationSchema,
  SEQUENCE_ORDER: SequenceGenerationSchema,
  MATCH_PAIRS: MatchPairsGenerationSchema,
  FILL_BLANK_CHOICE: FillBlankGenerationSchema,
} as const;

type IssueSink = (path: (string | number)[], message: string) => void;

function checkPages(pages: number[], allowed: Set<number>, path: (string | number)[], report: IssueSink): void {
  const outside = invalidPages(pages, allowed);
  if (outside.length > 0) {
    report(path, `Pages ${outside.join(', ')} are not in the provided SOURCE PAGES (${describePageSet([...allowed])}).`);
  }
}

function checkDrill(drill: DrillGeneration, ctx: UnitBuildContext, path: (string | number)[], report: IssueSink): void {
  const allowed = new Set(ctx.allowedPages);
  if (!ctx.pillarIds.includes(drill.competencyPillarId)) {
    report([...path, 'competencyPillarId'], `Use one of these CompetencyPillar ids: ${ctx.pillarIds.join(', ')}.`);
  }
  checkPages(drill.sourcePages, allowed, [...path, 'sourcePages'], report);
  switch (drill.kind) {
    case 'MULTIPLE_CHOICE': {
      const ids = drill.options.map((option) => option.id);
      if (new Set(ids).size !== ids.length) report([...path, 'options'], 'Each option needs a different "id".');
      if (!ids.includes(drill.correctOptionId)) {
        report([...path, 'correctOptionId'], `"correctOptionId" must be one of the option ids: ${ids.join(', ')}.`);
      }
      const texts = drill.options.map((option) => option.text.trim().toLowerCase());
      if (new Set(texts).size !== texts.length) report([...path, 'options'], 'Each option needs different text.');
      break;
    }
    case 'FILL_BLANK_CHOICE': {
      const occurrences = drill.sentenceTemplate.split(FILL_BLANK_TOKEN).length - 1;
      if (occurrences !== 1) {
        report([...path, 'sentenceTemplate'], `"sentenceTemplate" must contain the token ${FILL_BLANK_TOKEN} exactly once.`);
      }
      const bank = drill.wordBank.map((word) => word.trim().toLowerCase());
      if (new Set(bank).size !== bank.length) report([...path, 'wordBank'], 'The 4 words in "wordBank" must be different.');
      if (!bank.includes(drill.correctWord.trim().toLowerCase())) {
        report([...path, 'correctWord'], '"correctWord" must be one of the 4 words in "wordBank".');
      }
      break;
    }
    case 'SEQUENCE_ORDER': {
      const steps = drill.orderedSteps.map((step) => step.text.trim().toLowerCase());
      if (new Set(steps).size !== steps.length) report([...path, 'orderedSteps'], 'Each step needs different text.');
      break;
    }
    case 'MATCH_PAIRS': {
      const lefts = drill.pairs.map((pair) => pair.leftPrompt.trim().toLowerCase());
      const rights = drill.pairs.map((pair) => pair.rightMatch.trim().toLowerCase());
      if (new Set(lefts).size !== lefts.length || new Set(rights).size !== rights.length) {
        report([...path, 'pairs'], 'Each "leftPrompt" and each "rightMatch" must be different.');
      }
      break;
    }
    case 'TRUE_FALSE_SPOT':
      break;
  }
}

/** Zod output schema for one full Unit (Pass 2). */
export function buildUnitGenerationSchema(ctx: UnitBuildContext) {
  return z
    .object({
      briefingCards: z.array(CardGenerationSchema).min(MIN_BRIEFING_CARDS).max(MAX_BRIEFING_CARDS),
      drills: z.array(DrillGenerationSchema).min(MIN_DRILLS).max(MAX_DRILLS),
    })
    .superRefine((value, zctx) => {
      const report: IssueSink = (path, message) => zctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
      const allowed = new Set(ctx.allowedPages);
      value.briefingCards.forEach((card, index) => checkPages(card.sourcePages, allowed, ['briefingCards', index, 'sourcePages'], report));
      value.drills.forEach((drill, index) => checkDrill(drill, ctx, ['drills', index], report));
      const kinds = new Set(value.drills.map((drill) => drill.kind));
      if (kinds.size < MIN_DISTINCT_DRILL_KINDS) {
        const missing = DRILL_KINDS.filter((kind) => !kinds.has(kind));
        report(
          ['drills'],
          `Use at least ${MIN_DISTINCT_DRILL_KINDS} different Drill kinds. You used ${kinds.size} (${[...kinds].join(', ')}). Add Drills of these kinds: ${missing.join(', ')}.`,
        );
      }
    });
}

export type UnitGeneration = z.infer<ReturnType<typeof buildUnitGenerationSchema>>;

/** Zod output schema for regenerating one BriefingCard. */
export function buildCardGenerationSchema(ctx: Pick<UnitBuildContext, 'allowedPages'>) {
  return CardGenerationSchema.superRefine((card, zctx) => {
    checkPages(card.sourcePages, new Set(ctx.allowedPages), ['sourcePages'], (path, message) =>
      zctx.addIssue({ code: z.ZodIssueCode.custom, path, message }),
    );
  });
}

/** Zod output schema for regenerating one Drill of a fixed kind. */
export function buildDrillGenerationSchema(kind: DrillKind, ctx: UnitBuildContext) {
  const base: z.ZodType<DrillGeneration> = DRILL_GENERATION_SCHEMAS[kind];
  return base.superRefine((drill, zctx) => {
    checkDrill(drill, ctx, [], (path, message) => zctx.addIssue({ code: z.ZodIssueCode.custom, path, message }));
  });
}

const DRILL_KIND_GUIDE = [
  `MULTIPLE_CHOICE: "prompt" is a realistic call situation or a rule check. "options" has exactly 4 objects {"id","text"} with ids "a","b","c","d". "correctOptionId" is the id of the one correct option. Wrong options must be plausible mistakes an agent could make.`,
  'TRUE_FALSE_SPOT: "statement" describes what an agent said or did on a call. "isCompliant" is true when it follows the Playbook and false when it breaks the Playbook. "prompt" asks the agent to decide.',
  'SEQUENCE_ORDER: "orderedSteps" has 3 to 5 steps {"text"} in the CORRECT order from the Playbook. "prompt" asks the agent to put the steps in order.',
  'MATCH_PAIRS: "pairs" has 3 or 4 objects {"leftPrompt","rightMatch"} (for example a caller situation and the required action). Every right side matches only one left side.',
  `FILL_BLANK_CHOICE: "sentenceTemplate" is a Playbook rule with the token ${FILL_BLANK_TOKEN} exactly once where the key word goes. "wordBank" has exactly 4 different words or short phrases. "correctWord" is one of them, written exactly the same.`,
].join('\n');

const LENGTH_LIMITS = [
  'BriefingCard: "headline" at most 90 characters; "bodyMarkdown" 2 to 4 sentences, at most 600 characters (simple markdown such as **bold** is allowed); "keyTakeaway" at most 160 characters; "doList" and "dontList" each 2 to 4 items of at most 140 characters.',
  'Drill: "prompt" at most 300 characters; "explanation" at most 350 characters and it must say WHY the answer is correct with the rule from the Playbook; option text at most 180; "statement" at most 260; step text at most 140; pair sides at most 100; "sentenceTemplate" at most 260; each word in "wordBank" at most 60.',
].join('\n');

export function buildUnitSystemPrompt(divisionId: DivisionId): string {
  const profile = DIVISION_PROFILES[divisionId];
  return [
    `You are the Unit author for LogiCall Pulse, a Duolingo-style training platform for ${divisionLabel(divisionId)} call-center agents (${profile.traineeDescription}).`,
    'You turn the rules in the provided SOURCE PAGES into short BriefingCards (learn) and Drills (test) for one Unit.',
    '',
    'GROUNDING RULES:',
    GROUNDING_RULE,
    'Teach only rules that the SOURCE PAGES state. Copy exact values (amounts, days, steps, required fields) from the pages. If a detail is not stated, do not use it.',
    CITATION_RULE,
    LANGUAGE_RULE,
    `Callers in Drills are ${profile.counterparty}. Use synthetic names and synthetic order numbers.`,
    '',
    'CONTENT RULES:',
    `- Write ${MIN_BRIEFING_CARDS} to ${MAX_BRIEFING_CARDS} BriefingCards. Each card teaches one operational rule.`,
    `- Write ${MIN_DRILLS} to ${MAX_DRILLS} Drills that test the rules on the BriefingCards.`,
    `- Use at least ${MIN_DISTINCT_DRILL_KINDS} DIFFERENT Drill kinds in the Unit. Available kinds: ${DRILL_KINDS.join(', ')}.`,
    '- Every Drill has "competencyPillarId" set to one of the CompetencyPillar ids given in the request.',
    '',
    'DRILL KINDS:',
    DRILL_KIND_GUIDE,
    '',
    'LENGTH LIMITS:',
    LENGTH_LIMITS,
    '',
    'Return one JSON object that matches the schema. No markdown fences, no comments.',
  ].join('\n');
}

export interface UnitPromptInput {
  trackTitle: string;
  campaignCode: string;
  divisionId: DivisionId;
  globalSummary: string;
  pillars: CompetencyPillar[];
  outline: UnitOutline;
  /** Only the SOURCE PAGES mapped to this Unit. */
  pages: ExtractedPage[];
  /** Titles of the other Units, to avoid overlap. */
  otherUnitTitles: string[];
}

function unitPillars(input: Pick<UnitPromptInput, 'pillars' | 'outline'>): CompetencyPillar[] {
  const preferred = input.pillars.filter((pillar) => input.outline.pillarIds.includes(pillar.id));
  return preferred.length > 0 ? preferred : input.pillars;
}

function contextBlock(input: Omit<UnitPromptInput, 'pages'> & { pages: ExtractedPage[] }): string[] {
  const pages = fitPagesToBudget(input.pages, UNIT_SOURCE_CHAR_BUDGET);
  return [
    `Track: ${input.trackTitle}${input.campaignCode ? ` (campaign ${input.campaignCode})` : ''}`,
    `Division: ${divisionLabel(input.divisionId)}`,
    '',
    'GLOBAL CAMPAIGN SUMMARY (context only; cite only the SOURCE PAGES below):',
    input.globalSummary || '(no summary)',
    '',
    'COMPETENCYPILLARS (use these ids in "competencyPillarId"):',
    describePillars(unitPillars(input)),
    '',
    `UNIT ${input.outline.orderIndex + 1}: ${input.outline.title}`,
    `Summary: ${input.outline.summary}`,
    `Focus: ${input.outline.focus}`,
    input.otherUnitTitles.length > 0 ? `Other Units (do not teach their rules here): ${input.otherUnitTitles.join('; ')}` : '',
    `Allowed sourcePages: ${describePageSet(pages.map((page) => page.pageNumber))}`,
    '',
    formatSourcePages(pages),
  ];
}

export function buildUnitUserPrompt(input: UnitPromptInput): string {
  return [...contextBlock(input), '', 'Make the BriefingCards and Drills JSON for this Unit now.'].join('\n');
}

export function buildRegenerateCardUserPrompt(input: UnitPromptInput & { current: BriefingCard; siblingHeadlines: string[]; trainerHint?: string }): string {
  return [
    ...contextBlock(input),
    '',
    'TASK: Write ONE new BriefingCard that replaces the current card below. Teach the same rule area, with better clarity and accuracy.',
    `Current card: ${JSON.stringify({ headline: input.current.headline, bodyMarkdown: input.current.bodyMarkdown, keyTakeaway: input.current.keyTakeaway })}`,
    input.siblingHeadlines.length > 0 ? `Other cards in this Unit (do not repeat them): ${input.siblingHeadlines.join('; ')}` : '',
    input.trainerHint ? `Trainer instruction: ${input.trainerHint}` : '',
    'Return the BriefingCard JSON object only.',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

export function buildRegenerateDrillUserPrompt(input: UnitPromptInput & { current: DrillItem; siblingPrompts: string[]; trainerHint?: string }): string {
  return [
    ...contextBlock(input),
    '',
    `TASK: Write ONE new Drill of kind ${input.current.kind} that replaces the current Drill below. Keep "kind": "${input.current.kind}". Test a rule from the SOURCE PAGES, with a clear correct answer.`,
    `Current Drill: ${JSON.stringify({ ...input.current, id: undefined })}`,
    input.siblingPrompts.length > 0 ? `Other Drills in this Unit (do not repeat them): ${input.siblingPrompts.join('; ')}` : '',
    input.trainerHint ? `Trainer instruction: ${input.trainerHint}` : '',
    'Return the Drill JSON object only.',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

// ---------- Deterministic post-processing ----------

/** Final BriefingCard with a stable id, clamped lengths, and valid pages. */
export function finalizeBriefingCard(card: CardGeneration, id: string, allowedPages: number[]): BriefingCard {
  const allowed = new Set(allowedPages);
  return BriefingCardSchema.parse({
    id,
    headline: clampText(card.headline, 90),
    bodyMarkdown: clampMultiline(card.bodyMarkdown, 600),
    keyTakeaway: clampText(card.keyTakeaway, 160),
    doList: card.doList.slice(0, 4).map((item) => clampText(item, 140)).filter(Boolean),
    dontList: card.dontList.slice(0, 4).map((item) => clampText(item, 140)).filter(Boolean),
    sourcePages: sanitizePages(card.sourcePages, allowed, allowedPages.slice(0, 1)),
  });
}

/** Final Drill with a stable id (sub-ids derived from it), clamped lengths, valid pillar and pages. */
export function finalizeDrill(drill: DrillGeneration, id: string, ctx: UnitBuildContext): DrillItem {
  const allowed = new Set(ctx.allowedPages);
  const base = {
    id,
    competencyPillarId: ctx.pillarIds.includes(drill.competencyPillarId) ? drill.competencyPillarId : ctx.pillarIds[0],
    prompt: clampText(drill.prompt, 300),
    explanation: clampText(drill.explanation, 350),
    sourcePages: sanitizePages(drill.sourcePages, allowed, ctx.allowedPages.slice(0, 1)),
  };
  switch (drill.kind) {
    case 'MULTIPLE_CHOICE': {
      const options = drill.options.map((option, index) => ({
        sourceId: option.id,
        id: `${id}-o${index + 1}`,
        text: clampText(option.text, 180),
      }));
      const correct = options.find((option) => option.sourceId === drill.correctOptionId) ?? options[0];
      return MultipleChoiceDrillSchema.parse({
        ...base,
        kind: 'MULTIPLE_CHOICE',
        options: options.map((option) => ({ id: option.id, text: option.text })),
        correctOptionId: correct.id,
      });
    }
    case 'TRUE_FALSE_SPOT':
      return TrueFalseSpotDrillSchema.parse({
        ...base,
        kind: 'TRUE_FALSE_SPOT',
        statement: clampText(drill.statement, 260),
        isCompliant: drill.isCompliant,
      });
    case 'SEQUENCE_ORDER':
      return SequenceOrderDrillSchema.parse({
        ...base,
        kind: 'SEQUENCE_ORDER',
        orderedSteps: drill.orderedSteps.map((step, index) => ({ id: `${id}-s${index + 1}`, text: clampText(step.text, 140) })),
      });
    case 'MATCH_PAIRS':
      return MatchPairsDrillSchema.parse({
        ...base,
        kind: 'MATCH_PAIRS',
        pairs: drill.pairs.map((pair, index) => ({
          id: `${id}-p${index + 1}`,
          leftPrompt: clampText(pair.leftPrompt, 100),
          rightMatch: clampText(pair.rightMatch, 100),
        })),
      });
    case 'FILL_BLANK_CHOICE': {
      const wordBank = drill.wordBank.map((word) => clampText(word, 60));
      const correctIndex = drill.wordBank.findIndex((word) => word.trim().toLowerCase() === drill.correctWord.trim().toLowerCase());
      const template = clampFillBlankTemplate(drill.sentenceTemplate);
      return FillBlankChoiceDrillSchema.parse({
        ...base,
        kind: 'FILL_BLANK_CHOICE',
        sentenceTemplate: template,
        wordBank,
        correctWord: wordBank[correctIndex >= 0 ? correctIndex : 0],
      });
    }
  }
}

/** Keep exactly one {{BLANK}} token and fit the template into 260 characters. */
export function clampFillBlankTemplate(raw: string): string {
  const max = 260;
  const text = raw.replace(/\s+/g, ' ').trim();
  const tokenAt = text.indexOf(FILL_BLANK_TOKEN);
  let before = tokenAt === -1 ? `${text} ` : text.slice(0, tokenAt);
  let after = tokenAt === -1 ? '' : text.slice(tokenAt + FILL_BLANK_TOKEN.length).split(FILL_BLANK_TOKEN).join('');
  if (before.length + FILL_BLANK_TOKEN.length + after.length <= max) return `${before}${FILL_BLANK_TOKEN}${after}`;
  after = after.length > 100 ? clampText(after, 100) : after;
  const room = max - FILL_BLANK_TOKEN.length - after.length - 1;
  before = before.length > room ? `${clampText(before, room)} ` : before;
  return `${before}${FILL_BLANK_TOKEN}${after}`.slice(0, max);
}

/** Estimated minutes for a Unit: ~40 s per BriefingCard and ~45 s per Drill, clamped to 2-10. */
export function estimateUnitMinutes(cardCount: number, drillCount: number): number {
  return Math.min(10, Math.max(2, Math.round((cardCount * 40 + drillCount * 45) / 60)));
}

/** Build the final TrackUnit from a validated generation with stable ids `u1`, `u1-c1`, `u1-d1`. */
export function finalizeUnit(outline: UnitOutline, generated: UnitGeneration, ctx: UnitBuildContext): TrackUnit {
  const briefingCards = generated.briefingCards
    .slice(0, MAX_BRIEFING_CARDS)
    .map((card, index) => finalizeBriefingCard(card, `${outline.id}-c${index + 1}`, ctx.allowedPages));
  const drills = generated.drills.slice(0, MAX_DRILLS).map((drill, index) => finalizeDrill(drill, `${outline.id}-d${index + 1}`, ctx));
  return TrackUnitSchema.parse({
    id: outline.id,
    orderIndex: outline.orderIndex,
    title: clampText(outline.title, 80),
    summary: clampText(outline.summary, 180),
    estimatedMinutes: estimateUnitMinutes(briefingCards.length, drills.length),
    briefingCards,
    drills,
  });
}
