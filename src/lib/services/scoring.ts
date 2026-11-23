/**
 * Pure scoring rules for Units, streaks, Simulations and skill scores.
 * This module has no Firestore or network dependencies so unit tests can import it directly.
 */
import type { PillarStat } from '@/lib/schemas/domain';
import type { DrillResult } from '@/lib/schemas/api';
import {
  SIM_AUTO_FAIL_SCORE_CAP,
  SIM_DISPOSITION_PENALTY,
  STRENGTH_THRESHOLDS,
  XP_RULES,
} from '@/lib/schemas/constants';
import { utcDateKey } from '@/lib/utils';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Weight of Unit completion in `progressPct`. The remaining weight is shared across the Simulation scenarios. */
const UNIT_PROGRESS_WEIGHT = 80;
const SIM_PROGRESS_WEIGHT = 100 - UNIT_PROGRESS_WEIGHT;

function roundTo1Decimal(value: number): number {
  return Math.round(value * 10) / 10;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

/** Percent of Drills passed on the first try, rounded to an integer. 0 when there are no results. */
export function computeFirstTryAccuracyPct(results: DrillResult[]): number {
  if (results.length === 0) return 0;
  const passed = results.filter((r) => r.passedFirstTry).length;
  return Math.round((100 * passed) / results.length);
}

/**
 * XP for one Unit completion: 15 per first-try correct Drill, 5 per recovered (first-try missed) Drill,
 * plus a 50 XP completion bonus.
 */
export function computeUnitXp(results: DrillResult[]): number {
  let xp = XP_RULES.unitCompletionBonus;
  for (const result of results) {
    xp += result.passedFirstTry ? XP_RULES.perFirstTryCorrectDrill : XP_RULES.perRecoveredDrill;
  }
  return xp;
}

function parseDateKey(dateKey: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null;
  const ms = Date.parse(`${dateKey}T00:00:00.000Z`);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Daily streak rule (UTC days):
 * - activity on the same UTC day -> streak is unchanged (minimum 1),
 * - activity on the next UTC day -> streak + 1,
 * - a gap of more than one day, no previous activity, or an unreadable date -> streak restarts at 1.
 */
export function nextStreak(
  prev: { currentStreakDays: number; lastActiveDateUtc: string | null },
  nowMs: number,
): { currentStreakDays: number; lastActiveDateUtc: string } {
  const today = utcDateKey(nowMs);
  if (!prev.lastActiveDateUtc) return { currentStreakDays: 1, lastActiveDateUtc: today };

  const lastMs = parseDateKey(prev.lastActiveDateUtc);
  const todayMs = parseDateKey(today);
  if (lastMs === null || todayMs === null) return { currentStreakDays: 1, lastActiveDateUtc: today };

  const dayDiff = Math.round((todayMs - lastMs) / DAY_MS);
  const current = Math.max(0, Math.floor(prev.currentStreakDays));

  if (dayDiff <= 0) {
    // Same day (or a stored date in the future because of clock skew): keep the streak and the later date.
    return {
      currentStreakDays: Math.max(1, current),
      lastActiveDateUtc: dayDiff < 0 ? prev.lastActiveDateUtc : today,
    };
  }
  if (dayDiff === 1) return { currentStreakDays: current + 1, lastActiveDateUtc: today };
  return { currentStreakDays: 1, lastActiveDateUtc: today };
}

/**
 * Raw Simulation score: S_raw = sum(w_i * s_i) / 100, with s_i in {0, 50, 100}.
 * Rounded to 1 decimal and clamped to 0..100.
 */
export function computeRawSimScore(criteria: Array<{ weight: number; score: number }>): number {
  let total = 0;
  for (const c of criteria) {
    const weight = Number.isFinite(c.weight) ? c.weight : 0;
    const score = Number.isFinite(c.score) ? c.score : 0;
    total += (weight * score) / 100;
  }
  return clamp(roundTo1Decimal(total), 0, 100);
}

function normalizeDisposition(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Apply the Simulation rules to the raw score:
 * 1. Wrong disposition (case-insensitive, trimmed compare) -> minus SIM_DISPOSITION_PENALTY points, floored at 0.
 * 2. Auto-fail -> passed = false and score capped at SIM_AUTO_FAIL_SCORE_CAP.
 * 3. Otherwise passed = final integer score >= passThreshold.
 * `overallScorePct` is an integer in 0..100. The pass check uses the same integer the learner sees.
 */
export function applySimScoringRules(input: {
  rawScore: number;
  selectedDisposition: string;
  expectedDisposition: string;
  autoFailTriggered: boolean;
  passThreshold: number;
}): { overallScorePct: number; passed: boolean; dispositionCorrect: boolean } {
  const dispositionCorrect =
    normalizeDisposition(input.selectedDisposition) === normalizeDisposition(input.expectedDisposition);

  let score = clamp(input.rawScore, 0, 100);
  if (!dispositionCorrect) score = Math.max(0, score - SIM_DISPOSITION_PENALTY);
  if (input.autoFailTriggered) score = Math.min(score, SIM_AUTO_FAIL_SCORE_CAP);

  const overallScorePct = clamp(Math.round(score), 0, 100);
  const passed = !input.autoFailTriggered && overallScorePct >= input.passThreshold;
  return { overallScorePct, passed, dispositionCorrect };
}

/**
 * Track progress: completed Units give up to 80%, one or more passed Simulation scenarios give the last 20%.
 * The result is 100 only when all Units are complete and at least one scenario is passed.
 */
export function computeProgressPct(input: {
  completedUnitCount: number;
  unitCount: number;
  passedScenarioCount: number;
  /** Scenarios in the Track. Each passed one adds its share of the practice weight. */
  scenarioCount: number;
}): number {
  const unitFraction =
    input.unitCount > 0 ? clamp(input.completedUnitCount / input.unitCount, 0, 1) : 0;
  const simFraction = input.scenarioCount > 0 ? clamp(input.passedScenarioCount / input.scenarioCount, 0, 1) : 0;
  // A Track with no scenarios puts all the weight on its Checkpoints.
  const raw = input.scenarioCount > 0 ? UNIT_PROGRESS_WEIGHT * unitFraction + SIM_PROGRESS_WEIGHT * simFraction : 100 * unitFraction;
  // Never show 100 unless every Unit is complete and every scenario is passed.
  const allUnitsDone = input.unitCount > 0 && input.completedUnitCount >= input.unitCount;
  const allScenariosPassed = input.passedScenarioCount >= input.scenarioCount;
  const pct = Math.round(raw);
  if (pct >= 100 && !(allUnitsDone && allScenariosPassed)) return 99;
  return clamp(pct, 0, 100);
}

/** Color band for heatmaps and gauges (STRENGTH_THRESHOLDS). */
export function strengthBand(score: number): 'strong' | 'borderline' | 'weak' {
  if (score >= STRENGTH_THRESHOLDS.strong) return 'strong';
  if (score >= STRENGTH_THRESHOLDS.borderline) return 'borderline';
  return 'weak';
}

/** Matches `<SIM_END>` and tolerant variants with whitespace inside the brackets. */
const SIM_END_PATTERN = /<\s*SIM_END\s*>/gi;

/** Remove every `<SIM_END>` sentinel from an Actor reply and report if one was present. */
export function stripSimEndToken(text: string): { text: string; simEnded: boolean } {
  const simEnded = new RegExp(SIM_END_PATTERN.source, 'i').test(text);
  const cleaned = text.replace(new RegExp(SIM_END_PATTERN.source, 'gi'), '');
  return { text: cleaned.trim(), simEnded };
}

/**
 * Add new 0..100 skill samples to one pillar statistic.
 * averageScore = weightedScoreSum / attempts, rounded to 1 decimal.
 */
export function mergePillarStat(
  prev: PillarStat | undefined,
  key: string,
  label: string,
  scores: number[],
): PillarStat {
  const prevAttempts = prev ? Math.max(0, Math.floor(prev.attempts)) : 0;
  const prevSum = prev ? Math.max(0, prev.weightedScoreSum) : 0;
  const added = scores.map((s) => clamp(s, 0, 100));
  const attempts = prevAttempts + added.length;
  const weightedScoreSum = prevSum + added.reduce((sum, s) => sum + s, 0);
  const averageScore = attempts > 0 ? clamp(roundTo1Decimal(weightedScoreSum / attempts), 0, 100) : 0;
  return {
    pillarKey: key,
    pillarLabel: label || prev?.pillarLabel || key,
    attempts,
    weightedScoreSum,
    averageScore,
  };
}

/** Overall readiness = mean averageScore across pillars with at least one attempt (integer, 0 when none). */
export function computeOverallReadiness(
  skillScoresByPillar: Record<string, PillarStat> | null | undefined,
): number {
  if (!skillScoresByPillar) return 0;
  const attempted = Object.values(skillScoresByPillar).filter((stat) => stat.attempts > 0);
  if (attempted.length === 0) return 0;
  const mean = attempted.reduce((sum, stat) => sum + stat.averageScore, 0) / attempted.length;
  return clamp(Math.round(mean), 0, 100);
}
