import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionUser } from '@/lib/schemas/domain';
import { DrillStartRequestSchema, DrillStartResponseSchema } from '@/lib/schemas/api';
import { FakeProgressDb } from './helpers/fake-progress-db';
import { learningVersion } from './helpers/learning-service-fixtures';

const { mockRequireAuth, mockCollection, mockLoadLearnerTrackContext } = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockCollection: vi.fn(),
  mockLoadLearnerTrackContext: vi.fn(),
}));

vi.mock('@/lib/firebase/auth-guard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/firebase/auth-guard')>();
  return { ...actual, requireAuth: mockRequireAuth };
});
vi.mock('@/lib/firebase/admin', () => ({ adminDb: { collection: mockCollection } }));
vi.mock('@/lib/services/track-loader', () => ({ loadLearnerTrackContext: mockLoadLearnerTrackContext }));

import { POST } from '@/app/api/progress/drill-start/route';

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
let db: FakeProgressDb;

function startPayload(overrides: Record<string, unknown> = {}) {
  return { trackId: 'track-1', versionId: 'v1', unitId: 'u1', drillId: 'u1-d1', ...overrides };
}

function startRequest(overrides: Record<string, unknown> = {}): Request {
  return new Request('http://localhost/api/progress/drill-start', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(startPayload(overrides)),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
  db = new FakeProgressDb();
  mockRequireAuth.mockResolvedValue({ ok: true, user });
  mockCollection.mockImplementation((name: string) => db.collection(name));
  mockLoadLearnerTrackContext.mockResolvedValue({
    track: { id: 'track-1' },
    version: learningVersion(),
    isDraft: false,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('drill start request schema', () => {
  it.each(['learnerId', 'startedAt', 'consumedAt', 'answer', 'correct'])('rejects client-owned field %s', (field) => {
    expect(DrillStartRequestSchema.safeParse(startPayload({ [field]: 'forged' })).success).toBe(false);
  });
});

describe('POST /api/progress/drill-start', () => {
  it('creates a server-owned timing record with no answer or grading data', async () => {
    const response = await POST(startRequest());
    const body = DrillStartResponseSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(body.startedAt).toBe(NOW);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(db.get('drillAttemptStarts', body.startId)).toEqual({
      id: body.startId,
      learnerId: user.uid,
      trackId: 'track-1',
      unitId: 'u1',
      drillId: 'u1-d1',
      curriculumVersion: 'v1',
      startedAt: NOW,
      consumedAt: null,
    });
    expect(body).not.toHaveProperty('answer');
    expect(body).not.toHaveProperty('correctAnswer');
  });

  it('does not create a timing record for a Drill outside the requested Unit', async () => {
    const response = await POST(startRequest({ drillId: 'u2-d1' }));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe('DRILL_NOT_FOUND');
    expect(db.all('drillAttemptStarts')).toHaveLength(0);
  });
});
