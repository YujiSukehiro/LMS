import { describe, expect, it } from 'vitest';
import { createProvenance } from '@/lib/ai/provenance';
import {
  evaluateCertificationEligibility,
  grantCertification,
} from '@/lib/services/certification';
import { applyDeterministicAssessment } from '@/lib/services/scenario-state';
import {
  allPassingEvidence,
  learningBlueprint,
  learningEnrollment,
  NOW,
  RULE_IDS_BY_DRILL,
} from './helpers/learning-service-fixtures';

function passingCertificationInput() {
  const evidence = allPassingEvidence();
  return {
    learnerId: 'learner-1',
    blueprint: learningBlueprint(),
    enrollment: learningEnrollment(),
    ruleIdsByDrillId: RULE_IDS_BY_DRILL,
    scenarioCoverage: evidence.scenarioCoverage,
    simSessions: evidence.simSessions,
    drillAttempts: evidence.drillAttempts.map((attempt) => ({
      ...attempt,
      attemptKind: 'varied_retrieval' as const,
      firstIndependent: false,
    })),
  };
}

describe('golden certification release regressions', () => {
  it('does not let replay provenance nested in an otherwise live evidence chain certify', () => {
    const input = passingCertificationInput();
    expect(evaluateCertificationEligibility(input).eligible).toBe(true);

    const replay = structuredClone(input.simSessions[1]);
    replay.messages[1]!.provenance = createProvenance({
      source: 'replay',
      provider: 'replay',
      model: 'Demo replay',
    });
    const eligibility = evaluateCertificationEligibility({
      ...input,
      simSessions: [input.simSessions[0], replay],
    });

    expect(eligibility.eligible).toBe(false);
    expect(eligibility.scenarios.scenarios[1].blockers).toContain('replay_excluded');
    expect(() => grantCertification({
      learnerId: input.learnerId,
      partnerCohortId: 'INTERNAL',
      blueprint: input.blueprint,
      eligibility,
      actorUid: 'trainer-release',
      now: NOW,
    })).toThrow('requirements are not met');
  });

  it('carries a deterministic critical failure through a perfect judge result to certification denial', () => {
    const input = passingCertificationInput();
    const critical = structuredClone(input.simSessions[1]);
    const perfectJudge = {
      ...critical.evaluation!,
      overallScorePct: 100,
      passed: true,
      autoFailedReason: null,
    };
    const failedGate = { ...critical.gateResults![0]!, status: 'fail' as const };
    critical.evaluation = applyDeterministicAssessment({
      evaluation: perfectJudge,
      gates: [failedGate],
      eligibility: {
        eligible: false,
        reasons: ['A deterministic critical rule failed.'],
        minimumEvidenceMet: true,
        dispositionValid: true,
        deterministicCriticalFailure: true,
      },
      disposition: perfectJudge.dispositionValidation!,
    });
    critical.gateResults = [failedGate];

    const eligibility = evaluateCertificationEligibility({
      ...input,
      simSessions: [input.simSessions[0], critical],
    });

    expect(eligibility.eligible).toBe(false);
    expect(eligibility.scenarios.scenarios[1].blockers).toEqual(expect.arrayContaining([
      'critical_failure',
      'required_gate_not_passed:rule-optout',
    ]));
    expect(() => grantCertification({
      learnerId: input.learnerId,
      partnerCohortId: 'INTERNAL',
      blueprint: input.blueprint,
      eligibility,
      actorUid: 'trainer-release',
      now: NOW,
    })).toThrow('requirements are not met');
  });
});
