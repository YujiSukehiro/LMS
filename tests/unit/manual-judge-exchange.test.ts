import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ManualExchangePackage } from '@/lib/ai/manual-exchange';
import type { JudgeOutput } from '@/lib/ai/prompts/sim-judge';
import { SimSessionDocSchema, type SimSessionDoc } from '@/lib/schemas/analytics';
import { INTERNAL_OPS_ROLES } from '@/lib/schemas/constants';
import {
  TrackDocSchema,
  TrackVersionDocSchema,
  type PublicSimScenario,
  type SecretSimScenarioConfig,
} from '@/lib/schemas/curriculum';
import type { SessionUser, UserRole } from '@/lib/schemas/domain';
import type { SimulationEvent } from '@/lib/schemas/simulation-state';
import { createInitialScenarioState } from '@/lib/services/scenario-state';

const { mockRequireAuth, mockSaveEvaluation, mockRecordEvaluation } = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockSaveEvaluation: vi.fn(),
  mockRecordEvaluation: vi.fn(),
}));

vi.mock('@/lib/firebase/auth-guard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/firebase/auth-guard')>();
  return { ...actual, requireAuth: mockRequireAuth };
});

vi.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: (path: string) => collection(path) },
}));

vi.mock('@/lib/services/analytics-rollup', () => ({
  saveSimulationEvaluation: mockSaveEvaluation,
  recordSimulationEvaluation: mockRecordEvaluation,
}));

import { POST as exportPOST } from '@/app/api/simulations/[sessionId]/manual-judge/export/route';
import { POST as importPOST } from '@/app/api/simulations/[sessionId]/manual-judge/import/route';

interface FakeDocumentReference {
  path: string;
  collection(path: string): FakeCollectionReference;
  get(): Promise<{ exists: boolean; id: string; data(): unknown }>;
  set(value: unknown): Promise<void>;
}

interface FakeCollectionReference {
  path: string;
  doc(id: string): FakeDocumentReference;
  get(): Promise<{ docs: Array<{ data(): unknown }> }>;
}

const store = new Map<string, unknown>();
const writeLog: Array<{ path: string; data: unknown }> = [];
const readLog: string[] = [];

function clone<T>(value: T): T {
  return structuredClone(value);
}

function document(path: string): FakeDocumentReference {
  return {
    path,
    collection: (child) => collection(`${path}/${child}`),
    get: async () => {
      readLog.push(path);
      const exists = store.has(path);
      return { exists, id: path.split('/').at(-1)!, data: () => (exists ? clone(store.get(path)) : undefined) };
    },
    set: async (value) => {
      store.set(path, clone(value));
      writeLog.push({ path, data: clone(value) });
    },
  };
}

function collection(path: string): FakeCollectionReference {
  return {
    path,
    doc: (id) => document(`${path}/${id}`),
    get: async () => {
      readLog.push(path);
      return {
        docs: [...store.entries()]
          .filter(([candidate]) => candidate.startsWith(`${path}/`) && !candidate.slice(path.length + 1).includes('/'))
          .map(([, value]) => ({ data: () => clone(value) })),
      };
    },
  };
}

const pillars = [
  {
    id: 'pillar-synthetic',
    key: 'communication',
    label: 'Synthetic communication',
    description: 'Communicate clearly in a synthetic call.',
  },
];

const scenario: PublicSimScenario = {
  id: 'scenario-synthetic',
  title: 'Synthetic manual judge call',
  difficulty: 'STANDARD',
  counterpartyRoleLabel: 'Synthetic caller',
  contextTicketSummary: 'Synthetic training queue; no real customer data.',
  openingMessage: 'This is a synthetic training call.',
  dispositionOptions: ['Recovered', 'Callback scheduled', "Didn't reply"],
  maxTurns: 8,
  passScoreThreshold: 80,
  context: {
    direction: 'inbound',
    queue: 'customer_support',
    product: 'Synthetic Product',
    stage: 'support_case',
    contactState: 'existing_patient',
    pricingPosture: 'not_applicable',
    caseBranch: 'synthetic_support',
    syntheticTimezone: 'America/Boise',
    syntheticNow: '2026-01-15T17:00:00.000Z',
    sourceRevision: 'synthetic-source',
    curriculumVersion: 'synthetic-v1',
  },
  evidenceRequirements: {
    minimumLearnerTurns: 1,
    requiredInspections: [],
    requiredWorkflowActions: ['recovery_confirmed'],
    requiredWrapUpEvidence: [],
    requiredGateIds: [],
    requiredCustomerConcerns: [],
    expectedDurationMinutes: 5,
    gateSourceRefs: {},
    maximumCriticalFailures: 0,
    maximumMajorFailures: 0,
  },
};

function approvedEvidence(ruleId: string): NonNullable<SecretSimScenarioConfig['rubricCriteria'][number]['evidence']> {
  return [
    {
      id: `evidence-${ruleId}`,
      claim: `Approved synthetic evidence for ${ruleId}.`,
      ruleIds: [ruleId],
      excerpts: [
        {
          documentId: 'synthetic-playbook',
          revisionId: 'synthetic-r1',
          pageNumber: 1,
          exactText: 'Approved synthetic judge rubric source excerpt.',
          fromApprovedTranscription: true,
        },
      ],
      support: 'supported',
      approvalStatus: 'approved',
      critical: true,
      requiresInterfaceDetails: false,
      reviewerUid: 'trainer-synthetic',
      reviewedAt: 1,
    },
  ];
}

const secret: SecretSimScenarioConfig = {
  scenarioId: scenario.id,
  personaName: 'Synthetic Caller',
  personaBackstoryAndMood: 'A fictional caller in a synthetic training fixture.',
  hiddenFactsToRevealOnlyWhenAsked: ['The synthetic order ID is SYN-1001.'],
  conditionalBehaviors: [],
  expectedDisposition: 'Recovered',
  autoFailTriggers: [],
  rubricCriteria: [
    {
      id: 'rule-greeting',
      competencyPillarId: 'pillar-synthetic',
      criterionLabel: 'Synthetic greeting',
      evaluationRule: 'Use a clear synthetic greeting.',
      weight: 50,
      sourcePages: [1],
      evidence: approvedEvidence('rule-greeting'),
    },
    {
      id: 'rule-help',
      competencyPillarId: 'pillar-synthetic',
      criterionLabel: 'Synthetic help',
      evaluationRule: 'Offer help with the synthetic request.',
      weight: 30,
      sourcePages: [1],
      evidence: approvedEvidence('rule-help'),
    },
    {
      id: 'rule-close',
      competencyPillarId: 'pillar-synthetic',
      criterionLabel: 'Synthetic close',
      evaluationRule: 'Close the synthetic call clearly.',
      weight: 20,
      sourcePages: [1],
      evidence: approvedEvidence('rule-close'),
    },
  ],
};

const track = TrackDocSchema.parse({
  id: 'track-synthetic',
  title: 'Synthetic Track',
  campaignCode: 'SYNTH',
  divisionId: 'INBOUND',
  status: 'PUBLISHED',
  generationProgress: { step: 'READY', percent: 100, message: 'Synthetic fixture ready.' },
  sourcePdfStoragePath: 'synthetic/fixture.pdf',
  sourcePdfFileName: 'fixture.pdf',
  sourcePageCount: 2,
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
  sourceBundleId: 'bundle-synthetic',
  sourceRevision: `sha256:${'a'.repeat(64)}`,
  publishedAt: 1,
  createdAt: 1,
});

function event(patch: Partial<SimulationEvent> & Pick<SimulationEvent, 'id' | 'sequence' | 'type'>): SimulationEvent {
  return {
    sessionId: 'session-synthetic',
    actor: 'learner',
    payload: { synthetic: true },
    stateHash: `sha256:${'0'.repeat(64)}`,
    occurredAt: '2026-01-15T17:01:00.000Z',
    provenance: 'learner',
    ...patch,
  };
}

function syntheticSession(): SimSessionDoc {
  const scenarioState = {
    ...createInitialScenarioState(scenario),
    lifecycle: 'wrap_up' as const,
    contactReached: 'patient' as const,
    identityVerified: true,
    recording: 'active' as const,
    workflowActionIds: ['recovery_confirmed'],
    selectedDisposition: 'Recovered' as const,
    dispositionCorrect: true,
    wrapUpComplete: true,
  };
  const agentText = 'Hello synthetic caller. I can help with the synthetic request. Thank you for calling synthetic support.';
  return SimSessionDocSchema.parse({
    id: 'session-synthetic',
    userId: 'learner-synthetic',
    userDisplayName: 'Synthetic Learner',
    partnerCohortId: 'INTERNAL',
    divisionId: 'INBOUND',
    trackId: track.id,
    versionId: 'v1',
    scenarioId: scenario.id,
    scenarioTitle: scenario.title,
    status: 'READY_FOR_EVAL',
    turnCount: 2,
    messages: [
      { id: 'message-caller', role: 'counterparty', content: scenario.openingMessage, createdAt: 1 },
      { id: 'message-agent', role: 'agent', content: agentText, createdAt: 2 },
    ],
    selectedDisposition: 'Recovered',
    evaluation: null,
    scenarioState,
    simulationEvents: [
      event({ id: 'event-agent', sequence: 1, type: 'utterance', payload: { content: agentText, synthetic: true } }),
      event({ id: 'event-workflow', sequence: 2, type: 'workflow', payload: { actionId: 'recovery_confirmed', synthetic: true } }),
      event({ id: 'event-disposition', sequence: 3, type: 'disposition', payload: { disposition: 'Recovered', valid: true, synthetic: true } }),
      event({
        id: 'event-redaction',
        sequence: 4,
        type: 'note',
        payload: { text: 'Synthetic redaction fixture 4111 1111 1111 1111.', receiptId: 'fake-note-4', synthetic: true },
      }),
    ],
    nextEventSequence: 5,
    startedAt: 1,
    updatedAt: 10,
  });
}

function seed(): void {
  store.set(`simSessions/${syntheticSession().id}`, syntheticSession());
  store.set(`tracks/${track.id}`, clone(track));
  store.set(`tracks/${track.id}/versions/v1`, clone(version));
  store.set(`tracks/${track.id}/versions/v1/secrets/evalRubrics`, {
    trackId: track.id,
    versionId: 'v1',
    scenarios: [secret],
    updatedAt: 1,
  });
  // Legacy raw pages intentionally remain available: manual export must not use them as an approval shortcut.
  store.set(`tracks/${track.id}/sourcePages/batch-001`, {
    id: 'batch-001',
    trackId: track.id,
    startPage: 1,
    endPage: 2,
    pages: [
      { pageNumber: 1, text: 'Approved synthetic judge rubric source excerpt.' },
      { pageNumber: 2, text: 'Unrelated synthetic source page must not be exported.' },
    ],
    createdAt: 1,
  });
  store.set(`tracks/${track.id}/sourceBundles/bundle-synthetic`, {
    schemaVersion: 1,
    id: 'bundle-synthetic',
    trackId: track.id,
    documents: [{
      id: 'synthetic-playbook',
      revisionId: 'synthetic-r1',
      bundleId: 'bundle-synthetic',
      trackId: track.id,
      role: 'support',
      fileName: 'synthetic-playbook.pdf',
      storagePath: 'synthetic/playbook.pdf',
      sourceVersion: 'synthetic-r1',
      effectiveDate: null,
      uploadedAt: 1,
      uploadedByUid: 'trainer-synthetic',
      contentHash: `sha256:${'b'.repeat(64)}`,
      pageCount: 2,
      inheritanceOrder: 0,
      excluded: false,
      exclusionReason: null,
    }],
    sharedRulePackIds: [],
    precedencePolicyId: 'standard-meds-precedence-v1',
    conflictIds: [],
    status: 'published',
    revisionHash: `sha256:${'a'.repeat(64)}`,
    approvedSourceRevision: `sha256:${'a'.repeat(64)}`,
    approvedByUid: 'trainer-synthetic',
    approvedAt: 1,
    createdAt: 1,
    updatedAt: 1,
  });
  store.set(`tracks/${track.id}/sourceBundles/bundle-synthetic/pageEvidence/synthetic-playbook-page-1`, {
    id: 'synthetic-playbook-page-1',
    documentId: 'synthetic-playbook',
    revisionId: 'synthetic-r1',
    pageNumber: 1,
    rawText: 'Approved synthetic judge rubric source excerpt.',
    normalizedText: 'Approved synthetic judge rubric source excerpt.',
    contentHash: `sha256:${'c'.repeat(64)}`,
    characterCount: 45,
    extractionFlags: [],
    transcription: {
      text: 'Approved synthetic judge rubric source excerpt.',
      approvedByUid: 'trainer-synthetic',
      approvedAt: 1,
    },
    approvedExcerpts: [],
  });
}

function user(role: UserRole = 'TRAINER'): SessionUser {
  return {
    uid: 'trainer-synthetic',
    email: 'trainer@synthetic.internal',
    displayName: 'Synthetic Trainer',
    role,
    partnerCohortId: 'INTERNAL',
    divisionIds: ['INBOUND'],
    active: true,
  };
}

function request(sessionId: string, body?: unknown): Request {
  return new Request(`http://localhost/api/simulations/${sessionId}/manual-judge`, {
    method: 'POST',
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
}

function params(sessionId = 'session-synthetic'): Promise<{ sessionId: string }> {
  return Promise.resolve({ sessionId });
}

function validJudgeOutput(): JudgeOutput {
  return {
    criterionResults: secret.rubricCriteria.map((criterion) => ({
      criterionId: criterion.id,
      score: 100,
      agentQuoteEvidence: 'Hello synthetic caller.',
      evidenceEventIds: ['event-agent'],
      coachingNote: 'You met this synthetic rubric rule with clear evidence.',
      betterResponseExample: null,
    })),
    autoFailTriggered: false,
    autoFailedReason: null,
    summaryFeedback: 'You completed the synthetic call clearly. Your evidence supported every rubric rule.',
    strengthsHighlighted: ['Clear synthetic greeting'],
    coachingImprovements: ['Keep using clear synthetic evidence'],
  };
}

function envelope(manualPackage: ManualExchangePackage, output: unknown = validJudgeOutput()): string {
  return JSON.stringify({
    format: 'logicall.manual-chat',
    formatVersion: 1,
    packageChecksum: manualPackage.checksum,
    taskId: manualPackage.taskId,
    taskType: 'judge',
    outputSchemaVersion: manualPackage.outputSchemaVersion,
    output,
  });
}

async function exportPackage(): Promise<ManualExchangePackage> {
  const response = await exportPOST(request('session-synthetic'), { params: params() });
  expect(response.status).toBe(200);
  return ((await response.json()) as { package: ManualExchangePackage }).package;
}

function importBody(manualPackage: ManualExchangePackage, input = envelope(manualPackage)): Record<string, unknown> {
  return {
    taskId: manualPackage.taskId,
    input,
    externalProvider: 'external-chat-synthetic',
    externalModel: 'trainer-labelled-model',
  };
}

beforeEach(() => {
  store.clear();
  writeLog.length = 0;
  readLog.length = 0;
  vi.clearAllMocks();
  seed();
  mockRequireAuth.mockResolvedValue({ ok: true, user: user() });
  mockSaveEvaluation.mockResolvedValue(undefined);
  mockRecordEvaluation.mockResolvedValue({ certified: false });
});

describe('manual judge authorization', () => {
  it.each(['AGENT', 'PARTNER_SUPERVISOR'] as const)('blocks learner-side %s export/import before data access', async (role) => {
    mockRequireAuth.mockResolvedValue({ ok: true, user: user(role) });
    const taskId = 'simulation-judge:session-synthetic';

    const exportResponse = await exportPOST(request('session-synthetic'), { params: params() });
    const importResponse = await importPOST(
      request('session-synthetic', { taskId, input: '{}', externalProvider: 'external', externalModel: 'synthetic-model' }),
      { params: params() },
    );

    expect(exportResponse.status).toBe(403);
    expect(importResponse.status).toBe(403);
    expect(mockRequireAuth).toHaveBeenNthCalledWith(1, expect.any(Request), INTERNAL_OPS_ROLES);
    expect(mockRequireAuth).toHaveBeenNthCalledWith(2, expect.any(Request), INTERNAL_OPS_ROLES);
    expect(readLog).toHaveLength(0);
    expect(writeLog).toHaveLength(0);
    expect(mockSaveEvaluation).not.toHaveBeenCalled();
    expect(mockRecordEvaluation).not.toHaveBeenCalled();
  });
});

describe('manual judge source evidence approval', () => {
  const rubricsPath = 'tracks/track-synthetic/versions/v1/secrets/evalRubrics';

  function editFirstCriterion(edit: (criterion: SecretSimScenarioConfig['rubricCriteria'][number]) => void): void {
    const rubrics = clone(store.get(rubricsPath)) as { scenarios: SecretSimScenarioConfig[] };
    edit(rubrics.scenarios[0].rubricCriteria[0]);
    store.set(rubricsPath, rubrics);
  }

  it('rejects raw cited but unapproved evidence without writing a task', async () => {
    editFirstCriterion((criterion) => {
      criterion.evidence = criterion.evidence!.map((evidence) => ({ ...evidence, approvalStatus: 'draft' }));
    });

    const response = await exportPOST(request('session-synthetic'), { params: params() });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toBe('SOURCE_EVIDENCE_NOT_APPROVED');
    expect(body.message).toContain('Raw page citations are not approval');
    expect(store.has('simSessions/session-synthetic/manualJudgeTasks/current')).toBe(false);
    expect(writeLog).toHaveLength(0);
  });

  it('rejects approved exactText that does not match the persisted source page', async () => {
    editFirstCriterion((criterion) => {
      criterion.evidence![0].excerpts[0].exactText = 'Approved synthetic text absent from the persisted page.';
    });

    const response = await exportPOST(request('session-synthetic'), { params: params() });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toBe('SOURCE_EVIDENCE_MISMATCH');
    expect(store.has('simSessions/session-synthetic/manualJudgeTasks/current')).toBe(false);
    expect(writeLog).toHaveLength(0);
  });

  it('rejects approved evidence without reviewer identity and review time', async () => {
    editFirstCriterion((criterion) => {
      criterion.evidence![0].reviewerUid = null;
      criterion.evidence![0].reviewedAt = null;
    });

    const response = await exportPOST(request('session-synthetic'), { params: params() });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toBe('SOURCE_EVIDENCE_NOT_APPROVED');
    expect(store.has('simSessions/session-synthetic/manualJudgeTasks/current')).toBe(false);
    expect(writeLog).toHaveLength(0);
  });

  it.each(['documentId', 'revisionId'] as const)('rejects a wrong %s even when raw page text is identical', async (field) => {
    editFirstCriterion((criterion) => {
      criterion.evidence![0].excerpts[0][field] = 'different-synthetic-source';
    });

    const response = await exportPOST(request('session-synthetic'), { params: params() });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toBe('SOURCE_EVIDENCE_MISMATCH');
    expect(store.has('simSessions/session-synthetic/manualJudgeTasks/current')).toBe(false);
    expect(writeLog).toHaveLength(0);
  });

  it('rejects evidence from an approved transcription when that transcription is missing', async () => {
    const pagePath = 'tracks/track-synthetic/sourceBundles/bundle-synthetic/pageEvidence/synthetic-playbook-page-1';
    const page = clone(store.get(pagePath)) as { transcription: unknown };
    page.transcription = null;
    store.set(pagePath, page);

    const response = await exportPOST(request('session-synthetic'), { params: params() });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toBe('SOURCE_EVIDENCE_MISMATCH');
    expect(store.has('simSessions/session-synthetic/manualJudgeTasks/current')).toBe(false);
    expect(writeLog).toHaveLength(0);
  });

  it('rejects evidence affected by an open persisted source conflict', async () => {
    const excerpt = secret.rubricCriteria[0].evidence![0].excerpts[0];
    store.set('tracks/track-synthetic/sourceBundles/bundle-synthetic/conflicts/conflict-synthetic', {
      id: 'conflict-synthetic',
      trackId: track.id,
      sourceRefs: [excerpt, { ...excerpt, documentId: 'other-synthetic-playbook' }],
      affectedProducts: ['Synthetic Product'],
      affectedContexts: ['support_case'],
      affectedStages: ['support'],
      affectedAssetIds: [],
      affectedRuleIds: ['rule-greeting'],
      detectedValues: ['Synthetic value A', 'Synthetic value B'],
      severity: 'major',
      status: 'open',
      decision: null,
      decisionOwnerUid: null,
      decidedAt: null,
      effectiveFrom: null,
      effectiveTo: null,
      downstreamInvalidationStatus: 'required',
    });

    const response = await exportPOST(request('session-synthetic'), { params: params() });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toBe('SOURCE_EVIDENCE_MISMATCH');
    expect(store.has('simSessions/session-synthetic/manualJudgeTasks/current')).toBe(false);
    expect(writeLog).toHaveLength(0);
  });

  it('fails closed with 409 when the exact source bundle is missing', async () => {
    store.delete('tracks/track-synthetic/sourceBundles/bundle-synthetic');

    const response = await exportPOST(request('session-synthetic'), { params: params() });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toBe('SOURCE_EVIDENCE_MISSING');
    expect(store.has('simSessions/session-synthetic/manualJudgeTasks/current')).toBe(false);
    expect(writeLog).toHaveLength(0);
  });
});

describe('manual judge export and valid import', () => {
  it('persists a safe admin-exported package and records a validated evaluation with manual_chat provenance', async () => {
    mockRequireAuth.mockResolvedValue({ ok: true, user: user('ADMIN') });
    const manualPackage = await exportPackage();

    expect(manualPackage).toMatchObject({
      taskId: 'simulation-judge:session-synthetic',
      taskType: 'judge',
      outputSchemaName: 'SimJudgeOutput',
      outputSchemaVersion: '1',
      external: { provider: '', model: '' },
    });
    expect(manualPackage.outputJsonSchema.properties).toHaveProperty('criterionResults');
    expect(manualPackage.approvedSourceExcerpts).toHaveLength(1);
    expect(manualPackage.approvedSourceExcerpts[0]).toMatchObject({
      sourceId: 'synthetic-playbook',
      revision: 'synthetic-r1',
      page: 1,
      text: 'Approved synthetic judge rubric source excerpt.',
      approved: true,
    });
    expect(manualPackage.scenarioState).toMatchObject({ sessionId: 'session-synthetic', sessionUpdatedAt: 10 });
    const serialized = JSON.stringify(manualPackage);
    expect(serialized).not.toContain('Unrelated synthetic source page must not be exported');
    expect(serialized).not.toContain('4111 1111 1111 1111');
    expect(serialized).toContain('[REDACTED_CARD_NUMBER]');
    expect(serialized).not.toContain('userDisplayName');
    expect(store.has('simSessions/session-synthetic/manualJudgeTasks/current')).toBe(true);

    writeLog.length = 0;
    const response = await importPOST(request('session-synthetic', importBody(manualPackage)), { params: params() });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.validationReport.valid).toBe(true);
    expect(body.validationReport.checks).toContainEqual(expect.objectContaining({ name: 'evidence', passed: true }));
    expect(body.evaluation).toMatchObject({ overallScorePct: 100, passed: true });
    expect(body.provenance).toMatchObject({
      source: 'manual_chat',
      provider: 'external-chat-synthetic',
      model: 'trainer-labelled-model',
      schema: { name: 'SimJudgeOutput', version: '1' },
      runtime: { label: 'external_manual_chat', protocol: null },
    });
    expect(body.evaluation.provenance).toEqual(body.provenance);
    expect(mockRecordEvaluation).toHaveBeenCalledTimes(1);
    expect(mockSaveEvaluation).not.toHaveBeenCalled();
    const recorded = mockRecordEvaluation.mock.calls[0][0];
    expect(recorded.user.uid).toBe('learner-synthetic');
    expect(recorded.evaluation).toMatchObject({ passed: true, provenance: { source: 'manual_chat' } });
    expect(recorded.expectedSessionUpdatedAt).toBe(10);
    expect(writeLog).toHaveLength(0);
  });

  it('passes the exported session timestamp to replay evaluation commits', async () => {
    const replay = SimSessionDocSchema.parse({ ...syntheticSession(), provenance: { source: 'replay' } });
    store.set(`simSessions/${replay.id}`, replay);
    const manualPackage = await exportPackage();

    const response = await importPOST(request('session-synthetic', importBody(manualPackage)), { params: params() });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.demoReplay).toBe(true);
    expect(mockSaveEvaluation).toHaveBeenCalledWith(expect.objectContaining({ expectedSessionUpdatedAt: 10 }));
    expect(mockRecordEvaluation).not.toHaveBeenCalled();
  });

  it('rejects browser-supplied live/local provenance fields without evaluation writes', async () => {
    const manualPackage = await exportPackage();
    writeLog.length = 0;
    const response = await importPOST(
      request('session-synthetic', {
        ...importBody(manualPackage),
        provenance: { source: 'local_ai', provider: 'ollama', model: 'forged-local-model' },
      }),
      { params: params() },
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('VALIDATION_FAILED');
    expect(mockSaveEvaluation).not.toHaveBeenCalled();
    expect(mockRecordEvaluation).not.toHaveBeenCalled();
    expect(writeLog).toHaveLength(0);
  });
});

describe('manual judge import safety and deterministic controls', () => {
  it('writes nothing for malformed JSON', async () => {
    const manualPackage = await exportPackage();
    const before = [...store.entries()].map(([path, value]) => [path, clone(value)]);
    writeLog.length = 0;

    const response = await importPOST(request('session-synthetic', importBody(manualPackage, '{not-json')), { params: params() });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('MANUAL_IMPORT_INVALID');
    expect(body.validationReport.checks.at(-1)).toMatchObject({ name: 'import_json', passed: false });
    expect([...store.entries()]).toEqual(before);
    expect(writeLog).toHaveLength(0);
    expect(mockSaveEvaluation).not.toHaveBeenCalled();
    expect(mockRecordEvaluation).not.toHaveBeenCalled();
  });

  it('rejects unexported evidence IDs before commit', async () => {
    const manualPackage = await exportPackage();
    const output = validJudgeOutput();
    output.criterionResults[0].evidenceEventIds = ['invented-event'];
    writeLog.length = 0;

    const response = await importPOST(
      request('session-synthetic', importBody(manualPackage, envelope(manualPackage, output))),
      { params: params() },
    );

    expect(response.status).toBe(400);
    expect((await response.json()).message).toContain('unexported event ID');
    expect(writeLog).toHaveLength(0);
    expect(mockSaveEvaluation).not.toHaveBeenCalled();
    expect(mockRecordEvaluation).not.toHaveBeenCalled();
  });

  it('preserves deterministic failure even when every imported rubric score is perfect', async () => {
    const failed = syntheticSession();
    failed.scenarioState!.recordingDisclosureRequired = true;
    failed.scenarioState!.recordingDisclosed = false;
    failed.simulationEvents!.push(
      event({ id: 'event-dial', sequence: 5, type: 'dial', payload: { status: 'connected', contactReached: 'patient', synthetic: true } }),
    );
    failed.nextEventSequence = 6;
    store.set(`simSessions/${failed.id}`, failed);
    const manualPackage = await exportPackage();
    expect(manualPackage.scenarioState).toMatchObject({
      scenarioState: { recordingDisclosureRequired: true, recordingDisclosed: false },
      simulationEvents: expect.arrayContaining([expect.objectContaining({ id: 'event-dial', type: 'dial' })]),
      gateResults: expect.arrayContaining([expect.objectContaining({ ruleId: 'recording_disclosure', status: 'fail' })]),
    });

    const response = await importPOST(request('session-synthetic', importBody(manualPackage)), { params: params() });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.evaluation.passed).toBe(false);
    expect(body.evaluation.overallScorePct).toBeLessThanOrEqual(59);
    expect(body.evaluation.autoFailedReason).toContain('recording_disclosure');
    expect(body.evaluation.gateResults).toContainEqual(expect.objectContaining({ ruleId: 'recording_disclosure', status: 'fail' }));
    expect(body.evaluation.assessmentEligibility.eligible).toBe(false);
    expect(mockRecordEvaluation.mock.calls[0][0].evaluation.passed).toBe(false);
  });

  it('rejects a task/session mismatch without evaluation writes', async () => {
    const manualPackage = await exportPackage();
    writeLog.length = 0;

    const response = await importPOST(request('another-session', importBody(manualPackage)), { params: params('another-session') });

    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe('SESSION_MISMATCH');
    expect(writeLog).toHaveLength(0);
    expect(mockSaveEvaluation).not.toHaveBeenCalled();
    expect(mockRecordEvaluation).not.toHaveBeenCalled();
  });
});
