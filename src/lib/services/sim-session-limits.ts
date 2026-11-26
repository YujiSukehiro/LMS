/** Pure Live Call Sim session-limit rules (no I/O) so unit tests can import them. */
import type { SimEvaluation } from '@/lib/schemas/analytics';

/**
 * A practice call counts toward the daily limit only once the learner has sent this many replies. Calls with fewer
 * replies cannot be graded for certification ("Send at least 2 verbal replies"), so they should not use up the day
 * (Connor 2026-11-26, after an agent burned two of 15 calls on one-reply runs).
 */
export const MIN_REPLIES_TO_COUNT = 2;

/**
 * Hard cost guard for runs that do not count (fewer than MIN_REPLIES_TO_COUNT replies): every run that used the AI
 * caller at all is capped at this multiple of the daily limit, so uncounted one-reply runs cannot loop forever.
 */
export const UNCOUNTED_RUN_CAP_MULTIPLIER = 3;

function turnsOf(doc: { turnCount?: unknown }): number | null {
  return typeof doc.turnCount === 'number' ? doc.turnCount : null;
}

/**
 * True when a started session counts toward the daily limit: the learner sent at least MIN_REPLIES_TO_COUNT replies.
 * Zero-turn runs (AI caller down, left during pre-call) and one-reply runs do not count. Legacy docs without
 * turnCount still count, as before.
 */
export function countsTowardDailySimLimit(doc: { status?: unknown; turnCount?: unknown }): boolean {
  const turns = turnsOf(doc);
  if (turns === null) return true; // legacy docs without turnCount count
  return turns >= MIN_REPLIES_TO_COUNT;
}

/** True when a session used the AI caller at all (at least one learner reply); used only for the hard cost guard. */
export function usedAiCaller(doc: { status?: unknown; turnCount?: unknown }): boolean {
  const turns = turnsOf(doc);
  if (turns === null) return true;
  return turns > 0 || doc.status === 'EVALUATED';
}

export function uncountedRunCap(limit: number): number {
  return limit * UNCOUNTED_RUN_CAP_MULTIPLIER;
}

export interface DailySimUsage {
  /** Runs that count toward the daily limit. */
  counted: number;
  /** Runs that used the AI caller at all (cost guard). */
  withDialogue: number;
  /** When staff last reset this learner's count today (ms), else null. */
  resetAt: number | null;
}

export function startOfUtcDayMs(nowMs: number): number {
  const d = new Date(nowMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Window start for today's count: midnight UTC, or a staff reset made today (whichever is later). */
export function dailyWindowStart(nowMs: number, resetAt: number | null | undefined): number {
  const dayStart = startOfUtcDayMs(nowMs);
  return typeof resetAt === 'number' && resetAt > dayStart && resetAt <= nowMs ? resetAt : dayStart;
}

export function summarizeDailySimUsage(
  docs: Array<{ userId?: unknown; status?: unknown; turnCount?: unknown; startedAt?: unknown }>,
  uid: string,
  windowStart: number,
  resetAt: number | null,
): DailySimUsage {
  const mine = docs.filter((d) => d.userId === uid && (typeof d.startedAt !== 'number' || d.startedAt >= windowStart));
  return {
    counted: mine.filter(countsTowardDailySimLimit).length,
    withDialogue: mine.filter(usedAiCaller).length,
    resetAt,
  };
}

// ---------- Hint after repeated fails on the same practice ----------

/** After this many failed tries in a row on one practice, the scorecard names the rule they keep missing. */
export const REPEAT_MISS_THRESHOLD = 3;

export interface RepeatMissHint {
  failedTries: number;
  /** The criterion missed most often across those tries (learner-facing label). */
  criterionLabel: string | null;
  /** Latest coaching note for that criterion, or the eligibility reason when nothing was graded. */
  coachingNote: string;
  betterResponseExample: string | null;
}

type HintEvaluation = Pick<SimEvaluation, 'passed' | 'criterionResults' | 'assessmentEligibility' | 'autoFailedReason'>;

/**
 * Given a learner's graded tries on one practice, newest first, return a hint when the newest REPEAT_MISS_THRESHOLD
 * (or more) in a row all failed. Picks the criterion scored below 100 in the most of those tries (ties: lowest total
 * score, then the newest try's order), considering only criteria missed on the newest try. Falls back to the newest
 * eligibility reason (for example too few replies).
 */
export function repeatMissHint(newestFirst: HintEvaluation[], threshold: number = REPEAT_MISS_THRESHOLD): RepeatMissHint | null {
  const streak: HintEvaluation[] = [];
  for (const evaluation of newestFirst) {
    if (evaluation.passed) break;
    streak.push(evaluation);
  }
  if (streak.length < threshold) return null;
  const window = streak.slice(0, threshold);

  const byId = new Map<string, { label: string; misses: number; total: number; order: number; note: string; example: string | null }>();
  window.forEach((evaluation, tryIndex) => {
    evaluation.criterionResults.forEach((criterion, index) => {
      const score = Number(criterion.score);
      const entry = byId.get(criterion.criterionId) ?? {
        label: criterion.criterionLabel,
        misses: 0,
        total: 0,
        order: tryIndex * 100 + index,
        note: '',
        example: null,
      };
      entry.total += score;
      if (score < 100) {
        entry.misses += 1;
        // Newest try first, so keep the first (newest) non-empty coaching we see.
        if (!entry.note && criterion.coachingNote.trim()) entry.note = criterion.coachingNote.trim();
        if (!entry.example && criterion.betterResponseExample?.trim()) entry.example = criterion.betterResponseExample.trim();
      }
      byId.set(criterion.criterionId, entry);
    });
  });
  // Only point at something the learner missed on this latest try (never at a rule they just got right).
  const missedNow = new Set(window[0]!.criterionResults.filter((criterion) => Number(criterion.score) < 100).map((criterion) => criterion.criterionId));
  const best = [...byId.entries()]
    .filter(([id, entry]) => entry.misses > 0 && missedNow.has(id))
    .map(([, entry]) => entry)
    .sort((a, b) => b.misses - a.misses || a.total - b.total || a.order - b.order)[0];
  if (best) {
    return { failedTries: streak.length, criterionLabel: best.label, coachingNote: best.note, betterResponseExample: best.example };
  }
  const reason =
    window.flatMap((evaluation) => (evaluation.assessmentEligibility && !evaluation.assessmentEligibility.eligible ? evaluation.assessmentEligibility.reasons : []))[0] ??
    window.map((evaluation) => evaluation.autoFailedReason).find((r): r is string => Boolean(r));
  if (!reason) return null;
  return { failedTries: streak.length, criterionLabel: null, coachingNote: reason, betterResponseExample: null };
}
