import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProvenance } from '@/lib/ai/provenance';
import {
  SimEvaluationSchema,
  SimSessionDocSchema,
  type SimMessage,
  type SimSessionDoc,
} from '@/lib/schemas/analytics';
import type { EvaluateSimResponse } from '@/lib/schemas/api';
import {
  TrackDocSchema,
  TrackVersionDocSchema,
  type PublicSimScenario,
  type SecretSimScenarioConfig,
} from '@/lib/schemas/curriculum';
import type { SessionUser } from '@/lib/schemas/domain';

const {
  mockRequireAuth,
  mockRunTransaction,
  mockGetLLMGateway,
  mockStreamChat,
  mockLoadOwnedSimSession,
  mockSimSessionsCollection,
  mockLoadLearnerTrackContext,
  mockLoadSecretScenario,
  mockLoadTrack,
  mockLoadVersion,
  mockEnsureEnrollment,
  mockHasCompletedAllUnits,
  mockSaveSimulationEvaluation,
  mockRecordSimulationEvaluation,
  mockEvaluateSimulation,
} = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockRunTransaction: vi.fn(),
  mockGetLLMGateway: vi.fn(),
  mockStreamChat: vi.fn(),
  mockLoadOwnedSimSession: vi.fn(),
  mockSimSessionsCollection: vi.fn(),
  mockLoadLearnerTrackContext: vi.fn(),
  mockLoadSecretScenario: vi.fn(),
  mockLoadTrack: vi.fn(),
  mockLoadVersion: vi.fn(),
  mockEnsureEnrollment: vi.fn(),
  mockHasCompletedAllUnits: vi.fn(),
  mockSaveSimulationEvaluation: vi.fn(),
  mockRecordSimulationEvaluation: vi.fn(),
  mockEvaluateSimulation: vi.fn(),
}));

vi.mock('@/lib/firebase/auth-guard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/firebase/auth-guard')>();
  return { ...actual, requireAuth: mockRequireAuth };
});
vi.mock('@/lib/firebase/admin', () => ({ adminDb: { runTransaction: mockRunTransaction } }));
vi.mock('@/lib/ai/gateway', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/gateway')>();
  return { ...actual, getLLMGateway: mockGetLLMGateway };
});
vi.mock('@/lib/services/simulation-engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/simulation-engine')>();
  return {
    ...actual,
    evaluateSimulation: mockEvaluateSimulation,
    loadOwnedSimSession: mockLoadOwnedSimSession,
    simSessionsCollection: mockSimSessionsCollection,
  };
});
vi.mock('@/lib/services/track-loader', () => ({
  loadLearnerTrackContext: mockLoadLearnerTrackContext,
  loadSecretScenario: mockLoadSecretScenario,
  loadTrack: mockLoadTrack,
  loadVersion: mockLoadVersion,
}));
vi.mock('@/lib/services/analytics-rollup', () => ({
  ensureEnrollment: mockEnsureEnrollment,
  hasCompletedAllUnits: mockHasCompletedAllUnits,
  saveSimulationEvaluation: mockSaveSimulationEvaluation,
  recordSimulationEvaluation: mockRecordSimulationEvaluation,
}));

import { POST as startPOST } from '@/app/api/simulations/start/route';
import { POST as messagePOST } from '@/app/api/simulations/[sessionId]/message/route';
import { POST as evaluatePOST } from '@/app/api/simulations/[sessionId]/evaluate/route';

const user: SessionUser = {
  uid: 'learner-synthetic',
  email: 'learner@synthetic.internal',
  displayName: 'Synthetic Learner',
  role: 'AGENT',
  partnerCohortId: 'INTERNAL',
  divisionIds: ['INBOUND'],
  active: true,
};

const scenario: PublicSimScenario = {
  id: 'scenario-synthetic',
  title: 'Synthetic replay call',
  difficulty: 'STANDARD',
  counterpartyRoleLabel: 'Synthetic caller',
  contextTicketSummary: 'Synthetic training queue; no real customer data.',
  openingMessage: 'This is a synthetic demonstration call.',
  dispositionOptions: ['Completed', 'Escalated', 'Follow up'],
  maxTurns: 8,
  passScoreThreshold: 80,
};

const secret: SecretSimScenarioConfig = {
  scenarioId: scenario.id,
  personaName: 'Synthetic Caller',
  personaBackstoryAndMood: 'A fictional caller in a deterministic training fixture.',
  hiddenFactsToRevealOnlyWhenAsked: [],
  conditionalBehaviors: [],
  expectedDisposition: 'Completed',
  autoFailTriggers: [],
  rubricCriteria: [
    {
      id: 'rule-1',
      competencyPillarId: 'pillar-1',
      criterionLabel: 'Synthetic greeting',
      evaluationRule: 'Use a clear synthetic greeting.',
      weight: 100,
      sourcePages: [1],
    },
  ],
};

const pillars = [
  {
    id: 'pillar-1',
    key: 'communication',
    label: 'Synthetic communication',
    description: 'Communicate clearly in a synthetic call.',
  },
];

const track = TrackDocSchema.parse({
  id: 'track-synthetic',
  title: 'Synthetic Track',
  campaignCode: 'SYNTH',
  divisionId: 'INBOUND',
  status: 'PUBLISHED',
  generationProgress: { step: 'READY', percent: 100, message: 'Synthetic fixture ready.' },
  sourcePdfStoragePath: 'synthetic/fixture.pdf',
  sourcePdfFileName: 'fixture.pdf',
  sourcePageCount: 1,
  currentDraftVersionId: 'draft',
  publishedVersionId: 'v1',
  assignedCohortIds: ['INTERNAL'],
  competencyPillars: pillars,
  unitCount: 0,
  simScenarioCount: 1,
  estimatedTotalMinutes: 5,
  createdByUid: 'trainer-synthetic',
  createdAt: 1,
  updatedAt: 1,
});

const version = TrackVersionDocSchema.parse({
  versionId: 'v1',
  trackId: track.id,
  versionNumber: 1,
  competencyPillars: pillars,
  units: [],
  simScenarios: [scenario],
  publishedAt: 1,
  createdAt: 1,
});

const replayEvaluation = SimEvaluationSchema.parse({
  overallScorePct: 100,
  passed: true,
  autoFailedReason: null,
  dispositionCorrect: true,
  summaryFeedback: 'Synthetic replay scorecard for inspection.',
  strengthsHighlighted: ['Synthetic evidence'],
  coachingImprovements: [],
  criterionResults: [
    {
      criterionId: 'rule-1',
      competencyPillarId: 'pillar-1',
      criterionLabel: 'Synthetic greeting',
      score: 100,
      agentQuoteEvidence: 'Hello, synthetic caller.',
      coachingNote: 'Synthetic fixture result.',
      betterResponseExample: null,
    },
  ],
  provenance: createProvenance({
    source: 'replay',
    provider: 'replay',
    model: 'Demo replay',
    schema: { name: 'SimJudgeOutput', version: '1' },
  }),
  evaluatedAt: 1,
});

function replaySession(): SimSessionDoc {
  return SimSessionDocSchema.parse({
    id: 'session-synthetic',
    userId: user.uid,
    userDisplayName: user.displayName,
    partnerCohortId: user.partnerCohortId,
    divisionId: 'INBOUND',
    trackId: track.id,
    versionId: 'v1',
    scenarioId: scenario.id,
    scenarioTitle: scenario.title,
    status: 'ACTIVE',
    turnCount: 0,
    messages: [
      {
        id: 'message-agent',
        role: 'agent',
        content: 'Hello, synthetic caller.',
        createdAt: 1,
      },
    ],
    selectedDisposition: null,
    evaluation: null,
    provenance: createProvenance({ source: 'replay', provider: 'replay', model: 'Demo replay' }),
    startedAt: 1,
    updatedAt: 1,
  });
}

const mockSessionRef = { id: 'session-new', set: vi.fn() };
const mockTxGet = vi.fn();
const mockTxUpdate = vi.fn();

function request(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('AI_PROVIDER', 'replay');
  vi.spyOn(console, 'error').mockImplementation(() => {});

  const query = {
    where: vi.fn(),
    orderBy: vi.fn(),
    select: vi.fn(),
    get: vi.fn().mockResolvedValue({ docs: [] }),
  };
  query.where.mockReturnValue(query);
  query.orderBy.mockReturnValue(query);
  query.select.mockReturnValue(query);
  mockSimSessionsCollection.mockReturnValue({
    ...query,
    doc: (id?: string) => (id ? { id } : mockSessionRef),
  });

  mockRequireAuth.mockResolvedValue({ ok: true, user });
  mockLoadOwnedSimSession.mockResolvedValue(replaySession());
  mockLoadLearnerTrackContext.mockResolvedValue({ track, version, versionId: 'v1', isDraft: true });
  mockLoadSecretScenario.mockResolvedValue(secret);
  mockLoadTrack.mockResolvedValue(track);
  mockLoadVersion.mockResolvedValue(version);
  mockHasCompletedAllUnits.mockReturnValue(true);
  mockEvaluateSimulation.mockResolvedValue(replayEvaluation);
  mockRecordSimulationEvaluation.mockResolvedValue({ certified: true, enrollment: {} });
  mockGetLLMGateway.mockReturnValue({ streamChat: mockStreamChat });
  mockStreamChat.mockImplementation(async function* () {
    yield 'Synthetic caller reply';
  });
  mockTxGet.mockResolvedValue({
    exists: true,
    get: (field: string) => {
      if (field === 'status') return 'ACTIVE';
      if (field === 'turnCount') return 0;
      if (field === 'messages') return replaySession().messages;
      return undefined;
    },
  });
  mockRunTransaction.mockImplementation(async (callback) =>
    callback({ get: mockTxGet, update: mockTxUpdate }),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('Demo replay simulation routes', () => {
  it('persists replay provenance when a session starts', async () => {
    const response = await startPOST(
      request('/api/simulations/start', { trackId: track.id, versionId: 'v1', scenarioId: scenario.id }),
    );
    const body = (await response.json()) as { session: SimSessionDoc };

    expect(response.status).toBe(201);
    expect(body.session.provenance).toMatchObject({
      source: 'replay',
      provider: 'replay',
      model: 'Demo replay',
      runtime: { label: 'Demo replay', protocol: 'replay' },
    });
    expect(mockSessionRef.set).toHaveBeenCalledWith(
      expect.objectContaining({ provenance: expect.objectContaining({ source: 'replay' }) }),
    );
  });

  it('persists replay provenance on a completed actor turn', async () => {
    const response = await messagePOST(
      request('/api/simulations/session-synthetic/message', { content: 'Hello, synthetic caller.' }),
      { params: Promise.resolve({ sessionId: 'session-synthetic' }) },
    );
    const stream = await response.text();

    expect(stream).toContain('event: done');
    const update = mockTxUpdate.mock.calls[0]?.[1] as { messages: SimMessage[] };
    expect(update.messages).toHaveLength(3);
    expect(update.messages[2]).toMatchObject({
      role: 'counterparty',
      content: 'Synthetic caller reply',
      provenance: {
        source: 'replay',
        provider: 'replay',
        model: 'Demo replay',
        prompt: { templateId: 'simulation.actor', templateVersion: '1' },
        schema: { name: 'SimActorText', version: '1' },
      },
    });
    expect(update.messages[2].provenance?.prompt.inputHash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('emits no done event and writes no fake turn when actor generation fails', async () => {
    mockStreamChat.mockImplementation(async function* () {
      throw new Error('Synthetic actor failure');
    });

    const response = await messagePOST(
      request('/api/simulations/session-synthetic/message', { content: 'Hello, synthetic caller.' }),
      { params: Promise.resolve({ sessionId: 'session-synthetic' }) },
    );
    const stream = await response.text();

    expect(stream).toContain('event: error');
    expect(stream).not.toContain('event: done');
    expect(mockRunTransaction).not.toHaveBeenCalled();
    expect(mockTxUpdate).not.toHaveBeenCalled();
    expect(mockSessionRef.set).not.toHaveBeenCalled();
  });

  it('saves a published replay scorecard for inspection but bypasses all progress recording', async () => {
    const response = await evaluatePOST(
      request('/api/simulations/session-synthetic/evaluate', { selectedDisposition: 'Completed' }),
      { params: Promise.resolve({ sessionId: 'session-synthetic' }) },
    );
    const body = (await response.json()) as EvaluateSimResponse;

    expect({ status: response.status, body }).toMatchObject({ status: 200 });
    expect(body).toMatchObject({ certified: false, demoReplay: true });
    expect(mockSaveSimulationEvaluation).toHaveBeenCalledWith({
      sessionId: 'session-synthetic',
      evaluation: replayEvaluation,
      selectedDisposition: 'Completed',
    });
    expect(mockRecordSimulationEvaluation).not.toHaveBeenCalled();
    expect(mockEnsureEnrollment).not.toHaveBeenCalled();
  });

  it('keeps the normal published evaluation path unchanged', async () => {
    const normalSession = SimSessionDocSchema.parse({
      ...replaySession(),
      provenance: createProvenance({ source: 'local_ai', provider: 'openai_compatible', model: 'synthetic-fast' }),
    });
    const normalEvaluation = SimEvaluationSchema.parse({
      ...replayEvaluation,
      provenance: createProvenance({ source: 'local_ai', provider: 'openai_compatible', model: 'synthetic-judge' }),
    });
    mockLoadOwnedSimSession.mockResolvedValue(normalSession);
    mockEvaluateSimulation.mockResolvedValue(normalEvaluation);

    const response = await evaluatePOST(
      request('/api/simulations/session-synthetic/evaluate', { selectedDisposition: 'Completed' }),
      { params: Promise.resolve({ sessionId: 'session-synthetic' }) },
    );
    const body = (await response.json()) as EvaluateSimResponse;

    expect(response.status).toBe(200);
    expect(body.certified).toBe(true);
    expect(body).not.toHaveProperty('demoReplay');
    expect(mockRecordSimulationEvaluation).toHaveBeenCalledTimes(1);
    expect(mockSaveSimulationEvaluation).not.toHaveBeenCalled();
  });
});
