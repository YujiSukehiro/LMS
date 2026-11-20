import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProvenance } from '@/lib/ai/provenance';
import { AIUnavailableError } from '@/lib/ai/types';
import { SimEvaluationSchema, SimSessionDocSchema, type SimMessage, type SimSessionDoc } from '@/lib/schemas/analytics';
import { TrackDocSchema, TrackVersionDocSchema, type PublicSimScenario, type SecretSimScenarioConfig } from '@/lib/schemas/curriculum';
import type { SessionUser } from '@/lib/schemas/domain';
import { createInitialScenarioState } from '@/lib/services/scenario-state';
import { countsTowardDailySimLimit } from '@/lib/services/sim-session-limits';

const h = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  runTransaction: vi.fn(),
  getLLMGateway: vi.fn(),
  streamChat: vi.fn(),
  loadOwned: vi.fn(),
  collection: vi.fn(),
  loadLearnerTrackContext: vi.fn(),
  loadSecret: vi.fn(),
  loadTrack: vi.fn(),
  loadVersion: vi.fn(),
  saveEvaluation: vi.fn(),
  recordEvaluation: vi.fn(),
  evaluate: vi.fn(),
  availability: vi.fn(),
  noteUnavailable: vi.fn(),
  certifications: [] as Array<Record<string, unknown>>,
  countToday: vi.fn(),
}));

vi.mock('@/lib/firebase/auth-guard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/firebase/auth-guard')>()),
  requireAuth: h.requireAuth,
}));
vi.mock('@/lib/firebase/admin', () => ({ adminDb: { runTransaction: h.runTransaction } }));
vi.mock('@/lib/ai/gateway', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ai/gateway')>()),
  getLLMGateway: h.getLLMGateway,
}));
vi.mock('@/lib/ai/availability', () => ({ getCachedAiAvailability: h.availability, noteAiUnavailable: h.noteUnavailable }));
vi.mock('@/lib/services/simulation-engine', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/services/simulation-engine')>()),
  evaluateSimulation: h.evaluate,
  loadOwnedSimSession: h.loadOwned,
  simSessionsCollection: h.collection,
  countSimSessionsTowardLimitToday: h.countToday,
}));
vi.mock('@/lib/services/learning-evidence', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/services/learning-evidence')>()),
  certificationsCollection: () => ({
    where: () => ({ where: () => ({ get: async () => ({ docs: h.certifications.map((data) => ({ id: String(data.id), data: () => data })) }) }) }),
  }),
}));
vi.mock('@/lib/services/track-loader', () => ({
  loadLearnerTrackContext: h.loadLearnerTrackContext,
  loadSecretScenario: h.loadSecret,
  loadTrack: h.loadTrack,
  loadVersion: h.loadVersion,
}));
vi.mock('@/lib/services/analytics-rollup', () => ({
  ensureEnrollment: vi.fn(),
  hasCompletedAllUnits: vi.fn().mockReturnValue(true),
  saveSimulationEvaluation: h.saveEvaluation,
  recordSimulationEvaluation: h.recordEvaluation,
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
  dispositionOptions: ['Recovered', 'Callback scheduled', "Didn't reply"],
  maxTurns: 8,
  passScoreThreshold: 80,
  context: {
    direction: 'outbound',
    queue: 'recovery',
    product: 'Synthetic Product',
    stage: 'dosage',
    contactState: 'lead',
    pricingPosture: 'active',
    caseBranch: 'replay_test',
    syntheticTimezone: 'America/Boise',
    syntheticNow: '2026-01-15T17:00:00.000Z',
    sourceRevision: 'synthetic-source',
    curriculumVersion: 'synthetic-v1',
  },
  evidenceRequirements: {
    minimumLearnerTurns: 0,
    requiredInspections: [],
    requiredWorkflowActions: [],
    requiredWrapUpEvidence: [],
    requiredGateIds: [],
    requiredCustomerConcerns: [],
    expectedDurationMinutes: 5,
    gateSourceRefs: {},
    maximumCriticalFailures: 0,
    maximumMajorFailures: 0,
  },
};

const secret: SecretSimScenarioConfig = {
  scenarioId: scenario.id,
  personaName: 'Synthetic Caller',
  personaBackstoryAndMood: 'A fictional caller in a deterministic training fixture.',
  hiddenFactsToRevealOnlyWhenAsked: [],
  conditionalBehaviors: [],
  expectedDisposition: 'Recovered',
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

const storedEvaluation = SimEvaluationSchema.parse({
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


function session(patch: Partial<SimSessionDoc> = {}): SimSessionDoc {
  return SimSessionDocSchema.parse({
    id: 'session-1',
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
    messages: [{ id: 'opening', role: 'counterparty', content: 'Hello?', createdAt: 1 }],
    selectedDisposition: null,
    evaluation: null,
    scenarioState: { ...createInitialScenarioState(scenario), lifecycle: 'in_call', contactReached: 'patient', recording: 'active' },
    simulationEvents: [],
    nextEventSequence: 1,
    startedAt: 1,
    updatedAt: 1,
    ...patch,
  });
}

function readySession(patch: Partial<SimSessionDoc> = {}): SimSessionDoc {
  return session({
    status: 'READY_FOR_EVAL',
    selectedDisposition: 'Recovered',
    turnCount: 2,
    scenarioState: {
      ...createInitialScenarioState(scenario),
      lifecycle: 'wrap_up', contactReached: 'patient', workflowActionIds: ['recovery_confirmed'],
      selectedDisposition: 'Recovered', dispositionCorrect: true, wrapUpComplete: true,
    },
    ...patch,
  });
}

function doc(data: SimSessionDoc) {
  return { id: data.id, data: () => data, get: (field: string) => data[field as keyof SimSessionDoc] };
}

const queryDocs: { today: ReturnType<typeof doc>[]; resumable: ReturnType<typeof doc>[] } = { today: [], resumable: [] };
const batchSet = vi.fn();
const startLock: { sessionId: string | null } = { sessionId: null };
const txUpdate = vi.fn();
let txDoc: SimSessionDoc;

function request(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}
const params = { params: Promise.resolve({ sessionId: 'session-1' }) };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('AI_PROVIDER', 'openai_compatible');
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  queryDocs.today = [];
  queryDocs.resumable = [];
  startLock.sessionId = null;
  h.availability.mockReturnValue({ status: 'unknown', message: 'No check.', provider: 'openai_compatible' });
  h.requireAuth.mockResolvedValue({ ok: true, user });
  h.loadLearnerTrackContext.mockResolvedValue({ track, version, versionId: 'v1', isDraft: true });
  h.loadSecret.mockResolvedValue(secret);
  h.loadTrack.mockResolvedValue(track);
  h.loadVersion.mockResolvedValue(version);
  h.collection.mockImplementation(() => {
    const query = {
      mode: 'today' as 'today' | 'resumable',
      where: vi.fn((field: string) => {
        if (field === 'userId') query.mode = 'resumable';
        return query;
      }),
      orderBy: vi.fn(() => query),
      select: vi.fn(() => query),
      get: vi.fn(async () => ({ docs: queryDocs[query.mode] })),
      doc: (id?: string) => ({
        id: id ?? 'session-new',
        collection: () => ({ doc: (eventId: string) => ({ id: eventId }) }),
        get: async () => ({ exists: true, id: txDoc.id, data: () => txDoc }),
        firestore: {
          batch: () => ({ set: batchSet, commit: vi.fn().mockResolvedValue(undefined) }),
          collection: () => ({ doc: (lockId: string) => ({ id: lockId, path: `simStartLocks/${lockId}` }) }),
          // Start's find-or-create transaction: the lock is read from startLock, writes go to batchSet.
          runTransaction: async (callback: (tx: unknown) => Promise<unknown>) => callback({
            get: async (target: { path?: string }) => target.path?.startsWith('simStartLocks/')
              ? { exists: Boolean(startLock.sessionId), get: () => startLock.sessionId }
              : { exists: true, id: txDoc.id, data: () => txDoc },
            set: batchSet,
          }),
        },
      }),
    };
    return query;
  });
  h.countToday.mockImplementation(async (uid: string) =>
    queryDocs.today.filter((d) => d.get('userId') === uid && countsTowardDailySimLimit({ status: d.get('status'), turnCount: d.get('turnCount') })).length);
  txDoc = session();
  h.runTransaction.mockImplementation(async (callback) =>
    callback({
      get: async () => ({ exists: true, id: txDoc.id, data: () => txDoc, get: (field: string) => txDoc[field as keyof SimSessionDoc] }),
      update: txUpdate,
      set: vi.fn(),
    }),
  );
  h.streamChat.mockImplementation(async function* () {
    yield 'Caller: *sighs* Fine, what is it?\nAgent: Thanks!';
  });
  h.getLLMGateway.mockReturnValue({ streamChat: h.streamChat });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('POST /api/simulations/start', () => {
  const body = { trackId: track.id, versionId: 'v1', scenarioId: scenario.id };

  it('returns 503 AI_UNAVAILABLE (and creates nothing) when the AI caller is blocked', async () => {
    h.availability.mockReturnValue({ status: 'blocked', message: 'Connection refused', provider: 'openai_compatible' });
    const response = await startPOST(request('/api/simulations/start', body));
    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe('AI_UNAVAILABLE');
    expect(batchSet).not.toHaveBeenCalled();
  });

  it('returns the existing active run of the same scenario instead of creating a new one', async () => {
    queryDocs.resumable = [doc(session({ id: 'existing', turnCount: 3, updatedAt: 5 }))];
    const response = await startPOST(request('/api/simulations/start', body));
    expect(response.status).toBe(200);
    expect((await response.json()).session.id).toBe('existing');
    expect(batchSet).not.toHaveBeenCalled();
  });

  it('never sends trainer-only gate detail to a learner, but keeps it for internal ops', async () => {
    const gate = { ruleId: 'local_time', sourceRefs: [], severity: 'critical' as const, status: 'pass' as const, evidenceEventIds: [], learnerFeedback: 'Check local time.', trainerDetail: 'TRAINER-ONLY-DETAIL' };
    queryDocs.resumable = [doc(session({ id: 'existing', turnCount: 3, updatedAt: 5, gateResults: [gate] }))];
    const learnerBody = await (await startPOST(request('/api/simulations/start', body))).text();
    expect(learnerBody).toContain('Check local time.');
    expect(learnerBody).not.toContain('TRAINER-ONLY-DETAIL');
    expect(learnerBody).not.toContain('trainerDetail');

    h.requireAuth.mockResolvedValue({ ok: true, user: { ...user, role: 'TRAINER' } });
    const opsBody = await (await startPOST(request('/api/simulations/start', body))).text();
    expect(opsBody).toContain('TRAINER-ONLY-DETAIL');
  });

  it('does not resume a run that is waiting for a Trainer score', async () => {
    queryDocs.resumable = [doc(readySession({ id: 'pending', judgeReview: { status: 'awaiting_manual_judge', reason: 'ai_unavailable', requestedAt: 1 } }))];
    const response = await startPOST(request('/api/simulations/start', body));
    expect(response.status).toBe(201);
  });

  it('does not count zero-turn sessions toward the daily limit', async () => {
    vi.stubEnv('MAX_SIM_SESSIONS_PER_USER_PER_DAY', '2');
    queryDocs.today = [doc(session({ id: 'a', status: 'ABANDONED', turnCount: 0 })), doc(session({ id: 'b', status: 'ACTIVE', turnCount: 0, scenarioId: 'other' })), doc(session({ id: 'c', status: 'EVALUATED', turnCount: 4 }))];
    expect((await startPOST(request('/api/simulations/start', body))).status).toBe(201);
    queryDocs.today.push(doc(session({ id: 'd', status: 'ABANDONED', turnCount: 2 })));
    expect((await startPOST(request('/api/simulations/start', body))).status).toBe(429);
  });

  it('returns the run a parallel Start just created (transactional find-or-create), creating nothing', async () => {
    startLock.sessionId = 'parallel-run';
    txDoc = session({ id: 'parallel-run' });
    const response = await startPOST(request('/api/simulations/start', body));
    expect(response.status).toBe(200);
    expect((await response.json()).session.id).toBe('parallel-run');
    expect(batchSet).not.toHaveBeenCalled();
  });

  it('creates a new run when the locked one is no longer resumable, and moves the lock to it', async () => {
    startLock.sessionId = 'old-run';
    txDoc = session({ id: 'old-run', status: 'EVALUATED' });
    const response = await startPOST(request('/api/simulations/start', body));
    expect(response.status).toBe(201);
    expect(batchSet).toHaveBeenCalledWith(expect.objectContaining({ path: expect.stringContaining('simStartLocks/') }), expect.objectContaining({ sessionId: 'session-new' }));
  });
});

describe('daily limit at the first learner message', () => {
  it('refuses the first message of a zero-turn run once the day\'s counted runs reach the limit', async () => {
    vi.stubEnv('MAX_SIM_SESSIONS_PER_USER_PER_DAY', '1');
    queryDocs.today = [doc(session({ id: 'used', status: 'EVALUATED', turnCount: 3 }))];
    h.loadOwned.mockResolvedValue(session({ turnCount: 0 }));
    const response = await messagePOST(request('/api/simulations/session-1/message', { content: 'Hello.' }), params);
    expect(response.status).toBe(429);
    expect((await response.json()).error).toBe('SIM_DAILY_LIMIT');
    expect(h.streamChat).not.toHaveBeenCalled();
  });

  it('lets a run that already has dialogue continue past the limit', async () => {
    vi.stubEnv('MAX_SIM_SESSIONS_PER_USER_PER_DAY', '1');
    queryDocs.today = [doc(session({ id: 'session-1', status: 'ACTIVE', turnCount: 1 }))];
    h.loadOwned.mockResolvedValue(session({ turnCount: 1 }));
    txDoc = session({ turnCount: 1 });
    const stream = await (await messagePOST(request('/api/simulations/session-1/message', { content: 'Hello again.' }), params)).text();
    expect(stream).toContain('event: done');
  });
});

describe('POST /api/simulations/[sessionId]/message', () => {
  it('persists the cleaned caller reply and returns it in done', async () => {
    h.loadOwned.mockResolvedValue(session());
    const response = await messagePOST(request('/api/simulations/session-1/message', { content: 'Hello, this is LogiCall.' }), params);
    const stream = await response.text();
    expect(stream).toContain('event: done');
    expect(stream).toContain('"reply":"Fine, what is it?"');
    const update = txUpdate.mock.calls[0]![1] as { messages: SimMessage[]; simulationEvents: Array<{ provenance: string }> };
    expect(update.messages.at(-1)!.content).toBe('Fine, what is it?');
    expect(update.simulationEvents.at(-1)!.provenance).toBe('local_ai');
  });

  it('labels Gemini actor turns as hosted_ai', async () => {
    vi.stubEnv('AI_PROVIDER', 'gemini');
    h.loadOwned.mockResolvedValue(session());
    await (await messagePOST(request('/api/simulations/session-1/message', { content: 'Hello.' }), params)).text();
    const update = txUpdate.mock.calls[0]![1] as { simulationEvents: Array<{ provenance: string }> };
    expect(update.simulationEvents.at(-1)!.provenance).toBe('hosted_ai');
  });

  it('returns 503 AI_UNAVAILABLE before streaming when the runtime is blocked', async () => {
    h.loadOwned.mockResolvedValue(session());
    h.availability.mockReturnValue({ status: 'blocked', message: 'down', provider: 'openai_compatible' });
    const response = await messagePOST(request('/api/simulations/session-1/message', { content: 'Hello.' }), params);
    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe('AI_UNAVAILABLE');
  });

  it('maps a provider AIUnavailableError during streaming to a plain AI_UNAVAILABLE error event', async () => {
    h.loadOwned.mockResolvedValue(session());
    h.streamChat.mockImplementation(async function* () {
      yield* [];
      throw new AIUnavailableError('ECONNREFUSED 127.0.0.1:8080', 'unreachable');
    });
    const stream = await (await messagePOST(request('/api/simulations/session-1/message', { content: 'Hello.' }), params)).text();
    expect(stream).toContain('event: error');
    expect(stream).toContain('"code":"AI_UNAVAILABLE"');
    expect(stream).not.toContain('ECONNREFUSED');
    expect(txUpdate).not.toHaveBeenCalled();
    expect(h.noteUnavailable).toHaveBeenCalled();
  });
});

describe('POST /api/simulations/[sessionId]/message idempotency', () => {
  const KEY = 'retry-key-0001';
  const savedTurn = (patch: Partial<SimSessionDoc> = {}) => {
    const base = session();
    return session({
      turnCount: 1,
      messages: [
        ...base.messages,
        { id: 'agent-1', role: 'agent', content: 'Hello, this is LogiCall.', createdAt: 1, idempotencyKey: KEY },
        { id: 'reply-1', role: 'counterparty', content: 'Fine, what is it?', createdAt: 2 },
      ],
      ...patch,
    });
  };

  it('stores the key on the saved learner turn', async () => {
    h.loadOwned.mockResolvedValue(session());
    await (await messagePOST(request('/api/simulations/session-1/message', { content: 'Hello, this is LogiCall.', idempotencyKey: KEY }), params)).text();
    const update = txUpdate.mock.calls[0]![1] as { messages: SimMessage[] };
    expect(update.messages.find((message) => message.role === 'agent')?.idempotencyKey).toBe(KEY);
  });

  it('replays the stored reply for a retried key without calling the AI or appending again', async () => {
    h.loadOwned.mockResolvedValue(savedTurn());
    const response = await messagePOST(request('/api/simulations/session-1/message', { content: 'Hello, this is LogiCall.', idempotencyKey: KEY }), params);
    const stream = await response.text();
    expect(stream).toContain('event: done');
    expect(stream).toContain('"reply":"Fine, what is it?"');
    expect(stream).toContain('"turnCount":1');
    expect(stream).toContain('"replayed":true');
    expect(h.streamChat).not.toHaveBeenCalled();
    expect(h.runTransaction).not.toHaveBeenCalled();
  });

  it('replays even after that turn ended the call, instead of answering 409', async () => {
    h.loadOwned.mockResolvedValue(savedTurn({ status: 'READY_FOR_EVAL' }));
    const response = await messagePOST(request('/api/simulations/session-1/message', { content: 'Hello, this is LogiCall.', idempotencyKey: KEY }), params);
    expect(response.status).toBe(200);
    const stream = await response.text();
    expect(stream).toContain('"simEnded":true');
    expect(h.runTransaction).not.toHaveBeenCalled();
  });

  it('treats a new key, or no key, as a new learner turn', async () => {
    h.loadOwned.mockResolvedValue(savedTurn());
    await (await messagePOST(request('/api/simulations/session-1/message', { content: 'Next question.', idempotencyKey: 'another-key-02' }), params)).text();
    await (await messagePOST(request('/api/simulations/session-1/message', { content: 'Next question.' }), params)).text();
    expect(h.streamChat).toHaveBeenCalledTimes(2);
  });

  it('rejects a malformed key', async () => {
    h.loadOwned.mockResolvedValue(session());
    const response = await messagePOST(request('/api/simulations/session-1/message', { content: 'Hi', idempotencyKey: 'bad key with spaces' }), params);
    expect(response.status).toBe(400);
  });
});

describe('POST /api/simulations/[sessionId]/evaluate', () => {
  it('saves gates and marks the call for manual judging (202) when the judge is unavailable', async () => {
    const ready = readySession();
    h.loadOwned.mockResolvedValue(ready);
    txDoc = ready;
    h.evaluate.mockRejectedValue(new AIUnavailableError('timeout', 'timeout'));
    const response = await evaluatePOST(request('/api/simulations/session-1/evaluate', { selectedDisposition: 'Recovered' }), params);
    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body).toMatchObject({ pending: true, judgeReview: { status: 'awaiting_manual_judge', reason: 'ai_unavailable' } });
    expect(body.message).toContain('Trainer will score it');
    expect(txUpdate).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      judgeReview: expect.objectContaining({ status: 'awaiting_manual_judge' }),
      gateResults: expect.any(Array),
      dispositionValidation: expect.objectContaining({ disposition: 'Recovered' }),
    }));
    expect(h.saveEvaluation).not.toHaveBeenCalled();
    expect(h.recordEvaluation).not.toHaveBeenCalled();
  });

  it('returns the stored scorecard (200) on a retry after the call was already scored', async () => {
    h.loadOwned.mockResolvedValue(readySession({ status: 'EVALUATED', evaluation: storedEvaluation }));
    const response = await evaluatePOST(request('/api/simulations/session-1/evaluate', { selectedDisposition: 'Recovered' }), params);
    expect(response.status).toBe(200);
    expect((await response.json()).evaluation.summaryFeedback).toBe(storedEvaluation.summaryFeedback);
    expect(h.evaluate).not.toHaveBeenCalled();
  });

  it('derives certified on a stored-scorecard retry from the certification register', async () => {
    h.certifications.length = 0;
    h.certifications.push({
      schemaVersion: 1, id: 'certification_learner', learnerId: user.uid, partnerCohortId: 'INTERNAL', trackId: track.id, curriculumVersion: 'v1',
      blueprintId: 'bp', sourceRevision: 'rev', status: 'certified', certifiedAt: '2026-01-01T00:00:00.000Z', expiresAt: null,
      recertificationRequiredAt: null, revokedAt: null, revokedByUid: null, revocationReason: null, evidenceAttemptIds: [], evidenceSessionIds: [],
      history: [], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    });
    const liveEvaluation = SimEvaluationSchema.parse({ ...storedEvaluation, provenance: createProvenance({ source: 'local_ai', provider: 'x', model: 'y' }) });
    h.loadOwned.mockResolvedValue(readySession({ status: 'EVALUATED', evaluation: liveEvaluation }));
    const certified = await (await evaluatePOST(request('/api/simulations/session-1/evaluate', { selectedDisposition: 'Recovered' }), params)).json();
    expect(certified.certified).toBe(true);
    h.certifications.length = 0;
    const notCertified = await (await evaluatePOST(request('/api/simulations/session-1/evaluate', { selectedDisposition: 'Recovered' }), params)).json();
    expect(notCertified.certified).toBe(false);
  });

  it('treats a judge TimeoutError as a manual-judge case (202), not a 500', async () => {
    const ready = readySession();
    h.loadOwned.mockResolvedValue(ready);
    txDoc = ready;
    h.evaluate.mockRejectedValue(new DOMException('The operation timed out.', 'TimeoutError'));
    const response = await evaluatePOST(request('/api/simulations/session-1/evaluate', { selectedDisposition: 'Recovered' }), params);
    expect(response.status).toBe(202);
    expect((await response.json()).judgeReview.reason).toBe('judge_timeout');
  });

  it('answers 409 (never 500) when the call changed while the judge failed', async () => {
    const ready = readySession();
    h.loadOwned.mockResolvedValue(ready);
    txDoc = { ...ready, updatedAt: ready.updatedAt + 1 };
    h.evaluate.mockRejectedValue(new DOMException('The operation timed out.', 'TimeoutError'));
    const response = await evaluatePOST(request('/api/simulations/session-1/evaluate', { selectedDisposition: 'Recovered' }), params);
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe('SIM_CONFLICT');
  });

  it('never answers "a Trainer will score it" when another request already scored the call', async () => {
    const ready = readySession();
    h.loadOwned.mockResolvedValue(ready);
    txDoc = { ...ready, status: 'EVALUATED' };
    h.collection.mockReturnValue({ doc: () => ({ get: async () => { throw new Error('reload failed'); } }) });
    h.evaluate.mockRejectedValue(new AIUnavailableError('down', 'unreachable'));
    const response = await evaluatePOST(request('/api/simulations/session-1/evaluate', { selectedDisposition: 'Recovered' }), params);
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe('ALREADY_EVALUATED');
  });

  it('passes an abort signal to the judge', async () => {
    h.loadOwned.mockResolvedValue(readySession());
    h.evaluate.mockResolvedValue(SimEvaluationSchema.parse({ ...storedEvaluation, provenance: createProvenance({ source: 'local_ai', provider: 'x', model: 'y' }) }));
    h.recordEvaluation.mockResolvedValue({ certified: false });
    const response = await evaluatePOST(request('/api/simulations/session-1/evaluate', { selectedDisposition: 'Recovered' }), params);
    expect(response.status).toBe(200);
    expect(h.evaluate.mock.calls[0]![0].signal).toBeInstanceOf(AbortSignal);
  });
});
