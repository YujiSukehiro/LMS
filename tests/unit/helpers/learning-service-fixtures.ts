import { createProvenance } from '@/lib/ai/provenance';
import type { EnrollmentDoc, SimSessionDoc } from '@/lib/schemas/analytics';
import type { TrackVersionDoc } from '@/lib/schemas/curriculum';
import type {
  AssessmentBlueprintDoc,
  DrillAttemptDoc,
  ReviewScheduleDoc,
  ScenarioAttemptEvidence,
  ScenarioCoverageDoc,
} from '@/lib/schemas/learning';
import { buildAssessmentBlueprint } from '@/lib/services/certification';
import { pillars, scenario, unit } from './fixtures';

export const NOW = '2026-11-02T12:00:00.000Z';
export const RULE_IDS_BY_DRILL = {
  'u1-d1': ['rule-privacy'],
  'u2-d1': ['rule-optout'],
} as const;

export function learningVersion(overrides: Partial<TrackVersionDoc> = {}): TrackVersionDoc {
  const easy = {
    ...scenario,
    id: 's-easy',
    difficulty: 'STANDARD' as const,
    dispositionOptions: ['Recovered', 'Lost', 'Organic'],
    evidenceRequirements: {
      minimumLearnerTurns: 1,
      requiredInspections: [],
      requiredWorkflowActions: ['verify_identity'],
      requiredWrapUpEvidence: ['note'],
      requiredGateIds: ['rule-privacy'],
      requiredCustomerConcerns: [],
      expectedDurationMinutes: null,
      gateSourceRefs: {},
      maximumCriticalFailures: 0,
      maximumMajorFailures: 0,
    },
  };
  const critical = {
    ...easy,
    id: 's-critical',
    difficulty: 'HIGH_PRESSURE' as const,
    evidenceRequirements: {
      ...easy.evidenceRequirements,
      requiredGateIds: ['rule-optout'],
    },
  };
  return {
    versionId: 'v1',
    trackId: 'track-1',
    versionNumber: 1,
    competencyPillars: pillars,
    units: [unit('u1', 0), unit('u2', 1)],
    simScenarios: [easy, critical],
    sourceRevision: 'source-v1',
    requiredRuleIds: ['rule-privacy', 'rule-optout'],
    publishedAt: Date.parse(NOW),
    createdAt: Date.parse(NOW),
    ...overrides,
  };
}

export function learningBlueprint(overrides: Partial<AssessmentBlueprintDoc> = {}): AssessmentBlueprintDoc {
  return {
    ...buildAssessmentBlueprint(learningVersion(), {
      createdAt: NOW,
      certificationExpiryDays: 90,
      policyVersion: 'policy-1',
    }),
    ...overrides,
  };
}

export function learningEnrollment(overrides: Partial<EnrollmentDoc> = {}): EnrollmentDoc {
  return {
    id: 'learner-1_track-1',
    userId: 'learner-1',
    userDisplayName: 'Learner',
    partnerCohortId: 'INTERNAL',
    divisionId: 'INBOUND',
    trackId: 'track-1',
    trackTitle: 'Learning Track',
    versionId: 'v1',
    status: 'IN_PROGRESS',
    completedUnitIds: ['u1', 'u2'],
    passedScenarioIds: [],
    unitScores: {},
    bestSimScorePct: null,
    xpEarned: 0,
    progressPct: 50,
    certifiedAt: null,
    lastActivityAt: Date.parse(NOW),
    ...overrides,
  };
}

export function drillAttempt(overrides: Partial<DrillAttemptDoc> = {}): DrillAttemptDoc {
  return {
    schemaVersion: 1,
    id: 'attempt-1',
    learnerId: 'learner-1',
    partnerCohortId: 'INTERNAL',
    trackId: 'track-1',
    unitId: 'u1',
    drillId: 'u1-d1',
    curriculumVersion: 'v1',
    attemptNumber: 1,
    attemptKind: 'initial',
    answer: { kind: 'MULTIPLE_CHOICE', optionId: 'a' },
    correct: true,
    score: 100,
    firstIndependent: true,
    misconceptionRuleIds: [],
    startId: 'start-1',
    requestHash: `sha256:${'a'.repeat(64)}`,
    startedAt: '2026-11-02T10:00:00.000Z',
    submittedAt: '2026-11-02T10:01:00.000Z',
    durationMs: 60_000,
    provenance: 'live',
    ...overrides,
  };
}

export function scenarioEvidence(overrides: Partial<ScenarioAttemptEvidence> = {}): ScenarioAttemptEvidence {
  return {
    sessionId: 'session-easy',
    passed: true,
    evaluatedAt: NOW,
    criticalFailureRuleIds: [],
    workflowComplete: true,
    dispositionValid: true,
    provenance: 'local_ai',
    ...overrides,
  };
}

export function scenarioSession(overrides: Partial<SimSessionDoc> = {}): SimSessionDoc {
  const sessionId = overrides.id ?? 'session-easy';
  const scenarioId = overrides.scenarioId ?? 's-easy';
  const ruleId = scenarioId === 's-critical' ? 'rule-optout' : 'rule-privacy';
  const base: SimSessionDoc = {
    id: sessionId,
    userId: 'learner-1',
    userDisplayName: 'Learner',
    partnerCohortId: 'INTERNAL',
    divisionId: 'INBOUND',
    trackId: 'track-1',
    versionId: 'v1',
    scenarioId,
    scenarioTitle: scenarioId,
    status: 'EVALUATED',
    turnCount: 1,
    messages: [
      { id: `${sessionId}-m1`, role: 'counterparty', content: 'Hello', createdAt: Date.parse(NOW) - 2_000 },
      { id: `${sessionId}-m2`, role: 'agent', content: 'I can help.', createdAt: Date.parse(NOW) - 1_000 },
    ],
    selectedDisposition: 'Recovered',
    evaluation: {
      overallScorePct: 90,
      passed: true,
      autoFailedReason: null,
      dispositionCorrect: true,
      summaryFeedback: 'Good.',
      strengthsHighlighted: [],
      coachingImprovements: [],
      criterionResults: [{
        criterionId: `criterion-${scenarioId}`,
        competencyPillarId: 'p1',
        criterionLabel: 'Verified identity',
        score: 100,
        agentQuoteEvidence: 'I can help.',
        evidenceEventIds: [`${sessionId}-event-1`],
        coachingNote: 'Good.',
        betterResponseExample: null,
      }],
      gateResults: [{
        ruleId,
        sourceRefs: [],
        severity: 'critical',
        status: 'pass',
        evidenceEventIds: [`${sessionId}-event-1`],
        learnerFeedback: 'Passed.',
        trainerDetail: 'Observed.',
      }],
      assessmentEligibility: {
        eligible: true,
        reasons: [],
        minimumEvidenceMet: true,
        dispositionValid: true,
        deterministicCriticalFailure: false,
      },
      dispositionValidation: { disposition: 'Recovered', valid: true, reasons: [] },
      evidenceEventIds: [`${sessionId}-event-1`],
      provenance: createProvenance({ source: 'local_ai', provider: 'test', model: 'judge' }),
      evaluatedAt: Date.parse(NOW),
    },
    scenarioState: {
      lifecycle: 'evaluated',
      context: {
        direction: 'inbound',
        queue: 'recovery',
        product: 'Test Product',
        stage: 'score',
        contactState: 'existing_patient',
        pricingPosture: 'active',
        caseBranch: 'standard',
        syntheticTimezone: 'UTC',
        syntheticNow: NOW,
        sourceRevision: 'source-v1',
        curriculumVersion: 'v1',
      },
      inspectionIds: [],
      identityVerified: true,
      localTimeValidated: true,
      recordingDisclosureRequired: false,
      recordingDisclosed: false,
      contactReached: 'patient',
      customerIntent: 'support',
      clinicalRiskBranch: null,
      optOut: false,
      suppressionRecorded: false,
      customerAskedPrice: false,
      pricingDiscussed: false,
      selectedPlanId: null,
      baseRecoveryCommitted: false,
      offerAssetIds: [],
      smsPermissionGranted: false,
      sentLinkAssetIds: [],
      workflowActionIds: ['verify_identity'],
      recording: 'inactive',
      paymentState: 'not_started',
      patientCompletionIds: [],
      organicCompletionIds: [],
      escalationReceiptIds: [],
      noteReceiptIds: ['note-1'],
      callbackAt: null,
      selectedDisposition: 'Recovered',
      dispositionCorrect: true,
      wrapUpComplete: true,
      abortReason: null,
    },
    simulationEvents: [{
      id: `${sessionId}-event-1`,
      sessionId,
      sequence: 1,
      actor: 'learner',
      type: 'utterance',
      payload: { content: 'I can help.' },
      stateHash: `sha256:${'b'.repeat(64)}`,
      occurredAt: NOW,
      provenance: 'learner',
    }],
    gateResults: [{
      ruleId,
      sourceRefs: [],
      severity: 'critical',
      status: 'pass',
      evidenceEventIds: [`${sessionId}-event-1`],
      learnerFeedback: 'Passed.',
      trainerDetail: 'Observed.',
    }],
    dispositionValidation: { disposition: 'Recovered', valid: true, reasons: [] },
    assessmentEligibility: {
      eligible: true,
      reasons: [],
      minimumEvidenceMet: true,
      dispositionValid: true,
      deterministicCriticalFailure: false,
    },
    provenance: createProvenance({ source: 'local_ai', provider: 'test', model: 'actor' }),
    startedAt: Date.parse(NOW) - 10_000,
    updatedAt: Date.parse(NOW),
  };
  return { ...base, ...overrides };
}

export function scenarioCoverage(overrides: Partial<ScenarioCoverageDoc> = {}): ScenarioCoverageDoc {
  const scenarioId = overrides.scenarioId ?? 's-easy';
  const sessionId = overrides.attemptHistory?.[0]?.sessionId ?? (scenarioId === 's-critical' ? 'session-critical' : 'session-easy');
  return {
    schemaVersion: 1,
    id: `coverage-${scenarioId}`,
    learnerId: 'learner-1',
    partnerCohortId: 'INTERNAL',
    trackId: 'track-1',
    curriculumVersion: 'v1',
    scenarioId,
    requiredGateIds: [scenarioId === 's-critical' ? 'rule-optout' : 'rule-privacy'],
    status: 'passed',
    attemptHistory: [scenarioEvidence({ sessionId })],
    passingSessionIds: [sessionId],
    lastSessionId: sessionId,
    updatedAt: NOW,
    ...overrides,
  };
}

export function reviewSchedule(overrides: Partial<ReviewScheduleDoc> = {}): ReviewScheduleDoc {
  return {
    schemaVersion: 1,
    id: 'review-1',
    learnerId: 'learner-1',
    trackId: 'track-1',
    unitId: 'u1',
    drillId: 'u1-d1',
    curriculumVersion: 'v1',
    ruleIds: ['rule-privacy'],
    nextAttemptKind: 'spaced_review',
    dueAt: '2026-11-03T12:00:00.000Z',
    intervalIndex: 0,
    independent: true,
    lastAttemptId: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

export function allPassingEvidence() {
  const easySession = scenarioSession();
  const criticalSession = scenarioSession({ id: 'session-critical', scenarioId: 's-critical' });
  return {
    drillAttempts: [
      drillAttempt({ id: 'attempt-privacy', drillId: 'u1-d1', unitId: 'u1' }),
      drillAttempt({ id: 'attempt-optout', drillId: 'u2-d1', unitId: 'u2' }),
    ],
    scenarioCoverage: [scenarioCoverage(), scenarioCoverage({ scenarioId: 's-critical' })],
    simSessions: [easySession, criticalSession],
  };
}
