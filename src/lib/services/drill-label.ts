/**
 * A short, specific label for a Drill in "most missed" lists (QA M7). Generic prompts such as
 * "Complete the Playbook rule." tell a trainer nothing, so those show the Drill's own content instead.
 */
import type { DrillItem } from '@/lib/schemas/curriculum';

const LABEL_MAX = 80;
const GENERIC_PROMPT = /^(complete|fill in|finish|choose|select|pick|match|put|order|answer)\b[^.?!]{0,40}(rule|blank|sentence|word|statement|steps?|pairs?|items?|question|answer|order)\b[^.?!]*[.?!]?$/i;

function clip(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > LABEL_MAX ? `${flat.slice(0, LABEL_MAX - 1).trimEnd()}…` : flat;
}

/** "Does this agent action follow the Playbook?" and similar: the question is the same for every Drill of its kind. */
const GENERIC_QUESTION = /^(does|is|do) (this|the) (agent|action|statement|response|reply|step)\b[^.?!]{0,60}\?$|^decide (whether|if)\b[^.?!]{0,80}[.?]?$/i;

export function isGenericDrillPrompt(prompt: string): boolean {
  const flat = prompt.trim();
  return flat.length < 12 || GENERIC_PROMPT.test(flat) || GENERIC_QUESTION.test(flat);
}

/**
 * What a Drill actually tests, whatever its prompt says. True/False prompts are all alike ("Decide whether the
 * agent's action follows the Playbook."), so a later Drill batch told only the prompts repeated the same situation
 * in every Checkpoint (review 2026-11-23). Used in the "already written" list of the next batch.
 */
export function drillSummary(drill: DrillItem): string {
  switch (drill.kind) {
    case 'TRUE_FALSE_SPOT':
      return `True/False: ${clip(drill.statement)}`;
    case 'FILL_BLANK_CHOICE':
      return `Fill-in: ${clip(drill.sentenceTemplate.replace(/\{\{BLANK\}\}/g, '___'))}`;
    case 'MATCH_PAIRS':
      return `Match: ${clip(drill.pairs.map((pair) => pair.leftPrompt).join(', '))}`;
    case 'SEQUENCE_ORDER':
      return `Order: ${clip(drill.prompt)}`;
    default:
      return `Choice: ${clip(drill.prompt)}`;
  }
}

export function drillLabel(drill: DrillItem): string {
  if (!isGenericDrillPrompt(drill.prompt)) return clip(drill.prompt);
  switch (drill.kind) {
    case 'FILL_BLANK_CHOICE':
      return clip(drill.sentenceTemplate.replace(/\{\{BLANK\}\}/g, '___'));
    case 'TRUE_FALSE_SPOT':
      return clip(drill.statement);
    case 'MATCH_PAIRS':
      return clip(`${drill.prompt.replace(/[.?!]$/, '')}: ${drill.pairs.map((pair) => pair.leftPrompt).join(', ')}`);
    case 'SEQUENCE_ORDER':
      return clip(`${drill.prompt.replace(/[.?!]$/, '')}: ${drill.orderedSteps[0]?.text ?? ''}…`);
    default:
      return clip(drill.prompt);
  }
}

/**
 * A step that only applies in some situations ("If unsure…", "Stop sharing if uncertain whether…") cannot sit in a
 * fixed order (feedback 2026-11-23: a "Call-Flow Order" Drill mixed privacy options with steps). Exported for tests.
 */
export function isConditionalStep(text: string): boolean {
  const flat = text.trim();
  return /^(if|when|whenever|unless|only if|in case|otherwise)\b/i.test(flat) || /\b(if|when) (you are |you're |it is |it's )?(uncertain|unsure|not sure|in doubt)\b|\bwhether\b/i.test(flat);
}

function drillText(drill: DrillItem): string {
  switch (drill.kind) {
    case 'TRUE_FALSE_SPOT':
      return drill.statement;
    case 'SEQUENCE_ORDER':
      return drill.orderedSteps.map((step) => step.text).join(' ');
    case 'MATCH_PAIRS':
      return drill.pairs.map((pair) => `${pair.leftPrompt} ${pair.rightMatch}`).join(' ');
    case 'FILL_BLANK_CHOICE':
      return drill.sentenceTemplate;
    case 'MULTIPLE_CHOICE':
      return `${drill.prompt} ${drill.options.find((option) => option.id === drill.correctOptionId)?.text ?? ''}`;
  }
}

const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'their', 'agent', 'patient', 'must', 'not', 'are', 'was', 'from', 'into', 'any', 'all', 'only', 'before', 'after', 'when', 'what', 'which', 'should', 'does', 'follow', 'playbook']);

function contentWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 2 && !STOP.has(word)),
  );
}

/** Content-word overlap (0..1) of two Drills of the same kind; 0 for different kinds. */
export function drillOverlap(left: DrillItem, right: DrillItem): number {
  if (left.kind !== right.kind) return 0;
  const a = contentWords(drillText(left));
  const b = contentWords(drillText(right));
  if (a.size === 0 || b.size === 0) return 0;
  const shared = [...a].filter((word) => b.has(word)).length;
  return shared / (a.size + b.size - shared);
}

/** Drills this similar to one in an earlier Checkpoint test the same thing again. */
export const REPEAT_OVERLAP = 0.5;

/**
 * Notes for Drills that repeat a Drill in an earlier Checkpoint (review 2026-11-23: "never sign for the patient" was
 * tested 5 times across 3 Checkpoints). Keyed by Unit index. Pure; used by Studio's attention panel.
 */
export function crossUnitRepeatNotes(units: ReadonlyArray<{ drills: readonly DrillItem[] }>): Map<number, string[]> {
  const notes = new Map<number, string[]>();
  units.forEach((unit, unitIndex) => {
    unit.drills.forEach((drill, drillIndex) => {
      for (let earlier = 0; earlier < unitIndex; earlier += 1) {
        const match = units[earlier].drills.findIndex((other) => drillOverlap(drill, other) >= REPEAT_OVERLAP);
        if (match !== -1) {
          notes.set(unitIndex, [
            ...(notes.get(unitIndex) ?? []),
            `Drill ${drillIndex + 1} repeats Checkpoint ${earlier + 1}, Drill ${match + 1}. Replace it with a rule this Checkpoint has not tested yet.`,
          ]);
          break;
        }
      }
    });
  });
  return notes;
}

/**
 * The prompt names the missing word (review 2026-11-23: "Complete the rule about our Business Associate Agreement
 * (BAA)" with the answer "BAA"). Exported for tests.
 */
export function givesAwayWord(prompt: string, correctWord: string): boolean {
  const word = correctWord.trim();
  return word.replace(/[^a-z0-9]/gi, '').length >= 2 && new RegExp(`(^|[^a-z0-9])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'i').test(prompt);
}

/** "Step 1: Stop the activity", "First -", "2." : a Match Pairs side labelled by position. Exported for tests. */
export function isPositionLabel(text: string): boolean {
  return /^\s*(step\s*\d+|\d+[.):]|(first|second|third|fourth|fifth|last)\b\s*[:.\-–—])/i.test(text);
}


export interface DrillRepeat {
  unitIndex: number;
  drillIndex: number;
  /** The earlier Drill (in an earlier Checkpoint) that already tests this rule. */
  earlier: DrillItem;
  earlierUnitIndex: number;
}

const normRule = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Source quotes long enough to stand for one rule (short phrases like "licensed provider" are shared by many). */
function ruleQuotes(drill: DrillItem): Set<string>[] {
  return (drill.evidence ?? [])
    .flatMap((evidence) => evidence.excerpts.map((excerpt) => normRule(excerpt.exactText)))
    .filter((quote) => quote.length >= 30)
    .map((quote) => contentWords(quote));
}

/** Two quotes state the same rule when most content words of the shorter one are in the longer one. */
function sameRuleQuote(left: Set<string>[], right: Set<string>[]): boolean {
  return left.some((a) => right.some((b) => {
    const [small, large] = a.size <= b.size ? [a, b] : [b, a];
    if (small.size < 4) return false;
    const shared = [...small].filter((word) => large.has(word)).length;
    return shared / small.size >= 0.8;
  }));
}

/**
 * Drills that retest a rule an earlier Checkpoint already tests (review 2026-11-23: "verbal OK never replaces the
 * e-signature" in Checkpoints 3 and 6; "licensed provider" as the fill-in answer in 3 and 5). A repeat is a close
 * rewording of the same kind, a fill-in with the same answer, or a Drill grounded in the same source quote.
 * Pure; at most `limit` repeats, earliest first.
 */
export function findCrossUnitRepeats(units: ReadonlyArray<{ drills: readonly DrillItem[] }>, limit = 8): DrillRepeat[] {
  const repeats: DrillRepeat[] = [];
  units.forEach((unit, unitIndex) => {
    unit.drills.forEach((drill, drillIndex) => {
      if (repeats.length >= limit) return;
      const quotes = ruleQuotes(drill);
      for (let earlierUnitIndex = 0; earlierUnitIndex < unitIndex; earlierUnitIndex += 1) {
        const earlier = units[earlierUnitIndex].drills.find((other) =>
          drillOverlap(drill, other) >= REPEAT_OVERLAP ||
          (drill.kind === 'FILL_BLANK_CHOICE' && other.kind === 'FILL_BLANK_CHOICE' && normRule(drill.correctWord) === normRule(other.correctWord)) ||
          // Match Pairs cite several rules at once, so a shared quote there is not a repeat.
          (drill.kind !== 'MATCH_PAIRS' && other.kind !== 'MATCH_PAIRS' && sameRuleQuote(quotes, ruleQuotes(other))),
        );
        if (earlier) {
          repeats.push({ unitIndex, drillIndex, earlier, earlierUnitIndex });
          return;
        }
      }
    });
  });
  return repeats;
}
