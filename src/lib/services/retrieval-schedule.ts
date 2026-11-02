import type { AttemptKind, DrillAttemptDoc, ReviewScheduleDoc } from '@/lib/schemas/learning';

export interface RetrievalIntervals {
  variedRetrievalMinutes: number;
  errorReviewHours: number;
  spacedReviewDays: readonly [number, number, number];
}

export const DEFAULT_RETRIEVAL_INTERVALS: RetrievalIntervals = {
  variedRetrievalMinutes: 10,
  errorReviewHours: 4,
  spacedReviewDays: [1, 3, 7],
};

function validateIntervals(intervals: RetrievalIntervals): void {
  if (
    !Number.isFinite(intervals.variedRetrievalMinutes) || intervals.variedRetrievalMinutes <= 0 ||
    !Number.isFinite(intervals.errorReviewHours) || intervals.errorReviewHours <= 0 ||
    intervals.spacedReviewDays.some((days) => !Number.isFinite(days) || days <= 0)
  ) {
    throw new Error('Retrieval intervals must be positive.');
  }
}

/**
 * Immediate retries never advance the independent retention ladder. Errors return to a short
 * varied-retrieval step; successful varied/spaced work advances the transparent 1/3/7-day schedule.
 */
export function nextReviewSchedule(args: {
  previous: ReviewScheduleDoc | null;
  attempt: DrillAttemptDoc;
  ruleIds: readonly string[];
  now?: string;
  intervals?: RetrievalIntervals;
}): ReviewScheduleDoc {
  const intervals = args.intervals ?? DEFAULT_RETRIEVAL_INTERVALS;
  validateIntervals(intervals);
  const now = args.now ?? args.attempt.submittedAt;
  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs)) throw new Error('A valid schedule timestamp is required.');
  const previous = args.previous;
  const correct = args.attempt.correct;
  const kind = args.attempt.attemptKind;

  let nextAttemptKind: ReviewScheduleDoc['nextAttemptKind'];
  let dueAt: string;
  let intervalIndex: number;
  if (!correct) {
    nextAttemptKind = 'varied_retrieval';
    dueAt = new Date(nowMs + intervals.errorReviewHours * 3_600_000).toISOString();
    intervalIndex = 0;
  } else if (kind === 'initial') {
    nextAttemptKind = 'spaced_review';
    dueAt = new Date(nowMs + intervals.spacedReviewDays[0] * 86_400_000).toISOString();
    intervalIndex = 1;
  } else if (kind === 'immediate_retry') {
    nextAttemptKind = 'varied_retrieval';
    const delayMs = previous?.lastResult === 'incorrect'
      ? intervals.errorReviewHours * 3_600_000
      : intervals.variedRetrievalMinutes * 60_000;
    dueAt = new Date(nowMs + delayMs).toISOString();
    intervalIndex = 0;
  } else if (kind === 'varied_retrieval') {
    nextAttemptKind = 'spaced_review';
    dueAt = new Date(nowMs + intervals.spacedReviewDays[0] * 86_400_000).toISOString();
    intervalIndex = 1;
  } else {
    nextAttemptKind = 'spaced_review';
    const dueIndex = Math.min(previous?.intervalIndex ?? 1, intervals.spacedReviewDays.length - 1);
    intervalIndex = Math.min(dueIndex + 1, intervals.spacedReviewDays.length - 1);
    dueAt = new Date(nowMs + intervals.spacedReviewDays[dueIndex] * 86_400_000).toISOString();
  }

  return {
    schemaVersion: 1,
    id: previous?.id ?? `review_${args.attempt.learnerId}_${args.attempt.drillId}`,
    learnerId: args.attempt.learnerId,
    trackId: args.attempt.trackId,
    unitId: args.attempt.unitId,
    drillId: args.attempt.drillId,
    curriculumVersion: args.attempt.curriculumVersion,
    ruleIds: [...new Set(args.ruleIds)],
    nextAttemptKind,
    dueAt,
    intervalIndex,
    independent: nextAttemptKind === 'spaced_review',
    lastAttemptId: args.attempt.id,
    lastAttemptKind: kind,
    lastResult: correct ? 'correct' : 'incorrect',
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
  };
}

export function classifyFollowUpAttempt(args: {
  now: string;
  schedule: ReviewScheduleDoc | null;
}): Exclude<AttemptKind, 'initial'> {
  if (args.schedule && Date.parse(args.now) >= Date.parse(args.schedule.dueAt)) {
    return args.schedule.nextAttemptKind;
  }
  return 'immediate_retry';
}

/** A varied attempt must use a different Drill for the same rule after the applicable delay. */
export function classifyDrillAttempt(args: {
  now: string;
  drillId: string;
  ruleIds: readonly string[];
  ruleIdsByDrillId: Readonly<Record<string, readonly string[]>>;
  previousAttempts: readonly DrillAttemptDoc[];
  schedule: ReviewScheduleDoc | null;
  intervals?: RetrievalIntervals;
}): AttemptKind {
  const sameDrillAttempts = args.previousAttempts.filter((attempt) => attempt.drillId === args.drillId);
  if (sameDrillAttempts.length > 0) {
    const followUp = classifyFollowUpAttempt({ now: args.now, schedule: args.schedule });
    return followUp === 'varied_retrieval' ? 'immediate_retry' : followUp;
  }

  const latestDifferentDrill = args.previousAttempts
    .filter((attempt) =>
      attempt.drillId !== args.drillId &&
      args.ruleIds.some((ruleId) => args.ruleIdsByDrillId[attempt.drillId]?.includes(ruleId)))
    .sort((left, right) => Date.parse(right.submittedAt) - Date.parse(left.submittedAt))[0];
  if (!latestDifferentDrill) return 'initial';

  const intervals = args.intervals ?? DEFAULT_RETRIEVAL_INTERVALS;
  validateIntervals(intervals);
  const delayMs = latestDifferentDrill.correct
    ? intervals.variedRetrievalMinutes * 60_000
    : intervals.errorReviewHours * 3_600_000;
  return Date.parse(args.now) - Date.parse(latestDifferentDrill.submittedAt) >= delayMs
    ? 'varied_retrieval'
    : 'initial';
}
