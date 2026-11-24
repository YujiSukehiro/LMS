import { describe, expect, it } from 'vitest';
import type { DrillItem } from '@/lib/schemas/curriculum';
import { toLearnerDrill } from '@/components/learn/DrillRunner';
import { gradeDrillAnswer, sanitizeDrillForLearner } from '@/lib/services/drill-grader';
import { drills } from './helpers/fixtures';

const [multipleChoice, trueFalse, sequence, matchPairs, fillBlank] = drills('synthetic');

function asMatch(drill: DrillItem) {
  if (drill.kind !== 'MATCH_PAIRS') throw new Error('Expected a Match Pairs fixture.');
  return drill;
}

function asSequence(drill: DrillItem) {
  if (drill.kind !== 'SEQUENCE_ORDER') throw new Error('Expected a Call-Flow Order fixture.');
  return drill;
}

// Studio test-play hands raw (unsanitized) Drills to DrillRunner and grades them on the server with versionId "draft".
describe('Studio test-play Drill view', () => {
  it('gives raw Match Pairs Drills the same option ids the server grades against', () => {
    const drill = asMatch(matchPairs);
    const view = toLearnerDrill(drill);
    if (view.kind !== 'MATCH_PAIRS') throw new Error('Expected a Match Pairs view.');
    expect(view).toEqual(sanitizeDrillForLearner(drill));

    // A learner who pairs every item with the text the Trainer wrote must be graded correct.
    const matches = Object.fromEntries(drill.pairs.map((pair) => [
      pair.id,
      view.rightOptions.find((option) => option.text === pair.rightMatch)!.id,
    ]));
    expect(gradeDrillAnswer(drill, { kind: 'MATCH_PAIRS', matches })).toBe(true);
  });

  it('gives raw Call-Flow Order Drills the aliased step ids the server grades against', () => {
    const drill = asSequence(sequence);
    const view = toLearnerDrill(drill);
    if (view.kind !== 'SEQUENCE_ORDER') throw new Error('Expected a Call-Flow Order view.');
    expect(view).toEqual(sanitizeDrillForLearner(drill));
    const orderedStepIds = drill.orderedSteps.map((step) => view.steps.find((item) => item.text === step.text)!.id);
    expect(gradeDrillAnswer(drill, { kind: 'SEQUENCE_ORDER', orderedStepIds })).toBe(true);
  });

  it('strips answer keys from the other raw Drill kinds and passes sanitized Drills through', () => {
    for (const drill of [multipleChoice, trueFalse, fillBlank, sequence, matchPairs]) {
      const sanitized = sanitizeDrillForLearner(drill);
      expect(toLearnerDrill(drill)).toEqual(sanitized);
      expect(toLearnerDrill(sanitized)).toBe(sanitized);
    }
  });
});
