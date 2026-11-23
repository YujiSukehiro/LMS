/**
 * Content depth: size a Track from what the source pages actually contain.
 *
 * Before this module the pipeline asked for a fixed 3-6 Units per Track and a fixed
 * 3-5 BriefingCards / 5-7 Drills per Unit, no matter if the Playbook was a 2-page
 * flyer or a 40-page SOP. Here we count the teachable rules on each page and derive:
 *   - a Unit range for the whole Track (Pass 1 Blueprint), and
 *   - a BriefingCard and Drill range for each Unit (Pass 2 Unit Builder).
 *
 * Pure functions only (no Firebase, no model calls) so they are cheap to unit test.
 */

/** Part of the stage cache identity: change it when the sizing rules change. */
export const CONTENT_SIZING_VERSION = 'content-depth-v2';

/** Hard limits. The Track schema and Studio UI are sized for these. */
export const DEPTH_LIMITS = {
  minUnits: 2,
  maxUnits: 12,
  minCards: 2,
  maxCards: 8,
  minDrills: 4,
  maxDrills: 10,
} as const;

export type DepthLimits = { [K in keyof typeof DEPTH_LIMITS]: number };

/**
 * Smaller per-Unit maximums for local models (Ollama / OpenAI-compatible MLX). A 7B model writes
 * reliable JSON for a few cards or Drills per call; the Unit count stays the same.
 */
export const LOCAL_DEPTH_LIMITS: DepthLimits = {
  ...DEPTH_LIMITS,
  maxCards: 5,
  maxDrills: 6,
};

/** Depth limits for the active provider. Local providers get the smaller per-Unit maximums. */
export function depthLimitsForProvider(provider: string): DepthLimits {
  return provider === 'ollama' || provider === 'openai_compatible' ? LOCAL_DEPTH_LIMITS : DEPTH_LIMITS;
}

/** Tuning: about how many rule signals one Unit, one card, and one Drill should carry. */
const RULES_PER_UNIT = 12;
const WORDS_PER_UNIT = 900;
const RULES_PER_CARD = 2;
const DRILLS_PER_CARD = 1.4;

export interface CountRange {
  min: number;
  target: number;
  max: number;
  /** The trainer picked this number: the prompt asks for exactly `target`, and `min`/`max` are the tolerated miss. */
  exact?: boolean;
}

export interface PageDepth {
  pageNumber: number;
  words: number;
  /** Lines or sentences that state a rule, step, value, or condition. */
  ruleSignals: number;
  /** Short heading-like lines (section starts). */
  headings: number;
}

export interface SourceDepth {
  pages: PageDepth[];
  words: number;
  ruleSignals: number;
  headings: number;
  /** Pages that hold at least one rule signal. */
  operationalPages: number;
  units: CountRange;
}

export interface UnitContentPlan {
  cards: CountRange;
  drills: CountRange;
  /** Weighted rule signals assigned to this Unit (pages shared by Units are split). */
  ruleSignals: number;
}

const RULE_WORDS =
  /\b(must|never|always|required?|requires|do not|don't|only|cannot|can't|should|ensure|verify|confirm|escalate|transfer|disposition|before|after|if|when|unless|within|max(?:imum)?|min(?:imum)?|policy|step)\b/i;
const VALUE_PATTERN = /(\$\s?\d|\d+\s?(?:%|days?|hours?|hrs?|minutes?|mins?|business days|mg|ml|weeks?|months?))/i;
const LIST_ITEM = /^\s*(?:[-*•▪◦●]|\d{1,2}[.)]|[a-z][.)]|step\s+\d+)\s+/i;

function wordCount(text: string): number {
  const words = text.trim().split(/\s+/);
  return words[0] === '' ? 0 : words.length;
}

function isHeading(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length < 3 || trimmed.length > 70) return false;
  if (/[.;,]$/.test(trimmed) || LIST_ITEM.test(trimmed)) return false;
  const words = wordCount(trimmed);
  if (words === 0 || words > 8) return false;
  const letters = trimmed.replace(/[^A-Za-z]/g, '');
  if (letters.length < 3) return false;
  const upperShare = letters.replace(/[^A-Z]/g, '').length / letters.length;
  const titleCase = trimmed.split(/\s+/).filter((word) => /^[A-Z0-9]/.test(word)).length >= Math.ceil(words * 0.6);
  return upperShare > 0.7 || titleCase || /:$/.test(trimmed);
}

/** Measure one page. Long prose lines are split into sentences so a dense paragraph counts fully. */
export function measurePage(pageNumber: number, text: string): PageDepth {
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  let ruleSignals = 0;
  let headings = 0;
  for (const line of lines) {
    if (isHeading(line)) {
      headings += 1;
      continue;
    }
    const units = LIST_ITEM.test(line) ? [line] : line.split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/);
    for (const unit of units) {
      if (wordCount(unit) < 4) continue;
      if (LIST_ITEM.test(unit) || RULE_WORDS.test(unit) || VALUE_PATTERN.test(unit)) ruleSignals += 1;
    }
  }
  return { pageNumber, words: wordCount(text), ruleSignals, headings };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function rangeAround(target: number, min: number, max: number, spread = 1): CountRange {
  const t = clamp(Math.round(target), min, max);
  return { min: clamp(t - spread, min, max), target: t, max: clamp(t + spread, min, max) };
}

/** Recommend a Unit range from the whole source. */
export function measureSourceDepth(pages: ReadonlyArray<{ pageNumber: number; text: string }>): SourceDepth {
  const measured = pages.map((page) => measurePage(page.pageNumber, page.text));
  const words = measured.reduce((sum, page) => sum + page.words, 0);
  const ruleSignals = measured.reduce((sum, page) => sum + page.ruleSignals, 0);
  const headings = measured.reduce((sum, page) => sum + page.headings, 0);
  const operationalPages = measured.filter((page) => page.ruleSignals > 0).length;
  // Rules drive the count. Word volume and section headings keep rule-light prose from collapsing to one Unit.
  const byRules = ruleSignals / RULES_PER_UNIT;
  const byWords = words / WORDS_PER_UNIT;
  const bySections = headings / 6;
  const target = Math.max(byRules, (byRules + byWords + bySections) / 3);
  const spread = target >= 7 ? 2 : 1;
  return {
    pages: measured,
    words,
    ruleSignals,
    headings,
    operationalPages,
    units: rangeAround(target, DEPTH_LIMITS.minUnits, DEPTH_LIMITS.maxUnits, spread),
  };
}

/**
 * Unit range when a trainer picks a target on the Content map (kept inside the absolute limits).
 * With `source`, a large target on a tiny PDF is clamped: at most 2 Units per page with rules and
 * one Unit per ~4 rule statements, so the model is never asked to split 3 rules into 12 Units.
 */
export function unitRangeForTarget(target: number): CountRange {
  // The trainer chose this count on the Content map (which already warns when it is outside the measured range),
  // so the build asks for exactly that many and tolerates one more or one fewer (QA M5: "Build 9" built 8).
  return { ...rangeAround(target, DEPTH_LIMITS.minUnits, DEPTH_LIMITS.maxUnits), exact: true };
}

/** Plain note when a build's Checkpoint count differs from the trainer's choice, or null when it matches. */
export function unitCountNote(built: number, requested: number | null | undefined): string | null {
  if (!requested || built === requested) return null;
  return `${built} checkpoints built (you asked for ${requested}; the Playbook's rules fit ${built}).`;
}

/** Rough learner time for a Track: ~40 s per card, ~45 s per Drill, ~6 min per Live Call Sim. */
export function estimateTrackMinutes(units: number, ruleSignals: number, sims = 2): number {
  const perUnit = planForRuleSignals(units > 0 ? ruleSignals / units : 0);
  const unitSeconds = perUnit.cards.target * 40 + perUnit.drills.target * 45;
  return Math.round((units * unitSeconds) / 60 + sims * 6);
}

/** Card and Drill range for a Unit with this many rule signals. */
export function planForRuleSignals(ruleSignals: number, limits: DepthLimits = DEPTH_LIMITS): UnitContentPlan {
  const cards = rangeAround(ruleSignals / RULES_PER_CARD, limits.minCards, limits.maxCards);
  const drills = rangeAround(cards.target * DRILLS_PER_CARD, limits.minDrills, limits.maxDrills);
  return { cards, drills, ruleSignals: Math.round(ruleSignals * 10) / 10 };
}

/** Clamp an existing plan (for example a cached or default one) into provider limits. */
export function clampPlanToLimits(plan: UnitContentPlan, limits: DepthLimits): UnitContentPlan {
  const fit = (range: CountRange, min: number, max: number): CountRange => {
    const target = clamp(range.target, min, max);
    return { min: clamp(Math.min(range.min, target), min, max), target, max: clamp(Math.max(range.max, target), min, max) };
  };
  return { ...plan, cards: fit(plan.cards, limits.minCards, limits.maxCards), drills: fit(plan.drills, limits.minDrills, limits.maxDrills) };
}

/** The plan we used before content depth existed. Kept for callers with no page text. */
export const DEFAULT_UNIT_CONTENT_PLAN: UnitContentPlan = {
  cards: { min: 3, target: 4, max: 5 },
  drills: { min: 5, target: 6, max: 7 },
  ruleSignals: 0,
};

/**
 * Plan every Unit. A page cited by N Units gives each of them 1/N of its rule signals,
 * so shared pages do not inflate the Track.
 */
export function planUnitContent(
  depth: Pick<SourceDepth, 'pages'>,
  unitPages: ReadonlyArray<ReadonlyArray<number>>,
  limits: DepthLimits = DEPTH_LIMITS,
): UnitContentPlan[] {
  const byPage = new Map(depth.pages.map((page) => [page.pageNumber, page]));
  const citeCount = new Map<number, number>();
  for (const pages of unitPages) for (const page of new Set(pages)) citeCount.set(page, (citeCount.get(page) ?? 0) + 1);
  return unitPages.map((pages) => {
    let signals = 0;
    for (const page of new Set(pages)) {
      const measured = byPage.get(page);
      if (measured) signals += measured.ruleSignals / (citeCount.get(page) ?? 1);
    }
    return planForRuleSignals(signals, limits);
  });
}

export function describeRange(range: Pick<CountRange, 'min' | 'max'>): string {
  return range.min === range.max ? `${range.min}` : `${range.min} to ${range.max}`;
}

/** Units below the published minimums (2 BriefingCards, 4 Drills), in plain words. */
export function thinUnitProblems(units: Array<{ orderIndex: number; title: string; briefingCards: unknown[]; drills: unknown[] }>): string[] {
  return units.flatMap((unit) => {
    const missing: string[] = [];
    if (unit.briefingCards.length < DEPTH_LIMITS.minCards) missing.push(`${unit.briefingCards.length} of ${DEPTH_LIMITS.minCards} Briefing Cards`);
    if (unit.drills.length < DEPTH_LIMITS.minDrills) missing.push(`${unit.drills.length} of ${DEPTH_LIMITS.minDrills} Drills`);
    return missing.length > 0 ? [`Checkpoint ${unit.orderIndex + 1} (${unit.title}) has only ${missing.join(' and ')}.`] : [];
  });
}
