import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionUser } from '@/lib/schemas/domain';
import { DrillAnswerRequestSchema, DrillAnswerResponseSchema } from '@/lib/schemas/api';
import { FakeProgressDb } from './helpers/fake-progress-db';
import { drillAttempt, learningVersion } from './helpers/learning-service-fixtures';

const { mockRequireAuth, mockCollection, mockRunTransaction, mockLoadLearnerTrackContext } = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockCollection: vi.fn(),
  mockRunTransaction: vi.fn(),
  mockLoadLearnerTrackContext: vi.fn(),
}));

vi.mock('@/lib/firebase/auth-guard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/firebase/auth-guard')>();
  return { ...actual, requireAuth: mockRequireAuth };
});
vi.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection, runTransaction: mockRunTransaction },
}));
vi.mock('@/lib/services/track-loader', () => ({ loadLearnerTrackContext: mockLoadLearnerTrackContext }));

import { POST } from '@/app/api/progress/drill-answer/route';

const NOW = '2026-11-02T12:00:00.000Z';
const user: SessionUser = {
  uid: 'learner-synthetic',
  email: 'learner@synthetic.internal',
  displayName: 'Synthetic Learner',
  role: 'AGENT',
  partnerCohortId: 'INTERNAL',
  divisionIds: ['INBOUND'],
  active: true,
};
const version = learningVersion();
let db: FakeProgressDb;

function answerPayload(overrides: Record<string, unknown> = {}) {
  return {
    trackId: 'track-1',
    versionId: 'v1',
    unitId: 'u1',
    drillId: 'u1-d1',
    startId: 'start-1',
    idempotencyKey: 'answer-key-0001',
    answer: { kind: 'MULTIPLE_CHOICE', optionId: 'a' },
    ...overrides,
  };
}

function answerRequest(overrides: Record<string, unknown> = {}): Request {
  return new Request('http://localhost/api/progress/drill-answer', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(answerPayload(overrides)),
  });
}

function seedStart(id = 'start-1', overrides: Record<string, unknown> = {}) {
  db.seed('drillAttemptStarts', id, {
    id,
    learnerId: user.uid,
    trackId: 'track-1',
    unitId: 'u1',
    drillId: 'u1-d1',
    curriculumVersion: 'v1',
    startedAt: '2026-11-02T11:59:00.000Z',
    consumedAt: null,
    ...overrides,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
  db = new FakeProgressDb();
  mockRequireAuth.mockResolvedValue({ ok: true, user });
  mockCollection.mockImplementation((name: string) => db.collection(name));
  mockRunTransaction.mockImplementation((callback: (tx: Parameters<FakeProgressDb['runTransaction']>[0] extends (tx: infer T) => Promise<unknown> ? T : never) => Promise<unknown>) => db.runTransaction(callback));
  mockLoadLearnerTrackContext.mockResolvedValue({ track: { id: 'track-1' }, version, isDraft: false });
  seedStart();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('drill answer request schema', () => {
  it('accepts only identifiers, idempotency data, and the answer', () => {
    expect(DrillAnswerRequestSchema.safeParse(answerPayload()).success).toBe(true);
  });

  it.each(['correct', 'score', 'attemptNumber', 'attemptKind', 'firstIndependent', 'durationMs', 'schedule', 'misconceptionRuleIds'])(
    'rejects forged server-owned analytical field %s',
    (field) => {
      expect(DrillAnswerRequestSchema.safeParse(answerPayload({ [field]: true })).success).toBe(false);
    },
  );

  it('rejects analytical fields smuggled inside the answer', () => {
    expect(DrillAnswerRequestSchema.safeParse(answerPayload({
      answer: { kind: 'MULTIPLE_CHOICE', optionId: 'a', correct: true },
    })).success).toBe(false);
  });
});

describe('POST /api/progress/drill-answer', () => {
  it('derives grading, analytics, and capped server timing from authoritative data', async () => {
    seedStart('start-1', { startedAt: '2026-11-02T11:00:00.000Z' });

    const response = await POST(answerRequest());
    const body = DrillAnswerResponseSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(body.correct).toBe(true);
    expect(body.score).toBe(100);
    expect(body.attempt).toMatchObject({
      learnerId: user.uid,
      attemptNumber: 1,
      attemptKind: 'initial',
      correct: true,
      score: 100,
      firstIndependent: true,
      misconceptionRuleIds: [],
      startedAt: '2026-11-02T11:00:00.000Z',
      submittedAt: NOW,
      durationMs: 1_800_000,
      provenance: 'live',
    });
    expect(body.attempt?.requestHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(body.schedule).toMatchObject({
      nextAttemptKind: 'spaced_review',
      dueAt: '2026-11-03T12:00:00.000Z',
      intervalIndex: 1,
      independent: true,
    });
    expect(db.all('drillAttempts')).toHaveLength(1);
    expect(db.all('reviewSchedules')).toHaveLength(1);
  });

  it('replays an identical idempotent submission without new attempt or schedule writes', async () => {
    const firstResponse = await POST(answerRequest());
    const first = DrillAnswerResponseSchema.parse(await firstResponse.json());
    const writesAfterFirst = db.writes.length;

    const replayResponse = await POST(answerRequest());
    const replay = DrillAnswerResponseSchema.parse(await replayResponse.json());

    expect(replayResponse.status).toBe(200);
    expect(replay.attempt).toEqual(first.attempt);
    expect(replay.schedule).toEqual(first.schedule);
    expect(db.writes).toHaveLength(writesAfterFirst);
    expect(db.all('drillAttempts')).toHaveLength(1);
    expect(db.all('reviewSchedules')).toHaveLength(1);
  });

  it('returns the same answer feedback on a matched idempotent replay', async () => {
    const first = DrillAnswerResponseSchema.parse(await (await POST(answerRequest())).json());
    expect(first.correctAnswer).not.toBeNull();
    expect(first.explanation).not.toBeNull();
    expect(first.sourcePages.length).toBeGreaterThan(0);
    const writesAfterFirst = db.writes.length;

    const replay = DrillAnswerResponseSchema.parse(await (await POST(answerRequest())).json());

    expect(replay).toMatchObject({
      correctAnswer: first.correctAnswer,
      explanation: first.explanation,
      sourcePages: first.sourcePages,
    });
    expect(db.writes).toHaveLength(writesAfterFirst);
  });

  it('rejects reuse of an idempotency key with a different answer', async () => {
    await POST(answerRequest());
    const writesAfterFirst = db.writes.length;

    const response = await POST(answerRequest({ answer: { kind: 'MULTIPLE_CHOICE', optionId: 'b' } }));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toBe('IDEMPOTENCY_CONFLICT');
    expect(db.writes).toHaveLength(writesAfterFirst);
    expect(db.all('drillAttempts')).toHaveLength(1);
  });

  it('denies a start owned by another learner without consuming it or writing progress', async () => {
    seedStart('start-1', { learnerId: 'different-learner' });

    const response = await POST(answerRequest());
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe('START_MISMATCH');
    expect(db.get('drillAttemptStarts', 'start-1')?.consumedAt).toBeNull();
    expect(db.writes).toHaveLength(0);
    expect(db.all('drillAttempts')).toHaveLength(0);
    expect(db.all('reviewSchedules')).toHaveLength(0);
  });

  it('serializes concurrent identical submissions into one attempt write', async () => {
    const responses = await Promise.all([POST(answerRequest()), POST(answerRequest())]);
    const bodies = await Promise.all(responses.map(async (response) => DrillAnswerResponseSchema.parse(await response.json())));

    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(bodies[0].attempt?.id).toBe(bodies[1].attempt?.id);
    expect(db.all('drillAttempts')).toHaveLength(1);
    expect(db.all('reviewSchedules')).toHaveLength(1);
    expect(db.writes.filter((write) => write.ref.collectionName === 'drillAttempts' && write.operation === 'set')).toHaveLength(1);
  });

  it('returns a draft preview without attempt or review-schedule writes', async () => {
    mockLoadLearnerTrackContext.mockResolvedValue({ track: { id: 'track-1' }, version, isDraft: true });

    const response = await POST(answerRequest());
    const body = DrillAnswerResponseSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(body.attempt).toBeNull();
    expect(body.schedule).toBeNull();
    expect(body.correct).toBe(true);
    expect(db.all('drillAttempts')).toHaveLength(0);
    expect(db.all('reviewSchedules')).toHaveLength(0);
    expect(db.writes).toHaveLength(0);
    expect(db.get('drillAttemptStarts', 'start-1')?.consumedAt).toBeNull();
  });

  it('lets a draft preview be retried with the same start', async () => {
    mockLoadLearnerTrackContext.mockResolvedValue({ track: { id: 'track-1' }, version, isDraft: true });

    const first = await POST(answerRequest());
    const retry = await POST(answerRequest());
    const body = DrillAnswerResponseSchema.parse(await retry.json());

    expect(first.status).toBe(200);
    expect(retry.status).toBe(200);
    expect(body.correctAnswer).not.toBeNull();
    expect(db.writes).toHaveLength(0);
  });

  it('uses only current-version attempts and keeps an immediate retry non-independent', async () => {
    db.seed('drillAttempts', 'attempt-old-version', drillAttempt({
      id: 'attempt-old-version',
      learnerId: user.uid,
      curriculumVersion: 'v0',
      attemptNumber: 9,
    }));
    seedStart('start-2');

    const first = DrillAnswerResponseSchema.parse(await (await POST(answerRequest())).json());
    const second = DrillAnswerResponseSchema.parse(await (await POST(answerRequest({
      startId: 'start-2',
      idempotencyKey: 'answer-key-0002',
    }))).json());

    expect(first.attempt).toMatchObject({ attemptNumber: 1, attemptKind: 'initial', firstIndependent: true });
    expect(second.attempt).toMatchObject({ attemptNumber: 2, attemptKind: 'immediate_retry', firstIndependent: false });
    expect(second.schedule).toMatchObject({
      nextAttemptKind: 'varied_retrieval',
      dueAt: '2026-11-02T12:10:00.000Z',
      independent: false,
    });
    expect(db.all('drillAttempts')).toHaveLength(3);
  });

  it('rejects a mismatched answer kind before opening a transaction', async () => {
    const response = await POST(answerRequest({ answer: { kind: 'TRUE_FALSE_SPOT', isCompliant: true } }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('ANSWER_KIND_MISMATCH');
    expect(mockRunTransaction).not.toHaveBeenCalled();
    expect(db.writes).toHaveLength(0);
  });
});
