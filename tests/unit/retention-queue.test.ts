import { describe, expect, it } from 'vitest';
import { TrackDocSchema, TrackVersionDocSchema } from '@/lib/schemas/curriculum';
import { ReviewScheduleDocSchema, type ReviewScheduleDoc } from '@/lib/schemas/learning';
import { buildRetentionQueue, deduplicateReviewSchedules } from '@/lib/services/retention-queue-core';
import { reviewScheduleDocId } from '@/lib/services/review-schedule-id';
import { card, drills, pillars } from './helpers/fixtures';

const NOW_MS = Date.parse('2026-11-17T12:00:00.000Z');

function schedule(overrides: Partial<ReviewScheduleDoc>): ReviewScheduleDoc {
  return ReviewScheduleDocSchema.parse({
    schemaVersion: 1,
    id: 'review_1',
    learnerId: 'learner-1',
    trackId: 'track-a',
    unitId: 'u1',
    drillId: 'u1-d1',
    curriculumVersion: 'v1',
    ruleIds: ['rule-1'],
    nextAttemptKind: 'spaced_review',
    dueAt: '2026-11-16T12:00:00.000Z',
    intervalIndex: 0,
    independent: true,
    lastAttemptId: 'att-1',
    lastAttemptKind: 'initial',
    lastResult: 'correct',
    createdAt: '2026-11-15T12:00:00.000Z',
    updatedAt: '2026-11-15T12:00:00.000Z',
    ...overrides,
  });
}

describe('retention queue and canonical review schedule IDs', () => {
  it('computes deterministic SHA-256 doc IDs across seed and runtime callers', () => {
    const id1 = reviewScheduleDocId('seed-agent-1042', 'v1', 'u1-d1');
    const id2 = reviewScheduleDocId('seed-agent-1042', 'v1', 'u1-d1');
    const id3 = reviewScheduleDocId('seed-agent-1042', 'v1', 'u1-d2');
    expect(id1).toBe(id2);
    expect(id1).toMatch(/^review_[a-f0-9]{64}$/);
    expect(id1).not.toBe(id3);
  });

  it('deduplicates legacy colon IDs and runtime hash IDs keeping the most recent schedule', () => {
    const older = schedule({
      id: 'review:old-colon-key',
      drillId: 'u1-d1',
      dueAt: '2026-11-14T12:00:00.000Z',
      intervalIndex: 0,
      updatedAt: '2026-11-13T12:00:00.000Z',
    });
    const newer = schedule({
      id: reviewScheduleDocId('learner-1', 'v1', 'u1-d1'),
      drillId: 'u1-d1',
      dueAt: '2026-11-20T12:00:00.000Z',
      intervalIndex: 2,
      updatedAt: '2026-11-16T12:00:00.000Z',
    });

    const deduped = deduplicateReviewSchedules([older, newer]);
    expect(deduped).toHaveLength(1);
    expect(deduped[0]!.id).toBe(newer.id);
    expect(deduped[0]!.intervalIndex).toBe(2);
  });

  it('orders overdue reviews first, strips answer keys from LearnerDrill, and summarizes tracks', () => {
    const track = TrackDocSchema.parse({
      id: 'track-a',
      title: 'Verbal Recovery Track',
      campaignCode: 'VR-1',
      divisionId: 'INBOUND',
      status: 'PUBLISHED',
      generationProgress: { step: 'READY', percent: 100, message: 'Ready' },
      sourcePdfStoragePath: 'playbooks/track-a/p.pdf',
      sourcePdfFileName: 'p.pdf',
      sourcePageCount: 2,
      currentDraftVersionId: 'draft',
      publishedVersionId: 'v1',
      assignedCohortIds: ['ALL'],
      competencyPillars: pillars,
      unitCount: 1,
      simScenarioCount: 0,
      estimatedTotalMinutes: 10,
      createdByUid: 'trainer-1',
      createdAt: NOW_MS - 10_000,
      updatedAt: NOW_MS - 5_000,
    });

    const unitDrills = drills('u1');
    const version = TrackVersionDocSchema.parse({
      versionId: 'v1',
      trackId: 'track-a',
      versionNumber: 1,
      competencyPillars: pillars,
      units: [
        {
          id: 'u1',
          orderIndex: 0,
          title: 'Identity & Escalation',
          summary: 'Verify before account details.',
          estimatedMinutes: 8,
          briefingCards: [card('c1')],
          drills: unitDrills,
        },
      ],
      simScenarios: [],
      publishedAt: NOW_MS - 5_000,
      createdAt: NOW_MS - 10_000,
    });

    const queue = buildRetentionQueue({
      tracks: [{ track, version }],
      schedules: [
        schedule({ id: 'due-late', drillId: 'u1-d2', dueAt: '2026-11-16T12:00:00.000Z', intervalIndex: 1 }),
        schedule({ id: 'due-earliest', drillId: 'u1-d1', dueAt: '2026-11-15T12:00:00.000Z', intervalIndex: 0 }),
        schedule({ id: 'upcoming-mastered', drillId: 'u1-d3', dueAt: '2026-11-24T12:00:00.000Z', intervalIndex: 3, lastResult: 'correct' }),
      ],
      nowMs: NOW_MS,
    });

    expect(queue.dueItems.map((i) => i.drill.id)).toEqual(['u1-d1', 'u1-d2']);
    expect(queue.reinforceItems.map((i) => i.drill.id)).toEqual(['u1-d3']);
    expect(queue.summary).toEqual({
      dueCount: 2,
      overdueCount: 2,
      scheduledCount: 3,
      masteredCount: 1,
      nextDueAt: '2026-11-15T12:00:00.000Z',
      upcomingCount: 1,
      nextUpcomingAt: '2026-11-24T12:00:00.000Z',
    });
    expect(queue.trackSummaries).toHaveLength(1);
    expect(queue.trackSummaries[0]!.dueCount).toBe(2);
    // QA M2: a Track's caught-up line uses its next FUTURE review, not an already-due one.
    expect(queue.trackSummaries[0]!.upcomingCount).toBe(1);
    expect(queue.trackSummaries[0]!.nextUpcomingAt).toBe('2026-11-24T12:00:00.000Z');

    // Ensure answer keys and rationales never leak into queue DTOs.
    expect('correctOptionId' in queue.dueItems[0]!.drill).toBe(false);
    expect('explanation' in queue.dueItems[0]!.drill).toBe(false);
  });
});
