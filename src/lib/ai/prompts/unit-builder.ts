/**
 * Pass 2 (Unit Builder): one Unit outline + only its SOURCE PAGES + global summary
 * -> BriefingCards and Drills sized to the rules on those pages (see content-depth.ts),
 *    with at least 4 distinct Drill kinds.
 * Also holds the single-item regeneration prompts for one BriefingCard or one Drill.
 */
import { z } from 'zod';
import { givesAwayWord, isConditionalStep, isPositionLabel } from '@/lib/services/drill-label';
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
import {
  ClaimEvidenceProposalSchema,
  evidenceProblems,
  finalizeEvidenceProposals,
  pageLabelMap,
  type EvidenceSource,
} from '@/lib/ai/prompts/evidence';
import { formatSourcePages, type ExtractedPage } from '@/lib/ai/pdf-extractor';
import { formatConflictDecisions } from '@/lib/ai/prompts/contradiction-check';
import { parseStructuredOutput } from '@/lib/ai/pipeline/structured-output';
import type { ClaimEvidence } from '@/lib/schemas/source-truth';
import {
  EXACT_EVIDENCE_RULE,
  formatApprovedAssets,
  formatBudgetedSourcePages,
  formatSharedRulePacks,
  planSourceBudget,
  type SourceReviewPromptContext,
} from '@/lib/ai/pipeline/source-budget';
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
import { DEFAULT_UNIT_CONTENT_PLAN, DEPTH_LIMITS, describeRange, type UnitContentPlan } from '@/lib/ai/pipeline/content-depth';

export const UNIT_SCHEMA_NAME = 'TrackUnitContent';
/** Split Unit stage: all BriefingCards of one Unit in one call. */
export const UNIT_CARDS_SCHEMA_NAME = 'TrackUnitCards';
/** Split Unit stage: one batch of Drills of planned kinds. */
export const UNIT_DRILLS_SCHEMA_NAME = 'TrackUnitDrills';
export const BRIEFING_CARD_SCHEMA_NAME = 'BriefingCard';
export const DRILL_SCHEMA_NAME = 'Drill';
/** Absolute limits. The range for one Unit is `UnitBuildContext.contentPlan`. */
export const MIN_BRIEFING_CARDS = DEPTH_LIMITS.minCards;
export const MAX_BRIEFING_CARDS = DEPTH_LIMITS.maxCards;
export const MIN_DRILLS = DEPTH_LIMITS.minDrills;
export const MAX_DRILLS = DEPTH_LIMITS.maxDrills;
export const MIN_DISTINCT_DRILL_KINDS = 3;

/**
 * Kinds that only fit some pages. When a Checkpoint's pages have no fixed-order procedure (or no natural pairs), the
 * model may write a MULTIPLE_CHOICE or TRUE_FALSE_SPOT Drill in that slot instead of forcing one (review 2026-11-23).
 */
export const FLEXIBLE_DRILL_KINDS: ReadonlySet<DrillKind> = new Set(['SEQUENCE_ORDER', 'MATCH_PAIRS']);
const FLEXIBLE_SUBSTITUTES: ReadonlySet<string> = new Set(['MULTIPLE_CHOICE', 'TRUE_FALSE_SPOT']);
/** Character budget for verbatim SOURCE PAGE text in one Unit Builder prompt (fits num_ctx 16384 with output room). */
export const UNIT_SOURCE_CHAR_BUDGET = 32000;

export interface UnitBuildContext {
  /** CompetencyPillar ids the Drills may reference. */
  pillarIds: string[];
  /** Page numbers the items may cite. */
  allowedPages: number[];
  /** Approved source bundles require exact claim evidence; legacy manual exchange remains optional. */
  requireEvidence?: boolean;
  /** Card and Drill counts for this Unit. Defaults to the pre-depth 3-5 cards / 5-7 Drills. */
  contentPlan?: UnitContentPlan;
  /**
   * Approved source pages for server-side evidence resolution. With it, the model-facing schema
   * reports passages that are not on the cited page (so the repair turn can fix them) unless
   * `strictEvidence` is false, and finalize fills document identity and exact source text.
   */
  evidenceSource?: EvidenceSource;
  /** Default true. False accepts unresolvable excerpts (they are stored unsupported for trainer review). */
  strictEvidence?: boolean;
  /**
   * Drills already in the Track (earlier Units and batches, or the Drill being regenerated): a new Drill that
   * repeats one of them, or is a near-duplicate, is sent back for repair (or dropped by salvage).
   */
  avoidDrills?: readonly DrillContent[];
  /** Regenerate: the Drill being replaced. Returning it unchanged (same content, explanation and quotes) is repaired. */
  replacing?: DrillItem;
}

/** Per-item output token estimates (with one evidence claim) used for maxOutputTokens. */
export const CARD_OUTPUT_TOKENS = 560;
export const DRILL_OUTPUT_TOKENS = 480;

export function cardsMaxOutputTokens(maxCards: number): number {
  return Math.min(8192, 500 + CARD_OUTPUT_TOKENS * maxCards);
}

export function drillsMaxOutputTokens(drillCount: number): number {
  return Math.min(8192, 400 + DRILL_OUTPUT_TOKENS * drillCount);
}

export function unitMaxOutputTokens(plan: UnitContentPlan): number {
  return Math.min(8192, 600 + CARD_OUTPUT_TOKENS * plan.cards.max + DRILL_OUTPUT_TOKENS * plan.drills.max);
}

function unitPlan(plan: UnitContentPlan | undefined): UnitContentPlan {
  return plan ?? DEFAULT_UNIT_CONTENT_PLAN;
}

// Model-facing schemas carry no .max() on text or lists: finalize* clamps lengths and slices lists,
// so a slightly long sentence never forces a full regeneration. The limits stay in .describe()
// (and in LENGTH_LIMITS in the system prompt) as guidance. Structural counts (4 options, 4 words)
// are kept exact because finalize cannot repair them.
const citedPages = z.array(z.number().int().positive()).min(1).describe('SOURCE PAGE numbers this item is based on');
const proposedEvidence = z.array(ClaimEvidenceProposalSchema).min(1).optional().describe('Exactly one claim with 1 to 3 excerpts');
const text = (guide: string) => z.string().min(1).describe(guide);

const CardGenerationSchema = z.object({
  headline: text('At most 90 characters'),
  bodyMarkdown: text('2 to 4 sentences, at most 600 characters'),
  keyTakeaway: text('At most 160 characters'),
  doList: z.array(z.string()).describe('2 to 4 items, each at most 140 characters'),
  dontList: z.array(z.string()).describe('2 to 4 items, each at most 140 characters'),
  sourcePages: citedPages,
  evidence: proposedEvidence,
});

const drillBase = {
  competencyPillarId: z.string().min(1),
  prompt: text('At most 300 characters'),
  // Optional on input: a missing explanation is rebuilt from the Drill's evidence in finalizeDrill.
  explanation: z.string().optional().describe('At most 350 characters: WHY the answer is correct, with the Playbook rule'),
  sourcePages: citedPages,
  evidence: proposedEvidence,
};

const MultipleChoiceGenerationSchema = z.object({
  ...drillBase,
  kind: z.literal('MULTIPLE_CHOICE'),
  options: z.array(z.object({ id: z.string(), text: text('At most 180 characters') })).length(4),
  correctOptionId: z.string(),
});
const TrueFalseGenerationSchema = z.object({
  ...drillBase,
  kind: z.literal('TRUE_FALSE_SPOT'),
  statement: text('At most 260 characters'),
  isCompliant: z.boolean(),
});
const SequenceGenerationSchema = z.object({
  ...drillBase,
  kind: z.literal('SEQUENCE_ORDER'),
  orderedSteps: z
    .array(z.object({ text: text('At most 140 characters') }))
    .min(3)
    .describe('3 to 5 steps in the CORRECT order'),
});
const MatchPairsGenerationSchema = z.object({
  ...drillBase,
  kind: z.literal('MATCH_PAIRS'),
  pairs: z
    .array(z.object({ leftPrompt: text('A short phrase, at most 80 characters'), rightMatch: text('A short phrase, at most 80 characters') }))
    .min(3)
    .describe('3 or 4 pairs'),
});
const FillBlankGenerationSchema = z.object({
  ...drillBase,
  kind: z.literal('FILL_BLANK_CHOICE'),
  sentenceTemplate: text(`At most 260 characters, with ${FILL_BLANK_TOKEN} exactly once`),
  wordBank: z.array(z.string().min(1)).length(4),
  correctWord: z.string().min(1),
});

const OPTION_IDS = ['a', 'b', 'c', 'd'];

function asStringList(value: unknown): unknown {
  return typeof value === 'string' ? [value] : value;
}

function asPages(value: unknown): unknown {
  if (typeof value === 'number') return [value];
  if (typeof value === 'string') return (value.match(/\d+/g) ?? []).map(Number);
  return value;
}

/**
 * Coerce near-miss Drill shapes a small model often writes, where the fix cannot change meaning:
 * kind casing, "true"/"false" strings, options/steps written as plain strings, missing option ids,
 * a correct answer given as option text, a word bank with one extra word, a blank explanation.
 * Anything else stays as written and is validated normally.
 */
/** Kind names a 7B model writes instead of the canonical ones. */
const DRILL_KIND_ALIASES: Record<string, DrillKind> = {
  MCQ: 'MULTIPLE_CHOICE', MULTIPLECHOICE: 'MULTIPLE_CHOICE', MULTIPLE_CHOICE_QUESTION: 'MULTIPLE_CHOICE',
  TRUE_FALSE: 'TRUE_FALSE_SPOT', TRUE_OR_FALSE: 'TRUE_FALSE_SPOT', 'TRUE/FALSE': 'TRUE_FALSE_SPOT', SPOT_THE_VIOLATION: 'TRUE_FALSE_SPOT',
  SEQUENCE: 'SEQUENCE_ORDER', ORDER: 'SEQUENCE_ORDER', ORDERING: 'SEQUENCE_ORDER', SEQUENCE_ORDERING: 'SEQUENCE_ORDER',
  MATCH: 'MATCH_PAIRS', MATCHING: 'MATCH_PAIRS', MATCH_PAIR: 'MATCH_PAIRS', MATCHING_PAIRS: 'MATCH_PAIRS',
  FILL_BLANK: 'FILL_BLANK_CHOICE', FILL_IN_THE_BLANK: 'FILL_BLANK_CHOICE', FILL_IN_BLANK: 'FILL_BLANK_CHOICE', FILL_THE_BLANK: 'FILL_BLANK_CHOICE',
};
const DRILL_KIND_FIELDS: Record<DrillKind, string[]> = {
  MULTIPLE_CHOICE: ['options', 'correctOptionId'],
  TRUE_FALSE_SPOT: ['statement', 'isCompliant'],
  SEQUENCE_ORDER: ['orderedSteps'],
  MATCH_PAIRS: ['pairs'],
  FILL_BLANK_CHOICE: ['sentenceTemplate', 'wordBank'],
};

export function coerceDrillShape(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const drill: Record<string, unknown> = { ...(value as Record<string, unknown>) };
  if (typeof drill.kind === 'string') drill.kind = drill.kind.trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (typeof drill.kind === 'string' && DRILL_KIND_ALIASES[drill.kind]) drill.kind = DRILL_KIND_ALIASES[drill.kind];
  // A missing or unknown kind is inferred from the fields only when exactly one kind's fields are present.
  if (!(DRILL_KINDS as readonly unknown[]).includes(drill.kind)) {
    const inferred = DRILL_KINDS.filter((kind) => DRILL_KIND_FIELDS[kind].every((field) => field in drill));
    if (inferred.length === 1) drill.kind = inferred[0];
  }
  if (typeof drill.isCompliant === 'string') {
    const answer = drill.isCompliant.trim().toLowerCase();
    if (['true', 'yes', 'compliant'].includes(answer)) drill.isCompliant = true;
    else if (['false', 'no', 'non-compliant', 'noncompliant', 'violation'].includes(answer)) drill.isCompliant = false;
  }
  if (Array.isArray(drill.options)) {
    drill.options = drill.options.map((option, index) =>
      typeof option === 'string'
        ? { id: OPTION_IDS[index] ?? `o${index + 1}`, text: option }
        : option && typeof option === 'object' && !('id' in option)
          ? { ...(option as object), id: OPTION_IDS[index] ?? `o${index + 1}` }
          : option,
    );
    const options = drill.options as Array<{ id?: unknown; text?: unknown }>;
    if (typeof drill.correctOptionId === 'string' && !options.some((option) => option?.id === drill.correctOptionId)) {
      const wanted = drill.correctOptionId.trim().toLowerCase();
      const byText = options.find((option) => typeof option?.text === 'string' && option.text.trim().toLowerCase() === wanted);
      if (byText && typeof byText.id === 'string') drill.correctOptionId = byText.id;
    }
  }
  if (Array.isArray(drill.orderedSteps)) {
    drill.orderedSteps = drill.orderedSteps.map((step) => (typeof step === 'string' ? { text: step } : step));
  }
  if (Array.isArray(drill.wordBank) && drill.wordBank.length > 4 && typeof drill.correctWord === 'string') {
    const correct = drill.correctWord.trim().toLowerCase();
    const words = drill.wordBank.filter((word): word is string => typeof word === 'string');
    const hit = words.find((word) => word.trim().toLowerCase() === correct);
    if (hit) drill.wordBank = [hit, ...words.filter((word) => word !== hit).slice(0, 3)];
  }
  if (typeof drill.explanation !== 'string' || !drill.explanation.trim()) delete drill.explanation;
  drill.sourcePages = asPages(drill.sourcePages);
  return drill;
}

/** Coerce near-miss BriefingCard shapes (single strings for lists, page numbers as text). */
export function coerceCardShape(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const card: Record<string, unknown> = { ...(value as Record<string, unknown>) };
  card.doList = asStringList(card.doList) ?? [];
  card.dontList = asStringList(card.dontList) ?? [];
  card.sourcePages = asPages(card.sourcePages);
  return card;
}

const DrillUnionSchema = z.discriminatedUnion('kind', [
  MultipleChoiceGenerationSchema,
  TrueFalseGenerationSchema,
  SequenceGenerationSchema,
  MatchPairsGenerationSchema,
  FillBlankGenerationSchema,
]);
const DrillGenerationSchema = z.preprocess(coerceDrillShape, DrillUnionSchema);
const CardItemSchema = z.preprocess(coerceCardShape, CardGenerationSchema);

export type CardGeneration = z.infer<typeof CardGenerationSchema>;
export type DrillGeneration = z.infer<typeof DrillUnionSchema>;

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

function checkRequiredEvidence(evidence: CardGeneration['evidence'], ctx: UnitBuildContext, path: (string | number)[], report: IssueSink): void {
  if (ctx.requireEvidence && !evidence?.length) {
    report(path, 'Add "evidence": one claim with an excerpt copied word for word from a SOURCE PAGE.');
    return;
  }
  if (!ctx.evidenceSource || ctx.strictEvidence === false) return;
  for (const problem of evidenceProblems(evidence, ctx.evidenceSource, ctx.allowedPages)) report([...path, ...problem.path], problem.message);
}

const MAX_WORD_BANK_WORDS = 4;
/** Learner-facing limit of a MATCH_PAIRS side (MatchPairsDrillSchema). Longer sides are repaired, never cut. */
export const MAX_PAIR_SIDE_CHARS = 100;
/** Same-kind Drills whose normalized content words overlap at least this much are near-duplicates. */
export const NEAR_DUPLICATE_SIMILARITY = 0.7;

/** The fields that make two Drills "the same question" (generated or finalized Drills). */
export type DrillContent =
  | { kind: 'MULTIPLE_CHOICE'; prompt: string; options?: ReadonlyArray<{ id: string; text: string }>; correctOptionId?: string }
  | { kind: 'TRUE_FALSE_SPOT'; prompt: string; statement: string }
  | { kind: 'SEQUENCE_ORDER'; prompt: string; orderedSteps: ReadonlyArray<{ text: string }> }
  | { kind: 'MATCH_PAIRS'; prompt: string; pairs: ReadonlyArray<{ leftPrompt: string }> }
  | { kind: 'FILL_BLANK_CHOICE'; prompt: string; sentenceTemplate: string };

const normWords = (value: string) => value.toLowerCase().replace(/[^a-z0-9$%]+/g, ' ').trim();

function contentText(drill: DrillContent): string {
  switch (drill.kind) {
    case 'TRUE_FALSE_SPOT':
      return drill.statement;
    case 'SEQUENCE_ORDER':
      return drill.orderedSteps.map((step) => step.text).join(' | ');
    case 'MATCH_PAIRS':
      return drill.pairs.map((pair) => pair.leftPrompt).sort().join(' | ');
    case 'FILL_BLANK_CHOICE':
      return drill.sentenceTemplate;
    case 'MULTIPLE_CHOICE': {
      // Generic stems ("Which of the following is correct…") repeat; the right answer tells Drills apart.
      const correct = drill.options?.find((option) => option.id === drill.correctOptionId)?.text;
      return correct ? `${drill.prompt} | ${correct}` : drill.prompt;
    }
  }
}

/** Jaccard overlap of the content words of two Drills of the same kind (0 for different kinds). */
export function drillSimilarity(left: DrillContent, right: DrillContent): number {
  if (left.kind !== right.kind) return 0;
  const words = (drill: DrillContent) => new Set(normWords(contentText(drill)).split(' ').filter((word) => word.length > 2));
  const a = words(left);
  const b = words(right);
  if (a.size === 0 || b.size === 0) return normWords(contentText(left)) === normWords(contentText(right)) ? 1 : 0;
  const shared = [...a].filter((word) => b.has(word)).length;
  return shared / (a.size + b.size - shared);
}

function isUnchangedDrill(drill: DrillGeneration, current: DrillItem): boolean {
  const quotes = (evidence: ReadonlyArray<{ excerpts: ReadonlyArray<{ exactText: string }> }> | undefined) =>
    normWords((evidence ?? []).flatMap((claim) => claim.excerpts.map((excerpt) => excerpt.exactText)).join(' '));
  return drillContentKey(drill) === drillContentKey(current)
    && normWords(drill.prompt) === normWords(current.prompt)
    && normWords(drill.explanation ?? '') === normWords(current.explanation)
    && quotes(drill.evidence) === quotes(current.evidence);
}

export function isNearDuplicateDrill(left: DrillContent, right: DrillContent): boolean {
  return drillContentKey(left) === drillContentKey(right) || drillSimilarity(left, right) >= NEAR_DUPLICATE_SIMILARITY;
}

/** Explanation wording that contradicts the stored answer key. */
export function explanationProblems(drill: DrillGeneration): string[] {
  const explanation = drill.explanation?.trim();
  if (!explanation) return [];
  const problems: string[] = [];
  const folded = ` ${normWords(explanation)} `;
  if (drill.kind === 'SEQUENCE_ORDER') {
    const branches = drill.orderedSteps.filter((step) => isConditionalStep(step.text));
    if (branches.length > 0) {
      problems.push(
        `Step "${branches[0].text}" is an option for a situation, not a step in a fixed order. Use only steps of one procedure the Playbook gives in order.`,
      );
    }
    // "The correct order is 1, 3, 2, 4": any listed order other than 1..n contradicts the stored steps.
    for (const match of explanation.matchAll(/\b\d(?:\s*(?:,|->|→|then|and)\s*\d){2,}\b/g)) {
      const numbers = match[0].match(/\d/g)!.map(Number);
      if (numbers.some((value, index) => value !== index + 1)) {
        problems.push(`The explanation lists the order "${match[0]}", but the steps are stored in order 1 to ${drill.orderedSteps.length}. Explain why the order is right without step numbers.`);
        break;
      }
    }
    const positions = drill.orderedSteps
      .map((step) => folded.indexOf(` ${normWords(step.text)} `))
      .filter((at) => at >= 0);
    if (positions.length >= 2 && positions.some((at, index) => index > 0 && at < positions[index - 1])) {
      problems.push('The explanation describes the steps in a different order from "orderedSteps". Make them agree.');
    }
  }
  if (drill.kind === 'MULTIPLE_CHOICE') {
    const correct = drill.options.find((option) => option.id === drill.correctOptionId);
    const mentions = (value: string) => {
      const words = normWords(value);
      return words.split(' ').length >= 3 && folded.includes(` ${words} `);
    };
    // A verbatim Playbook quote in the explanation may contain a distractor's wording; that is not endorsement.
    const quoted = normWords((drill.evidence ?? []).flatMap((claim) => claim.excerpts.map((excerpt) => excerpt.exactText)).join(' '));
    const endorsedWrong = drill.options.find((option) =>
      option.id !== drill.correctOptionId && mentions(option.text) && !quoted.includes(normWords(option.text)));
    if (endorsedWrong && !(correct && mentions(correct.text))) {
      problems.push(`The explanation supports option "${endorsedWrong.id}" ("${clampText(endorsedWrong.text, 80)}"), but "correctOptionId" is "${drill.correctOptionId}". Make the explanation support the correct option.`);
    }
  }
  return problems;
}

const SMALL_NUMBERS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

/** Numbers a page spells out ("forty-percent", "ninety-nine dollars", "two hundred"), as digit strings. */
export function spelledNumbers(text: string): string[] {
  const words = text.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  const found: string[] = [];
  let total = 0;
  let current = 0;
  let inNumber = false;
  const flush = () => {
    if (inNumber) found.push(String(total + current));
    total = 0;
    current = 0;
    inNumber = false;
  };
  for (const word of words) {
    if (word in SMALL_NUMBERS) { current += SMALL_NUMBERS[word]; inNumber = true; }
    else if (word in TENS) { current += TENS[word]; inNumber = true; }
    else if (word === 'hundred' && inNumber) current *= 100;
    else if (word === 'thousand' && inNumber) { total += current * 1000; current = 0; }
    else if (word === 'and' && inNumber) continue;
    else flush();
  }
  flush();
  return found;
}

/** Learner-facing wrong values of a Drill: distractors and a non-compliant statement (never the correct answer). */
function wrongAnswerText(drill: Record<string, unknown>): string {
  const parts: string[] = [];
  if (Array.isArray(drill.options)) {
    for (const option of drill.options as Array<{ id?: unknown; text?: unknown }>) {
      if (option?.id !== drill.correctOptionId && typeof option?.text === 'string') parts.push(option.text);
    }
  }
  if (Array.isArray(drill.wordBank)) {
    for (const word of drill.wordBank) if (typeof word === 'string' && word !== drill.correctWord) parts.push(word);
  }
  if (typeof drill.statement === 'string' && drill.isCompliant === false) parts.push(drill.statement);
  return parts.join(' ');
}

/** Numbers (prices, percents, counts above 10) in `text` that appear neither in the Drill's cited pages nor its evidence. */
export function inventedNumbers(text: string, drill: Pick<DrillGeneration, 'sourcePages' | 'evidence'> & Record<string, unknown>, source: EvidenceSource): string[] {
  const byLabel = pageLabelMap(source.pages);
  const pages = drill.sourcePages.map((label) => byLabel.get(label)).filter((page) => page !== undefined);
  const known = [
    ...pages.map((page) => page.transcription?.text ?? page.normalizedText),
    ...(drill.evidence ?? []).flatMap((claim) => claim.excerpts.map((excerpt) => excerpt.exactText)),
  ].join(' ');
  if (pages.length === 0) return [];
  // Numbers the Drill itself shows the learner (a wrong price in a statement or a distractor) may be explained.
  // The answer key itself is excluded: an invented correct value ("40%" as the right word) must still be caught.
  const ownText = wrongAnswerText(drill);
  const numbersIn = (value: string) => new Set([...value.matchAll(/\d+(?:[.,]\d+)*/g)].map((match) => match[0].replace(/,/g, '')));
  const knownNumbers = new Set([...numbersIn(known), ...numbersIn(ownText), ...spelledNumbers(known)]);
  const found: string[] = [];
  for (const match of text.matchAll(/\$?\d+(?:[.,]\d+)*%?/g)) {
    const raw = match[0];
    const value = raw.replace(/[$%,]/g, '');
    const significant = raw.includes('$') || raw.includes('%') || Number(value) > 10;
    if (significant && !knownNumbers.has(value) && !found.includes(raw)) found.push(raw);
  }
  return found;
}

function checkDrill(drill: DrillGeneration, ctx: UnitBuildContext, path: (string | number)[], report: IssueSink): void {
  const allowed = new Set(ctx.allowedPages);
  if (!ctx.pillarIds.includes(drill.competencyPillarId)) {
    report([...path, 'competencyPillarId'], `Use one of these CompetencyPillar ids: ${ctx.pillarIds.join(', ')}.`);
  }
  checkPages(drill.sourcePages, allowed, [...path, 'sourcePages'], report);
  checkRequiredEvidence(drill.evidence, ctx, [...path, 'evidence'], report);
  // The blank token belongs only in a FILL_BLANK_CHOICE "sentenceTemplate"; a 7B model copies it into the
  // prompt of other kinds (and into MATCH_PAIRS cells), where learners would see a raw {{BLANK}}.
  for (const [field, value] of textFieldsOutsideTemplate(drill)) {
    if (value.includes(FILL_BLANK_TOKEN)) report([...path, ...field], `Remove ${FILL_BLANK_TOKEN}: it belongs only in a FILL_BLANK_CHOICE "sentenceTemplate".`);
  }
  const repeated = ctx.avoidDrills?.find((other) => isNearDuplicateDrill(drill, other));
  if (repeated) {
    report([...path, 'prompt'], `This Drill repeats an existing Drill ("${clampText(repeated.prompt, 90)}"). Test a different rule or situation.`);
  }
  if (ctx.replacing && isUnchangedDrill(drill, ctx.replacing)) {
    report([...path, 'prompt'], 'This is the current Drill unchanged. Write a NEW Drill that follows the TRAINER REQUIREMENT.');
  }
  for (const problem of explanationProblems(drill)) report([...path, 'explanation'], problem);
  if (isMetaPrompt(drill.prompt)) {
    report([...path, 'prompt'], 'The prompt talks about the Drill itself. Ask a plain question about the caller situation or the rule, without explaining the Drill kind or call-flow logic.');
  }
  // Checked in lenient mode too: lenient relaxes excerpt matching only, and an invented price taught to
  // learners is worse than a dropped Drill (the R2d build let "$129.00" through the lenient fallback).
  if (ctx.evidenceSource && drill.explanation) {
    const invented = inventedNumbers(drill.explanation, drill, ctx.evidenceSource);
    if (invented.length > 0) {
      report([...path, 'explanation'], `The explanation uses ${invented.map((value) => `"${value}"`).join(', ')}, which the SOURCE PAGES never state. Use only numbers written on the cited page.`);
    }
  }
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
      if (givesAwayWord(drill.prompt, drill.correctWord)) {
        report([...path, 'prompt'], `The prompt contains the answer "${drill.correctWord}". Rewrite the prompt so it does not name the missing word.`);
      }
      const occurrences = drill.sentenceTemplate.split(FILL_BLANK_TOKEN).length - 1;
      if (occurrences !== 1) {
        report([...path, 'sentenceTemplate'], `"sentenceTemplate" must contain the token ${FILL_BLANK_TOKEN} exactly once.`);
      }
      const bank = drill.wordBank.map((word) => word.trim().toLowerCase());
      if (new Set(bank).size !== bank.length) report([...path, 'wordBank'], 'The 4 words in "wordBank" must be different.');
      // A word bank of instructions ("state the 3-month plan is the most popular") is not a fill-in-the-blank.
      if (drill.wordBank.some((word) => word.trim().split(/\s+/).length > MAX_WORD_BANK_WORDS)) {
        report([...path, 'wordBank'], `Each "wordBank" entry must be a short word or phrase of at most ${MAX_WORD_BANK_WORDS} words that fits the blank.`);
      }
      const correct = drill.correctWord.trim().toLowerCase();
      if (!bank.includes(correct)) {
        report([...path, 'correctWord'], '"correctWord" must be one of the 4 words in "wordBank".');
      } else if (correct && bank.some((word) => word !== correct && containsAsWords(word, correct))) {
        // e.g. bank ["approved", "ready", "approved, your medication ships."]: two answers fit the blank.
        report([...path, 'wordBank'], 'A wrong word in "wordBank" must not contain the correct word. Use 3 different wrong words.');
      }
      break;
    }
    case 'SEQUENCE_ORDER': {
      const promised = promisedStepCount(drill.prompt);
      if (promised !== null && promised !== drill.orderedSteps.length) {
        report([...path, 'prompt'], `The prompt promises ${promised} steps but the Drill lists ${drill.orderedSteps.length}. List all ${promised} steps, or remove the number from the prompt.`);
      }
      const steps = drill.orderedSteps.map((step) => step.text.trim().toLowerCase());
      if (new Set(steps).size !== steps.length) report([...path, 'orderedSteps'], 'Each step needs different text.');
      break;
    }
    case 'MATCH_PAIRS': {
      drill.pairs.forEach((pair, index) => {
        for (const side of ['leftPrompt', 'rightMatch'] as const) {
          if (pair[side].trim().length > MAX_PAIR_SIDE_CHARS) {
            report([...path, 'pairs', index, side], `Shorten "${side}" to a phrase of at most ${MAX_PAIR_SIDE_CHARS} characters (it has ${pair[side].trim().length}).`);
          }
        }
      });
      if (drill.pairs.some((pair) => isPositionLabel(pair.leftPrompt))) {
        report([...path, 'pairs'], 'A "leftPrompt" starts with its position ("Step 1", "First"). Name each item by what it is, so the learner matches by meaning, not by number.');
      }
      const lefts = drill.pairs.map((pair) => pair.leftPrompt.trim().toLowerCase());
      const rights = drill.pairs.map((pair) => pair.rightMatch.trim().toLowerCase());
      if (new Set(lefts).size !== lefts.length || new Set(rights).size !== rights.length) {
        report([...path, 'pairs'], 'Each "leftPrompt" and each "rightMatch" must be different.');
      }
      break;
    }
    case 'TRUE_FALSE_SPOT':
      // The learner judges a statement ("Compliant" or "Violation"); a question cannot be either.
      if (drill.statement.trim().endsWith('?')) {
        report([...path, 'statement'], '"statement" must be something an agent says on a call, not a question. Put the question in "prompt".');
      }
      break;
  }
}

/**
 * A prompt that narrates the Drill instead of asking ("Because call-flow actions depend on situational outcomes ...,
 * answer this rule check:", review 2026-11-23). Exported for tests.
 */
export function isMetaPrompt(prompt: string): boolean {
  return /\b(rule check|drill kind|this slot|this drill (type|kind|format)|call-flow actions depend|instead of (a |an )?(sequence|ordering|matching|match pairs))\b/i.test(prompt);
}

const NUMBER_WORDS: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

/**
 * "Put the 6-step procedure in order" promises 6 steps (review 2026-11-23: a Drill said 6-step and showed 5).
 * "the first five steps" is a deliberate subset, so it promises nothing. Exported for tests.
 */
export function promisedStepCount(prompt: string): number | null {
  const match = /\b(first|last)?\s*(\d+|two|three|four|five|six|seven|eight|nine|ten)[\s-]+steps?\b/i.exec(prompt);
  if (!match || match[1]) return null;
  const raw = match[2].toLowerCase();
  return NUMBER_WORDS[raw] ?? Number.parseInt(raw, 10);
}

/** True when `needle` appears in `haystack` as whole words ("5 minutes" is not inside "15 minutes"). */
function containsAsWords(haystack: string, needle: string): boolean {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(haystack);
}

function textFieldsOutsideTemplate(drill: DrillGeneration): Array<[(string | number)[], string]> {
  const fields: Array<[(string | number)[], string]> = [];
  if (drill.kind !== 'FILL_BLANK_CHOICE') fields.push([['prompt'], drill.prompt]);
  switch (drill.kind) {
    case 'MULTIPLE_CHOICE':
      drill.options.forEach((option, index) => fields.push([['options', index, 'text'], option.text]));
      break;
    case 'TRUE_FALSE_SPOT':
      fields.push([['statement'], drill.statement]);
      break;
    case 'SEQUENCE_ORDER':
      drill.orderedSteps.forEach((step, index) => fields.push([['orderedSteps', index, 'text'], step.text]));
      break;
    case 'MATCH_PAIRS':
      drill.pairs.forEach((pair, index) => {
        fields.push([['pairs', index, 'leftPrompt'], pair.leftPrompt]);
        fields.push([['pairs', index, 'rightMatch'], pair.rightMatch]);
      });
      break;
    case 'FILL_BLANK_CHOICE':
      drill.wordBank.forEach((word, index) => fields.push([['wordBank', index], word]));
      break;
  }
  return fields;
}

/** Normalized content of a Drill, so a later batch that repeats an earlier Drill can be dropped. */
export function drillContentKey(drill: DrillContent): string {
  const norm = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return `${drill.kind}:${drill.kind === 'MATCH_PAIRS' || drill.kind === 'SEQUENCE_ORDER'
    ? contentText(drill).split(' | ').map(norm).join('|')
    : norm(contentText(drill))}`;
}

/**
 * Drop Drills that repeat, or nearly repeat, an earlier Drill of the Track (the split stage asks in batches,
 * and a small model rewrites the same Drill in later Checkpoints).
 */
export function dropRepeatedDrills<T extends DrillContent>(existing: readonly DrillContent[], incoming: readonly T[]): T[] {
  const kept: T[] = [];
  for (const drill of incoming) {
    if ([...existing, ...kept].some((other) => isNearDuplicateDrill(drill, other))) continue;
    kept.push(drill);
  }
  return kept;
}

/** Zod output schema for one full Unit (Pass 2, single-call mode: replay and manual exchange). */
export function buildUnitGenerationSchema(ctx: UnitBuildContext) {
  const plan = unitPlan(ctx.contentPlan);
  return z
    .object({
      briefingCards: z.array(CardItemSchema).min(plan.cards.min).describe(`${describeRange(plan.cards)} BriefingCards`),
      drills: z.array(DrillGenerationSchema).min(plan.drills.min).describe(`${describeRange(plan.drills)} Drills`),
    })
    .superRefine((value, zctx) => {
      const report: IssueSink = (path, message) => zctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
      const allowed = new Set(ctx.allowedPages);
      value.briefingCards.forEach((card, index) => {
        checkPages(card.sourcePages, allowed, ['briefingCards', index, 'sourcePages'], report);
        checkRequiredEvidence(card.evidence, ctx, ['briefingCards', index, 'evidence'], report);
      });
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

/** Zod output schema for all BriefingCards of one Unit (split mode, call 1). */
export function buildUnitCardsSchema(ctx: UnitBuildContext) {
  const plan = unitPlan(ctx.contentPlan);
  return z
    .object({ briefingCards: z.array(CardItemSchema).min(plan.cards.min).describe(`${describeRange(plan.cards)} BriefingCards`) })
    .superRefine((value, zctx) => {
      const report: IssueSink = (path, message) => zctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
      const allowed = new Set(ctx.allowedPages);
      value.briefingCards.forEach((card, index) => {
        checkPages(card.sourcePages, allowed, ['briefingCards', index, 'sourcePages'], report);
        checkRequiredEvidence(card.evidence, ctx, ['briefingCards', index, 'evidence'], report);
      });
    });
}
export type UnitCardsGeneration = z.infer<ReturnType<typeof buildUnitCardsSchema>>;

/** Zod output schema for one batch of Drills whose kinds were planned up front (split mode). */
export function buildUnitDrillBatchSchema(ctx: UnitBuildContext, kinds: readonly DrillKind[]) {
  return z
    .object({ drills: z.array(DrillGenerationSchema).min(kinds.length).describe(`Exactly ${kinds.length} Drills of kinds: ${kinds.join(', ')}`) })
    .superRefine((value, zctx) => {
      const report: IssueSink = (path, message) => zctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
      value.drills.forEach((drill, index) => checkDrill(drill, ctx, ['drills', index], report));
      const missing = missingKinds(value.drills, kinds);
      if (missing.length > 0) {
        report(['drills'], `Write Drills of exactly these kinds, in this order: ${kinds.join(', ')}. Missing: ${missing.join(', ')}.`);
      }
    });
}
export type UnitDrillBatchGeneration = z.infer<ReturnType<typeof buildUnitDrillBatchSchema>>;

function missingKinds(drills: readonly DrillGeneration[], kinds: readonly DrillKind[]): DrillKind[] {
  const available = drills.map((drill) => drill.kind as DrillKind);
  const missing: DrillKind[] = [];
  const flexibleMisses: DrillKind[] = [];
  for (const kind of kinds) {
    const at = available.indexOf(kind);
    if (at !== -1) available.splice(at, 1);
    else if (FLEXIBLE_DRILL_KINDS.has(kind)) flexibleMisses.push(kind);
    else missing.push(kind);
  }
  // A flexible slot may be filled by a spare MULTIPLE_CHOICE or TRUE_FALSE_SPOT Drill.
  for (const kind of flexibleMisses) {
    const at = available.findIndex((have) => FLEXIBLE_SUBSTITUTES.has(have));
    if (at !== -1) available.splice(at, 1);
    else missing.push(kind);
  }
  return missing;
}

/** Pick one Drill per planned kind (in plan order) from a batch that may hold extras. */
export function pickPlannedDrills(drills: readonly DrillGeneration[], kinds: readonly DrillKind[]): DrillGeneration[] {
  const pool = [...drills];
  const picked: DrillGeneration[] = [];
  const flexibleMisses: DrillKind[] = [];
  for (const kind of kinds) {
    const at = pool.findIndex((drill) => drill.kind === kind);
    if (at !== -1) picked.push(...pool.splice(at, 1));
    else if (FLEXIBLE_DRILL_KINDS.has(kind)) flexibleMisses.push(kind);
  }
  for (let slot = 0; slot < flexibleMisses.length; slot += 1) {
    const at = pool.findIndex((drill) => FLEXIBLE_SUBSTITUTES.has(drill.kind));
    if (at !== -1) picked.push(...pool.splice(at, 1));
  }
  return picked;
}

/**
 * Mix of Drill kinds for one Unit, mostly scenario questions. SEQUENCE_ORDER and MATCH_PAIRS appear at most once
 * each per Unit (and only in Units of 5+ / 6+ Drills), and the model may swap them for a scenario question when the
 * pages don't suit them (FLEXIBLE_DRILL_KINDS). Before, every Unit cycled through all five kinds, which forced
 * ordering Drills onto pages with no order (review 2026-11-23).
 */
const DRILL_KIND_PATTERN: readonly DrillKind[] = [
  'MULTIPLE_CHOICE',
  'TRUE_FALSE_SPOT',
  'FILL_BLANK_CHOICE',
  'MULTIPLE_CHOICE',
  'SEQUENCE_ORDER',
  'MATCH_PAIRS',
  'TRUE_FALSE_SPOT',
  'MULTIPLE_CHOICE',
  'FILL_BLANK_CHOICE',
  'MULTIPLE_CHOICE',
];

export function planDrillKinds(count: number, unitOrderIndex = 0): DrillKind[] {
  void unitOrderIndex;
  return Array.from({ length: count }, (_, index) => DRILL_KIND_PATTERN[index % DRILL_KIND_PATTERN.length]);
}

/** Split planned kinds into batches of at most `size` Drills. */
export function batchDrillKinds(kinds: readonly DrillKind[], size: number): DrillKind[][] {
  const batches: DrillKind[][] = [];
  for (let start = 0; start < kinds.length; start += Math.max(1, size)) batches.push(kinds.slice(start, start + Math.max(1, size)));
  return batches;
}

/** Zod output schema for regenerating one BriefingCard. */
export function buildCardGenerationSchema(ctx: Pick<UnitBuildContext, 'allowedPages' | 'requireEvidence' | 'evidenceSource' | 'strictEvidence'>) {
  return CardItemSchema.superRefine((card, zctx) => {
    const report: IssueSink = (path, message) => zctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
    checkPages(card.sourcePages, new Set(ctx.allowedPages), ['sourcePages'], report);
    checkRequiredEvidence(card.evidence, { pillarIds: [], ...ctx }, ['evidence'], report);
  });
}

/** Zod output schema for regenerating one Drill of a fixed kind. */
export function buildDrillGenerationSchema(kind: DrillKind, ctx: UnitBuildContext) {
  // Keep each variant's Zod input type (including optional evidence defaults) intact.
  const refine = <T extends z.ZodTypeAny>(schema: T) =>
    schema.superRefine((drill, zctx) => {
      checkDrill(drill as DrillGeneration, ctx, [], (path, message) => zctx.addIssue({ code: z.ZodIssueCode.custom, path, message }));
    });
  return refine(z.preprocess(coerceDrillShape, DRILL_GENERATION_SCHEMAS[kind]));
}

const DRILL_KIND_GUIDE = [
  `MULTIPLE_CHOICE: "prompt" is a realistic call situation or a rule check. "options" has exactly 4 objects {"id","text"} with ids "a","b","c","d". "correctOptionId" is the id of the one correct option. Wrong options must be plausible mistakes an agent could make. All 4 options have about the same length and level of detail: the correct option is never the only long, specific or Playbook-worded one.`,
  'TRUE_FALSE_SPOT: "statement" describes what an agent said or did on a call. "isCompliant" is true when it follows the Playbook and false when it breaks the Playbook. "prompt" asks the agent to decide.',
  'SEQUENCE_ORDER: "orderedSteps" has 3 to 5 steps {"text"} in the CORRECT order from the Playbook. "prompt" asks the agent to put the steps in order. The "explanation" says why that order is right; it never lists step numbers.',
  'SEQUENCE_ORDER is ONLY for a procedure the Playbook itself gives in a fixed order (numbered steps, a call flow, or "first / then / after"). Every step is one action the agent takes at one point in the same call, and swapping two steps would be wrong. Never use it for a list of separate rules, options for different situations, or "if ..." branches (for example "Stop sharing if uncertain" next to "Limit records to assigned duties"); test those with MULTIPLE_CHOICE or TRUE_FALSE_SPOT ideas inside a sequence about the one procedure the pages do give.',
  'MATCH_PAIRS: "pairs" has 3 or 4 objects {"leftPrompt","rightMatch"} (for example a caller situation and the required action). Each side is a SHORT phrase of at most 80 characters, never a full script. Every right side matches only one left side. Never label a left side with its position ("Step 1", "First", "1."): the learner must match by meaning.',
  `FILL_BLANK_CHOICE: "sentenceTemplate" is a Playbook rule with the token ${FILL_BLANK_TOKEN} exactly once where the key word goes. "wordBank" has exactly 4 different words or short phrases. "correctWord" is one of them, written exactly the same.`,
].join('\n');

const LENGTH_LIMITS = [
  'BriefingCard: "headline" at most 90 characters; "bodyMarkdown" 2 to 4 sentences, at most 600 characters (simple markdown such as **bold** is allowed); "keyTakeaway" at most 160 characters; "doList" and "dontList" each 2 to 4 items of at most 140 characters.',
  'Drill: "prompt" at most 300 characters; "explanation" at most 350 characters and it must say WHY the answer is correct with the rule from the Playbook; option text at most 180; "statement" at most 260; step text at most 140; pair sides at most 80; "sentenceTemplate" at most 260; each word in "wordBank" at most 60.',
].join('\n');

export function buildUnitSystemPrompt(divisionId: DivisionId): string {
  const profile = DIVISION_PROFILES[divisionId];
  return [
    `You are the Unit author for LogiCall Pulse, a Duolingo-style training platform for ${divisionLabel(divisionId)} call-center agents (${profile.traineeDescription}).`,
    'You turn the rules in the provided SOURCE PAGES into short BriefingCards (learn) and Drills (test) for one Unit.',
    '',
    'GROUNDING RULES:',
    GROUNDING_RULE,
    'Teach only rules that the SOURCE PAGES state. Copy exact values (amounts, days, steps, required fields) from the pages. If a detail is not stated, do not use it. Never invent a number, percent or price that is not on the SOURCE PAGES.',
    CITATION_RULE,
    EXACT_EVIDENCE_RULE,
    LANGUAGE_RULE,
    `Callers in Drills are ${profile.counterparty}. Use synthetic names, and only the names listed in the request. Do not invent order, ticket or account numbers unless the SOURCE PAGES show that kind of number.`,
    '',
    'CONTENT RULES:',
    '- Write the number of BriefingCards given in the request (CONTENT SIZE). Each card teaches one operational rule. The count was measured from how many rules the Unit pages hold, so cover every rule and do not pad.',
    '- Write the number of Drills given in the request (CONTENT SIZE). The Drills test the rules on the BriefingCards.',
    `- Use at least ${MIN_DISTINCT_DRILL_KINDS} DIFFERENT Drill kinds in the Unit. Available kinds: ${DRILL_KINDS.join(', ')}.`,
    '- Every Drill has "competencyPillarId" set to one of the CompetencyPillar ids given in the request.',
    '- Teach what an agent says or does on a call. Skip internal testing steps, URL parameters, screenshot or page-layout details and metric definitions unless an agent uses them on a call.',
    '- Skip background trivia an agent never acts on: penalty amounts, fines, legal history, regulation names or dates, and comparisons between company policy and the law. Teach the action the rule requires instead (for example "report immediately", not the size of a fine).',
    '- A "Never", "Do not" or compliance rule in the GLOBAL CAMPAIGN SUMMARY or the SOURCE PAGES wins over any script, example or step. Never write a card, a "doList" item, a takeaway or a correct Drill answer that tells the agent to do a forbidden action (for example sending a link after reaching voicemail). When a script on the pages seems to allow it, teach the script words but not the forbidden action.',
    '- Do not re-teach a rule that one of the "Other Units" listed in the request already covers. Focus on what is new on this Unit\'s pages.',
    '- Every wrong option, wrong word or false statement must be a mistake a new agent could plausibly make. Never use an absurd or joke option that nobody would pick.',
    '- A Drill must never give away its answer: the prompt must not contain the correct word, the correct option text, or the order of the steps.',
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
  /** Only the legacy SOURCE PAGES mapped to this Unit. */
  pages: ExtractedPage[];
  /** Approved document identities, inherited rules, and operational assets for exact evidence. */
  sourceReview?: SourceReviewPromptContext;
  /** Titles of the other Units, to avoid overlap. */
  otherUnitTitles: string[];
  /** Characters of SOURCE text that fit this call (smaller for local models). Default UNIT_SOURCE_CHAR_BUDGET. */
  sourceCharBudget?: number;
}

function unitPillars(input: Pick<UnitPromptInput, 'pillars' | 'outline'>): CompetencyPillar[] {
  const preferred = input.pillars.filter((pillar) => input.outline.pillarIds.includes(pillar.id));
  return preferred.length > 0 ? preferred : input.pillars;
}

function contextBlock(input: UnitPromptInput): string[] {
  const budget = input.sourceReview
    ? planSourceBudget({
        stage: `unit:${input.outline.id}`,
        pages: input.sourceReview.pages,
        rulePacks: input.sourceReview.rulePacks,
        assets: input.sourceReview.assets,
        selectedPageNumbers: input.outline.sourcePages,
        preferredPageOrder: input.outline.sourcePages,
        charBudget: input.sourceCharBudget ?? UNIT_SOURCE_CHAR_BUDGET,
      })
    : null;
  const legacyPages = budget ? [] : fitPagesToBudget(input.pages, input.sourceCharBudget ?? UNIT_SOURCE_CHAR_BUDGET);
  const allowedPages = budget ? budget.pages.map((page) => page.pageNumber) : legacyPages.map((page) => page.pageNumber);
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
    `Allowed sourcePages: ${describePageSet(allowedPages)}`,
    ...(input.sourceReview
      ? [
          '',
          'APPROVED SHARED RULES (inherit these exact rule IDs and statements):',
          formatSharedRulePacks(input.sourceReview.rulePacks, input.sourceReview.pages),
          '',
          'APPROVED OPERATIONAL ASSETS (use these exact values in their declared context):',
          formatApprovedAssets(input.sourceReview.assets),
          ...(formatConflictDecisions(input.sourceReview.conflicts)
            ? [
                '',
                'PLAYBOOK CONTRADICTIONS THE TRAINER DECIDED (follow each decision; never teach the side the trainer ruled out; teach the rule itself and never mention a "trainer decision" in learner text):',
                formatConflictDecisions(input.sourceReview.conflicts),
              ]
            : []),
        ]
      : []),
    '',
    budget ? formatBudgetedSourcePages(budget.pages) : formatSourcePages(legacyPages),
  ];
}

export function buildUnitUserPrompt(input: UnitPromptInput): string {
  const plan = unitPlan(input.outline.contentPlan);
  return [
    ...contextBlock(input),
    '',
    `CONTENT SIZE: these pages hold about ${Math.round(plan.ruleSignals) || 'a few'} rule statements for this Unit.`,
    `Write ${describeRange(plan.cards)} BriefingCards (aim for ${plan.cards.target}) and ${describeRange(plan.drills)} Drills (aim for ${plan.drills.target}).`,
    '',
    'Make the BriefingCards and Drills JSON for this Unit now.',
  ].join('\n');
}

/** Split mode, call 1: every BriefingCard of the Unit. */
/**
 * The part of every card and Drill prompt of one Unit that is the same across its calls (Track, summary, pillars,
 * Unit outline, approved rules and SOURCE PAGES). Prompts start with exactly this text, so a provider can cache it
 * once per Unit (Gemini context caching) instead of billing it in full on every call.
 */
export function unitContextPrefix(input: UnitPromptInput): string {
  return contextBlock(input).join('\n');
}

export function buildUnitCardsUserPrompt(input: UnitPromptInput & { existingHeadlines?: readonly string[] }): string {
  const plan = unitPlan(input.outline.contentPlan);
  const existing = input.existingHeadlines ?? [];
  return [
    unitContextPrefix(input),
    '',
    `CONTENT SIZE: these pages hold about ${Math.round(plan.ruleSignals) || 'a few'} rule statements for this Unit.`,
    ...(existing.length > 0
      ? [
          `BriefingCards already written for this Unit (teach OTHER rules): ${existing.join(' | ')}`,
          `TASK: Write exactly ${plan.cards.target} more BriefingCard${plan.cards.target === 1 ? '' : 's'}, each teaching a different rule from the SOURCE PAGES. Do not write Drills.`,
        ]
      : [`TASK: Write ${describeRange(plan.cards)} BriefingCards (aim for ${plan.cards.target}). Each card teaches one rule from the SOURCE PAGES. Do not write Drills in this answer; they are written next.`]),
    'Return {"briefingCards": [ ... ]} only.',
  ].join('\n');
}

/** Content plan for a cards top-up call that asks for exactly `missing` more cards. */
export function cardsTopUpPlan(plan: UnitContentPlan, missing: number): UnitContentPlan {
  const count = Math.max(1, missing);
  return { ...plan, cards: { min: count, target: count, max: count } };
}

export interface DrillBatchPromptInput extends UnitPromptInput {
  /** The Unit's finalized cards: the Drills test these rules. */
  cards: Array<Pick<BriefingCard, 'headline' | 'keyTakeaway' | 'sourcePages'>>;
  kinds: readonly DrillKind[];
  /** Prompts of Drills already written for this Unit (do not repeat them). */
  previousDrillPrompts: string[];
  batchIndex: number;
  batchCount: number;
}

/** Synthetic first and last names, handed out so no two Drills of a Track reuse a person (review 2026-11-23). */
const DRILL_NAMES = [
  'Ana Torres', 'Ben Okafor', 'Carla Nguyen', 'Dev Shah', 'Erin Walsh', 'Farah Haddad', 'Gus Lindqvist', 'Hana Sato',
  'Ivan Petrov', 'June Park', 'Kofi Mensah', 'Lena Fischer', 'Mateo Ruiz', 'Nadia Karim', 'Owen Brady', 'Paula Costa',
  'Quinn Reyes', 'Rosa Delgado', 'Sam Whitaker', 'Tara Singh', 'Umar Aziz', 'Vera Novak', 'Wes Harlow', 'Xin Li',
  'Yara Haddad', 'Zane Cooper', 'Alma Ortiz', 'Boris Klein', 'Cleo Grant', 'Dario Rossi', 'Ella Morgan', 'Felix Wu',
  'Gia Romano', 'Hugo Lambert', 'Iris Holt', 'Jonah Price', 'Kira Novak', 'Luis Moreno', 'Mina Cho', 'Nico Ferreira',
  'Olga Ivanova', 'Pedro Alves', 'Rhea Kapoor', 'Silas Boone', 'Tess Mahoney', 'Uri Levin', 'Viola Bennett', 'Wade Ellis',
  'Abby Lowell', 'Bruno Silva', 'Celia Hart', 'Dmitri Volkov', 'Esme Quinn', 'Femi Adeyemi', 'Grace Tanaka', 'Hector Ramos',
  'Ines Duarte', 'Jasper Cole', 'Keiko Mori', 'Leo Marchetti', 'Mara Lindgren', 'Nate Ortega', 'Odette Blanc', 'Pavel Novak',
  'Ruth Adler', 'Sergio Pena', 'Talia Ward', 'Umberto Ricci', 'Vanessa Cruz', 'Will Hensley', 'Ximena Rojas', 'Yusuf Demir',
  'Zoe Kaplan', 'Arjun Mehta', 'Bianca Ferraro', 'Colin Byrne', 'Daria Petrenko', 'Elias Haddad', 'Fiona Walsh', 'Gabe Turner',
  'Holly Chen', 'Ibrahim Saleh', 'Janet Okoro', 'Kai Nakamura', 'Lucia Vega', 'Milo Grant', 'Nora Fitzgerald', 'Oscar Lund',
  'Priya Raman', 'Reed Calloway', 'Sana Qureshi', 'Theo Lambert', 'Ursula Krebs', 'Victor Osei', 'Wren Doyle', 'Yasmin Farah',
];
const NAMES_PER_BATCH = 4;

/** The names a Drill batch may use: different for every Unit and batch of a Track (wraps after 12 batches). */
export function drillBatchNames(unitIndex: number, batchIndex: number): string[] {
  const start = ((unitIndex * 2 + batchIndex) * NAMES_PER_BATCH) % DRILL_NAMES.length;
  return Array.from({ length: NAMES_PER_BATCH }, (_, offset) => DRILL_NAMES[(start + offset) % DRILL_NAMES.length]);
}

/** Split mode, call 2..n: one batch of Drills of planned kinds. */
export function buildUnitDrillsUserPrompt(input: DrillBatchPromptInput): string {
  return `${unitContextPrefix(input)}\n${[
    'BRIEFINGCARDS OF THIS UNIT (the Drills test these rules):',
    ...input.cards.map((card, index) => `${index + 1}. ${card.headline} — ${card.keyTakeaway} (pages ${card.sourcePages.join(', ')})`),
    input.previousDrillPrompts.length > 0
      ? `Drills already written for this Unit (do not test the same situation or rule again, even with a different Drill kind): ${input.previousDrillPrompts.join(' | ')}`
      : '',
    `Names for people in these Drills (use each for one person only, and no other names): ${drillBatchNames(input.outline.orderIndex, input.batchIndex).join(', ')}.`,
    '',
    `TASK (Drill batch ${input.batchIndex + 1} of ${input.batchCount}): Write exactly ${input.kinds.length} Drills, one of each kind in this order: ${input.kinds.join(', ')}.`,
    ...(input.kinds.some((kind) => FLEXIBLE_DRILL_KINDS.has(kind))
      ? ['If these pages give no fixed-order procedure (for SEQUENCE_ORDER) or no natural pairs (for MATCH_PAIRS), write a MULTIPLE_CHOICE scenario Drill in that slot instead. Never invent an order or pairing. Write that Drill\'s prompt as a plain question about a caller situation; never mention the swap, the Drill kind, or why.']
      : []),
    'Each Drill tests a different rule from the cards above with one clear correct answer.',
    'Return {"drills": [ ... ]} only.',
  ]
    .filter((line) => line !== '')
    .join('\n')}`;
}

/** A trainer hint is the first thing the model reads, as a hard requirement (a 7B model ignores a trailing hint). */
function trainerRequirement(hint: string | undefined): string[] {
  const trimmed = hint?.trim();
  return trimmed
    ? [`TRAINER REQUIREMENT (must follow; it overrides the current item): ${trimmed}`, '']
    : [];
}

export function buildRegenerateCardUserPrompt(input: UnitPromptInput & { current: BriefingCard; siblingHeadlines: string[]; trainerHint?: string }): string {
  return [
    ...trainerRequirement(input.trainerHint),
    ...contextBlock(input),
    '',
    'TASK: Write ONE new BriefingCard that replaces the current card below. Teach the same rule area, with better clarity and accuracy.',
    `Current card (being replaced; do not copy it): ${JSON.stringify({ headline: input.current.headline, keyTakeaway: input.current.keyTakeaway })}`,
    input.siblingHeadlines.length > 0 ? `Other cards in this Unit (do not repeat them): ${input.siblingHeadlines.join('; ')}` : '',
    input.trainerHint ? `Remember the TRAINER REQUIREMENT: ${input.trainerHint.trim()}` : '',
    'Return the BriefingCard JSON object only.',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

export function buildRegenerateDrillUserPrompt(input: UnitPromptInput & { current: DrillItem; siblingPrompts: string[]; trainerHint?: string }): string {
  return [
    ...trainerRequirement(input.trainerHint),
    ...contextBlock(input),
    '',
    `TASK: Write ONE new Drill of kind ${input.current.kind} that replaces the current Drill below. Keep "kind": "${input.current.kind}". Test a rule from the SOURCE PAGES, with a clear correct answer.`,
    // Only the prompt: a full copy of the old Drill invites the model to return it unchanged.
    `Current Drill (being replaced; do not copy it): ${JSON.stringify(input.current.prompt)}`,
    input.siblingPrompts.length > 0 ? `Other Drills in this Unit (do not repeat them): ${input.siblingPrompts.join('; ')}` : '',
    input.trainerHint ? `Remember the TRAINER REQUIREMENT: ${input.trainerHint.trim()}` : '',
    'Return the Drill JSON object only.',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

// ---------- Deterministic post-processing ----------

/** Final BriefingCard with a stable id, clamped lengths, valid pages, and server-resolved evidence. */
export function finalizeBriefingCard(
  card: CardGeneration,
  id: string,
  allowedPages: number[],
  evidenceSource?: EvidenceSource,
): BriefingCard {
  const allowed = new Set(allowedPages);
  return BriefingCardSchema.parse({
    id,
    headline: clampText(card.headline, 90),
    bodyMarkdown: clampMultiline(card.bodyMarkdown, 600),
    keyTakeaway: clampText(card.keyTakeaway, 160),
    doList: card.doList.slice(0, 4).map((item) => clampText(item, 140)).filter(Boolean),
    dontList: card.dontList.slice(0, 4).map((item) => clampText(item, 140)).filter(Boolean),
    sourcePages: sanitizePages(card.sourcePages, allowed, allowedPages.slice(0, 1)),
    ...(card.evidence
      ? { evidence: finalizeEvidenceProposals(card.evidence, id, { source: evidenceSource, allowedLabels: allowedPages }) }
      : {}),
  });
}

/** Final Drill with a stable id (sub-ids derived from it), clamped lengths, valid pillar and pages. */
export function finalizeDrill(drill: DrillGeneration, id: string, ctx: UnitBuildContext): DrillItem {
  const allowed = new Set(ctx.allowedPages);
  const base = {
    id,
    competencyPillarId: ctx.pillarIds.includes(drill.competencyPillarId) ? drill.competencyPillarId : ctx.pillarIds[0],
    prompt: clampText(drill.prompt, 300),
    sourcePages: sanitizePages(drill.sourcePages, allowed, ctx.allowedPages.slice(0, 1)),
    ...(drill.evidence
      ? { evidence: finalizeEvidenceProposals(drill.evidence, id, { source: ctx.evidenceSource, allowedLabels: ctx.allowedPages }) }
      : {}),
  };
  const explanation = clampText(drill.explanation?.trim() || fallbackExplanation(base.evidence, base.sourcePages), 350);
  Object.assign(base, { explanation });
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
        orderedSteps: drill.orderedSteps.slice(0, 5).map((step, index) => ({ id: `${id}-s${index + 1}`, text: clampText(step.text, 140) })),
      });
    case 'MATCH_PAIRS':
      return MatchPairsDrillSchema.parse({
        ...base,
        kind: 'MATCH_PAIRS',
        pairs: drill.pairs.slice(0, 4).map((pair, index) => {
          // A cut side ("…") makes pairs ambiguous; an over-long side drops the Drill instead (repair asks first).
          if (pair.leftPrompt.trim().length > MAX_PAIR_SIDE_CHARS || pair.rightMatch.trim().length > MAX_PAIR_SIDE_CHARS) {
            throw new Error(`MATCH_PAIRS pair ${index + 1} has a side longer than ${MAX_PAIR_SIDE_CHARS} characters.`);
          }
          return { id: `${id}-p${index + 1}`, leftPrompt: pair.leftPrompt.trim(), rightMatch: pair.rightMatch.trim() };
        }),
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

/** Explanation for a Drill whose model output had none: the exact Playbook passage it rests on. */
export function fallbackExplanation(evidence: readonly ClaimEvidence[] | undefined, sourcePages: readonly number[]): string {
  const page = sourcePages[0];
  const excerpt = evidence?.find((item) => item.support === 'supported')?.excerpts[0] ?? evidence?.[0]?.excerpts[0];
  if (excerpt) return `The Playbook${page ? ` (page ${page})` : ''} says: “${clampText(excerpt.exactText, 290)}”`;
  return `See the Playbook rule${page ? ` on page ${page}` : ''} this Drill is based on.`;
}

export interface SalvageResult<T> {
  items: T[];
  /** One line per dropped item: index and first problem. */
  dropped: string[];
}

const ITEM_MARKERS: Record<'drills' | 'briefingCards', string> = { drills: 'kind', briefingCards: 'headline' };

function rawItems(raw: string, key: 'drills' | 'briefingCards'): unknown[] | null {
  const parsed = parseStructuredOutput(raw, z.unknown());
  if (parsed.ok) {
    const value = parsed.data;
    if (Array.isArray(value) && value.some((item) => item && typeof item === 'object')) return value;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const list = (value as Record<string, unknown>)[key];
      if (Array.isArray(list)) return list;
    }
  }
  // The wrapper did not parse (one broken card, a missing bracket): recover every item object that does.
  const items = parseableItemObjects(raw, ITEM_MARKERS[key]);
  return items.length > 0 ? items : null;
}

/**
 * Every balanced, parseable {...} object in `raw` that has the `marker` key, scanning left to right and skipping
 * the inside of an object once it parsed. String contents (with escapes) never count as braces.
 */
export function parseableItemObjects(raw: string, marker: string): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  for (let start = raw.indexOf('{'); start !== -1; ) {
    let depth = 0;
    let inString = false;
    let end = -1;
    for (let index = start; index < raw.length; index++) {
      const char = raw[index];
      if (inString) {
        if (char === '\\') index++;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') inString = true;
      else if (char === '{') depth++;
      else if (char === '}' && --depth === 0) {
        end = index;
        break;
      }
    }
    let next = start + 1;
    if (end !== -1) {
      try {
        const value: unknown = JSON.parse(raw.slice(start, end + 1));
        if (value && typeof value === 'object' && !Array.isArray(value) && marker in value) {
          found.push(value as Record<string, unknown>);
          next = end + 1;
        }
      } catch {
        // Not parseable as a whole: look for a smaller object inside it.
      }
    }
    start = raw.indexOf('{', next);
  }
  return found;
}

/**
 * Salvage a Drill batch whose repair loop failed: validate every Drill on its own (model schema,
 * Unit rules, then the strict stored finalize rules) and keep the valid ones. Planned kinds come
 * first; valid extras of other kinds fill remaining slots. Exact-evidence matching is lenient here:
 * unresolvable excerpts are stored unsupported for trainer review.
 */
export function salvageDrillBatch(
  raw: string,
  ctx: UnitBuildContext,
  kinds: readonly DrillKind[],
  idFor: (index: number) => string,
): SalvageResult<DrillItem> {
  const items = rawItems(raw, 'drills');
  if (!items) return { items: [], dropped: ['The answer was not readable JSON.'] };
  const lenient: UnitBuildContext = { ...ctx, strictEvidence: false };
  const valid: DrillGeneration[] = [];
  const dropped: string[] = [];
  items.forEach((item, index) => {
    const parsed = DrillGenerationSchema.safeParse(item);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      dropped.push(`drills.${index}${issue?.path.length ? `.${issue.path.join('.')}` : ''}: ${issue?.message ?? 'invalid'}`);
      return;
    }
    const problems: string[] = [];
    checkDrill(parsed.data, lenient, [], (path, message) => problems.push(`${path.join('.') || 'drill'}: ${message}`));
    if (problems.length > 0) {
      dropped.push(`drills.${index}.${problems[0]}`);
      return;
    }
    valid.push(parsed.data);
  });
  const planned = pickPlannedDrills(valid, kinds);
  const extras = valid.filter((drill) => !planned.includes(drill)).slice(0, Math.max(0, kinds.length - planned.length));
  const finalized: DrillItem[] = [];
  for (const drill of [...planned, ...extras]) {
    try {
      finalized.push(finalizeDrill(drill, idFor(finalized.length), lenient));
    } catch (error) {
      dropped.push(`${drill.kind}: ${error instanceof Error ? error.message.slice(0, 160) : 'failed final checks'}`);
    }
  }
  return { items: finalized, dropped };
}

/** Salvage the cards call the same way: keep every card that passes on its own. */
export function salvageCards(raw: string, ctx: UnitBuildContext, idFor: (index: number) => string): SalvageResult<BriefingCard> {
  const items = rawItems(raw, 'briefingCards');
  if (!items) return { items: [], dropped: ['The answer was not readable JSON.'] };
  const lenient: UnitBuildContext = { ...ctx, strictEvidence: false };
  const allowed = new Set(ctx.allowedPages);
  const cards: BriefingCard[] = [];
  const dropped: string[] = [];
  items.forEach((item, index) => {
    const parsed = CardItemSchema.safeParse(item);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      dropped.push(`briefingCards.${index}${issue?.path.length ? `.${issue.path.join('.')}` : ''}: ${issue?.message ?? 'invalid'}`);
      return;
    }
    const problems: string[] = [];
    const report: IssueSink = (path, message) => problems.push(`${path.join('.') || 'card'}: ${message}`);
    checkPages(parsed.data.sourcePages, allowed, ['sourcePages'], report);
    checkRequiredEvidence(parsed.data.evidence, lenient, ['evidence'], report);
    if (problems.length > 0) {
      dropped.push(`briefingCards.${index}.${problems[0]}`);
      return;
    }
    try {
      cards.push(finalizeBriefingCard(parsed.data, idFor(cards.length), ctx.allowedPages, ctx.evidenceSource));
    } catch (error) {
      dropped.push(`briefingCards.${index}: ${error instanceof Error ? error.message.slice(0, 160) : 'failed final checks'}`);
    }
  });
  return { items: cards, dropped };
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

/** Estimated minutes for a Unit: ~40 s per BriefingCard and ~45 s per Drill, clamped to 2-15. */
export function estimateUnitMinutes(cardCount: number, drillCount: number): number {
  return Math.min(15, Math.max(2, Math.round((cardCount * 40 + drillCount * 45) / 60)));
}

/** Build the final TrackUnit from a validated generation with stable ids `u1`, `u1-c1`, `u1-d1`. */
export function finalizeUnit(outline: UnitOutline, generated: UnitGeneration, ctx: UnitBuildContext): TrackUnit {
  const briefingCards = generated.briefingCards
    .slice(0, MAX_BRIEFING_CARDS)
    .map((card, index) => finalizeBriefingCard(card, `${outline.id}-c${index + 1}`, ctx.allowedPages, ctx.evidenceSource));
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
