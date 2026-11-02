import { describe, expect, it } from 'vitest';
import { ClaimEvidenceSchema } from '@/lib/schemas/source-truth';
import type { DrillAnswer } from '@/lib/schemas/learning';
import type { DrillItem } from '@/lib/schemas/curriculum';
import {
  correctAnswerForDrill,
  drillRuleIds,
  gradeDrillAnswer,
  sanitizeDrillForLearner,
} from '@/lib/services/drill-grader';
import { drills } from './helpers/fixtures';

const [multipleChoice, trueFalse, sequence, matchPairs, fillBlank] = drills('synthetic');
const allDrills = [multipleChoice, trueFalse, sequence, matchPairs, fillBlank];

function answerFor(drill: DrillItem): DrillAnswer {
  return correctAnswerForDrill(drill);
}

describe('sanitizeDrillForLearner', () => {
  it.each(allDrills.map((drill) => [drill.kind, drill] as const))(
    'omits hidden grading, rationale, and evidence fields from %s DTOs',
    (_kind, drill) => {
      const learner = sanitizeDrillForLearner(drill) as unknown as Record<string, unknown>;

      expect(learner).not.toHaveProperty('correctOptionId');
      expect(learner).not.toHaveProperty('isCompliant');
      expect(learner).not.toHaveProperty('correctWord');
      expect(learner).not.toHaveProperty('explanation');
      expect(learner).not.toHaveProperty('evidence');
      expect(learner).not.toHaveProperty('sourcePages');
      expect(learner).not.toHaveProperty('orderedSteps');
      expect(learner).not.toHaveProperty('pairs');
    },
  );

  it('keeps the learner-facing multiple-choice options', () => {
    if (multipleChoice.kind !== 'MULTIPLE_CHOICE') throw new Error('Expected multiple-choice fixture.');
    expect(sanitizeDrillForLearner(multipleChoice)).toEqual({
      id: multipleChoice.id,
      kind: 'MULTIPLE_CHOICE',
      competencyPillarId: multipleChoice.competencyPillarId,
      prompt: multipleChoice.prompt,
      ruleIds: [],
      options: multipleChoice.options,
    });
  });

  it('rotates sequence steps behind public aliases without leaking canonical IDs', () => {
    if (sequence.kind !== 'SEQUENCE_ORDER') throw new Error('Expected sequence fixture.');
    const canonicalIds = sequence.orderedSteps.map((step) => step.id);
    const learner = sanitizeDrillForLearner(sequence);

    expect(learner.kind).toBe('SEQUENCE_ORDER');
    if (learner.kind !== 'SEQUENCE_ORDER') return;
    expect(learner.steps.map((step) => step.id)).toEqual(['step-0', 'step-1', 'step-2']);
    expect(learner.steps.map((step) => step.text)).toEqual([
      sequence.orderedSteps[1].text,
      sequence.orderedSteps[2].text,
      sequence.orderedSteps[0].text,
    ]);
    for (const step of learner.steps) {
      expect(canonicalIds).not.toContain(step.id);
    }
  });

  it('uses rotated right-side aliases without leaking pair IDs or index-aligned matches', () => {
    if (matchPairs.kind !== 'MATCH_PAIRS') throw new Error('Expected match fixture.');
    const learner = sanitizeDrillForLearner(matchPairs);

    expect(learner.kind).toBe('MATCH_PAIRS');
    if (learner.kind !== 'MATCH_PAIRS') return;
    expect(learner.rightOptions.map((option) => option.id)).toEqual(['right-0', 'right-1', 'right-2']);
    expect(learner.rightOptions.map((option) => option.text)).toEqual([
      matchPairs.pairs[2].rightMatch,
      matchPairs.pairs[0].rightMatch,
      matchPairs.pairs[1].rightMatch,
    ]);
    learner.rightOptions.forEach((option, index) => {
      expect(matchPairs.pairs.map((pair) => pair.id)).not.toContain(option.id);
      expect(option.text).not.toBe(matchPairs.pairs[index].rightMatch);
    });
  });

  it('keeps the fill-blank word bank but not its correct word', () => {
    const learner = sanitizeDrillForLearner(fillBlank);
    expect(learner.kind).toBe('FILL_BLANK_CHOICE');
    if (learner.kind !== 'FILL_BLANK_CHOICE') return;
    expect(learner.wordBank).toEqual(fillBlank.kind === 'FILL_BLANK_CHOICE' ? fillBlank.wordBank : []);
    expect(learner).not.toHaveProperty('correctWord');
  });
});

describe('gradeDrillAnswer', () => {
  it.each(allDrills.map((drill) => [drill.kind, drill] as const))(
    'accepts the authoritative correct answer for %s',
    (_kind, drill) => {
      expect(gradeDrillAnswer(drill, answerFor(drill))).toBe(true);
    },
  );

  it('rejects incorrect multiple-choice and true/false answers', () => {
    expect(gradeDrillAnswer(multipleChoice, { kind: 'MULTIPLE_CHOICE', optionId: 'not-correct' })).toBe(false);
    if (trueFalse.kind !== 'TRUE_FALSE_SPOT') throw new Error('Expected true/false fixture.');
    expect(gradeDrillAnswer(trueFalse, { kind: 'TRUE_FALSE_SPOT', isCompliant: !trueFalse.isCompliant })).toBe(false);
  });

  it('requires the exact public sequence without canonical IDs, duplicates, or omissions', () => {
    if (sequence.kind !== 'SEQUENCE_ORDER') throw new Error('Expected sequence fixture.');
    const correct = correctAnswerForDrill(sequence);
    if (correct.kind !== 'SEQUENCE_ORDER') throw new Error('Expected sequence answer.');
    const ids = correct.orderedStepIds;

    expect(gradeDrillAnswer(sequence, correct)).toBe(true);
    expect(gradeDrillAnswer(sequence, { kind: 'SEQUENCE_ORDER', orderedStepIds: [...ids].reverse() })).toBe(false);
    expect(gradeDrillAnswer(sequence, { kind: 'SEQUENCE_ORDER', orderedStepIds: [ids[0], ids[0], ids[1]] })).toBe(false);
    expect(gradeDrillAnswer(sequence, { kind: 'SEQUENCE_ORDER', orderedStepIds: ids.slice(1) })).toBe(false);
    expect(gradeDrillAnswer(sequence, {
      kind: 'SEQUENCE_ORDER',
      orderedStepIds: sequence.orderedSteps.map((step) => step.id),
    })).toBe(false);
  });

  it('grades match answers by pair ID to rotated right-side alias, not by pair ID alone', () => {
    if (matchPairs.kind !== 'MATCH_PAIRS') throw new Error('Expected match fixture.');
    const pairIdMapping = Object.fromEntries(matchPairs.pairs.map((pair) => [pair.id, pair.id]));
    const correct = correctAnswerForDrill(matchPairs);
    if (correct.kind !== 'MATCH_PAIRS') throw new Error('Expected match answer.');

    expect(gradeDrillAnswer(matchPairs, correct)).toBe(true);
    expect(gradeDrillAnswer(matchPairs, { kind: 'MATCH_PAIRS', matches: pairIdMapping })).toBe(false);
    expect(gradeDrillAnswer(matchPairs, {
      kind: 'MATCH_PAIRS',
      matches: { ...correct.matches, extra: 'right-0' },
    })).toBe(false);
  });

  it('normalizes fill-blank case, edge whitespace, and repeated internal whitespace', () => {
    if (fillBlank.kind !== 'FILL_BLANK_CHOICE') throw new Error('Expected fill fixture.');
    const multiWord = { ...fillBlank, correctWord: 'Verified Caller' };

    expect(gradeDrillAnswer(fillBlank, { kind: 'FILL_BLANK_CHOICE', word: '  70%  ' })).toBe(true);
    expect(gradeDrillAnswer(multiWord, { kind: 'FILL_BLANK_CHOICE', word: '  verified   caller ' })).toBe(true);
    expect(gradeDrillAnswer(multiWord, { kind: 'FILL_BLANK_CHOICE', word: 'verified callers' })).toBe(false);
  });

  it('never grades an answer against a different Drill kind', () => {
    for (const drill of allDrills) {
      expect(gradeDrillAnswer(drill, { kind: 'TRUE_FALSE_SPOT', isCompliant: true })).toBe(
        drill.kind === 'TRUE_FALSE_SPOT' && drill.isCompliant,
      );
    }
  });
});

describe('correctAnswerForDrill', () => {
  it('reveals public sequence aliases in canonical order only after submission', () => {
    if (sequence.kind !== 'SEQUENCE_ORDER') throw new Error('Expected sequence fixture.');
    expect(correctAnswerForDrill(sequence)).toEqual({
      kind: 'SEQUENCE_ORDER',
      orderedStepIds: ['step-2', 'step-0', 'step-1'],
    });
  });

  it('maps sorted server pair IDs to rotated right-side aliases', () => {
    if (matchPairs.kind !== 'MATCH_PAIRS') throw new Error('Expected match fixture.');
    const unsorted = {
      ...matchPairs,
      pairs: [...matchPairs.pairs].reverse(),
    };

    expect(correctAnswerForDrill(unsorted)).toEqual({
      kind: 'MATCH_PAIRS',
      matches: { m1: 'right-1', m2: 'right-2', m3: 'right-0' },
    });
  });
});

describe('drillRuleIds', () => {
  it('deduplicates explicit approved rule mappings', () => {
    expect(drillRuleIds({ ...multipleChoice, ruleIds: ['rule-a', 'rule-a', 'rule-b'] })).toEqual(['rule-a', 'rule-b']);
  });

  it('uses evidence rules only as a fallback and deduplicates them', () => {
    const evidence = ClaimEvidenceSchema.parse({
      id: 'evidence-synthetic',
      claim: 'A synthetic claim for rule mapping.',
      ruleIds: ['rule-evidence-a', 'rule-evidence-b', 'rule-evidence-a'],
      excerpts: [{
        documentId: 'document-synthetic',
        revisionId: 'revision-synthetic',
        pageNumber: 1,
        exactText: 'Synthetic source text.',
      }],
    });

    expect(drillRuleIds({ ...multipleChoice, ruleIds: [], evidence: [evidence] })).toEqual([
      'rule-evidence-a',
      'rule-evidence-b',
    ]);
    expect(drillRuleIds({ ...multipleChoice, ruleIds: ['rule-approved'], evidence: [evidence] })).toEqual(['rule-approved']);
  });
});
