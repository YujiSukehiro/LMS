import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionUser } from '@/lib/schemas/domain';
import { CompleteUnitRequestSchema, CompleteUnitResponseSchema } from '@/lib/schemas/api';
import { FakeProgressDb } from './helpers/fake-progress-db';
import { drillAttempt, learningEnrollment, learningVersion } from './helpers/learning-service-fixtures';

const { mockRequireAuth, mockCollection, mockLoadLearnerTrackContext, mockRecordUnitCompletion } = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockCollection: vi.fn(),
  mockLoadLearnerTrackContext: vi.fn(),
  mockRecordUnitCompletion: vi.fn(),
}));

vi.mock('@/lib/firebase/auth-guard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/firebase/auth-guard')>();
  return { ...actual, requireAuth: mockRequireAuth };
});
vi.mock('@/lib/firebase/admin', () => ({ adminDb: { collection: mockCollection } }));
vi.mock('@/lib/services/track-loader', () => ({ loadLearnerTrackContext: mockLoadLearnerTrackContext }));
vi.mock('@/lib/services/analytics-rollup', () => ({ recordUnitCompletion: mockRecordUnitCompletion }));

import { POST } from '@/app/api/progress/complete-unit/route';

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
const track = { id: 'track-1' };
let db: FakeProgressDb;

function completionPayload(overrides: Record<string, unknown> = {}) {
  return {
    trackId: 'track-1',
    versionId: 'v1',
    unitId: 'u1',
    idempotencyKey: 'completion-key-0001',
    ...overrides,
  };
}

function completionRequest(overrides: Record<string, unknown> = {}): Request {
  return new Request('http://localhost/api/progress/complete-unit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(completionPayload(overrides)),
  });
}

function seedAttempt(id: string, drillId: string, overrides: Record<string, unknown> = {}) {
  db.seed('drillAttempts', id, drillAttempt({
    id,
    learnerId: user.uid,
    drillId,
    unitId: 'u1',
    curriculumVersion: 'v1',
    correct: true,
    score: 100,
    ...overrides,
  }));
}

function seedCompleteEvidence() {
  const drills = version.units.find((unit) => unit.id === 'u1')!.drills;
  for (const drill of drills) seedAttempt(`attempt-${drill.id}-1`, drill.id);
  seedAttempt('attempt-u1-d2-1', 'u1-d2', { correct: false, score: 0, attemptNumber: 1 });
  seedAttempt('attempt-u1-d2-2', 'u1-d2', { attemptNumber: 2, submittedAt: '2026-11-02T10:02:00.000Z' });
}

beforeEach(() => {
  vi.clearAllMocks();
  db = new FakeProgressDb();
  mockRequireAuth.mockResolvedValue({ ok: true, user });
  mockCollection.mockImplementation((name: string) => db.collection(name));
  mockLoadLearnerTrackContext.mockResolvedValue({ track, version, isDraft: false });
  mockRecordUnitCompletion.mockResolvedValue({ xpAwarded: 115, enrollment: learningEnrollment() });
});

describe('complete Unit request schema', () => {
  it('accepts identifiers and an idempotency key without browser scoring evidence', () => {
    expect(CompleteUnitRequestSchema.safeParse(completionPayload()).success).toBe(true);
  });

  it.each([
    { drillResults: [{ drillId: 'u1-d1', competencyPillarId: 'p1', passedFirstTry: true }] },
    { xpAwarded: 9999 },
    { enrollment: { status: 'COMPLETED' } },
  ])('rejects forged completion or progress data: %o', (forged) => {
    expect(CompleteUnitRequestSchema.safeParse(completionPayload(forged)).success).toBe(false);
  });
});

describe('POST /api/progress/complete-unit', () => {
  it('derives DrillResult values from current-version live attempts and forwards the idempotency key', async () => {
    seedCompleteEvidence();
    seedAttempt('attempt-other-unit', 'u2-d1', { unitId: 'u2', drillId: 'u2-d1' });
    seedAttempt('attempt-old-version', 'u1-d1', { curriculumVersion: 'v0' });
    seedAttempt('attempt-other-learner', 'u1-d1', { learnerId: 'different-learner' });
    seedAttempt('attempt-imported', 'u1-d1', { provenance: 'imported_legacy', correct: false, score: 0 });

    const response = await POST(completionRequest());
    const body = CompleteUnitResponseSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(body.xpAwarded).toBe(115);
    expect(mockRecordUnitCompletion).toHaveBeenCalledTimes(1);
    const args = mockRecordUnitCompletion.mock.calls[0][0];
    expect(args).toMatchObject({
      user,
      track,
      version,
      unitId: 'u1',
      idempotencyKey: 'completion-key-0001',
    });
    expect(args.drillResults).toEqual(version.units.find((unit) => unit.id === 'u1')!.drills.map((drill) => ({
      drillId: drill.id,
      competencyPillarId: drill.competencyPillarId,
      passedFirstTry: drill.id !== 'u1-d2',
    })));
  });

  it('fails when there is no server-recorded Drill evidence', async () => {
    const response = await POST(completionRequest());
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toBe('DRILL_EVIDENCE_INCOMPLETE');
    expect(mockRecordUnitCompletion).not.toHaveBeenCalled();
  });

  it('fails when one Drill has attempts but none are correct', async () => {
    seedCompleteEvidence();
    db.seed('drillAttempts', 'attempt-u1-d3-1', drillAttempt({
      id: 'attempt-u1-d3-1',
      learnerId: user.uid,
      drillId: 'u1-d3',
      unitId: 'u1',
      correct: false,
      score: 0,
    }));

    const response = await POST(completionRequest());
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toBe('DRILL_EVIDENCE_INCOMPLETE');
    expect(mockRecordUnitCompletion).not.toHaveBeenCalled();
  });

  it('does not accept imported legacy attempts as live completion evidence', async () => {
    seedCompleteEvidence();
    db.seed('drillAttempts', 'attempt-u1-d4-1', drillAttempt({
      id: 'attempt-u1-d4-1',
      learnerId: user.uid,
      drillId: 'u1-d4',
      unitId: 'u1',
      provenance: 'imported_legacy',
    }));

    const response = await POST(completionRequest());

    expect(response.status).toBe(409);
    expect(mockRecordUnitCompletion).not.toHaveBeenCalled();
  });

  it('rejects browser-supplied drillResults before loading progress or recording completion', async () => {
    const response = await POST(completionRequest({
      drillResults: [{ drillId: 'u1-d1', competencyPillarId: 'p1', passedFirstTry: true }],
    }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('VALIDATION_FAILED');
    expect(mockLoadLearnerTrackContext).not.toHaveBeenCalled();
    expect(mockRecordUnitCompletion).not.toHaveBeenCalled();
  });

  it('does not record completion for draft preview play', async () => {
    mockLoadLearnerTrackContext.mockResolvedValue({ track, version, isDraft: true });

    const response = await POST(completionRequest());
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('DRAFT_NOT_RECORDED');
    expect(mockRecordUnitCompletion).not.toHaveBeenCalled();
  });
});
