import type { DrillItem } from '@/lib/schemas/curriculum';
import { LearnerDrillSchema, type DrillAnswer, type LearnerDrill } from '@/lib/schemas/learning';

function normalizeWord(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function sortedMatchPairs(drill: Extract<DrillItem, { kind: 'MATCH_PAIRS' }>) {
  return [...drill.pairs].sort((left, right) => left.id.localeCompare(right.id));
}

function learnerMatchRightId(pairIndex: number, pairCount: number): string {
  return `right-${(pairIndex + 1) % pairCount}`;
}

function learnerSequenceSteps(drill: Extract<DrillItem, { kind: 'SEQUENCE_ORDER' }>) {
  const rotated = [...drill.orderedSteps.slice(1), drill.orderedSteps[0]];
  return rotated.map((step, displayIndex) => ({ id: `step-${displayIndex}`, text: step.text }));
}

function learnerSequenceId(drill: Extract<DrillItem, { kind: 'SEQUENCE_ORDER' }>, canonicalId: string): string {
  const canonicalIndex = drill.orderedSteps.findIndex((step) => step.id === canonicalId);
  const displayIndex = (canonicalIndex - 1 + drill.orderedSteps.length) % drill.orderedSteps.length;
  return `step-${displayIndex}`;
}

/**
 * The learner-shaped Drill with the same option ids the grader expects (`right-N`, `step-N`), without schema
 * parsing. Studio test-play uses this on draft Drills so its answers grade the same way a learner's do.
 */
export function learnerDrillView(drill: DrillItem): LearnerDrill {
  const base = {
    id: drill.id,
    competencyPillarId: drill.competencyPillarId,
    prompt: drill.prompt,
    ruleIds: drill.ruleIds ?? [],
    variationOfDrillId: drill.variationOfDrillId,
  };
  let learner: LearnerDrill;
  switch (drill.kind) {
    case 'MULTIPLE_CHOICE':
      learner = { ...base, kind: drill.kind, options: drill.options.map((option) => ({ ...option })) };
      break;
    case 'TRUE_FALSE_SPOT':
      learner = { ...base, kind: drill.kind, statement: drill.statement };
      break;
    case 'SEQUENCE_ORDER':
      learner = { ...base, kind: drill.kind, steps: learnerSequenceSteps(drill) };
      break;
    case 'MATCH_PAIRS': {
      const pairs = sortedMatchPairs(drill);
      learner = {
        ...base,
        kind: drill.kind,
        leftOptions: pairs.map((pair) => ({ id: pair.id, text: pair.leftPrompt })),
        rightOptions: pairs.map((pair, index) => ({
          id: `right-${index}`,
          text: pairs[(index - 1 + pairs.length) % pairs.length].rightMatch,
        })),
      };
      break;
    }
    case 'FILL_BLANK_CHOICE':
      learner = { ...base, kind: drill.kind, sentenceTemplate: drill.sentenceTemplate, wordBank: [...drill.wordBank] };
      break;
  }
  return learner;
}

/** Stable, non-canonical learner order and opaque aliases. Correct order and pair mapping remain server-only. */
export function sanitizeDrillForLearner(drill: DrillItem): LearnerDrill {
  return LearnerDrillSchema.parse(learnerDrillView(drill));
}

/** The approved rule mapping used by mastery analytics; evidence mappings are a compatibility fallback. */
export function drillRuleIds(drill: DrillItem): string[] {
  const explicit = drill.ruleIds ?? [];
  return [...new Set([
    ...explicit,
    ...(explicit.length === 0 ? (drill.evidence ?? []).flatMap((evidence) => evidence.ruleIds) : []),
  ])];
}

export function gradeDrillAnswer(drill: DrillItem, answer: DrillAnswer): boolean {
  if (answer.kind !== drill.kind) return false;
  switch (drill.kind) {
    case 'MULTIPLE_CHOICE':
      return answer.kind === 'MULTIPLE_CHOICE' && answer.optionId === drill.correctOptionId;
    case 'TRUE_FALSE_SPOT':
      return answer.kind === 'TRUE_FALSE_SPOT' && answer.isCompliant === drill.isCompliant;
    case 'SEQUENCE_ORDER':
      return answer.kind === 'SEQUENCE_ORDER' &&
        answer.orderedStepIds.length === drill.orderedSteps.length &&
        new Set(answer.orderedStepIds).size === drill.orderedSteps.length &&
        drill.orderedSteps.every((step, index) =>
          answer.kind === 'SEQUENCE_ORDER' && answer.orderedStepIds[index] === learnerSequenceId(drill, step.id));
    case 'MATCH_PAIRS': {
      if (answer.kind !== 'MATCH_PAIRS') return false;
      const pairs = sortedMatchPairs(drill);
      const expected = new Map(pairs.map((pair, index) => [pair.id, learnerMatchRightId(index, pairs.length)]));
      return Object.keys(answer.matches).length === pairs.length &&
        pairs.every((pair) => answer.kind === 'MATCH_PAIRS' && answer.matches[pair.id] === expected.get(pair.id));
    }
    case 'FILL_BLANK_CHOICE':
      return answer.kind === 'FILL_BLANK_CHOICE' && normalizeWord(answer.word) === normalizeWord(drill.correctWord);
  }
}

/** Returned only after the authoritative submission has been recorded. */
export function correctAnswerForDrill(drill: DrillItem): DrillAnswer {
  switch (drill.kind) {
    case 'MULTIPLE_CHOICE':
      return { kind: drill.kind, optionId: drill.correctOptionId };
    case 'TRUE_FALSE_SPOT':
      return { kind: drill.kind, isCompliant: drill.isCompliant };
    case 'SEQUENCE_ORDER':
      return {
        kind: drill.kind,
        orderedStepIds: drill.orderedSteps.map((step) => learnerSequenceId(drill, step.id)),
      };
    case 'MATCH_PAIRS':
      return {
        kind: drill.kind,
        matches: Object.fromEntries(sortedMatchPairs(drill).map((pair, index) => [
          pair.id,
          learnerMatchRightId(index, drill.pairs.length),
        ])),
      };
    case 'FILL_BLANK_CHOICE':
      return { kind: drill.kind, word: drill.correctWord };
  }
}
