import type { ProvenanceSource } from '@/lib/ai/provenance';
import type { EnrollmentDoc, SimSessionDoc } from '@/lib/schemas/analytics';
import type { TrackVersionDoc } from '@/lib/schemas/curriculum';
import {
  AssessmentBlueprintDocSchema,
  CertificationDocSchema,
  type AssessmentBlueprintDoc,
  type CertificationDoc,
  type CertificationStatus,
  type CertificationTransition,
  type DrillAttemptDoc,
  type ScenarioAttemptEvidence,
  type ScenarioCoverageDoc,
} from '@/lib/schemas/learning';

export type IsoDateInput = string | Date;

export interface AssessmentBlueprintPolicy {
  id?: string;
  sourceRevision?: string;
  policyVersion?: string;
  createdAt: IsoDateInput;
  allowedAttemptsPerScenario?: number | null;
  remediationGuidance?: string;
  retentionRequired?: boolean;
  certificationExpiryDays?: number | null;
}

export interface EvidenceVerificationPolicy {
  /** Explicit server/trainer validation is required before imported attempts can count. */
  verifiedLegacyAttemptIds?: readonly string[];
  /** Explicit server/trainer validation is required before imported sessions can count. */
  verifiedLegacySessionIds?: readonly string[];
}

export interface KnowledgeMasteryPolicy {
  minimumCorrectAttemptsPerRule?: number;
}

export interface RetentionPolicy {
  /** Defaults to the blueprint's retentionRequired flag. */
  required?: boolean;
  minimumCorrectReviewsPerRule?: number;
}

export interface RuleKnowledgeEvaluation {
  masteredRuleIds: string[];
  outstandingRuleIds: string[];
  correctAttemptsByRule: Record<string, number>;
  evidenceAttemptIds: string[];
  eligibleAttemptIds: string[];
}

export interface RetentionEvaluation {
  required: boolean;
  retainedRuleIds: string[];
  outstandingRuleIds: string[];
  correctReviewsByRule: Record<string, number>;
  evidenceAttemptIds: string[];
}

export interface ScenarioSessionEvaluation {
  sessionId: string;
  scenarioId: string;
  /** Current, non-replay, sufficiently structured evidence; it may still contain failures. */
  evidenceEligible: boolean;
  /** Eligible evidence that also satisfies every certification gate. */
  certificationPass: boolean;
  reasons: string[];
  criticalFailureRuleIds: string[];
  workflowClean: boolean;
  evaluatedAt: string | null;
}

export interface ScenarioCoverageEvaluation {
  scenarioId: string;
  status: ScenarioCoverageDoc['status'];
  passed: boolean;
  passingSessionId: string | null;
  attemptHistory: ScenarioAttemptEvidence[];
  assessments: ScenarioSessionEvaluation[];
  blockers: string[];
}

export interface ScenarioCoverageEvaluationResult {
  allPassed: boolean;
  passedScenarioIds: string[];
  missingScenarioIds: string[];
  scenarios: ScenarioCoverageEvaluation[];
  evidenceSessionIds: string[];
}

export interface CertificationEligibility {
  eligible: boolean;
  blockers: string[];
  knowledge: RuleKnowledgeEvaluation;
  retention: RetentionEvaluation;
  scenarios: ScenarioCoverageEvaluationResult;
  evidenceAttemptIds: string[];
  evidenceSessionIds: string[];
}

export interface CertificationTransitionResult {
  certification: CertificationDoc;
  /** Populated when a new current record supersedes a historical certified version. */
  historicalCertification: CertificationDoc | null;
}

export interface CurriculumChangeMapping {
  /** Explicit content-diff results for required changes that retain stable IDs. */
  changedUnitIds?: readonly string[];
  changedRuleIds?: readonly string[];
  changedScenarioIds?: readonly string[];
  /** Old unit ID to new unit ID; null explicitly confirms removal. */
  unitIdMap?: Readonly<Record<string, string | null>>;
  /** Old scenario ID to new scenario ID; null explicitly confirms removal. */
  scenarioIdMap?: Readonly<Record<string, string | null>>;
  /** Stable rule ID to affected unit IDs in the new blueprint. */
  unitIdsByRuleId?: Readonly<Record<string, readonly string[]>>;
  assessmentModelChanged?: boolean;
}

export interface RecertificationPlan extends CertificationTransitionResult {
  changed: boolean;
  reassessmentScope: 'none' | 'targeted' | 'full';
  uncertainMapping: boolean;
  affectedUnitIds: string[];
  affectedScenarioIds: string[];
  outstandingRuleIds: string[];
}

export type LegacyProgressLabel =
  | 'current_verified'
  | 'historical_verified'
  | 'historical_unverified'
  | 'replay_excluded';

export interface LegacyProgressMigration {
  label: LegacyProgressLabel;
  countsTowardCurrentRequirements: boolean;
  reason: string;
}

const LIVE_SESSION_SOURCES = new Set<ProvenanceSource>(['local_ai', 'manual_chat']);
const EVALUATION_SOURCES = new Set<ProvenanceSource>(['local_ai', 'manual_chat', 'deterministic', 'trainer_override']);

function isoDate(value: IsoDateInput): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('A valid ISO timestamp is required.');
  return date.toISOString();
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function addDays(value: IsoDateInput, days: number): string {
  return new Date(Date.parse(isoDate(value)) + days * 86_400_000).toISOString();
}

function sameMembers(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && new Set(left).size === left.length && left.every((value) => right.includes(value));
}

function copyCertification(certification: CertificationDoc): CertificationDoc {
  return {
    ...certification,
    evidenceAttemptIds: [...certification.evidenceAttemptIds],
    evidenceSessionIds: [...certification.evidenceSessionIds],
    history: certification.history.map((entry) => ({ ...entry })),
  };
}

function transitionEntry(
  from: CertificationStatus,
  to: CertificationStatus,
  curriculumVersion: string,
  at: IsoDateInput,
  actorUid: string,
  reason: string,
): CertificationTransition {
  if (!actorUid.trim() || !reason.trim()) throw new Error('Certification transitions require an actor and reason.');
  return { from, to, at: isoDate(at), actorUid, reason, curriculumVersion };
}

function isReplaySession(session: SimSessionDoc): boolean {
  return (
    session.provenance?.source === 'replay' ||
    session.evaluation?.provenance?.source === 'replay' ||
    session.messages.some((message) => message.provenance?.source === 'replay') ||
    Boolean(session.simulationEvents?.some((event) => event.provenance === 'replay' || event.runtimeProvenance?.source === 'replay'))
  );
}

function isVerifiedLegacy(id: string, policy?: EvidenceVerificationPolicy): boolean {
  return policy?.verifiedLegacySessionIds?.includes(id) ?? false;
}

/** Current-version drill eligibility. Imports are excluded unless independently validated. */
export function isEligibleDrillAttempt(
  attempt: DrillAttemptDoc,
  args: {
    learnerId: string;
    blueprint: Pick<AssessmentBlueprintDoc, 'trackId' | 'curriculumVersion' | 'requiredUnitIds'>;
    verification?: EvidenceVerificationPolicy;
  },
): boolean {
  if (
    attempt.learnerId !== args.learnerId ||
    attempt.trackId !== args.blueprint.trackId ||
    attempt.curriculumVersion !== args.blueprint.curriculumVersion ||
    !args.blueprint.requiredUnitIds.includes(attempt.unitId)
  ) {
    return false;
  }
  if (attempt.provenance === 'live') return true;
  return args.verification?.verifiedLegacyAttemptIds?.includes(attempt.id) ?? false;
}

/** Build the complete assessment matrix; no scenario or required rule is selectively sampled. */
export function buildAssessmentBlueprint(
  version: TrackVersionDoc,
  policy: AssessmentBlueprintPolicy,
): AssessmentBlueprintDoc {
  const sourceRevision = policy.sourceRevision ?? version.sourceRevision;
  if (!sourceRevision) throw new Error('A sourceRevision is required to build an assessment blueprint.');
  if (version.requiredRuleIds === undefined) throw new Error('Stable requiredRuleIds are required to build an assessment blueprint.');
  for (const scenario of version.simScenarios) {
    if (!scenario.evidenceRequirements) {
      throw new Error(`Scenario ${scenario.id} is missing required assessment evidence requirements.`);
    }
  }

  const requiredUnitIds = [...version.units]
    .sort((left, right) => left.orderIndex - right.orderIndex)
    .map((unit) => unit.id);
  const requiredScenarioIds = version.simScenarios.map((scenario) => scenario.id);
  const requiredScenarioGates: Record<string, string[]> = {};
  const requiredWorkflowActions: Record<string, string[]> = {};
  const requiredWrapUpEvidence: Record<string, string[]> = {};
  const requiredCustomerConcerns: Record<string, string[]> = {};
  const minimumLearnerTurns: Record<string, number> = {};
  const passingScoreByScenario: Record<string, number> = {};

  for (const scenario of version.simScenarios) {
    const requirements = scenario.evidenceRequirements!;
    requiredScenarioGates[scenario.id] = unique(requirements.requiredGateIds);
    requiredWorkflowActions[scenario.id] = unique(requirements.requiredWorkflowActions);
    requiredWrapUpEvidence[scenario.id] = unique(requirements.requiredWrapUpEvidence);
    requiredCustomerConcerns[scenario.id] = unique(requirements.requiredCustomerConcerns);
    minimumLearnerTurns[scenario.id] = requirements.minimumLearnerTurns;
    passingScoreByScenario[scenario.id] = scenario.passScoreThreshold;
  }

  return AssessmentBlueprintDocSchema.parse({
    schemaVersion: 1,
    id: policy.id ?? `assessment_${version.trackId}_${version.versionId}`,
    trackId: version.trackId,
    curriculumVersion: version.versionId,
    sourceRevision,
    requiredUnitIds: unique(requiredUnitIds),
    requiredRuleIds: unique(version.requiredRuleIds ?? []),
    requiredScenarioIds: unique(requiredScenarioIds),
    requiredScenarioGates,
    requiredWorkflowActions,
    requiredWrapUpEvidence,
    requiredCustomerConcerns,
    minimumLearnerTurns,
    passingScoreByScenario,
    allowedAttemptsPerScenario: policy.allowedAttemptsPerScenario ?? null,
    remediationGuidance: policy.remediationGuidance ?? 'Review the cited source rules and repeat each outstanding scenario.',
    retentionRequired: policy.retentionRequired ?? false,
    certificationExpiryDays: policy.certificationExpiryDays ?? null,
    policyVersion: policy.policyVersion ?? '1',
    createdAt: isoDate(policy.createdAt),
  });
}

export function evaluateKnowledgeMastery(args: {
  learnerId: string;
  blueprint: AssessmentBlueprintDoc;
  drillAttempts: readonly DrillAttemptDoc[];
  /** Approved curriculum mapping; misconceptionRuleIds are feedback, not a coverage mapping. */
  ruleIdsByDrillId: Readonly<Record<string, readonly string[]>>;
  masteryPolicy?: KnowledgeMasteryPolicy;
  verification?: EvidenceVerificationPolicy;
}): RuleKnowledgeEvaluation {
  const minimum = args.masteryPolicy?.minimumCorrectAttemptsPerRule ?? 1;
  if (!Number.isInteger(minimum) || minimum < 1) throw new Error('Mastery requires at least one correct attempt per rule.');
  const eligibleAttempts = args.drillAttempts.filter((attempt) =>
    isEligibleDrillAttempt(attempt, {
      learnerId: args.learnerId,
      blueprint: args.blueprint,
      verification: args.verification,
    }),
  );
  const correctAttemptsByRule: Record<string, number> = {};
  const evidenceAttemptIds = new Set<string>();

  for (const ruleId of args.blueprint.requiredRuleIds) {
    const supportingAttempts = eligibleAttempts.filter(
      (attempt) =>
        attempt.attemptKind === 'varied_retrieval' &&
        attempt.correct &&
        args.ruleIdsByDrillId[attempt.drillId]?.includes(ruleId),
    );
    correctAttemptsByRule[ruleId] = supportingAttempts.length;
    supportingAttempts.forEach((attempt) => evidenceAttemptIds.add(attempt.id));
  }

  const masteredRuleIds = args.blueprint.requiredRuleIds.filter((ruleId) => correctAttemptsByRule[ruleId] >= minimum);
  return {
    masteredRuleIds,
    outstandingRuleIds: args.blueprint.requiredRuleIds.filter((ruleId) => !masteredRuleIds.includes(ruleId)),
    correctAttemptsByRule,
    evidenceAttemptIds: [...evidenceAttemptIds],
    eligibleAttemptIds: eligibleAttempts.map((attempt) => attempt.id),
  };
}

export function evaluateRetention(args: {
  learnerId: string;
  blueprint: AssessmentBlueprintDoc;
  drillAttempts: readonly DrillAttemptDoc[];
  ruleIdsByDrillId: Readonly<Record<string, readonly string[]>>;
  retentionPolicy?: RetentionPolicy;
  verification?: EvidenceVerificationPolicy;
}): RetentionEvaluation {
  const required = args.retentionPolicy?.required ?? args.blueprint.retentionRequired;
  const minimum = args.retentionPolicy?.minimumCorrectReviewsPerRule ?? 1;
  if (!Number.isInteger(minimum) || minimum < 1) throw new Error('Retention requires at least one correct review per rule.');
  const eligibleAttempts = args.drillAttempts.filter(
    (attempt) =>
      attempt.attemptKind === 'spaced_review' &&
      attempt.correct &&
      isEligibleDrillAttempt(attempt, {
        learnerId: args.learnerId,
        blueprint: args.blueprint,
        verification: args.verification,
      }),
  );
  const correctReviewsByRule: Record<string, number> = {};
  const evidenceAttemptIds = new Set<string>();
  for (const ruleId of args.blueprint.requiredRuleIds) {
    const reviews = eligibleAttempts.filter((attempt) => args.ruleIdsByDrillId[attempt.drillId]?.includes(ruleId));
    correctReviewsByRule[ruleId] = reviews.length;
    reviews.forEach((attempt) => evidenceAttemptIds.add(attempt.id));
  }
  const retainedRuleIds = args.blueprint.requiredRuleIds.filter((ruleId) => correctReviewsByRule[ruleId] >= minimum);
  return {
    required,
    retainedRuleIds,
    outstandingRuleIds: required
      ? args.blueprint.requiredRuleIds.filter((ruleId) => !retainedRuleIds.includes(ruleId))
      : [],
    correctReviewsByRule,
    evidenceAttemptIds: [...evidenceAttemptIds],
  };
}

function missingWrapUpEvidence(session: SimSessionDoc, required: readonly string[]): string[] {
  const state = session.scenarioState;
  if (!state) return [...required];
  return required.filter((evidence) => {
    if (evidence === 'note') return state.noteReceiptIds.length === 0;
    if (evidence === 'suppression') return !state.suppressionRecorded;
    if (evidence === 'escalation') return state.escalationReceiptIds.length === 0;
    if (evidence === 'callback') return state.callbackAt === null;
    return true;
  });
}

/**
 * Cross-check a coverage claim with server session evidence. A failed attempt can still be eligible
 * analytics evidence, but certificationPass is true only when every deterministic requirement passes.
 */
export function evaluateScenarioSessionEvidence(args: {
  learnerId: string;
  blueprint: AssessmentBlueprintDoc;
  session: SimSessionDoc;
  evidence: ScenarioAttemptEvidence;
  /** Coverage row being evaluated; prevents cross-scenario session reuse. */
  expectedScenarioId?: string;
  verification?: EvidenceVerificationPolicy;
}): ScenarioSessionEvaluation {
  const { session, evidence, blueprint } = args;
  const reasons = new Set<string>();
  const gates = session.evaluation?.gateResults ?? session.gateResults;
  const criticalFailureRuleIds = unique([
    ...evidence.criticalFailureRuleIds,
    ...(gates ?? []).filter((gate) => gate.severity === 'critical' && gate.status === 'fail').map((gate) => gate.ruleId),
  ]);
  const requiredWorkflow = blueprint.requiredWorkflowActions[session.scenarioId] ?? [];
  const requiredWrapUp = blueprint.requiredWrapUpEvidence[session.scenarioId] ?? [];
  const missingWorkflow = session.scenarioState
    ? requiredWorkflow.filter((actionId) => !session.scenarioState!.workflowActionIds.includes(actionId))
    : [...requiredWorkflow];
  const missingWrapUp = missingWrapUpEvidence(session, requiredWrapUp);
  const workflowClean =
    missingWorkflow.length === 0 &&
    missingWrapUp.length === 0 &&
    session.scenarioState?.wrapUpComplete === true &&
    Boolean(gates) &&
    !gates!.some((gate) => gate.status === 'fail');
  const evaluatedAt = session.evaluation ? new Date(session.evaluation.evaluatedAt).toISOString() : null;

  if (
    evidence.sessionId !== session.id ||
    !blueprint.requiredScenarioIds.includes(session.scenarioId) ||
    (args.expectedScenarioId !== undefined && session.scenarioId !== args.expectedScenarioId)
  ) {
    reasons.add('scenario_mismatch');
  }
  if (
    session.userId !== args.learnerId ||
    session.trackId !== blueprint.trackId ||
    session.versionId !== blueprint.curriculumVersion
  ) {
    reasons.add('not_current_learner_version');
  }
  if (isReplaySession(session)) reasons.add('replay_excluded');
  const sessionSource = session.provenance?.source;
  if (!sessionSource || !LIVE_SESSION_SOURCES.has(sessionSource)) reasons.add('session_provenance_unverified');
  if (!session.evaluation?.provenance || !EVALUATION_SOURCES.has(session.evaluation.provenance.source)) {
    reasons.add('evaluation_provenance_unverified');
  }
  if (evidence.provenance === 'imported_legacy') {
    if (!isVerifiedLegacy(session.id, args.verification)) reasons.add('legacy_unverified');
  } else if (evidence.provenance !== sessionSource) {
    reasons.add('evidence_provenance_mismatch');
  }
  if (session.status !== 'EVALUATED' || !session.evaluation) reasons.add('evaluation_missing');
  if (!session.evaluation?.assessmentEligibility) reasons.add('assessment_eligibility_missing');
  if (!session.scenarioState || !session.simulationEvents || !gates) reasons.add('deterministic_evidence_missing');
  if (!session.evaluation?.dispositionValidation) reasons.add('canonical_disposition_missing');

  const evidenceEligible = reasons.size === 0;
  const eligibility = session.evaluation?.assessmentEligibility;
  const disposition = session.evaluation?.dispositionValidation;
  const selectedDisposition = session.scenarioState?.selectedDisposition;
  if (!evidence.passed || !session.evaluation?.passed || session.evaluation.autoFailedReason !== null) reasons.add('attempt_not_passed');
  if (session.evaluation && session.evaluation.overallScorePct < blueprint.passingScoreByScenario[session.scenarioId]) {
    reasons.add('score_below_threshold');
  }
  if (!eligibility?.eligible || !eligibility.minimumEvidenceMet || eligibility.deterministicCriticalFailure) {
    reasons.add('deterministic_assessment_ineligible');
  }
  if (criticalFailureRuleIds.length > 0) reasons.add('critical_failure');
  if (!evidence.workflowComplete || !workflowClean) reasons.add('workflow_evidence_incomplete');
  if (
    !evidence.dispositionValid ||
    !session.evaluation?.dispositionCorrect ||
    !disposition?.valid ||
    !selectedDisposition ||
    disposition.disposition !== selectedDisposition ||
    session.selectedDisposition !== selectedDisposition
  ) {
    reasons.add('canonical_disposition_invalid');
  }
  for (const gateId of blueprint.requiredScenarioGates[session.scenarioId] ?? []) {
    if (gates?.find((gate) => gate.ruleId === gateId)?.status !== 'pass') reasons.add(`required_gate_not_passed:${gateId}`);
  }
  if (missingWorkflow.length > 0) reasons.add('required_workflow_missing');
  if (missingWrapUp.length > 0) reasons.add('required_wrapup_missing');
  const learnerUtterances = session.simulationEvents?.filter((event) => event.actor === 'learner' && event.type === 'utterance') ?? [];
  const learnerTurns = learnerUtterances.length;
  if (learnerTurns < (blueprint.minimumLearnerTurns[session.scenarioId] ?? 0)) reasons.add('minimum_turns_not_met');
  const dialogue = learnerUtterances.map((event) => {
    const text = event.payload.text ?? event.payload.content;
    return typeof text === 'string' ? text.toLowerCase() : '';
  }).join(' ');
  for (const concern of blueprint.requiredCustomerConcerns[session.scenarioId] ?? []) {
    const requiredPhrase = concern.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!requiredPhrase || !dialogue.includes(requiredPhrase)) reasons.add(`required_customer_concern_missing:${concern}`);
  }

  return {
    sessionId: session.id,
    scenarioId: session.scenarioId,
    evidenceEligible,
    certificationPass: evidenceEligible && reasons.size === 0,
    reasons: [...reasons],
    criticalFailureRuleIds,
    workflowClean,
    evaluatedAt,
  };
}

export function evaluateScenarioCoverage(args: {
  learnerId: string;
  blueprint: AssessmentBlueprintDoc;
  scenarioCoverage: readonly ScenarioCoverageDoc[];
  simSessions: readonly SimSessionDoc[];
  verification?: EvidenceVerificationPolicy;
}): ScenarioCoverageEvaluationResult {
  const sessionsById = new Map(args.simSessions.map((session) => [session.id, session]));
  const scenarios = args.blueprint.requiredScenarioIds.map((scenarioId): ScenarioCoverageEvaluation => {
    const coverage = args.scenarioCoverage.find(
      (candidate) =>
        candidate.learnerId === args.learnerId &&
        candidate.trackId === args.blueprint.trackId &&
        candidate.curriculumVersion === args.blueprint.curriculumVersion &&
        candidate.scenarioId === scenarioId,
    );
    if (!coverage) {
      return {
        scenarioId,
        status: 'not_started',
        passed: false,
        passingSessionId: null,
        attemptHistory: [],
        assessments: [],
        blockers: ['coverage_missing'],
      };
    }
    const assessments = coverage.attemptHistory.flatMap((evidence) => {
      const session = sessionsById.get(evidence.sessionId);
      return session
        ? [evaluateScenarioSessionEvidence({
            learnerId: args.learnerId,
            blueprint: args.blueprint,
            session,
            evidence,
            expectedScenarioId: scenarioId,
            verification: args.verification,
          })]
        : [];
    });
    const attemptLimit = args.blueprint.allowedAttemptsPerScenario ?? Number.POSITIVE_INFINITY;
    const passing = assessments.find((assessment) => {
      const attemptIndex = coverage.attemptHistory.findIndex((evidence) => evidence.sessionId === assessment.sessionId);
      return attemptIndex < attemptLimit && assessment.certificationPass && coverage.passingSessionIds.includes(assessment.sessionId);
    });
    const blockers: string[] = [];
    if (coverage.attemptHistory.length === 0) blockers.push('scenario_evidence_missing');
    if (assessments.length < coverage.attemptHistory.length) blockers.push('session_evidence_missing');
    if (!passing) {
      blockers.push('no_eligible_passing_attempt');
      const latest = assessments.at(-1);
      if (latest) blockers.push(...latest.reasons);
    }
    return {
      scenarioId,
      status: passing ? 'passed' : coverage.status === 'passed' ? 'remediation_required' : coverage.status,
      passed: Boolean(passing),
      passingSessionId: passing?.sessionId ?? null,
      attemptHistory: [...coverage.attemptHistory],
      assessments,
      blockers: unique(blockers),
    };
  });
  const passedScenarioIds = scenarios.filter((scenario) => scenario.passed).map((scenario) => scenario.scenarioId);
  return {
    allPassed: passedScenarioIds.length === args.blueprint.requiredScenarioIds.length,
    passedScenarioIds,
    missingScenarioIds: scenarios.filter((scenario) => !scenario.passed).map((scenario) => scenario.scenarioId),
    scenarios,
    evidenceSessionIds: scenarios.flatMap((scenario) => scenario.passingSessionId ? [scenario.passingSessionId] : []),
  };
}

export function evaluateCertificationEligibility(args: {
  learnerId: string;
  blueprint: AssessmentBlueprintDoc;
  enrollment: EnrollmentDoc | null;
  drillAttempts: readonly DrillAttemptDoc[];
  scenarioCoverage: readonly ScenarioCoverageDoc[];
  simSessions: readonly SimSessionDoc[];
  ruleIdsByDrillId: Readonly<Record<string, readonly string[]>>;
  masteryPolicy?: KnowledgeMasteryPolicy;
  retentionPolicy?: RetentionPolicy;
  verification?: EvidenceVerificationPolicy;
  trainerApprovalRequired?: boolean;
  trainerApproved?: boolean;
}): CertificationEligibility {
  const knowledge = evaluateKnowledgeMastery(args);
  const retention = evaluateRetention(args);
  const scenarios = evaluateScenarioCoverage(args);
  const blockers: string[] = [];
  if (
    !args.enrollment ||
    args.enrollment.userId !== args.learnerId ||
    args.enrollment.trackId !== args.blueprint.trackId ||
    args.enrollment.versionId !== args.blueprint.curriculumVersion
  ) {
    blockers.push('current_enrollment_missing');
  } else {
    const completed = new Set(args.enrollment.completedUnitIds);
    const missingUnits = args.blueprint.requiredUnitIds.filter((unitId) => !completed.has(unitId));
    if (missingUnits.length > 0) blockers.push(...missingUnits.map((unitId) => `required_unit_incomplete:${unitId}`));
  }
  if (knowledge.outstandingRuleIds.length > 0) blockers.push(...knowledge.outstandingRuleIds.map((ruleId) => `knowledge_not_mastered:${ruleId}`));
  if (retention.outstandingRuleIds.length > 0) blockers.push(...retention.outstandingRuleIds.map((ruleId) => `retention_not_demonstrated:${ruleId}`));
  if (!scenarios.allPassed) blockers.push(...scenarios.missingScenarioIds.map((scenarioId) => `scenario_not_passed:${scenarioId}`));
  if (args.trainerApprovalRequired && args.trainerApproved !== true) blockers.push('trainer_approval_required');
  return {
    eligible: blockers.length === 0,
    blockers,
    knowledge,
    retention,
    scenarios,
    evidenceAttemptIds: unique([...knowledge.evidenceAttemptIds, ...(retention.required ? retention.evidenceAttemptIds : [])]),
    evidenceSessionIds: scenarios.evidenceSessionIds,
  };
}

export function grantCertification(args: {
  learnerId: string;
  partnerCohortId: string;
  blueprint: AssessmentBlueprintDoc;
  eligibility: CertificationEligibility;
  actorUid: string;
  now: IsoDateInput;
  reason?: string;
  existing?: CertificationDoc | null;
}): CertificationTransitionResult {
  if (!args.eligibility.eligible) throw new Error(`Certification requirements are not met: ${args.eligibility.blockers.join(', ')}`);
  const now = isoDate(args.now);
  const existing = args.existing;
  if (existing?.status === 'revoked') {
    throw new Error('A revoked certification requires an explicit trainer reinstatement decision; unchanged evidence cannot restore it.');
  }
  if (
    existing?.status === 'certified' &&
    existing.blueprintId === args.blueprint.id &&
    existing.curriculumVersion === args.blueprint.curriculumVersion &&
    (!existing.expiresAt || Date.parse(existing.expiresAt) > Date.parse(now))
  ) {
    return { certification: existing, historicalCertification: null };
  }
  const from = existing?.status ?? 'not_started';
  const certification = CertificationDocSchema.parse({
    schemaVersion: 1,
    id: existing?.id ?? `certification_${args.learnerId}_${args.blueprint.trackId}`,
    learnerId: args.learnerId,
    partnerCohortId: args.partnerCohortId,
    trackId: args.blueprint.trackId,
    curriculumVersion: args.blueprint.curriculumVersion,
    blueprintId: args.blueprint.id,
    sourceRevision: args.blueprint.sourceRevision,
    status: 'certified',
    certifiedAt: now,
    expiresAt: args.blueprint.certificationExpiryDays ? addDays(now, args.blueprint.certificationExpiryDays) : null,
    recertificationRequiredAt: null,
    revokedAt: null,
    revokedByUid: null,
    revocationReason: null,
    evidenceAttemptIds: unique(args.eligibility.evidenceAttemptIds),
    evidenceSessionIds: unique(args.eligibility.evidenceSessionIds),
    history: [
      ...(existing?.history ?? []),
      transitionEntry(from, 'certified', args.blueprint.curriculumVersion, now, args.actorUid, args.reason ?? 'All versioned assessment requirements met.'),
    ],
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });
  return { certification, historicalCertification: null };
}

export function expireCertification(
  existing: CertificationDoc,
  args: { now: IsoDateInput; actorUid?: string; reason?: string },
): CertificationTransitionResult {
  const now = isoDate(args.now);
  if (existing.status !== 'certified' || !existing.expiresAt || Date.parse(existing.expiresAt) > Date.parse(now)) {
    return { certification: existing, historicalCertification: null };
  }
  return {
    certification: CertificationDocSchema.parse({
      ...existing,
      status: 'expired',
      history: [
        ...existing.history,
        transitionEntry('certified', 'expired', existing.curriculumVersion, now, args.actorUid ?? 'system', args.reason ?? 'Certification expiry reached.'),
      ],
      updatedAt: now,
    }),
    historicalCertification: null,
  };
}

export function revokeCertification(
  existing: CertificationDoc,
  args: { actorUid: string; reason: string; now: IsoDateInput },
): CertificationTransitionResult {
  if (existing.status === 'revoked') return { certification: existing, historicalCertification: null };
  const now = isoDate(args.now);
  return {
    certification: CertificationDocSchema.parse({
      ...existing,
      status: 'revoked',
      revokedAt: now,
      revokedByUid: args.actorUid,
      revocationReason: args.reason,
      history: [
        ...existing.history,
        transitionEntry(existing.status, 'revoked', existing.curriculumVersion, now, args.actorUid, args.reason),
      ],
      updatedAt: now,
    }),
    historicalCertification: null,
  };
}

/** Conservative same-ID content diff: changed assessment material always triggers recertification. */
export function mapAssessmentContentChanges(
  previous: TrackVersionDoc,
  next: TrackVersionDoc,
): CurriculumChangeMapping {
  const nextUnits = new Map(next.units.map((unit) => [unit.id, unit]));
  const nextScenarios = new Map(next.simScenarios.map((scenario) => [scenario.id, scenario]));
  const changedUnitIds = previous.units.filter((unit) => {
    const candidate = nextUnits.get(unit.id);
    return !candidate || JSON.stringify(unit.drills) !== JSON.stringify(candidate.drills);
  }).map((unit) => unit.id);
  const changedScenarioIds = previous.simScenarios.filter((scenario) => {
    const candidate = nextScenarios.get(scenario.id);
    return !candidate || JSON.stringify(scenario) !== JSON.stringify(candidate);
  }).map((scenario) => scenario.id);
  const changedRuleIds = unique(previous.units.filter((unit) => changedUnitIds.includes(unit.id)).flatMap((unit) =>
    unit.drills.flatMap((drill) => [
      ...(drill.ruleIds ?? []),
      ...((drill.ruleIds ?? []).length === 0 ? (drill.evidence ?? []).flatMap((evidence) => evidence.ruleIds) : []),
    ])));
  return { changedUnitIds, changedRuleIds, changedScenarioIds };
}

function blueprintRequirementChanges(
  previous: AssessmentBlueprintDoc,
  next: AssessmentBlueprintDoc,
  mapping?: CurriculumChangeMapping,
) {
  const changedUnitIds = unique([
    ...previous.requiredUnitIds.filter((id) => !next.requiredUnitIds.includes(id)),
    ...next.requiredUnitIds.filter((id) => !previous.requiredUnitIds.includes(id)),
    ...(mapping?.changedUnitIds ?? []),
  ]);
  const changedRuleIds = unique([
    ...previous.requiredRuleIds.filter((id) => !next.requiredRuleIds.includes(id)),
    ...next.requiredRuleIds.filter((id) => !previous.requiredRuleIds.includes(id)),
    ...(mapping?.changedRuleIds ?? []),
  ]);
  const changedScenarioIds = unique([
    ...previous.requiredScenarioIds.filter((id) => !next.requiredScenarioIds.includes(id)),
    ...next.requiredScenarioIds.filter((id) => !previous.requiredScenarioIds.includes(id)),
    ...next.requiredScenarioIds.filter((id) =>
      !sameMembers(previous.requiredScenarioGates[id] ?? [], next.requiredScenarioGates[id] ?? []) ||
      !sameMembers(previous.requiredWorkflowActions[id] ?? [], next.requiredWorkflowActions[id] ?? []) ||
      !sameMembers(previous.requiredWrapUpEvidence[id] ?? [], next.requiredWrapUpEvidence[id] ?? []) ||
      !sameMembers(previous.requiredCustomerConcerns[id] ?? [], next.requiredCustomerConcerns[id] ?? []) ||
      previous.minimumLearnerTurns[id] !== next.minimumLearnerTurns[id] ||
      previous.passingScoreByScenario[id] !== next.passingScoreByScenario[id]
    ),
    ...(mapping?.changedScenarioIds ?? []),
  ]);
  const assessmentModelChanged =
    previous.allowedAttemptsPerScenario !== next.allowedAttemptsPerScenario ||
    previous.retentionRequired !== next.retentionRequired;
  return { changedUnitIds, changedRuleIds, changedScenarioIds, assessmentModelChanged };
}

/**
 * Diff assessment requirements, not prose/sourceRevision. Editorial-only publications leave a valid
 * certification untouched. A versioned recertification returns the original record unchanged as a snapshot.
 */
export function planRecertification(args: {
  existing: CertificationDoc;
  previousBlueprint: AssessmentBlueprintDoc;
  nextBlueprint: AssessmentBlueprintDoc;
  now: IsoDateInput;
  actorUid: string;
  reason?: string;
  mapping?: CurriculumChangeMapping;
}): RecertificationPlan {
  const unchanged: RecertificationPlan = {
    certification: args.existing,
    historicalCertification: null,
    changed: false,
    reassessmentScope: 'none',
    uncertainMapping: false,
    affectedUnitIds: [],
    affectedScenarioIds: [],
    outstandingRuleIds: [],
  };
  if (args.existing.status !== 'certified') return unchanged;
  const changes = blueprintRequirementChanges(args.previousBlueprint, args.nextBlueprint, args.mapping);
  const changed = changes.changedUnitIds.length + changes.changedRuleIds.length + changes.changedScenarioIds.length > 0 || changes.assessmentModelChanged;
  if (!changed) return unchanged;

  const affectedUnitIds = new Set<string>();
  const affectedScenarioIds = new Set<string>();
  let uncertainMapping = args.mapping?.assessmentModelChanged === true || changes.assessmentModelChanged;
  for (const oldId of changes.changedUnitIds) {
    if (args.nextBlueprint.requiredUnitIds.includes(oldId)) affectedUnitIds.add(oldId);
    if (args.previousBlueprint.requiredUnitIds.includes(oldId)) {
      const mapped = args.mapping?.unitIdMap?.[oldId];
      if (mapped === undefined) uncertainMapping = true;
      else if (mapped !== null) affectedUnitIds.add(mapped);
    }
  }
  for (const oldId of changes.changedScenarioIds) {
    if (args.nextBlueprint.requiredScenarioIds.includes(oldId)) affectedScenarioIds.add(oldId);
    if (args.previousBlueprint.requiredScenarioIds.includes(oldId)) {
      const mapped = args.mapping?.scenarioIdMap?.[oldId];
      if (mapped === undefined) uncertainMapping = true;
      else if (mapped !== null) affectedScenarioIds.add(mapped);
    }
  }
  for (const ruleId of changes.changedRuleIds) {
    const mappedUnits = args.mapping?.unitIdsByRuleId?.[ruleId];
    if (mappedUnits === undefined) uncertainMapping = true;
    else mappedUnits.forEach((unitId) => affectedUnitIds.add(unitId));
  }
  if (uncertainMapping) {
    args.nextBlueprint.requiredUnitIds.forEach((unitId) => affectedUnitIds.add(unitId));
    args.nextBlueprint.requiredScenarioIds.forEach((scenarioId) => affectedScenarioIds.add(scenarioId));
  }

  const now = isoDate(args.now);
  const historicalCertification = copyCertification(args.existing);
  const certification = CertificationDocSchema.parse({
    ...args.existing,
    id: `${args.existing.id}:${args.nextBlueprint.curriculumVersion}`,
    curriculumVersion: args.nextBlueprint.curriculumVersion,
    blueprintId: args.nextBlueprint.id,
    sourceRevision: args.nextBlueprint.sourceRevision,
    status: 'recertification_required',
    certifiedAt: null,
    expiresAt: null,
    recertificationRequiredAt: now,
    revokedAt: null,
    revokedByUid: null,
    revocationReason: null,
    evidenceAttemptIds: [],
    evidenceSessionIds: [],
    history: [
      ...args.existing.history,
      transitionEntry(
        args.existing.status,
        'recertification_required',
        args.nextBlueprint.curriculumVersion,
        now,
        args.actorUid,
        args.reason ?? (uncertainMapping ? 'Assessment requirements changed with uncertain content mapping.' : 'Required assessment content changed.'),
      ),
    ],
    createdAt: now,
    updatedAt: now,
  });
  return {
    certification,
    historicalCertification,
    changed: true,
    reassessmentScope: uncertainMapping ? 'full' : 'targeted',
    uncertainMapping,
    affectedUnitIds: args.nextBlueprint.requiredUnitIds.filter((unitId) => affectedUnitIds.has(unitId)),
    affectedScenarioIds: args.nextBlueprint.requiredScenarioIds.filter((scenarioId) => affectedScenarioIds.has(scenarioId)),
    outstandingRuleIds: changes.changedRuleIds,
  };
}

/** Label migrated progress without silently converting legacy assertions into verified evidence. */
export function labelLegacyProgress(args: {
  provenance: ProvenanceSource | 'live' | 'imported_legacy';
  currentCurriculumVersion: string;
  curriculumVersion?: string | null;
  evidenceStatus?: 'verified' | 'unverified' | 'historical_unverified';
}): LegacyProgressMigration {
  if (args.provenance === 'replay') {
    return { label: 'replay_excluded', countsTowardCurrentRequirements: false, reason: 'Replay evidence is inspection-only.' };
  }
  const status = args.evidenceStatus ?? 'historical_unverified';
  if (status !== 'verified') {
    return {
      label: 'historical_unverified',
      countsTowardCurrentRequirements: false,
      reason: status === 'historical_unverified' ? 'Legacy evidence is insufficiently verified.' : 'Evidence has not been validated.',
    };
  }
  if (!args.curriculumVersion || args.curriculumVersion !== args.currentCurriculumVersion) {
    return { label: 'historical_verified', countsTowardCurrentRequirements: false, reason: 'Verified evidence belongs to another curriculum version.' };
  }
  return { label: 'current_verified', countsTowardCurrentRequirements: true, reason: 'Verified evidence matches the current curriculum version.' };
}
