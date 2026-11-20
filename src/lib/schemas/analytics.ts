import { z } from 'zod';
import { DivisionIdSchema } from './domain';
import { ProvenanceRecordSchema } from '@/lib/ai/provenance';
import {
  DispositionValidationSchema,
  ScenarioStateSchema,
  SimulationAssessmentEligibilitySchema,
  SimulationEventSchema,
  SimulationGateResultSchema,
} from './simulation-state';

export const EnrollmentStatusSchema = z.enum(['NOT_STARTED', 'IN_PROGRESS', 'CERTIFIED']);
export type EnrollmentStatus = z.infer<typeof EnrollmentStatusSchema>;

export const UnitScoreSchema = z.object({
  firstTryAccuracyPct: z.number().min(0).max(100),
  attemptsCount: z.number().int().positive(),
  completedAt: z.number(),
});
export type UnitScore = z.infer<typeof UnitScoreSchema>;

export const EnrollmentDocSchema = z.object({
  id: z.string(), // `${userId}_${trackId}`
  userId: z.string(),
  userDisplayName: z.string(),
  partnerCohortId: z.string(),
  divisionId: DivisionIdSchema,
  trackId: z.string(),
  trackTitle: z.string(),
  versionId: z.string(),
  status: EnrollmentStatusSchema,
  completedUnitIds: z.array(z.string()),
  passedScenarioIds: z.array(z.string()),
  unitScores: z.record(z.string(), UnitScoreSchema),
  bestSimScorePct: z.number().min(0).max(100).nullable(),
  xpEarned: z.number().int().nonnegative(),
  progressPct: z.number().min(0).max(100),
  certifiedAt: z.number().nullable(),
  /** Additive audit labels; legacy enrollment assertions never satisfy versioned certification gates. */
  certificationEvidenceLabel: z.enum(['current_verified', 'historical_verified', 'historical_unverified', 'replay_excluded']).optional(),
  certificationProvenance: z.enum(['certification_register', 'legacy_enrollment']).optional(),
  lastActivityAt: z.number(),
});
export type EnrollmentDoc = z.infer<typeof EnrollmentDocSchema>;

export const SimMessageSchema = z.object({
  id: z.string(),
  role: z.enum(['counterparty', 'agent']),
  content: z.string(),
  createdAt: z.number(),
  /** Present on generated actor turns; learner turns and legacy messages remain valid without it. */
  provenance: ProvenanceRecordSchema.optional(),
  /** Learner turns only: the client idempotency key the message was sent with (retry de-duplication). */
  idempotencyKey: z.string().optional(),
});
export type SimMessage = z.infer<typeof SimMessageSchema>;

export const SimCriterionResultSchema = z.object({
  criterionId: z.string(),
  competencyPillarId: z.string(),
  criterionLabel: z.string(),
  score: z.enum(['0', '50', '100']).transform(Number).or(z.number()),
  agentQuoteEvidence: z.string(),
  evidenceEventIds: z.array(z.string()).optional(),
  coachingNote: z.string(),
  betterResponseExample: z.string().nullable(),
  /** Set when the Judge's evidence for a deduction could not be confirmed against the transcript. */
  needsTrainerReview: z.boolean().optional(),
});
export type SimCriterionResult = z.infer<typeof SimCriterionResultSchema>;

export const SimEvaluationSchema = z.object({
  overallScorePct: z.number().min(0).max(100),
  passed: z.boolean(),
  autoFailedReason: z.string().nullable(),
  dispositionCorrect: z.boolean(),
  summaryFeedback: z.string(),
  strengthsHighlighted: z.array(z.string()),
  coachingImprovements: z.array(z.string()),
  criterionResults: z.array(SimCriterionResultSchema),
  /** Server-derived controls are authoritative over every model-produced score. */
  gateResults: z.array(SimulationGateResultSchema).optional(),
  assessmentEligibility: SimulationAssessmentEligibilitySchema.optional(),
  dispositionValidation: DispositionValidationSchema.optional(),
  evidenceEventIds: z.array(z.string()).optional(),
  provenance: ProvenanceRecordSchema.optional(),
  evaluatedAt: z.number(),
});
export type SimEvaluation = z.infer<typeof SimEvaluationSchema>;

export const SimJudgeReviewSchema = z.object({
  status: z.literal('awaiting_manual_judge'),
  reason: z.enum(['ai_unavailable', 'judge_output_invalid', 'judge_timeout']),
  requestedAt: z.number(),
});
export type SimJudgeReview = z.infer<typeof SimJudgeReviewSchema>;

export const SimSessionStatusSchema = z.enum(['ACTIVE', 'READY_FOR_EVAL', 'EVALUATED', 'ABANDONED']);
export type SimSessionStatus = z.infer<typeof SimSessionStatusSchema>;

export const SimSessionDocSchema = z.object({
  id: z.string(),
  userId: z.string(),
  userDisplayName: z.string(),
  partnerCohortId: z.string(),
  divisionId: DivisionIdSchema,
  trackId: z.string(),
  versionId: z.string(),
  scenarioId: z.string(),
  scenarioTitle: z.string(),
  status: SimSessionStatusSchema,
  turnCount: z.number().int().nonnegative(),
  messages: z.array(SimMessageSchema),
  selectedDisposition: z.string().nullable(),
  evaluation: SimEvaluationSchema.nullable(),
  /** Optional for historical sessions; all new scenario runs are server-state driven. */
  scenarioState: ScenarioStateSchema.optional(),
  simulationEvents: z.array(SimulationEventSchema).optional(),
  gateResults: z.array(SimulationGateResultSchema).optional(),
  dispositionValidation: DispositionValidationSchema.optional(),
  assessmentEligibility: SimulationAssessmentEligibilitySchema.optional(),
  nextEventSequence: z.number().int().positive().optional(),
  provenance: ProvenanceRecordSchema.optional(),
  /**
   * Additive: set when the AI Judge could not score a finished call (runtime unavailable or repeated invalid
   * output). The session stays READY_FOR_EVAL with its deterministic gates and disposition saved, and a
   * Trainer scores it through the manual judge exchange.
   */
  judgeReview: SimJudgeReviewSchema.optional(),
  startedAt: z.number(),
  updatedAt: z.number(),
});
export type SimSessionDoc = z.infer<typeof SimSessionDocSchema>;

export const RollupScopeTypeSchema = z.enum(['GLOBAL', 'DIVISION', 'COHORT', 'TRACK']);
export type RollupScopeType = z.infer<typeof RollupScopeTypeSchema>;

export const PillarAggregateSchema = z.object({
  pillarLabel: z.string(),
  sampleCount: z.number().int().nonnegative(),
  scoreSum: z.number().nonnegative(),
});
export type PillarAggregate = z.infer<typeof PillarAggregateSchema>;

export const MissedItemCountSchema = z.object({
  trackId: z.string(),
  itemId: z.string(),
  itemLabel: z.string(),
  missCount: z.number().int().nonnegative(),
});
export type MissedItemCount = z.infer<typeof MissedItemCountSchema>;

/**
 * Rollup document keys:
 * - "GLOBAL"
 * - "DIVISION_TELEHEALTH" | "DIVISION_INBOUND" | "DIVISION_OUTBOUND"
 * - "COHORT_INTERNAL" | "COHORT_THS" | "COHORT_DOZ" | ...
 * - "TRACK_{trackId}"
 */
export const AnalyticsRollupDocSchema = z.object({
  id: z.string(),
  scopeType: RollupScopeTypeSchema,
  divisionId: DivisionIdSchema.nullable(),
  partnerCohortId: z.string().nullable(),
  trackId: z.string().nullable(),
  totalCertifications: z.number().int().nonnegative(),
  totalUnitCompletions: z.number().int().nonnegative(),
  totalSimAttempts: z.number().int().nonnegative(),
  totalSimPasses: z.number().int().nonnegative(),
  // Keyed by canonical pillar key (see CanonicalPillarKeySchema)
  pillarAggregates: z.record(z.string(), PillarAggregateSchema),
  // Map of `${trackId}__${itemId}` -> miss count + prompt snippet (powers Playbook Gap Detector)
  missedItemCounts: z.record(z.string(), MissedItemCountSchema),
  updatedAt: z.number(),
});
export type AnalyticsRollupDoc = z.infer<typeof AnalyticsRollupDocSchema>;

export function rollupIdForGlobal(): string {
  return 'GLOBAL';
}
export function rollupIdForDivision(divisionId: z.infer<typeof DivisionIdSchema>): string {
  return `DIVISION_${divisionId}`;
}
export function rollupIdForCohort(partnerCohortId: string): string {
  return `COHORT_${partnerCohortId}`;
}
export function rollupIdForTrack(trackId: string): string {
  return `TRACK_${trackId}`;
}
export function enrollmentIdFor(userId: string, trackId: string): string {
  return `${userId}_${trackId}`;
}
