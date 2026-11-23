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
const GENERIC_QUESTION = /^(does|is|do) (this|the) (agent|action|statement|response|reply|step)\b[^.?!]{0,60}\?$/i;

export function isGenericDrillPrompt(prompt: string): boolean {
  const flat = prompt.trim();
  return flat.length < 12 || GENERIC_PROMPT.test(flat) || GENERIC_QUESTION.test(flat);
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
