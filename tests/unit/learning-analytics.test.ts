import { describe, expect, it } from 'vitest';
import { createProvenance } from '@/lib/ai/provenance';
import { buildLearningAnalytics, type LearningAnalyticsInput } from '@/lib/services/learning-analytics';
import {
  allPassingEvidence,
  drillAttempt,
  learningBlueprint,
  learningEnrollment,
  NOW,
  RULE_IDS_BY_DRILL,
  reviewSchedule,
  scenarioCoverage,
  scenarioEvidence,
} from './helpers/learning-service-fixtures';

function passingEvidenceWithVariedMastery() {
  const evidence = allPassingEvidence();
  return {
    ...evidence,
    drillAttempts: evidence.drillAttempts.map((attempt) => ({
      ...attempt,
      attemptKind: 'varied_retrieval' as const,
      firstIndependent: false,
    })),
  };
}

function analyticsInput(overrides: Partial<LearningAnalyticsInput> = {}): LearningAnalyticsInput {
  return {
    learnerId: 'learner-1',
    blueprint: learningBlueprint(),
    enrollment: learningEnrollment(),
    ruleIdsByDrillId: RULE_IDS_BY_DRILL,
    reviewSchedules: [],
    now: NOW,
    ...passingEvidenceWithVariedMastery(),
    ...overrides,
  };
}

describe('current-version learning analytics', () => {
  it('keeps completion, initial knowledge, mastery, retention, workflow, compliance, and dialogue separate', () => {
    const evidence = passingEvidenceWithVariedMastery();
    const critical = structuredClone(evidence.simSessions[1]);
    critical.evaluation!.overallScorePct = 40;
    critical.evaluation!.passed = false;
    critical.evaluation!.autoFailedReason = 'Critical opt-out failure.';
    critical.evaluation!.gateResults![0].status = 'fail';
    critical.evaluation!.assessmentEligibility = {
      eligible: false,
      reasons: ['Critical failure.'],
      minimumEvidenceMet: true,
      dispositionValid: true,
      deterministicCriticalFailure: true,
    };
    critical.gateResults![0].status = 'fail';
    const criticalCoverage = scenarioCoverage({
      scenarioId: 's-critical',
      status: 'remediation_required',
      attemptHistory: [scenarioEvidence({
        sessionId: 'session-critical',
        passed: false,
        criticalFailureRuleIds: ['rule-optout'],
      })],
      passingSessionIds: [],
    });
    const attempts = [
      drillAttempt({ id: 'initial-privacy', correct: true }),
      drillAttempt({
        id: 'initial-optout',
        unitId: 'u2',
        drillId: 'u2-d1',
        correct: false,
        score: 0,
        misconceptionRuleIds: ['rule-optout'],
      }),
      drillAttempt({
        id: 'varied-privacy',
        attemptKind: 'varied_retrieval',
        firstIndependent: false,
      }),
      drillAttempt({
        id: 'imported-optout',
        unitId: 'u2',
        drillId: 'u2-d1',
        correct: true,
        provenance: 'imported_legacy',
      }),
      drillAttempt({
        id: 'historical-optout',
        unitId: 'u2',
        drillId: 'u2-d1',
        curriculumVersion: 'v0',
        correct: true,
      }),
      drillAttempt({
        id: 'retention-privacy',
        attemptKind: 'spaced_review',
        firstIndependent: false,
        submittedAt: '2026-11-02T11:00:00.000Z',
      }),
    ];
    const result = buildLearningAnalytics(analyticsInput({
      enrollment: learningEnrollment({ completedUnitIds: ['u1'] }),
      drillAttempts: attempts,
      scenarioCoverage: [evidence.scenarioCoverage[0], criticalCoverage],
      simSessions: [evidence.simSessions[0], critical],
      reviewSchedules: [
        reviewSchedule({ id: 'due-complete', dueAt: '2026-11-01T12:00:00.000Z', lastAttemptId: 'retention-privacy' }),
        reviewSchedule({
          id: 'due-incomplete',
          unitId: 'u2',
          drillId: 'u2-d1',
          ruleIds: ['rule-optout'],
          dueAt: '2026-11-02T11:30:00.000Z',
        }),
        reviewSchedule({ id: 'future', dueAt: '2026-11-04T12:00:00.000Z' }),
      ],
    }));

    expect(result.contentCompletion).toEqual({ completed: 1, total: 2, ratio: 0.5 });
    expect(result.initialKnowledge).toEqual({ correct: 1, total: 2, ratio: 0.5 });
    expect(result.currentMastery).toEqual({ mastered: 1, total: 2, ratio: 0.5 });
    expect(result.delayedRetention).toEqual({ correct: 1, completed: 1, due: 2, ratio: 1 });
    expect(result.scenarioCoverage).toEqual({ passed: 1, total: 2, ratio: 0.5 });
    expect(result.workflowAccuracy).toEqual({ clean: 1, total: 2, ratio: 0.5 });
    expect(result.compliance).toEqual({
      criticalFailureCount: 1,
      byRule: { 'rule-optout': 1 },
      bySession: { 'session-critical': 1 },
    });
    expect(result.dialogueCoaching.averageScore).toBe(65);
    expect(result.dialogueCoaching.evaluatedAttempts).toBe(2);
    expect(result.dialogueCoaching.dimensions).toHaveLength(2);
    expect(result.dialogueCoaching.dimensions[0]).toMatchObject({
      averageScore: 100,
      evidenceSessionIds: ['session-easy'],
      evidenceEventIds: ['session-easy-event-1'],
      provenance: ['local_ai'],
    });
    expect(result.evidenceConfidence).toBe('emerging');
    expect(result.outstandingRuleIds).toEqual(['rule-optout']);
    expect(result.upcomingReviews.map((review) => review.id)).toEqual(['future']);
    expect(result.recency).toEqual({ lastEligibleAttemptAt: NOW, curriculumVersion: 'v1' });
    expect(result.evidenceRefs.initialKnowledgeAttemptIds).toEqual(['initial-privacy', 'initial-optout']);
    expect(result.evidenceRefs.masteryAttemptIds).toEqual(['varied-privacy']);
    expect(result.evidenceRefs.complianceSessionIds).toEqual(['session-critical']);
    expect(result.evidenceRefs.attemptIds).not.toContain('imported-optout');
    expect(result.evidenceRefs.attemptIds).not.toContain('historical-optout');
    expect(result).not.toHaveProperty('readinessScore');
  });

  it('requires varied retrieval for mastery, not initial or same-item spaced evidence', () => {
    const initialAttempts = allPassingEvidence().drillAttempts;
    const initialOnly = buildLearningAnalytics(analyticsInput({ drillAttempts: initialAttempts }));
    expect(initialOnly.initialKnowledge).toEqual({ correct: 2, total: 2, ratio: 1 });
    expect(initialOnly.currentMastery).toEqual({ mastered: 0, total: 2, ratio: 0 });
    expect(initialOnly.evidenceRefs.masteryAttemptIds).toEqual([]);

    const spacedAttempts = initialAttempts.map((attempt) => ({
      ...attempt,
      id: `${attempt.id}-spaced`,
      attemptKind: 'spaced_review' as const,
      firstIndependent: false,
    }));
    const spacedOnly = buildLearningAnalytics(analyticsInput({ drillAttempts: spacedAttempts }));
    expect(spacedOnly.currentMastery).toEqual({ mastered: 0, total: 2, ratio: 0 });
    expect(spacedOnly.outstandingRuleIds).toEqual(['rule-privacy', 'rule-optout']);
    expect(spacedOnly.evidenceRefs.masteryAttemptIds).toEqual([]);
    expect(spacedOnly.evidenceRefs.retentionAttemptIds).toEqual(['attempt-privacy-spaced', 'attempt-optout-spaced']);

    const variedAttempts = initialAttempts.map((attempt) => ({
      ...attempt,
      id: `${attempt.id}-varied`,
      attemptKind: 'varied_retrieval' as const,
      firstIndependent: false,
    }));
    const withVaried = buildLearningAnalytics(analyticsInput({
      drillAttempts: [...initialAttempts, ...spacedAttempts, ...variedAttempts],
    }));
    expect(withVaried.initialKnowledge).toEqual({ correct: 2, total: 2, ratio: 1 });
    expect(withVaried.currentMastery).toEqual({ mastered: 2, total: 2, ratio: 1 });
    expect(withVaried.evidenceRefs.masteryAttemptIds).toEqual(['attempt-privacy-varied', 'attempt-optout-varied']);
    expect(withVaried.evidenceRefs.retentionAttemptIds).toEqual(['attempt-privacy-spaced', 'attempt-optout-spaced']);
  });

  it('returns null evidence ratios and insufficient confidence when nothing is demonstrated', () => {
    const result = buildLearningAnalytics(analyticsInput({
      enrollment: null,
      drillAttempts: [],
      scenarioCoverage: [],
      simSessions: [],
      reviewSchedules: [],
    }));
    expect(result.initialKnowledge).toEqual({ correct: 0, total: 0, ratio: null });
    expect(result.delayedRetention).toEqual({ correct: 0, completed: 0, due: 0, ratio: null });
    expect(result.workflowAccuracy).toEqual({ clean: 0, total: 0, ratio: null });
    expect(result.dialogueCoaching).toMatchObject({ averageScore: null, evaluatedAttempts: 0, dimensions: [] });
    expect(result.recency).toEqual({ lastEligibleAttemptAt: null, curriculumVersion: null });
    expect(result.evidenceConfidence).toBe('insufficient');
    expect(result.evidenceRefs).toMatchObject({ attemptIds: [], sessionIds: [] });
    expect(result.compliance.criticalFailureCount).toBe(0);
  });

  it('excludes replay, historical, and unverified legacy evidence by default', () => {
    const evidence = passingEvidenceWithVariedMastery();
    const replay = { ...evidence.simSessions[1], provenance: createProvenance({ source: 'replay' }) };
    const legacyCoverage = scenarioCoverage({
      scenarioId: 's-critical',
      attemptHistory: [scenarioEvidence({ sessionId: 'session-critical', provenance: 'imported_legacy' })],
    });
    const importedAttempts = evidence.drillAttempts.map((attempt) => attempt.id === 'attempt-optout'
      ? { ...attempt, provenance: 'imported_legacy' as const }
      : attempt);
    const result = buildLearningAnalytics(analyticsInput({
      drillAttempts: importedAttempts,
      scenarioCoverage: [evidence.scenarioCoverage[0], legacyCoverage],
      simSessions: [evidence.simSessions[0], replay],
    }));
    expect(result.currentMastery.mastered).toBe(1);
    expect(result.scenarioCoverage.passed).toBe(1);
    expect(result.dialogueCoaching.evaluatedAttempts).toBe(1);
    expect(result.evidenceRefs.sessionIds).toEqual(['session-easy']);
    expect(result.evidenceRefs.attemptIds).not.toContain('attempt-optout');

    const validated = buildLearningAnalytics(analyticsInput({
      drillAttempts: importedAttempts,
      scenarioCoverage: [evidence.scenarioCoverage[0], legacyCoverage],
      simSessions: evidence.simSessions,
      verification: {
        verifiedLegacyAttemptIds: ['attempt-optout'],
        verifiedLegacySessionIds: ['session-critical'],
      },
    }));
    expect(validated.currentMastery.mastered).toBe(2);
    expect(validated.scenarioCoverage.passed).toBe(2);
  });

  it('does not award adequate confidence for partial or stale evidence', () => {
    const evidence = passingEvidenceWithVariedMastery();
    const partial = buildLearningAnalytics(analyticsInput({
      scenarioCoverage: [evidence.scenarioCoverage[0]],
      simSessions: [evidence.simSessions[0]],
    }));
    expect(partial.evidenceConfidence).toBe('emerging');

    const stale = buildLearningAnalytics(analyticsInput({ now: '2027-01-01T12:00:00.000Z' }));
    expect(stale.scenarioCoverage.ratio).toBe(1);
    expect(stale.currentMastery.ratio).toBe(1);
    expect(stale.evidenceConfidence).toBe('emerging');
  });
});
