import { describe, expect, it } from 'vitest';
import {
  applySimScoringRules,
  computeFirstTryAccuracyPct,
  computeProgressPct,
  computeRawSimScore,
  computeUnitXp,
  nextStreak,
  strengthBand,
  stripSimEndToken,
} from '@/lib/services/scoring';
import type { DrillResult } from '@/lib/schemas/api';

const results = (passes: boolean[]): DrillResult[] =>
  passes.map((passedFirstTry, i) => ({ drillId: `d${i}`, competencyPillarId: 'p1', passedFirstTry }));

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 31, 15, 0, 0);

describe('Unit scoring', () => {
  it('computes honest first-try accuracy', () => {
    expect(computeFirstTryAccuracyPct(results([true, true, false, true]))).toBe(75);
    expect(computeFirstTryAccuracyPct(results([true, false, false]))).toBe(33);
    expect(computeFirstTryAccuracyPct([])).toBe(0);
  });

  it('awards 15 XP per first-try pass, 5 per recovered Drill, and a 50 XP bonus', () => {
    expect(computeUnitXp(results([true, true, false, true, false]))).toBe(3 * 15 + 2 * 5 + 50);
    expect(computeUnitXp(results([true, true, true, true]))).toBe(4 * 15 + 50);
  });

  it('tracks daily streaks in UTC', () => {
    expect(nextStreak({ currentStreakDays: 0, lastActiveDateUtc: null }, NOW)).toEqual({
      currentStreakDays: 1,
      lastActiveDateUtc: '2026-10-31',
    });
    expect(nextStreak({ currentStreakDays: 4, lastActiveDateUtc: '2026-10-31' }, NOW).currentStreakDays).toBe(4);
    expect(nextStreak({ currentStreakDays: 4, lastActiveDateUtc: '2026-10-30' }, NOW).currentStreakDays).toBe(5);
    expect(nextStreak({ currentStreakDays: 9, lastActiveDateUtc: '2026-10-28' }, NOW).currentStreakDays).toBe(1);
    expect(nextStreak({ currentStreakDays: 2, lastActiveDateUtc: '2026-10-30' }, NOW + DAY).currentStreakDays).toBe(1);
  });

  it('weights progress toward Unit completion and a passed Simulation', () => {
    expect(computeProgressPct({ completedUnitCount: 0, unitCount: 4, passedScenarioCount: 0 })).toBe(0);
    expect(computeProgressPct({ completedUnitCount: 4, unitCount: 4, passedScenarioCount: 1 })).toBe(100);
    const partial = computeProgressPct({ completedUnitCount: 2, unitCount: 4, passedScenarioCount: 0 });
    expect(partial).toBeGreaterThan(0);
    expect(partial).toBeLessThan(100);
  });

  it('maps scores to strength bands', () => {
    expect(strengthBand(92)).toBe('strong');
    expect(strengthBand(85)).toBe('strong');
    expect(strengthBand(70)).toBe('borderline');
    expect(strengthBand(69)).toBe('weak');
  });
});

describe('Simulation scoring', () => {
  it('computes S_raw = sum(w_i * s_i) / 100', () => {
    expect(
      computeRawSimScore([
        { weight: 30, score: 100 },
        { weight: 40, score: 50 },
        { weight: 30, score: 100 },
      ]),
    ).toBe(80);
    expect(computeRawSimScore([{ weight: 50, score: 0 }, { weight: 50, score: 0 }])).toBe(0);
    expect(computeRawSimScore([{ weight: 100, score: 100 }])).toBe(100);
  });

  it('passes at or above the threshold with the correct disposition', () => {
    const r = applySimScoringRules({
      rawScore: 85,
      selectedDisposition: 'Refund - Medical',
      expectedDisposition: 'Refund - Medical',
      autoFailTriggered: false,
      passThreshold: 80,
    });
    expect(r).toEqual({ overallScorePct: 85, passed: true, dispositionCorrect: true });
  });

  it('subtracts 10 points for a wrong disposition', () => {
    const r = applySimScoringRules({
      rawScore: 85,
      selectedDisposition: 'Save - 25%',
      expectedDisposition: 'Refund - Medical',
      autoFailTriggered: false,
      passThreshold: 80,
    });
    expect(r.overallScorePct).toBe(75);
    expect(r.dispositionCorrect).toBe(false);
    expect(r.passed).toBe(false);
  });

  it('floors the disposition penalty at 0', () => {
    const r = applySimScoringRules({
      rawScore: 5,
      selectedDisposition: 'Wrong',
      expectedDisposition: 'Right',
      autoFailTriggered: false,
      passThreshold: 80,
    });
    expect(r.overallScorePct).toBe(0);
  });

  it('compares dispositions without case or edge-space differences', () => {
    const r = applySimScoringRules({
      rawScore: 90,
      selectedDisposition: '  refund - medical ',
      expectedDisposition: 'Refund - Medical',
      autoFailTriggered: false,
      passThreshold: 80,
    });
    expect(r.dispositionCorrect).toBe(true);
    expect(r.overallScorePct).toBe(90);
  });

  it('forces a fail and caps the score at 59 on an auto-fail trigger', () => {
    const high = applySimScoringRules({
      rawScore: 95,
      selectedDisposition: 'Refund - Medical',
      expectedDisposition: 'Refund - Medical',
      autoFailTriggered: true,
      passThreshold: 80,
    });
    expect(high).toEqual({ overallScorePct: 59, passed: false, dispositionCorrect: true });

    const low = applySimScoringRules({
      rawScore: 40,
      selectedDisposition: 'Refund - Medical',
      expectedDisposition: 'Refund - Medical',
      autoFailTriggered: true,
      passThreshold: 60,
    });
    expect(low.overallScorePct).toBe(40);
    expect(low.passed).toBe(false);
  });

  it('applies the penalty before the auto-fail cap', () => {
    const r = applySimScoringRules({
      rawScore: 100,
      selectedDisposition: 'Wrong',
      expectedDisposition: 'Right',
      autoFailTriggered: true,
      passThreshold: 80,
    });
    expect(r.overallScorePct).toBe(59);
    expect(r.passed).toBe(false);
  });
});

describe('Simulation end token', () => {
  it('strips <SIM_END> and flags the end of the Simulation', () => {
    expect(stripSimEndToken('Thank you, that works for me. <SIM_END>')).toEqual({
      text: 'Thank you, that works for me.',
      simEnded: true,
    });
    expect(stripSimEndToken('I still have a question.')).toEqual({ text: 'I still have a question.', simEnded: false });
  });
});
