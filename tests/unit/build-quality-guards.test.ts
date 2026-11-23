import { describe, expect, it } from 'vitest';
import { givesAwayWord, isPositionLabel } from '@/lib/services/drill-label';
import { drillBatchNames } from '@/lib/ai/prompts/unit-builder';
import { dispositionFamily, toCanonicalDisposition } from '@/lib/ai/prompts/sim-builder';
import { normalizeCanonicalDispositions } from '@/lib/services/verbal-defaults';

describe('build quality guards (review 2026-11-23)', () => {
  it('flags a fill-in-the-blank prompt that names its answer', () => {
    expect(givesAwayWord('Complete the Playbook rule about our Business Associate Agreement (BAA).', 'BAA')).toBe(true);
    expect(givesAwayWord('Complete the Playbook rule.', 'BAA')).toBe(false);
    expect(givesAwayWord('Complete the rule about 15 minutes.', '5 minutes')).toBe(false);
  });

  it('flags Match Pairs sides labelled by position', () => {
    expect(isPositionLabel('Step 1: Stop the activity')).toBe(true);
    expect(isPositionLabel('2. Report immediately')).toBe(true);
    expect(isPositionLabel('First: stop')).toBe(true);
    expect(isPositionLabel('Caller asks for a spouse update')).toBe(false);
    expect(isPositionLabel('Stop the activity')).toBe(false);
  });

  it('hands every Unit and batch different names', () => {
    const all = [0, 1, 2, 3, 4, 5].flatMap((unit) => [0, 1].flatMap((batch) => drillBatchNames(unit, batch)));
    expect(new Set(all).size).toBe(all.length);
  });

  it('maps service outcomes and keeps compliance calls free of sales outcomes', () => {
    expect(toCanonicalDisposition('Escalated to 911')).toBe('Escalated');
    expect(toCanonicalDisposition('Resolved')).toBe('Resolved');
    expect(toCanonicalDisposition('Recovered')).toBe('Recovered');
    expect(dispositionFamily('Escalated')).not.toContain('Recovered');
    expect(dispositionFamily('Recovered')).not.toContain('Escalated');
    expect(normalizeCanonicalDispositions(['Escalated'])).toEqual(['Escalated', 'Resolved', 'Callback scheduled']);
    expect(normalizeCanonicalDispositions(['Recovered'])).toEqual(['Recovered', 'Callback scheduled', "Didn't reply"]);
  });
});

describe('drillSummary', () => {
  it('describes a True/False Drill by its statement, not its generic prompt', async () => {
    const { drillSummary, drillLabel } = await import('@/lib/services/drill-label');
    const drill = { kind: 'TRUE_FALSE_SPOT', prompt: "Decide whether the agent's action follows the Playbook.", statement: 'The agent tells Mateo the recording is off.' } as never;
    expect(drillSummary(drill)).toBe('True/False: The agent tells Mateo the recording is off.');
    expect(drillLabel(drill)).toBe('The agent tells Mateo the recording is off.');
  });
});

describe('promisedStepCount', () => {
  it('reads a promised step count but not a deliberate subset', async () => {
    const { promisedStepCount } = await import('@/lib/ai/prompts/unit-builder');
    expect(promisedStepCount('Put the 6-step form assistance procedure in the required order.')).toBe(6);
    expect(promisedStepCount('Place the four steps in order.')).toBe(4);
    expect(promisedStepCount('Put the first five steps of the workflow in order.')).toBeNull();
    expect(promisedStepCount('Put these steps in order.')).toBeNull();
  });
});

describe('findCrossUnitRepeats', () => {
  it('finds a later Checkpoint retesting a rule by answer or by source quote, not by Match Pairs', async () => {
    const { findCrossUnitRepeats } = await import('@/lib/services/drill-label');
    const quote = (text: string) => [{ id: 'e', claim: 'c', ruleIds: [], excerpts: [{ documentId: 'd', revisionId: 'r', pageNumber: 1, exactText: text }] }];
    const fill = (id: string, answer: string) => ({ id, kind: 'FILL_BLANK_CHOICE', prompt: 'Complete the rule.', sentenceTemplate: `Say {{BLANK}} ${id}`, wordBank: [answer, 'x', 'y', 'z'], correctWord: answer, evidence: [] });
    const tf = (id: string, statement: string, text: string) => ({ id, kind: 'TRUE_FALSE_SPOT', prompt: 'Decide.', statement, evidence: quote(text) });
    const mc = (id: string, prompt: string, text: string) => ({ id, kind: 'MULTIPLE_CHOICE', prompt, options: [], correctOptionId: 'a', evidence: quote(text) });
    const units = [
      { drills: [fill('u1-d1', 'licensed provider'), tf('u1-d2', 'Agent signs for Rosa.', 'Verbal confirmation does not replace a required patient electronic signature, attestation,')] },
      { drills: [fill('u2-d1', 'licensed provider'), mc('u2-d2', 'Can a verbal yes replace the signature?', 'A verbal confirmation does not replace a required signature.'), mc('u2-d3', 'Different rule', 'Lock the screen whenever you step away from the workstation.')] },
    ] as never;
    const repeats = findCrossUnitRepeats(units);
    expect(repeats.map((repeat) => `${repeat.unitIndex}:${repeat.drillIndex}`)).toEqual(['1:0', '1:1']);
  });
});
