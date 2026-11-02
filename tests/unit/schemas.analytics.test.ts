import { describe, expect, it } from 'vitest';
import {
  AnalyticsRollupDocSchema,
  EnrollmentDocSchema,
  SimEvaluationSchema,
  SimSessionDocSchema,
  enrollmentIdFor,
  rollupIdForCohort,
  rollupIdForDivision,
  rollupIdForGlobal,
  rollupIdForTrack,
} from '@/lib/schemas/analytics';

const evaluation = {
  overallScorePct: 88,
  passed: true,
  autoFailedReason: null,
  dispositionCorrect: true,
  summaryFeedback: 'Strong verification and empathy.',
  strengthsHighlighted: ['Verified the order number'],
  coachingImprovements: ['State the refund timeline'],
  criterionResults: [
    {
      criterionId: 'r1',
      competencyPillarId: 'p1',
      criterionLabel: 'Verified identity',
      score: '100',
      agentQuoteEvidence: 'Can I have your order number?',
      coachingNote: 'Good.',
      betterResponseExample: null,
    },
    {
      criterionId: 'r2',
      competencyPillarId: 'p2',
      criterionLabel: 'Correct refund tier',
      score: 50,
      agentQuoteEvidence: 'I can offer a refund.',
      coachingNote: 'Name the 70% tier.',
      betterResponseExample: 'I can process a 70% refund right now.',
    },
  ],
  evaluatedAt: 1,
};

describe('analytics schemas', () => {
  it('builds deterministic document ids', () => {
    expect(enrollmentIdFor('u1', 't1')).toBe('u1_t1');
    expect(rollupIdForGlobal()).toBe('GLOBAL');
    expect(rollupIdForDivision('INBOUND')).toBe('DIVISION_INBOUND');
    expect(rollupIdForCohort('THS')).toBe('COHORT_THS');
    expect(rollupIdForTrack('t1')).toBe('TRACK_t1');
  });

  it('validates an enrollment and rejects zero attempts', () => {
    const enrollment = {
      id: 'u1_t1',
      userId: 'u1',
      userDisplayName: 'Ana',
      partnerCohortId: 'THS',
      divisionId: 'INBOUND',
      trackId: 't1',
      trackTitle: 'MVP',
      versionId: 'v1',
      status: 'IN_PROGRESS',
      completedUnitIds: ['u1'],
      passedScenarioIds: [],
      unitScores: { u1: { firstTryAccuracyPct: 80, attemptsCount: 1, completedAt: 1 } },
      bestSimScorePct: null,
      xpEarned: 125,
      progressPct: 40,
      certifiedAt: null,
      lastActivityAt: 1,
    };
    expect(EnrollmentDocSchema.parse(enrollment).status).toBe('IN_PROGRESS');
    expect(
      EnrollmentDocSchema.safeParse({
        ...enrollment,
        unitScores: { u1: { firstTryAccuracyPct: 80, attemptsCount: 0, completedAt: 1 } },
      }).success,
    ).toBe(false);
  });

  it('coerces string criterion scores to numbers', () => {
    const parsed = SimEvaluationSchema.parse(evaluation);
    expect(parsed.criterionResults.map((c) => c.score)).toEqual([100, 50]);
    expect(
      SimEvaluationSchema.safeParse({
        ...evaluation,
        criterionResults: [{ ...evaluation.criterionResults[0], score: '75' }],
      }).success,
    ).toBe(false);
  });

  it('validates a Simulation session with inline messages', () => {
    const session = {
      id: 'sess1',
      userId: 'u1',
      userDisplayName: 'Ana',
      partnerCohortId: 'THS',
      divisionId: 'INBOUND',
      trackId: 't1',
      versionId: 'v1',
      scenarioId: 's1',
      scenarioTitle: 'Medical Refund',
      status: 'EVALUATED',
      turnCount: 1,
      messages: [
        { id: 'm1', role: 'counterparty', content: 'I want a refund.', createdAt: 1 },
        { id: 'm2', role: 'agent', content: 'I can help.', createdAt: 2 },
      ],
      selectedDisposition: 'Refund - Medical',
      evaluation,
      startedAt: 1,
      updatedAt: 2,
    };
    expect(SimSessionDocSchema.parse(session).messages).toHaveLength(2);
    expect(
      SimSessionDocSchema.safeParse({ ...session, messages: [{ id: 'x', role: 'system', content: 'x', createdAt: 1 }] }).success,
    ).toBe(false);
  });

  it('validates rollup documents', () => {
    const rollup = {
      id: 'COHORT_THS',
      scopeType: 'COHORT',
      divisionId: null,
      partnerCohortId: 'THS',
      trackId: null,
      totalCertifications: 2,
      totalUnitCompletions: 30,
      totalSimAttempts: 5,
      totalSimPasses: 3,
      pillarAggregates: { empathy_communication: { pillarLabel: 'Empathy', sampleCount: 10, scoreSum: 930 } },
      missedItemCounts: { t1__u1_d2: { trackId: 't1', itemId: 'u1-d2', itemLabel: 'Is this compliant?', missCount: 4 } },
      updatedAt: 1,
    };
    expect(AnalyticsRollupDocSchema.parse(rollup).scopeType).toBe('COHORT');
    expect(AnalyticsRollupDocSchema.safeParse({ ...rollup, scopeType: 'TEAM' }).success).toBe(false);
  });
});
