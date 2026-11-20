import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EvalRubricsDocSchema, TrackDocSchema, TrackVersionDocSchema, type PublicSimScenario, type SecretSimScenarioConfig } from '@/lib/schemas/curriculum';
import { XP_RULES } from '@/lib/schemas/constants';
import type { SessionUser } from '@/lib/schemas/domain';
import { CertificationDocSchema, ReviewScheduleDocSchema } from '@/lib/schemas/learning';
import { buildAssessmentBlueprint, evaluateScenarioCoverage } from '@/lib/services/certification';
import { ensureVerbalScenarioDefaults, ensureVerbalSecretDefaults } from '@/lib/services/verbal-defaults';
import { pillars, unit } from './helpers/fixtures';
import { drillAttempt, learningEnrollment, scenarioCoverage, scenarioEvidence, scenarioSession } from './helpers/learning-service-fixtures';

type DocData = Record<string, unknown>;

function applyDotPatch(target: DocData, patch: DocData): DocData {
  const next = structuredClone(target);
  for (const [key, value] of Object.entries(patch)) {
    const parts = key.split('.');
    let cursor: DocData = next;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const part = parts[i]!;
      const existing = cursor[part];
      if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
        cursor[part] = {};
      }
      cursor = cursor[part] as DocData;
    }
    cursor[parts[parts.length - 1]!] = value;
  }
  return next;
}

class InMemoryFirestore {
  readonly docs = new Map<string, DocData>();
  private autoId = 0;

  seed(path: string, data: DocData) {
    this.docs.set(path, structuredClone(data));
  }

  read(path: string): DocData | undefined {
    const v = this.docs.get(path);
    return v ? structuredClone(v) : undefined;
  }

  private makeRef(path: string) {
    const id = path.split('/').pop()!;
    const ref = {
      id,
      path,
      firestore: this,
      collection: (sub: string) => this.makeCollection(`${path}/${sub}`),
      get: async () => this.makeSnap(ref),
      set: async (data: DocData, opts?: { merge?: boolean }) => {
        const prev = this.read(path) ?? {};
        this.docs.set(path, opts?.merge ? { ...prev, ...structuredClone(data) } : structuredClone(data));
      },
      update: async (patch: DocData) => {
        const prev = this.read(path) ?? {};
        this.docs.set(path, applyDotPatch(prev, patch));
      },
    };
    return ref;
  }

  private makeSnap(ref: { id: string; path: string }) {
    const data = this.read(ref.path);
    return {
      id: ref.id,
      ref,
      exists: data !== undefined,
      data: () => data,
      get: (field: string) => (data ? data[field] : undefined),
    };
  }

  private makeQuery(collectionPath: string, filters: Array<{ field: string; op: string; value: unknown }>, maxLimit?: number) {
    const prefix = `${collectionPath}/`;
    const runGet = async () => {
      const matchingDocs: ReturnType<InMemoryFirestore['makeSnap']>[] = [];
      for (const [path] of this.docs.entries()) {
        if (!path.startsWith(prefix)) continue;
        const remainder = path.slice(prefix.length);
        if (remainder.includes('/')) continue; // direct children only
        const snap = this.makeSnap(this.makeRef(path));
        const row = snap.data() ?? {};
        const matches = filters.every((f) => {
          const val = row[f.field];
          if (f.op === '==') return val === f.value;
          if (f.op === '>=') return typeof val === 'number' && typeof f.value === 'number' && val >= f.value;
          if (f.op === 'in') return Array.isArray(f.value) && f.value.includes(val);
          return val === f.value;
        });
        if (matches) matchingDocs.push(snap);
      }
      const sliced = maxLimit !== undefined ? matchingDocs.slice(0, maxLimit) : matchingDocs;
      return { docs: sliced, empty: sliced.length === 0, size: sliced.length };
    };
    return {
      __isQuery: true as const,
      collectionPath,
      filters,
      where: (field: string, op: string, value: unknown) => this.makeQuery(collectionPath, [...filters, { field, op, value }], maxLimit),
      orderBy: () => this.makeQuery(collectionPath, filters, maxLimit),
      select: () => this.makeQuery(collectionPath, filters, maxLimit),
      limit: (n: number) => this.makeQuery(collectionPath, filters, n),
      count: () => ({ get: async () => ({ data: () => ({ count: filters.length >= 0 ? 0 : 0 }) }) }),
      get: runGet,
    };
  }

  private makeCollection(collectionPath: string) {
    return {
      doc: (id?: string) => this.makeRef(`${collectionPath}/${id ?? `auto_${++this.autoId}`}`),
      where: (field: string, op: string, value: unknown) => this.makeQuery(collectionPath, [{ field, op, value }]),
      get: () => this.makeQuery(collectionPath, []).get(),
    };
  }

  collection(collectionPath: string) {
    return this.makeCollection(collectionPath);
  }

  async runTransaction<T>(callback: (tx: unknown) => Promise<T>): Promise<T> {
    const pending: Array<() => void> = [];
    const tx = {
      getAll: async (...refs: Array<{ id: string; path: string }>) => refs.map((ref) => this.makeSnap(ref)),
      get: async (target: { __isQuery?: true; get?: () => Promise<unknown>; id?: string; path?: string }) => {
        if (target.__isQuery && target.get) return target.get();
        return this.makeSnap(target as { id: string; path: string });
      },
      set: (ref: { path: string }, data: DocData, opts?: { merge?: boolean }) => {
        pending.push(() => {
          const prev = this.read(ref.path) ?? {};
          const next = opts?.merge ? { ...prev, ...structuredClone(data) } : structuredClone(data);
          this.docs.set(ref.path, next);
        });
      },
      update: (ref: { path: string }, patch: DocData) => {
        pending.push(() => {
          const prev = this.read(ref.path) ?? {};
          this.docs.set(ref.path, applyDotPatch(prev, patch));
        });
      },
    };
    const result = await callback(tx);
    for (const apply of pending) apply();
    return result;
  }
}

const h = vi.hoisted(() => ({
  db: null as unknown as InMemoryFirestore,
  requireAuth: vi.fn(),
  getLLMGateway: vi.fn(),
  streamChat: vi.fn(),
  generateStructured: vi.fn(),
  availability: vi.fn(),
  noteUnavailable: vi.fn(),
}));

vi.mock('@/lib/firebase/auth-guard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/firebase/auth-guard')>()),
  requireAuth: h.requireAuth,
}));

vi.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (name: string) => h.db.collection(name),
    runTransaction: <T,>(cb: (tx: unknown) => Promise<T>) => h.db.runTransaction(cb),
  },
}));

vi.mock('@/lib/ai/gateway', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ai/gateway')>()),
  getLLMGateway: h.getLLMGateway,
}));

vi.mock('@/lib/ai/availability', () => ({
  getCachedAiAvailability: h.availability,
  noteAiUnavailable: h.noteUnavailable,
  recordAiSuccess: vi.fn(),
}));

import { POST as completeReviewPOST } from '@/app/api/progress/complete-review/route';
import { POST as startSimPOST } from '@/app/api/simulations/start/route';
import { POST as messageSimPOST } from '@/app/api/simulations/[sessionId]/message/route';
import { POST as evaluateSimPOST } from '@/app/api/simulations/[sessionId]/evaluate/route';

const NOW_MS = Date.parse('2026-11-17T12:00:00.000Z');

const learner: SessionUser = {
  uid: 'learner-1',
  email: 'learner@synthetic.internal',
  displayName: 'Jordan Lee',
  role: 'AGENT',
  partnerCohortId: 'THS',
  divisionIds: ['TELEHEALTH'],
  active: true,
};

function makeVerbalFixture() {
  const scenario: PublicSimScenario = ensureVerbalScenarioDefaults({
    id: 'sim-verbal-route',
    title: 'Verbal Refill & Escalation',
    difficulty: 'STANDARD',
    counterpartyRoleLabel: 'Existing Patient',
    contextTicketSummary: 'Verbal role-play · Patient asks about a refill and dizziness.',
    openingMessage: 'Hi, my NeuroCalmRx refill arrived and I felt dizzy today.',
    dispositionOptions: ['Callback scheduled', 'Recovered', "Didn't reply"],
    maxTurns: 8,
    passScoreThreshold: 75,
  }, { divisionId: 'TELEHEALTH', product: 'NeuroCalmRx', sourceRevision: 'rev-1', curriculumVersion: 'v1' });

  const secret: SecretSimScenarioConfig = ensureVerbalSecretDefaults(scenario, {
    scenarioId: scenario.id,
    personaName: 'Taylor Bennett',
    personaBackstoryAndMood: 'Concerned patient.',
    hiddenFactsToRevealOnlyWhenAsked: [],
    conditionalBehaviors: [],
    expectedDisposition: 'Callback scheduled',
    autoFailTriggers: [],
    rubricCriteria: [
      { id: 'c1', competencyPillarId: 'p1', criterionLabel: 'Verify 3 IDs', evaluationRule: 'Ask for name, DOB, ZIP.', weight: 34, sourcePages: [1] },
      { id: 'c2', competencyPillarId: 'p2', criterionLabel: 'Keep scope', evaluationRule: 'Refer dosing questions to Clinical Tier 2.', weight: 33, sourcePages: [1] },
      { id: 'c3', competencyPillarId: 'p3', criterionLabel: 'Screen red flags', evaluationRule: 'Check chest pain and fainting.', weight: 33, sourcePages: [2] },
    ],
  }, true);

  const track = TrackDocSchema.parse({
    id: 'track-1',
    title: 'NeuroCalmRx Verbal Track',
    campaignCode: 'NC-1',
    divisionId: 'TELEHEALTH',
    status: 'PUBLISHED',
    generationProgress: { step: 'READY', percent: 100, message: 'Ready' },
    sourcePdfStoragePath: 'playbooks/track-1/p.pdf',
    sourcePdfFileName: 'p.pdf',
    sourcePageCount: 2,
    currentDraftVersionId: 'draft',
    publishedVersionId: 'v1',
    assignedCohortIds: ['ALL'],
    competencyPillars: pillars,
    unitCount: 2,
    simScenarioCount: 1,
    estimatedTotalMinutes: 20,
    createdByUid: 'trainer-1',
    createdAt: NOW_MS - 10_000,
    updatedAt: NOW_MS - 5_000,
  });

  const u1 = unit('u1', 0);
  u1.drills[0] = { ...u1.drills[0]!, ruleIds: ['rule-privacy'] };
  const u2 = unit('u2', 1);
  u2.drills[0] = { ...u2.drills[0]!, ruleIds: ['rule-optout'] };

  const version = TrackVersionDocSchema.parse({
    versionId: 'v1',
    trackId: 'track-1',
    versionNumber: 1,
    competencyPillars: pillars,
    units: [u1, u2],
    simScenarios: [scenario],
    sourceRevision: 'rev-1',
    requiredRuleIds: ['rule-privacy', 'rule-optout'],
    publishedAt: NOW_MS - 5_000,
    createdAt: NOW_MS - 10_000,
  });

  const rubrics = EvalRubricsDocSchema.parse({
    trackId: 'track-1',
    versionId: 'v1',
    scenarios: [secret],
    updatedAt: NOW_MS - 5_000,
  });

  return { track, version, rubrics, scenario, secret };
}

describe('verbal simulation and retention route flows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.db = new InMemoryFirestore();
    h.requireAuth.mockResolvedValue({ ok: true, user: learner });
    h.availability.mockResolvedValue({ ok: true });
    h.getLLMGateway.mockReturnValue({
      providerName: 'openai_compatible',
      heavyModel: 'mlx-community/Qwen2.5-7B-Instruct-4bit',
      fastModel: 'mlx-community/Qwen2.5-7B-Instruct-4bit',
      streamChat: h.streamChat,
      generateStructured: h.generateStructured,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('awards XP once, stays idempotent, and unlocks certification on POST /api/progress/complete-review', async () => {
    const { track, version } = makeVerbalFixture();
    const blueprint = buildAssessmentBlueprint(version, {
      id: 'assessment_track-1_v1',
      retentionRequired: true,
      createdAt: new Date(NOW_MS - 5_000),
    });

    h.db.seed('users/learner-1', {
      uid: 'learner-1',
      email: learner.email,
      displayName: learner.displayName,
      role: 'AGENT',
      partnerCohortId: 'THS',
      divisionIds: ['TELEHEALTH'],
      active: true,
      stats: {
        totalXp: 100,
        currentStreakDays: 1,
        lastActiveDateUtc: '2026-11-16',
        tracksCertifiedCount: 0,
        simulationsPassedCount: 1,
        overallReadinessScore: 80,
      },
      skillScoresByPillar: {},
      updatedAt: NOW_MS - 1_000,
    });
    h.db.seed('tracks/track-1', track);
    h.db.seed('tracks/track-1/versions/v1', version);
    h.db.seed('assessmentBlueprints/assessment_track-1_v1', blueprint);
    h.db.seed('enrollments/learner-1_track-1', {
      ...learningEnrollment({
        id: 'learner-1_track-1',
        userId: 'learner-1',
        partnerCohortId: 'THS',
        divisionId: 'TELEHEALTH',
        trackId: 'track-1',
        trackTitle: track.title,
        completedUnitIds: ['u1', 'u2'],
        passedScenarioIds: ['sim-verbal-route'],
        bestSimScorePct: 95,
        status: 'IN_PROGRESS',
        progressPct: 100,
        certifiedAt: null,
      }),
    });

    // Seed varied retrieval mastery + spaced retention attempts + passing scenario coverage/session
    h.db.seed('drillAttempts/att-m1', drillAttempt({ id: 'att-m1', unitId: 'u1', drillId: 'u1-d1', attemptKind: 'varied_retrieval', firstIndependent: false, correct: true, submittedAt: new Date(NOW_MS - 1_000).toISOString() }));
    h.db.seed('drillAttempts/att-m2', drillAttempt({ id: 'att-m2', unitId: 'u2', drillId: 'u2-d1', attemptKind: 'varied_retrieval', firstIndependent: false, correct: true, submittedAt: new Date(NOW_MS - 1_000).toISOString() }));
    h.db.seed('drillAttempts/att-r1', drillAttempt({ id: 'att-r1', unitId: 'u1', drillId: 'u1-d1', attemptKind: 'spaced_review', firstIndependent: false, correct: true, submittedAt: new Date(NOW_MS).toISOString() }));
    h.db.seed('drillAttempts/att-r2', drillAttempt({ id: 'att-r2', unitId: 'u2', drillId: 'u2-d1', attemptKind: 'spaced_review', firstIndependent: false, correct: true, submittedAt: new Date(NOW_MS).toISOString() }));

    const sessionId = 'sim-sess-pass';
    const scenario = version.simScenarios[0]!;
    const baseSession = scenarioSession({
      id: sessionId,
      userId: 'learner-1',
      partnerCohortId: 'THS',
      divisionId: 'TELEHEALTH',
      trackId: 'track-1',
      versionId: 'v1',
      scenarioId: scenario.id,
      scenarioTitle: scenario.title,
      turnCount: 2,
      selectedDisposition: 'Callback scheduled',
    });
    const simSession = {
      ...baseSession,
      evaluation: {
        ...baseSession.evaluation!,
        overallScorePct: 95,
        passed: true,
        dispositionValidation: { disposition: 'Callback scheduled' as const, valid: true, reasons: [] },
      },
      scenarioState: {
        ...baseSession.scenarioState!,
        workflowActionIds: [],
        selectedDisposition: 'Callback scheduled' as const,
      },
      simulationEvents: [
        baseSession.simulationEvents![0]!,
        {
          ...baseSession.simulationEvents![0]!,
          id: `${sessionId}-event-2`,
          sequence: 2,
        },
      ],
    };
    h.db.seed(`simSessions/${sessionId}`, simSession);
    h.db.seed(
      'scenarioCoverage/learner-1_track-1_v1_sim-verbal-route',
      scenarioCoverage({
        id: 'learner-1_track-1_v1_sim-verbal-route',
        learnerId: 'learner-1',
        partnerCohortId: 'THS',
        trackId: 'track-1',
        curriculumVersion: 'v1',
        scenarioId: 'sim-verbal-route',
        requiredGateIds: [],
        status: 'passed',
        passingSessionIds: [sessionId],
        lastSessionId: sessionId,
        attemptHistory: [
          scenarioEvidence({
            sessionId,
            passed: true,
            evaluatedAt: new Date(NOW_MS - 1_500).toISOString(),
            criticalFailureRuleIds: [],
            workflowComplete: true,
            dispositionValid: true,
            provenance: 'local_ai',
          }),
        ],
        updatedAt: new Date(NOW_MS - 1_500).toISOString(),
      }),
    );
    h.db.seed('reviewSchedules/s1', ReviewScheduleDocSchema.parse({
      schemaVersion: 1,
      id: 's1',
      learnerId: 'learner-1',
      trackId: 'track-1',
      unitId: 'u1',
      drillId: 'u1-d1',
      curriculumVersion: 'v1',
      ruleIds: ['rule-privacy'],
      nextAttemptKind: 'spaced_review',
      dueAt: new Date(NOW_MS + 86_400_000).toISOString(),
      intervalIndex: 1,
      independent: true,
      lastAttemptId: 'att-r1',
      lastAttemptKind: 'spaced_review',
      lastResult: 'correct',
      createdAt: new Date(NOW_MS - 86_400_000).toISOString(),
      updatedAt: new Date(NOW_MS).toISOString(),
    }));

    const payload = { trackIds: ['track-1'], reviewedCount: 2, idempotencyKey: 'review-batch-0001' };
    const res1 = await completeReviewPOST(new Request('http://localhost/api/progress/complete-review', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }));
    expect(res1.status).toBe(200);
    const json1 = await res1.json();
    expect(json1.xpAwarded).toBe(2 * XP_RULES.perRecoveredDrill);
    expect(json1.newlyCertifiedTrackIds).toEqual(['track-1']);

    const updatedUser = h.db.read('users/learner-1');
    expect((updatedUser?.stats as DocData).totalXp).toBe(100 + 2 * XP_RULES.perRecoveredDrill);
    expect((updatedUser?.stats as DocData).tracksCertifiedCount).toBe(1);

    const enrollment = h.db.read('enrollments/learner-1_track-1');
    expect(enrollment?.status).toBe('CERTIFIED');

    const certEntry = [...h.db.docs.entries()].find(([path]) => path.startsWith('certifications/'));
    expect(certEntry).toBeDefined();
    const certDoc = CertificationDocSchema.parse(certEntry![1]);
    expect(certDoc.status).toBe('certified');

    // Replaying the exact idempotencyKey grants 0 extra XP and returns the cached result.
    const res2 = await completeReviewPOST(new Request('http://localhost/api/progress/complete-review', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }));
    expect(res2.status).toBe(200);
    expect(await res2.json()).toEqual(json1);
    expect(((h.db.read('users/learner-1')?.stats) as DocData).totalXp).toBe(100 + 2 * XP_RULES.perRecoveredDrill);
    expect(evaluateScenarioCoverage).toBeDefined();
  });

  it('starts in_call immediately, streams message, and grades {} directly in verbal_only mode', async () => {
    const { track, version, rubrics } = makeVerbalFixture();
    h.db.seed('tracks/track-1', track);
    h.db.seed('tracks/track-1/versions/v1', version);
    h.db.seed('tracks/track-1/versions/v1/secrets/evalRubrics', rubrics);
    h.db.seed('enrollments/learner-1_track-1', {
      ...learningEnrollment({
        id: 'learner-1_track-1',
        userId: 'learner-1',
        partnerCohortId: 'THS',
        divisionId: 'TELEHEALTH',
        trackId: 'track-1',
        trackTitle: track.title,
        completedUnitIds: ['u1', 'u2'],
        passedScenarioIds: [],
        bestSimScorePct: null,
        status: 'IN_PROGRESS',
        progressPct: 80,
        certifiedAt: null,
      }),
    });
    h.db.seed('users/learner-1', {
      uid: 'learner-1',
      email: learner.email,
      displayName: learner.displayName,
      role: 'AGENT',
      partnerCohortId: 'THS',
      divisionIds: ['TELEHEALTH'],
      active: true,
      stats: { totalXp: 50, currentStreakDays: 1, lastActiveDateUtc: null, tracksCertifiedCount: 0, simulationsPassedCount: 0, overallReadinessScore: 0 },
      skillScoresByPillar: {},
      updatedAt: NOW_MS,
    });
    h.db.seed('assessmentBlueprints/assessment_track-1_v1', buildAssessmentBlueprint(version, {
      id: 'assessment_track-1_v1',
      createdAt: new Date(NOW_MS - 5_000),
    }));

    const startRes = await startSimPOST(new Request('http://localhost/api/simulations/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ trackId: 'track-1', versionId: 'v1', scenarioId: 'sim-verbal-route' }),
    }));
    expect(startRes.status).toBe(201);
    const startJson = await startRes.json();
    const sessionId = startJson.session.id as string;
    const seededSession = h.db.read(`simSessions/${sessionId}`);
    expect((seededSession?.scenarioState as DocData).lifecycle).toBe('in_call');

    h.streamChat.mockImplementation(async function* () {
      yield 'My name is Taylor Bennett, born July 12 1984, ZIP 60611.';
    });

    const msgRes = await messageSimPOST(
      new Request(`http://localhost/api/simulations/${sessionId}/message`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          content: 'Could you please confirm your full name, date of birth, and ZIP code?',
          idempotencyKey: 'msg-turn-0001',
        }),
      }),
      { params: Promise.resolve({ sessionId }) },
    );
    expect(msgRes.status).toBe(200);
    const streamText = await msgRes.text();
    expect(streamText).toContain('event: done');
    expect(streamText).toContain('Taylor Bennett');

    const storedAfterTurn = h.db.read(`simSessions/${sessionId}`);
    expect(storedAfterTurn?.turnCount).toBe(1);

    const msgRes2 = await messageSimPOST(
      new Request(`http://localhost/api/simulations/${sessionId}/message`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          content: 'Thank you. Let me warm transfer you to Clinical Support Tier 2 for your dizziness question.',
          idempotencyKey: 'msg-turn-0002',
        }),
      }),
      { params: Promise.resolve({ sessionId }) },
    );
    expect(msgRes2.status).toBe(200);
    expect(await msgRes2.text()).toContain('event: done');
    expect(h.db.read(`simSessions/${sessionId}`)?.turnCount).toBe(2);

    h.generateStructured.mockResolvedValue({
      criterionResults: [
        { criterionId: 'c1', score: 100, agentQuoteEvidence: 'Could you please confirm your full name, date of birth, and ZIP code?', evidenceEventIds: [], coachingNote: 'Verified ID.', betterResponseExample: null },
        { criterionId: 'c2', score: 100, agentQuoteEvidence: '', evidenceEventIds: [], coachingNote: 'Maintained scope.', betterResponseExample: null },
        { criterionId: 'c3', score: 100, agentQuoteEvidence: '', evidenceEventIds: [], coachingNote: 'Addressed red flags.', betterResponseExample: null },
      ],
      autoFailTriggered: false,
      autoFailedReason: null,
      summaryFeedback: 'Strong verbal handling.',
      strengthsHighlighted: ['Verified full name, DOB, and ZIP first'],
      coachingImprovements: [],
    });

    const evalRes = await evaluateSimPOST(
      new Request(`http://localhost/api/simulations/${sessionId}/evaluate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ sessionId }) },
    );
    expect(evalRes.status).toBe(200);
    const evalJson = await evalRes.json();
    expect(evalJson.evaluation.overallScorePct).toBe(100);
    expect(evalJson.evaluation.passed).toBe(true);
    expect(h.db.read(`simSessions/${sessionId}`)?.status).toBe('EVALUATED');
  });
});
