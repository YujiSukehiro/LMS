import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SimSessionDocSchema, type SimEvaluation, type SimSessionDoc } from '@/lib/schemas/analytics';
import type { PublicSimScenario, TrackDoc, TrackVersionDoc } from '@/lib/schemas/curriculum';
import type { SessionUser } from '@/lib/schemas/domain';

const { mockCollection, mockRunTransaction } = vi.hoisted(() => ({
  mockCollection: vi.fn(),
  mockRunTransaction: vi.fn(),
}));

vi.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection, runTransaction: mockRunTransaction },
}));

import { recordSimulationEvaluation, saveSimulationEvaluation } from '@/lib/services/analytics-rollup';

function syntheticSession(updatedAt = 10): SimSessionDoc {
  return SimSessionDocSchema.parse({
    id: 'session-synthetic',
    userId: 'learner-synthetic',
    userDisplayName: 'Synthetic Learner',
    partnerCohortId: 'INTERNAL',
    divisionId: 'INBOUND',
    trackId: 'track-synthetic',
    versionId: 'v1',
    scenarioId: 'scenario-synthetic',
    scenarioTitle: 'Synthetic scenario',
    status: 'READY_FOR_EVAL',
    turnCount: 0,
    messages: [],
    selectedDisposition: 'Recovered',
    evaluation: null,
    startedAt: 1,
    updatedAt,
  });
}

function snapshot(session: SimSessionDoc) {
  const data = { ...session };
  return {
    id: session.id,
    exists: true,
    data: () => data,
    get: (field: string) => data[field as keyof SimSessionDoc],
  };
}

const evaluation: SimEvaluation = {
  overallScorePct: 100,
  passed: true,
  autoFailedReason: null,
  dispositionCorrect: true,
  summaryFeedback: 'Synthetic evaluation fixture.',
  strengthsHighlighted: [],
  coachingImprovements: [],
  criterionResults: [],
  evaluatedAt: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockCollection.mockImplementation((collectionName: string) => ({
    doc: (id: string) => ({ id, path: `${collectionName}/${id}` }),
  }));
});

describe('evaluation commit session staleness', () => {
  it('rejects a stale saveSimulationEvaluation transaction before any writes', async () => {
    const update = vi.fn();
    const set = vi.fn();
    mockRunTransaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      get: async () => snapshot(syntheticSession(11)),
      update,
      set,
    }));

    await expect(saveSimulationEvaluation({
      sessionId: 'session-synthetic',
      evaluation,
      selectedDisposition: 'Recovered',
      expectedSessionUpdatedAt: 10,
    })).rejects.toMatchObject({ status: 409, code: 'STALE_MANUAL_PACKAGE' });

    expect(mockRunTransaction).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
  });

  it('rejects a stale recordSimulationEvaluation transaction before any writes', async () => {
    const update = vi.fn();
    const set = vi.fn();
    mockRunTransaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      getAll: async () => [snapshot(syntheticSession(11)), {}, {}],
      update,
      set,
    }));
    const user = { uid: 'learner-synthetic', partnerCohortId: 'INTERNAL' } as unknown as SessionUser;
    const track = {
      id: 'track-synthetic',
      divisionId: 'INBOUND',
      competencyPillars: [],
    } as unknown as TrackDoc;
    const version = { versionId: 'v1', competencyPillars: [] } as unknown as TrackVersionDoc;
    const scenario = { id: 'scenario-synthetic' } as unknown as PublicSimScenario;

    await expect(recordSimulationEvaluation({
      user,
      track,
      version,
      session: syntheticSession(),
      evaluation,
      scenario,
      pillars: [],
      selectedDisposition: 'Recovered',
      expectedSessionUpdatedAt: 10,
    })).rejects.toMatchObject({ status: 409, code: 'STALE_MANUAL_PACKAGE' });

    expect(mockRunTransaction).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
  });
});
