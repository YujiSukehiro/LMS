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
