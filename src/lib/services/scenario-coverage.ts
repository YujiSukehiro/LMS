/**
 * Pure builders for exact-version Live Call Sim coverage. Used by the evaluation transaction
 * (analytics-rollup) and by the demo seed, so both write identical evidence.
 */
import type { SimSessionDoc } from '@/lib/schemas/analytics';
import {
  ScenarioAttemptEvidenceSchema,
  ScenarioCoverageDocSchema,
  type AssessmentBlueprintDoc,
  type ScenarioAttemptEvidence,
  type ScenarioCoverageDoc,
} from '@/lib/schemas/learning';
import { evaluateScenarioSessionEvidence } from './certification';

export function scenarioCoverageDocId(learnerId: string, trackId: string, versionId: string, scenarioId: string): string {
  return `coverage_${learnerId}_${trackId}_${versionId}_${scenarioId}`;
}

/**
 * Evidence provenance for a session source. Live AI and manual sources pass through unchanged (hosted_ai included,
 * so policy decides eligibility rather than a silent relabel); anything else is unverified legacy.
 */
export function scenarioEvidenceProvenance(source: string | undefined): ScenarioAttemptEvidence['provenance'] {
  return source === 'local_ai' || source === 'hosted_ai' || source === 'manual_chat' ? source : 'imported_legacy';
}

export function scenarioAttemptEvidence(session: SimSessionDoc): ScenarioAttemptEvidence {
  const source = session.provenance?.source;
  const gates = session.evaluation?.gateResults ?? session.gateResults ?? [];
  return ScenarioAttemptEvidenceSchema.parse({
    sessionId: session.id,
    passed: session.evaluation?.passed ?? false,
    evaluatedAt: new Date(session.evaluation?.evaluatedAt ?? session.updatedAt).toISOString(),
    criticalFailureRuleIds: [...new Set(gates
      .filter((gate) => gate.severity === 'critical' && gate.status === 'fail')
      .map((gate) => gate.ruleId))],
    workflowComplete: session.scenarioState?.wrapUpComplete === true && !gates.some((gate) => gate.status === 'fail'),
    dispositionValid: session.evaluation?.dispositionCorrect === true && session.evaluation.dispositionValidation?.valid === true,
    provenance: scenarioEvidenceProvenance(source),
  });
}

/** Append `session` to the coverage row for its scenario and recompute which attempts certify. */
export function buildScenarioCoverageDoc(args: {
  learnerId: string;
  partnerCohortId: string;
  trackId: string;
  versionId: string;
  blueprint: AssessmentBlueprintDoc;
  existing: ScenarioCoverageDoc | null;
  session: SimSessionDoc;
  sessionsById: ReadonlyMap<string, SimSessionDoc>;
  now: number;
}): ScenarioCoverageDoc {
  const { session, blueprint } = args;
  const currentEvidence = scenarioAttemptEvidence(session);
  const attemptHistory = [...(args.existing?.attemptHistory ?? [])];
  if (!attemptHistory.some((item) => item.sessionId === currentEvidence.sessionId)) attemptHistory.push(currentEvidence);
  const attemptLimit = blueprint.allowedAttemptsPerScenario ?? Number.POSITIVE_INFINITY;
  const passingSessionIds = attemptHistory.flatMap((item, index) => {
    const candidate = args.sessionsById.get(item.sessionId);
    if (!candidate || index >= attemptLimit) return [];
    const assessment = evaluateScenarioSessionEvidence({
      learnerId: args.learnerId,
      blueprint,
      session: candidate,
      evidence: item,
      expectedScenarioId: session.scenarioId,
    });
    return assessment.certificationPass ? [item.sessionId] : [];
  });
  return ScenarioCoverageDocSchema.parse({
    schemaVersion: 1,
    id: scenarioCoverageDocId(args.learnerId, args.trackId, args.versionId, session.scenarioId),
    learnerId: args.learnerId,
    partnerCohortId: args.partnerCohortId,
    trackId: args.trackId,
    curriculumVersion: args.versionId,
    scenarioId: session.scenarioId,
    requiredGateIds: blueprint.requiredScenarioGates[session.scenarioId] ?? [],
    status: passingSessionIds.length > 0 ? 'passed' : attemptHistory.length > 0 ? 'remediation_required' : 'in_progress',
    attemptHistory,
    passingSessionIds: [...new Set(passingSessionIds)],
    lastSessionId: session.id,
    updatedAt: new Date(args.now).toISOString(),
  });
}
