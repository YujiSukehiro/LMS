import { z } from 'zod';

export const CurriculumVersionSchema = z.string().min(1).max(200);
export const AttemptKindSchema = z.enum(['initial', 'immediate_retry', 'varied_retrieval', 'spaced_review']);
export type AttemptKind = z.infer<typeof AttemptKindSchema>;

export const DrillAnswerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('MULTIPLE_CHOICE'), optionId: z.string().min(1).max(200) }).strict(),
  z.object({ kind: z.literal('TRUE_FALSE_SPOT'), isCompliant: z.boolean() }).strict(),
  z.object({ kind: z.literal('SEQUENCE_ORDER'), orderedStepIds: z.array(z.string().min(1).max(200)).min(3).max(5) }).strict(),
  z.object({ kind: z.literal('MATCH_PAIRS'), matches: z.record(z.string().min(1).max(200), z.string().min(1).max(200)) }).strict(),
  z.object({ kind: z.literal('FILL_BLANK_CHOICE'), word: z.string().min(1).max(60) }).strict(),
]);
export type DrillAnswer = z.infer<typeof DrillAnswerSchema>;

const LearnerDrillBase = {
  id: z.string(),
  competencyPillarId: z.string(),
  prompt: z.string().max(300),
  ruleIds: z.array(z.string().min(1)).default([]),
  variationOfDrillId: z.string().nullable().optional(),
};

/** Learner-safe Drill DTOs: no correct option, canonical sequence, pair mapping, or hidden rationale. */
export const LearnerDrillSchema = z.discriminatedUnion('kind', [
  z.object({
    ...LearnerDrillBase,
    kind: z.literal('MULTIPLE_CHOICE'),
    options: z.array(z.object({ id: z.string(), text: z.string().max(180) })).length(4),
  }).strict(),
  z.object({
    ...LearnerDrillBase,
    kind: z.literal('TRUE_FALSE_SPOT'),
    statement: z.string().max(260),
  }).strict(),
  z.object({
    ...LearnerDrillBase,
    kind: z.literal('SEQUENCE_ORDER'),
    steps: z.array(z.object({ id: z.string(), text: z.string().max(140) })).min(3).max(5),
  }).strict(),
  z.object({
    ...LearnerDrillBase,
    kind: z.literal('MATCH_PAIRS'),
    leftOptions: z.array(z.object({ id: z.string(), text: z.string().max(100) })).min(3).max(4),
    rightOptions: z.array(z.object({ id: z.string(), text: z.string().max(100) })).min(3).max(4),
  }).strict(),
  z.object({
    ...LearnerDrillBase,
    kind: z.literal('FILL_BLANK_CHOICE'),
    sentenceTemplate: z.string().max(260),
    wordBank: z.array(z.string().max(60)).length(4),
  }).strict(),
]);
export type LearnerDrill = z.infer<typeof LearnerDrillSchema>;
export type LearnerDrillKind = LearnerDrill['kind'];

export const DrillAttemptStartDocSchema = z.object({
  id: z.string().min(1),
  learnerId: z.string().min(1),
  trackId: z.string().min(1),
  unitId: z.string().min(1),
  drillId: z.string().min(1),
  curriculumVersion: CurriculumVersionSchema,
  startedAt: z.string().datetime(),
  consumedAt: z.string().datetime().nullable(),
});
export type DrillAttemptStartDoc = z.infer<typeof DrillAttemptStartDocSchema>;

export const DrillAttemptDocSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  learnerId: z.string().min(1),
  partnerCohortId: z.string().min(1),
  trackId: z.string().min(1),
  unitId: z.string().min(1),
  drillId: z.string().min(1),
  curriculumVersion: CurriculumVersionSchema,
  attemptNumber: z.number().int().positive(),
  attemptKind: AttemptKindSchema,
  answer: DrillAnswerSchema,
  correct: z.boolean(),
  score: z.number().min(0).max(100),
  firstIndependent: z.boolean(),
  misconceptionRuleIds: z.array(z.string().min(1)),
  startId: z.string().min(1),
  requestHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  startedAt: z.string().datetime(),
  submittedAt: z.string().datetime(),
  durationMs: z.number().int().min(0).max(1_800_000),
  provenance: z.enum(['live', 'imported_legacy']),
});
export type DrillAttemptDoc = z.infer<typeof DrillAttemptDocSchema>;

export const ReviewScheduleDocSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  learnerId: z.string().min(1),
  trackId: z.string().min(1),
  unitId: z.string().min(1),
  drillId: z.string().min(1),
  curriculumVersion: CurriculumVersionSchema,
  ruleIds: z.array(z.string().min(1)),
  nextAttemptKind: z.enum(['varied_retrieval', 'spaced_review']),
  dueAt: z.string().datetime(),
  intervalIndex: z.number().int().min(0).max(3),
  independent: z.boolean(),
  lastAttemptId: z.string().min(1).nullable(),
  lastAttemptKind: AttemptKindSchema.nullable().optional(),
  lastResult: z.enum(['correct', 'incorrect']).nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ReviewScheduleDoc = z.infer<typeof ReviewScheduleDocSchema>;

export const AssessmentBlueprintDocSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  trackId: z.string().min(1),
  curriculumVersion: CurriculumVersionSchema,
  sourceRevision: z.string().min(1),
  requiredUnitIds: z.array(z.string().min(1)),
  requiredRuleIds: z.array(z.string().min(1)),
  requiredScenarioIds: z.array(z.string().min(1)),
  requiredScenarioGates: z.record(z.string(), z.array(z.string().min(1))),
  requiredWorkflowActions: z.record(z.string(), z.array(z.string().min(1))),
  requiredWrapUpEvidence: z.record(z.string(), z.array(z.string().min(1))),
  requiredCustomerConcerns: z.record(z.string(), z.array(z.string().min(1))).default({}),
  minimumLearnerTurns: z.record(z.string(), z.number().int().nonnegative()),
  passingScoreByScenario: z.record(z.string(), z.number().min(0).max(100)),
  allowedAttemptsPerScenario: z.number().int().positive().nullable(),
  remediationGuidance: z.string().max(2_000),
  retentionRequired: z.boolean(),
  certificationExpiryDays: z.number().int().positive().nullable(),
  policyVersion: z.string().min(1),
  createdAt: z.string().datetime(),
});
export type AssessmentBlueprintDoc = z.infer<typeof AssessmentBlueprintDocSchema>;

export const ScenarioAttemptEvidenceSchema = z.object({
  sessionId: z.string().min(1),
  passed: z.boolean(),
  evaluatedAt: z.string().datetime(),
  criticalFailureRuleIds: z.array(z.string().min(1)),
  workflowComplete: z.boolean(),
  dispositionValid: z.boolean(),
  /** `hosted_ai` (Gemini) is kept as-is; whether it certifies is TRAINING_POLICY.allowHostedAiForCertification. */
  provenance: z.enum(['local_ai', 'hosted_ai', 'manual_chat', 'imported_legacy']),
});
export type ScenarioAttemptEvidence = z.infer<typeof ScenarioAttemptEvidenceSchema>;

export const ScenarioCoverageDocSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  learnerId: z.string().min(1),
  partnerCohortId: z.string().min(1),
  trackId: z.string().min(1),
  curriculumVersion: CurriculumVersionSchema,
  scenarioId: z.string().min(1),
  requiredGateIds: z.array(z.string().min(1)),
  status: z.enum(['not_started', 'in_progress', 'passed', 'remediation_required']),
  attemptHistory: z.array(ScenarioAttemptEvidenceSchema),
  passingSessionIds: z.array(z.string().min(1)),
  lastSessionId: z.string().min(1).nullable(),
  updatedAt: z.string().datetime(),
});
export type ScenarioCoverageDoc = z.infer<typeof ScenarioCoverageDocSchema>;

export const CertificationStatusSchema = z.enum([
  'not_started',
  'in_progress',
  'ready_for_trainer_review',
  'certified',
  'recertification_required',
  'expired',
  'revoked',
]);
export type CertificationStatus = z.infer<typeof CertificationStatusSchema>;

export const CertificationTransitionSchema = z.object({
  from: CertificationStatusSchema,
  to: CertificationStatusSchema,
  at: z.string().datetime(),
  actorUid: z.string().min(1),
  reason: z.string().min(1).max(1_000),
  curriculumVersion: CurriculumVersionSchema,
});
export type CertificationTransition = z.infer<typeof CertificationTransitionSchema>;

export const CertificationDocSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  learnerId: z.string().min(1),
  partnerCohortId: z.string().min(1),
  trackId: z.string().min(1),
  curriculumVersion: CurriculumVersionSchema,
  blueprintId: z.string().min(1),
  sourceRevision: z.string().min(1),
  status: CertificationStatusSchema,
  certifiedAt: z.string().datetime().nullable(),
  expiresAt: z.string().datetime().nullable(),
  recertificationRequiredAt: z.string().datetime().nullable(),
  revokedAt: z.string().datetime().nullable(),
  revokedByUid: z.string().min(1).nullable(),
  revocationReason: z.string().max(1_000).nullable(),
  evidenceAttemptIds: z.array(z.string().min(1)),
  evidenceSessionIds: z.array(z.string().min(1)),
  history: z.array(CertificationTransitionSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type CertificationDoc = z.infer<typeof CertificationDocSchema>;

const RatioMetricSchema = <T extends z.ZodRawShape>(shape: T) => z.object({
  ...shape,
  ratio: z.number().min(0).max(1).nullable(),
});

export const LearningAnalyticsSchema = z.object({
  trackId: z.string().min(1),
  curriculumVersion: CurriculumVersionSchema,
  contentCompletion: RatioMetricSchema({ completed: z.number().int().nonnegative(), total: z.number().int().nonnegative() }),
  initialKnowledge: RatioMetricSchema({ correct: z.number().int().nonnegative(), total: z.number().int().nonnegative() }),
  currentMastery: RatioMetricSchema({ mastered: z.number().int().nonnegative(), total: z.number().int().nonnegative() }),
  delayedRetention: RatioMetricSchema({
    correct: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
    due: z.number().int().nonnegative(),
  }),
  scenarioCoverage: RatioMetricSchema({ passed: z.number().int().nonnegative(), total: z.number().int().nonnegative() }),
  workflowAccuracy: RatioMetricSchema({ clean: z.number().int().nonnegative(), total: z.number().int().nonnegative() }),
  compliance: z.object({
    criticalFailureCount: z.number().int().nonnegative(),
    byRule: z.record(z.string(), z.number().int().nonnegative()),
  }),
  dialogueCoaching: z.object({
    averageScore: z.number().min(0).max(100).nullable(),
    evaluatedAttempts: z.number().int().nonnegative(),
  }),
  recency: z.object({
    lastEligibleAttemptAt: z.string().datetime().nullable(),
    curriculumVersion: CurriculumVersionSchema.nullable(),
  }),
  evidenceConfidence: z.enum(['insufficient', 'emerging', 'adequate']),
  certificationStatus: CertificationStatusSchema,
  outstandingRuleIds: z.array(z.string().min(1)),
  upcomingReviews: z.array(ReviewScheduleDocSchema),
  evidenceRefs: z.object({
    attemptIds: z.array(z.string().min(1)),
    sessionIds: z.array(z.string().min(1)),
  }),
});
export type LearningAnalytics = z.infer<typeof LearningAnalyticsSchema>;
