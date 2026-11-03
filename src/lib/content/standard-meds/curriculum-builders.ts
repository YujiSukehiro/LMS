import type { BriefingCard, CanonicalPillarKey, DrillItem, TrackUnit } from '@/lib/schemas/curriculum';
import type { StandardMedsSourceCode } from './source-catalog';

export function pillarId(code: StandardMedsSourceCode, key: CanonicalPillarKey): string {
  return `${code.toLowerCase()}-${key}`;
}

export function card(
  code: StandardMedsSourceCode,
  unitKey: string,
  index: number,
  headline: string,
  bodyMarkdown: string,
  keyTakeaway: string,
  doList: string[],
  dontList: string[],
  sourcePages: number[],
): BriefingCard {
  return { id: `${code.toLowerCase()}-${unitKey}-c${index}`, headline, bodyMarkdown, keyTakeaway, doList, dontList, sourcePages };
}

interface DrillBase {
  code: StandardMedsSourceCode;
  unitKey: string;
  index: number;
  pillar: CanonicalPillarKey;
  prompt: string;
  explanation: string;
  sourcePages: number[];
  ruleIds: string[];
}

function base(input: DrillBase) {
  return {
    id: `${input.code.toLowerCase()}-${input.unitKey}-d${input.index}`,
    competencyPillarId: pillarId(input.code, input.pillar),
    prompt: input.prompt,
    explanation: input.explanation,
    sourcePages: input.sourcePages,
    ruleIds: input.ruleIds,
  };
}

export function multipleChoice(input: DrillBase & { correct: string; distractors: [string, string, string] }): DrillItem {
  return {
    ...base(input),
    kind: 'MULTIPLE_CHOICE',
    options: [
      { id: 'a', text: input.correct },
      { id: 'b', text: input.distractors[0] },
      { id: 'c', text: input.distractors[1] },
      { id: 'd', text: input.distractors[2] },
    ],
    correctOptionId: 'a',
  };
}

export function trueFalse(input: DrillBase & { statement: string; isCompliant: boolean }): DrillItem {
  return { ...base(input), kind: 'TRUE_FALSE_SPOT', statement: input.statement, isCompliant: input.isCompliant };
}

export function sequence(input: DrillBase & { steps: [string, string, string] | [string, string, string, string] | [string, string, string, string, string] }): DrillItem {
  return { ...base(input), kind: 'SEQUENCE_ORDER', orderedSteps: input.steps.map((text, index) => ({ id: `s${index + 1}`, text })) };
}

export function matchPairs(input: DrillBase & { pairs: Array<[string, string]> }): DrillItem {
  if (input.pairs.length < 3 || input.pairs.length > 4) throw new Error('Match-pairs drills require three or four pairs.');
  return { ...base(input), kind: 'MATCH_PAIRS', pairs: input.pairs.map(([leftPrompt, rightMatch], index) => ({ id: `m${index + 1}`, leftPrompt, rightMatch })) };
}

export function fillBlank(input: DrillBase & { before: string; after: string; correctWord: string; distractors: [string, string, string] }): DrillItem {
  return {
    ...base(input),
    kind: 'FILL_BLANK_CHOICE',
    sentenceTemplate: `${input.before}{{BLANK}}${input.after}`,
    wordBank: [input.correctWord, ...input.distractors],
    correctWord: input.correctWord,
  };
}

export function unit(
  code: StandardMedsSourceCode,
  unitKey: string,
  orderIndex: number,
  title: string,
  summary: string,
  estimatedMinutes: number,
  briefingCards: BriefingCard[],
  drills: DrillItem[],
): TrackUnit {
  return { id: `${code.toLowerCase()}-${unitKey}`, orderIndex, title, summary, estimatedMinutes, briefingCards, drills };
}
