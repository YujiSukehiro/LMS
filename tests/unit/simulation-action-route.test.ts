import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildStandardMedsScenario } from '@/lib/content/standard-meds-scenarios';
import { SimSessionDocSchema, type SimSessionDoc } from '@/lib/schemas/analytics';
import type { SessionUser } from '@/lib/schemas/domain';
import { createInitialScenarioState } from '@/lib/services/scenario-state';

const {
  mockRequireAuth,
  mockRunTransaction,
  mockCollection,
  mockLoadOwnedSimSession,
  mockSimSessionsCollection,
  mockLoadVersion,
  mockTxGet,
  mockTxUpdate,
  mockTxSet,
  mockWhere,
  mockOutboxGet,
  mockOutboxDoc,
  mockEventDoc,
} = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockRunTransaction: vi.fn(),
  mockCollection: vi.fn(),
  mockLoadOwnedSimSession: vi.fn(),
  mockSimSessionsCollection: vi.fn(),
  mockLoadVersion: vi.fn(),
  mockTxGet: vi.fn(),
  mockTxUpdate: vi.fn(),
  mockTxSet: vi.fn(),
  mockWhere: vi.fn(),
  mockOutboxGet: vi.fn(),
  mockOutboxDoc: vi.fn(),
  mockEventDoc: vi.fn(),
}));

vi.mock('@/lib/firebase/auth-guard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/firebase/auth-guard')>();
  return { ...actual, requireAuth: mockRequireAuth };
});
vi.mock('@/lib/firebase/admin', () => ({
  adminDb: { runTransaction: mockRunTransaction, collection: mockCollection },
}));
vi.mock('@/lib/services/simulation-engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/simulation-engine')>();
  return {
    ...actual,
    loadOwnedSimSession: mockLoadOwnedSimSession,
    simSessionsCollection: mockSimSessionsCollection,
  };
});
vi.mock('@/lib/services/track-loader', () => ({ loadVersion: mockLoadVersion }));

import { GET, POST } from '@/app/api/simulations/[sessionId]/action/route';

const user: SessionUser = {
  uid: 'learner-synthetic',
  email: 'learner@synthetic.internal',
  displayName: 'Synthetic Learner',
  role: 'AGENT',
  partnerCohortId: 'INTERNAL',
  divisionIds: ['INBOUND'],
  active: true,
};
const scenario = buildStandardMedsScenario('NC-DOSAGE-BASE');

function session(): SimSessionDoc {
  return SimSessionDocSchema.parse({
    id: 'session-synthetic',
    userId: user.uid,
    userDisplayName: user.displayName,
    partnerCohortId: user.partnerCohortId,
    divisionId: 'INBOUND',
    trackId: 'track-synthetic',
    versionId: 'v1',
    scenarioId: scenario.id,
    scenarioTitle: scenario.title,
    status: 'ACTIVE',
    turnCount: 0,
    messages: [],
    selectedDisposition: null,
    evaluation: null,
    scenarioState: {
      ...createInitialScenarioState(scenario),
      lifecycle: 'in_call',
      inspectionIds: scenario.evidenceRequirements!.requiredInspections,
      localTimeValidated: true,
      recordingDisclosed: true,
      contactReached: 'patient',
      recording: 'active',
      smsPermissionGranted: true,
    },
    simulationEvents: [],
    nextEventSequence: 1,
    startedAt: 1,
    updatedAt: 1,
  });
}

function actionRequest(action: unknown): Request {
  return new Request('http://localhost/api/simulations/session-synthetic/action', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action }),
  });
}

const params = Promise.resolve({ sessionId: 'session-synthetic' });

beforeEach(() => {
  vi.clearAllMocks();
  const current = session();
  const sessionRef = {
    id: current.id,
    collection: () => ({ doc: mockEventDoc }),
  };
  mockRequireAuth.mockResolvedValue({ ok: true, user });
  mockLoadOwnedSimSession.mockResolvedValue(current);
  mockLoadVersion.mockResolvedValue({ simScenarios: [scenario] });
  mockSimSessionsCollection.mockReturnValue({ doc: () => sessionRef });
  mockCollection.mockReturnValue({ where: mockWhere, doc: mockOutboxDoc });
  mockWhere.mockReturnValue({ get: mockOutboxGet });
  mockOutboxGet.mockResolvedValue({ docs: [] });
  mockOutboxDoc.mockImplementation((id: string) => ({ id, collectionName: 'simSyntheticOutbox' }));
  mockEventDoc.mockImplementation((id: string) => ({ id, collectionName: 'events' }));
  mockTxGet.mockResolvedValue({ exists: true, id: current.id, data: () => current });
  mockRunTransaction.mockImplementation(async (callback) => callback({
    get: mockTxGet,
    update: mockTxUpdate,
    set: mockTxSet,
  }));
});

describe('simulation action route', () => {
  it('atomically stores the event and fake SMS outbox record without a live action', async () => {
    const response = await POST(actionRequest({ type: 'send_sms', assetId: 'neurocalmrx-dosage-link' }), { params });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.outboxRecord).toMatchObject({
      kind: 'fake_sms',
      destination: 'SYNTHETIC TRAINING outbox',
      assetId: 'neurocalmrx-dosage-link',
      synthetic: true,
    });
    expect(body.session.simulationEvents).toHaveLength(1);
    expect(body.session.nextEventSequence).toBe(2);
    expect(mockTxUpdate).toHaveBeenCalledTimes(1);
    expect(mockTxSet).toHaveBeenCalledTimes(2);
    expect(mockEventDoc).toHaveBeenCalledWith(body.session.simulationEvents[0].id);
    expect(mockOutboxDoc).toHaveBeenCalledWith(body.outboxRecord.id);
    const storedOutbox = mockTxSet.mock.calls.find(([ref]) => ref.collectionName === 'simSyntheticOutbox')?.[1];
    expect(storedOutbox).toEqual(body.outboxRecord);
  });

  it('rejects a stale operations view without writing events or outbox records', async () => {
    mockTxGet.mockResolvedValue({
      exists: true,
      id: 'session-synthetic',
      data: () => ({ ...session(), updatedAt: 2 }),
    });

    const response = await POST(actionRequest({ type: 'note', text: 'Synthetic outcome.' }), { params });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toBe('SIM_CONFLICT');
    expect(mockTxUpdate).not.toHaveBeenCalled();
    expect(mockTxSet).not.toHaveBeenCalled();
  });

  it('returns only validated synthetic outbox records in chronological order', async () => {
    const record = {
      sessionId: 'session-synthetic',
      kind: 'fake_sms',
      destination: 'SYNTHETIC TRAINING outbox',
      assetId: 'neurocalmrx-dosage-link',
      displayText: 'SYNTHETIC TRAINING — no SMS sent.',
      eventId: 'event-1',
      synthetic: true,
    };
    mockOutboxGet.mockResolvedValue({
      docs: [
        { id: 'outbox-2', data: () => ({ ...record, createdAt: '2026-01-15T17:01:00.000Z' }) },
        { id: 'outbox-1', data: () => ({ ...record, createdAt: '2026-01-15T17:00:00.000Z' }) },
      ],
    });

    const response = await GET(new Request('http://localhost/api/simulations/session-synthetic/action'), { params });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.outboxRecords.map((item: { id: string }) => item.id)).toEqual(['outbox-1', 'outbox-2']);
    expect(body.outboxRecords.every((item: { synthetic: boolean }) => item.synthetic)).toBe(true);
  });
});
