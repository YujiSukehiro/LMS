import type { ProvenanceSource } from '@/lib/ai/provenance';
import type { EnrollmentDoc, SimSessionDoc } from '@/lib/schemas/analytics';
import {
  LearningAnalyticsSchema,
  type AssessmentBlueprintDoc,
  type CertificationStatus,
  type DrillAttemptDoc,
  type LearningAnalytics,
  type ReviewScheduleDoc,
  type ScenarioCoverageDoc,
} from '@/lib/schemas/learning';
import {
  evaluateKnowledgeMastery,
  evaluateRetention,
  evaluateScenarioCoverage,
  evaluateScenarioSessionEvidence,
  isEligibleDrillAttempt,
  type EvidenceVerificationPolicy,
  type IsoDateInput,
  type KnowledgeMasteryPolicy,
  type RetentionPolicy,
  type ScenarioSessionEvaluation,
} from './certification';

export interface DialogueDimensionAnalytics {
  criterionId: string;
  competencyPillarId: string;
  averageScore: number | null;
  evaluatedAttempts: number;
  evidenceSessionIds: string[];
  evidenceEventIds: string[];
  provenance: ProvenanceSource[];
}

export interface MetricEvidenceRefs {
  attemptIds: string[];
  sessionIds: string[];
  initialKnowledgeAttemptIds: string[];
  masteryAttemptIds: string[];
  retentionAttemptIds: string[];
  scenarioSessionIds: string[];
  workflowSessionIds: string[];
  complianceSessionIds: string[];
  dialogueSessionIds: string[];
}

export interface CurrentLearningAnalytics extends Omit<LearningAnalytics, 'compliance' | 'dialogueCoaching' | 'evidenceRefs'> {
  compliance: LearningAnalytics['compliance'] & {
    /** Critical events remain visible by session instead of being hidden inside an average. */
    bySession: Record<string, number>;
  };
  dialogueCoaching: LearningAnalytics['dialogueCoaching'] & {
    dimensions: DialogueDimensionAnalytics[];
    evidenceSessionIds: string[];
  };
  evidenceRefs: MetricEvidenceRefs;
}

export interface LearningAnalyticsInput {
  learnerId: string;
  blueprint: AssessmentBlueprintDoc;
  enrollment: EnrollmentDoc | null;
  drillAttempts: readonly DrillAttemptDoc[];
  scenarioCoverage: readonly ScenarioCoverageDoc[];
  simSessions: readonly SimSessionDoc[];
  reviewSchedules: readonly ReviewScheduleDoc[];
  ruleIdsByDrillId: Readonly<Record<string, readonly string[]>>;
  now: IsoDateInput;
  certificationStatus?: CertificationStatus;
  masteryPolicy?: KnowledgeMasteryPolicy;
  retentionPolicy?: RetentionPolicy;
  verification?: EvidenceVerificationPolicy;
  /** Recency window for adequate confidence; defaults to 30 days. */
  confidenceRecencyDays?: number;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

function timestamp(value: IsoDateInput): number {
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error('A valid analytics timestamp is required.');
  return parsed;
}

function assessedSessions(args: LearningAnalyticsInput): ScenarioSessionEvaluation[] {
  const sessionsById = new Map(args.simSessions.map((session) => [session.id, session]));
  const assessed = new Map<string, ScenarioSessionEvaluation>();
  for (const coverage of args.scenarioCoverage) {
    if (
      coverage.learnerId !== args.learnerId ||
      coverage.trackId !== args.blueprint.trackId ||
      coverage.curriculumVersion !== args.blueprint.curriculumVersion ||
      !args.blueprint.requiredScenarioIds.includes(coverage.scenarioId)
    ) {
      continue;
    }
    for (const evidence of coverage.attemptHistory) {
      const session = sessionsById.get(evidence.sessionId);
      if (!session || assessed.has(session.id)) continue;
      assessed.set(
        session.id,
        evaluateScenarioSessionEvidence({
          learnerId: args.learnerId,
          blueprint: args.blueprint,
          session,
          evidence,
          expectedScenarioId: coverage.scenarioId,
          verification: args.verification,
        }),
      );
    }
  }
  return [...assessed.values()];
}

/**
 * Build current-version component metrics only. There is deliberately no blended readiness score:
 * absent evidence stays null and critical failures remain discrete counts.
 */
export function buildLearningAnalytics(args: LearningAnalyticsInput): CurrentLearningAnalytics {
  const now = timestamp(args.now);
  const knowledge = evaluateKnowledgeMastery(args);
  const retention = evaluateRetention(args);
  const scenarioCoverage = evaluateScenarioCoverage(args);
  const eligibleAttempts = args.drillAttempts.filter((attempt) =>
    isEligibleDrillAttempt(attempt, {
      learnerId: args.learnerId,
      blueprint: args.blueprint,
      verification: args.verification,
    }),
  );
  const initialAttempts = eligibleAttempts.filter((attempt) => attempt.firstIndependent && attempt.attemptKind !== 'immediate_retry');
  const initialCorrect = initialAttempts.filter((attempt) => attempt.correct).length;
  const sessionAssessments = assessedSessions(args);
  const eligibleSessions = sessionAssessments.filter((assessment) => assessment.evidenceEligible);
  const eligibleSessionIds = new Set(eligibleSessions.map((assessment) => assessment.sessionId));
  const sessionsById = new Map(args.simSessions.map((session) => [session.id, session]));

  const currentEnrollment = args.enrollment &&
    args.enrollment.userId === args.learnerId &&
    args.enrollment.trackId === args.blueprint.trackId &&
    args.enrollment.versionId === args.blueprint.curriculumVersion
    ? args.enrollment
    : null;
  const completedUnits = currentEnrollment
    ? args.blueprint.requiredUnitIds.filter((unitId) => currentEnrollment.completedUnitIds.includes(unitId)).length
    : 0;

  const attemptById = new Map(eligibleAttempts.map((attempt) => [attempt.id, attempt]));
  const currentSchedules = args.reviewSchedules.filter(
    (schedule) =>
      schedule.learnerId === args.learnerId &&
      schedule.trackId === args.blueprint.trackId &&
      schedule.curriculumVersion === args.blueprint.curriculumVersion &&
      schedule.nextAttemptKind === 'spaced_review',
  );
  const dueSchedules = currentSchedules.filter((schedule) => schedule.independent && timestamp(schedule.dueAt) <= now);
  const completedDueAttempts = dueSchedules.flatMap((schedule) => {
    if (!schedule.lastAttemptId) return [];
    const attempt = attemptById.get(schedule.lastAttemptId);
    return attempt?.attemptKind === 'spaced_review' && timestamp(attempt.submittedAt) >= timestamp(schedule.dueAt) ? [attempt] : [];
  });
  const correctDueAttempts = completedDueAttempts.filter((attempt) => attempt.correct);
  const upcomingReviews = currentSchedules
    .filter((schedule) => timestamp(schedule.dueAt) > now)
    .sort((left, right) => timestamp(left.dueAt) - timestamp(right.dueAt));

  const cleanWorkflowSessions = eligibleSessions.filter((assessment) => assessment.workflowClean);
  const complianceByRule: Record<string, number> = {};
  const complianceBySession: Record<string, number> = {};
  for (const assessment of eligibleSessions) {
    if (assessment.criticalFailureRuleIds.length === 0) continue;
    complianceBySession[assessment.sessionId] = assessment.criticalFailureRuleIds.length;
    for (const ruleId of assessment.criticalFailureRuleIds) {
      complianceByRule[ruleId] = (complianceByRule[ruleId] ?? 0) + 1;
    }
  }
  const criticalFailureCount = Object.values(complianceBySession).reduce((sum, count) => sum + count, 0);

  const dialogueSessions = eligibleSessions.flatMap((assessment) => {
    const session = sessionsById.get(assessment.sessionId);
    return session?.evaluation ? [session] : [];
  });
  const dialogueScoreSum = dialogueSessions.reduce((sum, session) => sum + session.evaluation!.overallScorePct, 0);
  const dimensions = new Map<string, {
    criterionId: string;
    competencyPillarId: string;
    scoreSum: number;
    evaluatedAttempts: number;
    evidenceSessionIds: Set<string>;
    evidenceEventIds: Set<string>;
    provenance: Set<ProvenanceSource>;
  }>();
  for (const session of dialogueSessions) {
    const evaluation = session.evaluation!;
    for (const criterion of evaluation.criterionResults) {
      const key = `${criterion.criterionId}:${criterion.competencyPillarId}`;
      const dimension = dimensions.get(key) ?? {
        criterionId: criterion.criterionId,
        competencyPillarId: criterion.competencyPillarId,
        scoreSum: 0,
        evaluatedAttempts: 0,
        evidenceSessionIds: new Set<string>(),
        evidenceEventIds: new Set<string>(),
        provenance: new Set<ProvenanceSource>(),
      };
      dimension.scoreSum += criterion.score;
      dimension.evaluatedAttempts += 1;
      dimension.evidenceSessionIds.add(session.id);
      criterion.evidenceEventIds?.forEach((eventId) => dimension.evidenceEventIds.add(eventId));
      if (evaluation.provenance) dimension.provenance.add(evaluation.provenance.source);
      dimensions.set(key, dimension);
    }
  }
  const dialogueDimensions: DialogueDimensionAnalytics[] = [...dimensions.values()].map((dimension) => ({
    criterionId: dimension.criterionId,
    competencyPillarId: dimension.competencyPillarId,
    averageScore: dimension.evaluatedAttempts > 0 ? dimension.scoreSum / dimension.evaluatedAttempts : null,
    evaluatedAttempts: dimension.evaluatedAttempts,
    evidenceSessionIds: [...dimension.evidenceSessionIds],
    evidenceEventIds: [...dimension.evidenceEventIds],
    provenance: [...dimension.provenance],
  }));

  const attemptTimes = eligibleAttempts.map((attempt) => timestamp(attempt.submittedAt));
  const sessionTimes = eligibleSessions.flatMap((assessment) => assessment.evaluatedAt ? [timestamp(assessment.evaluatedAt)] : []);
  const allEvidenceTimes = [...attemptTimes, ...sessionTimes];
  const lastEligibleAttemptAt = allEvidenceTimes.length > 0 ? new Date(Math.max(...allEvidenceTimes)).toISOString() : null;
  const recencyDays = args.confidenceRecencyDays ?? 30;
  if (!Number.isFinite(recencyDays) || recencyDays <= 0) throw new Error('Confidence recency window must be positive.');
  const recent = lastEligibleAttemptAt !== null && now - timestamp(lastEligibleAttemptAt) <= recencyDays * 86_400_000;
  const hasEvidence = eligibleAttempts.length > 0 || eligibleSessions.length > 0;
  const adequate =
    hasEvidence &&
    recent &&
    args.blueprint.requiredRuleIds.length > 0 &&
    args.blueprint.requiredScenarioIds.length > 0 &&
    knowledge.outstandingRuleIds.length === 0 &&
    scenarioCoverage.allPassed &&
    initialAttempts.length > 0 &&
    criticalFailureCount === 0;

  const scenarioSessionIds = scenarioCoverage.evidenceSessionIds;
  const retentionAttemptIds = unique([
    ...retention.evidenceAttemptIds,
    ...completedDueAttempts.map((attempt) => attempt.id),
  ]);
  const evidenceAttemptIds = unique([...eligibleAttempts.map((attempt) => attempt.id)]);
  const base = LearningAnalyticsSchema.parse({
    trackId: args.blueprint.trackId,
    curriculumVersion: args.blueprint.curriculumVersion,
    contentCompletion: {
      completed: completedUnits,
      total: args.blueprint.requiredUnitIds.length,
      ratio: ratio(completedUnits, args.blueprint.requiredUnitIds.length),
    },
    initialKnowledge: {
      correct: initialCorrect,
      total: initialAttempts.length,
      ratio: ratio(initialCorrect, initialAttempts.length),
    },
    currentMastery: {
      mastered: knowledge.masteredRuleIds.length,
      total: args.blueprint.requiredRuleIds.length,
      ratio: ratio(knowledge.masteredRuleIds.length, args.blueprint.requiredRuleIds.length),
    },
    delayedRetention: {
      correct: correctDueAttempts.length,
      completed: completedDueAttempts.length,
      due: dueSchedules.length,
      ratio: ratio(correctDueAttempts.length, completedDueAttempts.length),
    },
    scenarioCoverage: {
      passed: scenarioCoverage.passedScenarioIds.length,
      total: args.blueprint.requiredScenarioIds.length,
      ratio: ratio(scenarioCoverage.passedScenarioIds.length, args.blueprint.requiredScenarioIds.length),
    },
    workflowAccuracy: {
      clean: cleanWorkflowSessions.length,
      total: eligibleSessions.length,
      ratio: ratio(cleanWorkflowSessions.length, eligibleSessions.length),
    },
    compliance: { criticalFailureCount, byRule: complianceByRule },
    dialogueCoaching: {
      averageScore: dialogueSessions.length > 0 ? dialogueScoreSum / dialogueSessions.length : null,
      evaluatedAttempts: dialogueSessions.length,
    },
    recency: {
      lastEligibleAttemptAt,
      curriculumVersion: lastEligibleAttemptAt ? args.blueprint.curriculumVersion : null,
    },
    evidenceConfidence: adequate ? 'adequate' : hasEvidence ? 'emerging' : 'insufficient',
    certificationStatus: args.certificationStatus ?? 'not_started',
    outstandingRuleIds: unique([...knowledge.outstandingRuleIds, ...retention.outstandingRuleIds]),
    upcomingReviews,
    evidenceRefs: { attemptIds: evidenceAttemptIds, sessionIds: [...eligibleSessionIds] },
  });

  return {
    ...base,
    compliance: { ...base.compliance, bySession: complianceBySession },
    dialogueCoaching: {
      ...base.dialogueCoaching,
      dimensions: dialogueDimensions,
      evidenceSessionIds: dialogueSessions.map((session) => session.id),
    },
    evidenceRefs: {
      attemptIds: evidenceAttemptIds,
      sessionIds: [...eligibleSessionIds],
      initialKnowledgeAttemptIds: initialAttempts.map((attempt) => attempt.id),
      masteryAttemptIds: knowledge.evidenceAttemptIds,
      retentionAttemptIds,
      scenarioSessionIds,
      workflowSessionIds: eligibleSessions.map((assessment) => assessment.sessionId),
      complianceSessionIds: Object.keys(complianceBySession),
      dialogueSessionIds: dialogueSessions.map((session) => session.id),
    },
  };
}
