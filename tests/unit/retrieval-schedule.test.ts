import { describe, expect, it } from 'vitest';
import type { AttemptKind, DrillAttemptDoc } from '@/lib/schemas/learning';
import {
  classifyDrillAttempt,
  classifyFollowUpAttempt,
  nextReviewSchedule,
} from '@/lib/services/retrieval-schedule';
import { drillAttempt, reviewSchedule } from './helpers/learning-service-fixtures';

const NOW = '2026-11-02T12:00:00.000Z';

function attempt(attemptKind: AttemptKind, correct = true, overrides: Partial<DrillAttemptDoc> = {}): DrillAttemptDoc {
  return drillAttempt({
    id: `attempt-${attemptKind}-${correct ? 'correct' : 'incorrect'}`,
    attemptKind,
    correct,
    score: correct ? 100 : 0,
    submittedAt: NOW,
    ...overrides,
  });
}

describe('nextReviewSchedule', () => {
  it('schedules a correct initial attempt for spaced review in one day', () => {
    const result = nextReviewSchedule({
      previous: null,
      attempt: attempt('initial'),
      ruleIds: ['rule-a', 'rule-a', 'rule-b'],
      now: NOW,
    });

    expect(result).toMatchObject({
      id: 'review_learner-1_u1-d1',
      learnerId: 'learner-1',
      drillId: 'u1-d1',
      nextAttemptKind: 'spaced_review',
      dueAt: '2026-11-03T12:00:00.000Z',
      intervalIndex: 1,
      independent: true,
      lastAttemptKind: 'initial',
      lastResult: 'correct',
      ruleIds: ['rule-a', 'rule-b'],
      createdAt: NOW,
      updatedAt: NOW,
    });
  });

  it('returns an incorrect initial attempt to short varied retrieval', () => {
    const result = nextReviewSchedule({
      previous: null,
      attempt: attempt('initial', false),
      ruleIds: ['rule-a'],
      now: NOW,
    });

    expect(result).toMatchObject({
      nextAttemptKind: 'varied_retrieval',
      dueAt: '2026-11-02T16:00:00.000Z',
      intervalIndex: 0,
      independent: false,
      lastResult: 'incorrect',
    });
  });

  it('does not advance the independent retention ladder for an immediate retry', () => {
    const previous = reviewSchedule({
      id: 'review-stable',
      intervalIndex: 2,
      createdAt: '2026-10-01T12:00:00.000Z',
    });
    const result = nextReviewSchedule({
      previous,
      attempt: attempt('immediate_retry'),
      ruleIds: ['rule-a'],
      now: NOW,
    });

    expect(result).toMatchObject({
      id: 'review-stable',
      nextAttemptKind: 'varied_retrieval',
      dueAt: '2026-11-02T12:10:00.000Z',
      intervalIndex: 0,
      independent: false,
      lastAttemptKind: 'immediate_retry',
      createdAt: previous.createdAt,
      updatedAt: NOW,
    });
  });

  it('advances a correct varied retrieval to the one-day spaced review', () => {
    const result = nextReviewSchedule({
      previous: reviewSchedule({ nextAttemptKind: 'varied_retrieval', intervalIndex: 0, independent: false }),
      attempt: attempt('varied_retrieval'),
      ruleIds: ['rule-a'],
      now: NOW,
    });

    expect(result).toMatchObject({
      nextAttemptKind: 'spaced_review',
      dueAt: '2026-11-03T12:00:00.000Z',
      intervalIndex: 1,
      independent: true,
      lastAttemptKind: 'varied_retrieval',
    });
  });

  it('advances successive correct spaced reviews through the three- and seven-day intervals', () => {
    const afterVaried = reviewSchedule({ nextAttemptKind: 'spaced_review', intervalIndex: 1, independent: true });
    const afterFirstSpaced = nextReviewSchedule({
      previous: afterVaried,
      attempt: attempt('spaced_review', true, { id: 'attempt-spaced-1' }),
      ruleIds: ['rule-a'],
      now: NOW,
    });

    expect(afterFirstSpaced).toMatchObject({
      nextAttemptKind: 'spaced_review',
      dueAt: '2026-11-05T12:00:00.000Z',
      intervalIndex: 2,
      independent: true,
    });

    const afterSecondSpaced = nextReviewSchedule({
      previous: afterFirstSpaced,
      attempt: attempt('spaced_review', true, { id: 'attempt-spaced-2', submittedAt: afterFirstSpaced.dueAt }),
      ruleIds: ['rule-a'],
      now: afterFirstSpaced.dueAt,
    });
    expect(afterSecondSpaced).toMatchObject({
      nextAttemptKind: 'spaced_review',
      dueAt: '2026-11-12T12:00:00.000Z',
      intervalIndex: 2,
      independent: true,
    });
  });

  it('resets an incorrect spaced review to varied error review', () => {
    const result = nextReviewSchedule({
      previous: reviewSchedule({ intervalIndex: 2 }),
      attempt: attempt('spaced_review', false),
      ruleIds: ['rule-a'],
      now: NOW,
    });

    expect(result).toMatchObject({
      nextAttemptKind: 'varied_retrieval',
      dueAt: '2026-11-02T16:00:00.000Z',
      intervalIndex: 0,
      independent: false,
      lastResult: 'incorrect',
    });
  });

  it('uses the attempt submission time when no override is supplied', () => {
    const result = nextReviewSchedule({
      previous: null,
      attempt: attempt('initial', true, { submittedAt: '2026-11-02T13:30:00.000Z' }),
      ruleIds: [],
    });
    expect(result.dueAt).toBe('2026-11-03T13:30:00.000Z');
    expect(result.updatedAt).toBe('2026-11-02T13:30:00.000Z');
  });

  it.each([
    [{ variedRetrievalMinutes: 0, errorReviewHours: 4, spacedReviewDays: [1, 3, 7] as const }],
    [{ variedRetrievalMinutes: 10, errorReviewHours: Number.NaN, spacedReviewDays: [1, 3, 7] as const }],
    [{ variedRetrievalMinutes: 10, errorReviewHours: 4, spacedReviewDays: [1, -3, 7] as const }],
    [{ variedRetrievalMinutes: Number.POSITIVE_INFINITY, errorReviewHours: 4, spacedReviewDays: [1, 3, 7] as const }],
  ])('rejects non-positive or non-finite intervals: %o', (intervals) => {
    expect(() => nextReviewSchedule({ previous: null, attempt: attempt('initial'), ruleIds: [], now: NOW, intervals }))
      .toThrow('Retrieval intervals must be positive.');
  });

  it('rejects an invalid schedule timestamp', () => {
    expect(() => nextReviewSchedule({ previous: null, attempt: attempt('initial'), ruleIds: [], now: 'not-a-date' }))
      .toThrow('A valid schedule timestamp is required.');
  });
});

describe('classifyFollowUpAttempt', () => {
  it('classifies an attempt without a schedule as an immediate retry', () => {
    expect(classifyFollowUpAttempt({ now: NOW, schedule: null })).toBe('immediate_retry');
  });

  it('keeps attempts before the due time on the non-independent retry path', () => {
    const schedule = reviewSchedule({ nextAttemptKind: 'varied_retrieval', dueAt: '2026-11-02T12:10:00.000Z' });
    expect(classifyFollowUpAttempt({ now: '2026-11-02T12:09:59.999Z', schedule })).toBe('immediate_retry');
  });

  it.each(['varied_retrieval', 'spaced_review'] as const)('starts a due %s at or after its due time', (nextAttemptKind) => {
    const schedule = reviewSchedule({ nextAttemptKind, dueAt: NOW });
    expect(classifyFollowUpAttempt({ now: NOW, schedule })).toBe(nextAttemptKind);
    expect(classifyFollowUpAttempt({ now: '2026-11-02T12:00:00.001Z', schedule })).toBe(nextAttemptKind);
  });
});

describe('classifyDrillAttempt', () => {
  it('classifies a same-Drill attempt due for varied retrieval as an immediate retry', () => {
    const result = classifyDrillAttempt({
      now: NOW,
      drillId: 'u1-d1',
      ruleIds: ['rule-a'],
      ruleIdsByDrillId: { 'u1-d1': ['rule-a'] },
      previousAttempts: [attempt('initial')],
      schedule: reviewSchedule({ nextAttemptKind: 'varied_retrieval', dueAt: NOW, independent: false }),
    });

    expect(result).toBe('immediate_retry');
  });

  it.each([
    { correct: true, submittedAt: '2026-11-02T11:50:00.000Z', delay: 'ten-minute' },
    { correct: false, submittedAt: '2026-11-02T08:00:00.000Z', delay: 'four-hour' },
  ])('requires the $delay delay before a different Drill sharing a rule is varied retrieval', ({ correct, submittedAt }) => {
    const args = {
      drillId: 'u2-d1',
      ruleIds: ['rule-a'],
      ruleIdsByDrillId: { 'u1-d1': ['rule-a'], 'u2-d1': ['rule-a'] },
      previousAttempts: [attempt('initial', correct, { drillId: 'u1-d1', submittedAt })],
      schedule: null,
    };

    expect(classifyDrillAttempt({ ...args, now: '2026-11-02T11:59:59.999Z' })).toBe('initial');
    expect(classifyDrillAttempt({ ...args, now: NOW })).toBe('varied_retrieval');
  });

  it('does not classify a different Drill with unrelated rules as varied retrieval', () => {
    const result = classifyDrillAttempt({
      now: NOW,
      drillId: 'u2-d1',
      ruleIds: ['rule-b'],
      ruleIdsByDrillId: { 'u1-d1': ['rule-a'], 'u2-d1': ['rule-b'] },
      previousAttempts: [attempt('initial', true, {
        drillId: 'u1-d1',
        submittedAt: '2026-11-02T08:00:00.000Z',
      })],
      schedule: null,
    });

    expect(result).toBe('initial');
  });
});
