import { describe, expect, it } from 'vitest';
import { createProvenance } from '@/lib/ai/provenance';
import {
  buildAssessmentBlueprint,
  evaluateCertificationEligibility,
  expireCertification,
  grantCertification,
  labelLegacyProgress,
  mapAssessmentContentChanges,
  planRecertification,
  revokeCertification,
} from '@/lib/services/certification';
import {
  allPassingEvidence,
  learningBlueprint,
  learningEnrollment,
  learningVersion,
  NOW,
  RULE_IDS_BY_DRILL,
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

function eligibilityInput() {
  return {
    learnerId: 'learner-1',
    blueprint: learningBlueprint(),
    enrollment: learningEnrollment(),
    ruleIdsByDrillId: RULE_IDS_BY_DRILL,
    ...passingEvidenceWithVariedMastery(),
    // Most tests check the strict mode where rule recall also gates certification; the default (GATE-03) is tested below.
    requireRuleRecall: true,
  };
}

describe('assessment blueprints and certification eligibility', () => {
  it('builds the full versioned unit, rule, scenario, gate, workflow, and threshold matrix', () => {
    const blueprint = buildAssessmentBlueprint(learningVersion(), { createdAt: NOW, certificationExpiryDays: 90 });
    expect(blueprint.requiredUnitIds).toEqual(['u1', 'u2']);
    expect(blueprint.requiredRuleIds).toEqual(['rule-privacy', 'rule-optout']);
    expect(blueprint.requiredScenarioIds).toEqual(['s-easy', 's-critical']);
    expect(blueprint.requiredScenarioGates).toEqual({ 's-easy': ['rule-privacy'], 's-critical': ['rule-optout'] });
    expect(blueprint.requiredWorkflowActions['s-critical']).toEqual(['verify_identity']);
    expect(blueprint.requiredWrapUpEvidence['s-critical']).toEqual(['note']);
    expect(blueprint.requiredCustomerConcerns).toEqual({ 's-easy': [], 's-critical': [] });
    expect(blueprint.minimumLearnerTurns).toEqual({ 's-easy': 1, 's-critical': 1 });
    expect(blueprint.passingScoreByScenario).toEqual({ 's-easy': 80, 's-critical': 80 });
  });

  it('does not let one easy scenario certify the track', () => {
    const evidence = passingEvidenceWithVariedMastery();
    const result = evaluateCertificationEligibility({
      ...eligibilityInput(),
      scenarioCoverage: [evidence.scenarioCoverage[0]],
      simSessions: [evidence.simSessions[0]],
    });
    expect(result.eligible).toBe(false);
    expect(result.scenarios.passedScenarioIds).toEqual(['s-easy']);
    expect(result.blockers).toContain('scenario_not_passed:s-critical');
    expect(() => grantCertification({
      learnerId: 'learner-1',
      partnerCohortId: 'INTERNAL',
      blueprint: learningBlueprint(),
      eligibility: result,
      actorUid: 'trainer-1',
      now: NOW,
    })).toThrow('requirements are not met');
  });

  it('grants a traceable expiring certification only after the complete matrix passes', () => {
    const blueprint = learningBlueprint();
    const eligibility = evaluateCertificationEligibility(eligibilityInput());
    expect(eligibility.eligible).toBe(true);
    const result = grantCertification({
      learnerId: 'learner-1',
      partnerCohortId: 'INTERNAL',
      blueprint,
      eligibility,
      actorUid: 'trainer-1',
      now: NOW,
    });
    expect(result.certification.status).toBe('certified');
    expect(result.certification.expiresAt).toBe('2027-01-31T12:00:00.000Z');
    expect(result.certification.evidenceAttemptIds).toEqual(['attempt-privacy', 'attempt-optout']);
    expect(result.certification.evidenceSessionIds).toEqual(['session-easy', 'session-critical']);
    expect(result.certification.history).toHaveLength(1);
  });

  it('fails closed when a required deterministic gate was not observed', () => {
    const evidence = passingEvidenceWithVariedMastery();
    const critical = structuredClone(evidence.simSessions[1]);
    critical.evaluation!.gateResults![0].status = 'not_observed';
    critical.gateResults![0].status = 'not_observed';
    const result = evaluateCertificationEligibility({
      ...eligibilityInput(),
      scenarioCoverage: evidence.scenarioCoverage,
      simSessions: [evidence.simSessions[0], critical],
    });
    expect(result.eligible).toBe(false);
    expect(result.scenarios.scenarios[1].blockers).toContain('required_gate_not_passed:rule-optout');
  });

  it('rejects a passing session reused as evidence for a different scenario', () => {
    const evidence = passingEvidenceWithVariedMastery();
    const mislabeledCoverage = scenarioCoverage({
      scenarioId: 's-critical',
      attemptHistory: [scenarioEvidence({ sessionId: 'session-easy' })],
      passingSessionIds: ['session-easy'],
    });
    const result = evaluateCertificationEligibility({
      ...eligibilityInput(),
      scenarioCoverage: [mislabeledCoverage, evidence.scenarioCoverage[0]],
      simSessions: [evidence.simSessions[0]],
    });
    expect(result.eligible).toBe(false);
    expect(result.scenarios.scenarios[1].blockers).toContain('scenario_mismatch');
  });

  it('excludes replay and unverified legacy evidence, with explicit validation for imports', () => {
    const evidence = passingEvidenceWithVariedMastery();
    const replay = { ...evidence.simSessions[1], provenance: createProvenance({ source: 'replay' }) };
    const replayResult = evaluateCertificationEligibility({ ...eligibilityInput(), simSessions: [evidence.simSessions[0], replay] });
    expect(replayResult.eligible).toBe(false);
    expect(replayResult.scenarios.scenarios[1].blockers).toContain('replay_excluded');

    const legacyCoverage = scenarioCoverage({
      scenarioId: 's-critical',
      attemptHistory: [scenarioEvidence({ sessionId: 'session-critical', provenance: 'imported_legacy' })],
    });
    const legacyResult = evaluateCertificationEligibility({
      ...eligibilityInput(),
      scenarioCoverage: [evidence.scenarioCoverage[0], legacyCoverage],
    });
    expect(legacyResult.eligible).toBe(false);
    expect(legacyResult.scenarios.scenarios[1].blockers).toContain('legacy_unverified');
    const validatedLegacy = evaluateCertificationEligibility({
      ...eligibilityInput(),
      scenarioCoverage: [evidence.scenarioCoverage[0], legacyCoverage],
      verification: { verifiedLegacySessionIds: ['session-critical'] },
    });
    expect(validatedLegacy.eligible).toBe(true);

    const importedAttempts = evidence.drillAttempts.map((attempt) => attempt.id === 'attempt-optout'
      ? { ...attempt, provenance: 'imported_legacy' as const }
      : attempt);
    expect(evaluateCertificationEligibility({ ...eligibilityInput(), drillAttempts: importedAttempts }).eligible).toBe(false);
    expect(evaluateCertificationEligibility({
      ...eligibilityInput(),
      drillAttempts: importedAttempts,
      verification: { verifiedLegacyAttemptIds: ['attempt-optout'] },
    }).eligible).toBe(true);
  });

  it('does not count immediate retries as mastery and keeps retention separately configurable', () => {
    const evidence = passingEvidenceWithVariedMastery();
    const retryOnly = evidence.drillAttempts.map((attempt) => attempt.id === 'attempt-optout'
      ? { ...attempt, attemptKind: 'immediate_retry' as const, firstIndependent: false }
      : attempt);
    expect(evaluateCertificationEligibility({ ...eligibilityInput(), drillAttempts: retryOnly }).blockers)
      .toContain('knowledge_not_mastered:rule-optout');

    const retentionBlueprint = learningBlueprint({ retentionRequired: true });
    const withoutRetention = evaluateCertificationEligibility({ ...eligibilityInput(), blueprint: retentionBlueprint });
    expect(withoutRetention.eligible).toBe(false);
    expect(withoutRetention.blockers).toEqual(expect.arrayContaining([
      'retention_not_demonstrated:rule-privacy',
      'retention_not_demonstrated:rule-optout',
    ]));
    const withRetention = evaluateCertificationEligibility({
      ...eligibilityInput(),
      blueprint: retentionBlueprint,
      drillAttempts: [
        ...evidence.drillAttempts,
        ...evidence.drillAttempts.map((attempt) => ({
          ...attempt,
          id: `${attempt.id}-retention`,
          attemptKind: 'spaced_review' as const,
          firstIndependent: false,
        })),
      ],
    });
    expect(withRetention.eligible).toBe(true);
  });

  it('by default (GATE-03) certifies on Checkpoints + every scenario; rule recall is Keep-sharp only', () => {
    const evidence = passingEvidenceWithVariedMastery();
    const noRecall = evidence.drillAttempts.map((attempt) => ({ ...attempt, attemptKind: 'immediate_retry' as const, firstIndependent: false }));
    const defaults = { ...eligibilityInput(), requireRuleRecall: undefined };
    const result = evaluateCertificationEligibility({ ...defaults, drillAttempts: noRecall, blueprint: learningBlueprint({ retentionRequired: true }) });
    expect(result.knowledge.outstandingRuleIds.length).toBeGreaterThan(0);
    expect(result.blockers).toEqual([]);
    expect(result.eligible).toBe(true);

    // A missing scenario still blocks.
    const oneScenario = evaluateCertificationEligibility({ ...defaults, scenarioCoverage: [evidence.scenarioCoverage[0]] });
    expect(oneScenario.eligible).toBe(false);
    expect(oneScenario.blockers).toContain('scenario_not_passed:s-critical');
  });

  it('requires required customer concerns in learner dialogue', () => {
    const evidence = passingEvidenceWithVariedMastery();
    const blueprint = learningBlueprint({
      requiredCustomerConcerns: { 's-easy': ['side effects'], 's-critical': [] },
    });
    const missing = evaluateCertificationEligibility({ ...eligibilityInput(), blueprint });
    expect(missing.eligible).toBe(false);
    expect(missing.scenarios.scenarios[0].blockers).toContain('required_customer_concern_missing:side effects');

    const satisfiedSession = structuredClone(evidence.simSessions[0]);
    satisfiedSession.simulationEvents![0].payload.content = 'I can help with the side effects.';
    const satisfied = evaluateCertificationEligibility({
      ...eligibilityInput(),
      blueprint,
      simSessions: [satisfiedSession, evidence.simSessions[1]],
    });
    expect(satisfied.scenarios.scenarios[0].blockers).not.toContain('required_customer_concern_missing:side effects');
    expect(satisfied.eligible).toBe(true);
  });
});

describe('certification transitions and migration', () => {
  function certified() {
    const blueprint = learningBlueprint();
    return grantCertification({
      learnerId: 'learner-1',
      partnerCohortId: 'INTERNAL',
      blueprint,
      eligibility: evaluateCertificationEligibility(eligibilityInput()),
      actorUid: 'trainer-1',
      now: NOW,
    }).certification;
  }

  it('expires and revokes with audited history', () => {
    const original = certified();
    const expired = expireCertification(original, { now: '2027-02-01T12:00:00.000Z' }).certification;
    expect(expired.status).toBe('expired');
    expect(expired.history.at(-1)).toMatchObject({ from: 'certified', to: 'expired', actorUid: 'system' });
    const revoked = revokeCertification(original, { actorUid: 'trainer-2', reason: 'Invalid assessment evidence.', now: NOW }).certification;
    expect(revoked).toMatchObject({
      status: 'revoked',
      revokedByUid: 'trainer-2',
      revocationReason: 'Invalid assessment evidence.',
    });
    expect(revoked.history).toHaveLength(2);
    expect(original.status).toBe('certified');
  });

  it('does not restore a revoked certification with unchanged eligible evidence', () => {
    const revoked = revokeCertification(certified(), {
      actorUid: 'trainer-2',
      reason: 'Invalid assessment evidence.',
      now: NOW,
    }).certification;
    const eligibility = evaluateCertificationEligibility(eligibilityInput());
    expect(eligibility.eligible).toBe(true);
    expect(() => grantCertification({
      learnerId: 'learner-1',
      partnerCohortId: 'INTERNAL',
      blueprint: learningBlueprint(),
      eligibility,
      existing: revoked,
      actorUid: 'trainer-1',
      now: NOW,
    })).toThrow('explicit trainer reinstatement');
    expect(revoked.status).toBe('revoked');
  });

  it('maps same-ID drill and scenario content changes from version fixtures', () => {
    const previous = learningVersion();
    const editorial = learningVersion({ versionId: 'v2', sourceRevision: 'source-v2-editorial' });
    expect(mapAssessmentContentChanges(previous, editorial)).toEqual({
      changedUnitIds: [],
      changedRuleIds: [],
      changedScenarioIds: [],
    });

    const next = structuredClone(editorial);
    next.units[0].drills[0] = {
      ...next.units[0].drills[0],
      prompt: 'Which synthetic order detail must be confirmed first?',
    };
    next.simScenarios[1].evidenceRequirements = {
      ...next.simScenarios[1].evidenceRequirements!,
      requiredCustomerConcerns: ['side_effects'],
    };
    expect(mapAssessmentContentChanges(previous, next)).toEqual({
      changedUnitIds: ['u1'],
      changedRuleIds: [],
      changedScenarioIds: ['s-critical'],
    });
  });

  it('ignores unrelated editorial revisions but requires targeted recertification for required changes', () => {
    const original = certified();
    const previousBlueprint = learningBlueprint();
    const editorial = learningBlueprint({ id: 'blueprint-v2', curriculumVersion: 'v2', sourceRevision: 'source-v2-editorial' });
    const editorialPlan = planRecertification({
      existing: original,
      previousBlueprint,
      nextBlueprint: editorial,
      now: NOW,
      actorUid: 'system',
    });
    expect(editorialPlan.changed).toBe(false);
    expect(editorialPlan.certification).toBe(original);

    const critical = learningBlueprint({
      id: 'blueprint-v3',
      curriculumVersion: 'v3',
      sourceRevision: 'source-v3',
      requiredRuleIds: [...previousBlueprint.requiredRuleIds, 'rule-new-critical'],
    });
    const plan = planRecertification({
      existing: original,
      previousBlueprint,
      nextBlueprint: critical,
      now: NOW,
      actorUid: 'system',
      mapping: { unitIdsByRuleId: { 'rule-new-critical': ['u2'] } },
    });
    expect(plan).toMatchObject({
      changed: true,
      reassessmentScope: 'targeted',
      affectedUnitIds: ['u2'],
      outstandingRuleIds: ['rule-new-critical'],
    });
    expect(plan.certification.status).toBe('recertification_required');
    expect(plan.certification.evidenceAttemptIds).toEqual([]);
    expect(plan.historicalCertification).toEqual(original);
    expect(plan.historicalCertification?.curriculumVersion).toBe('v1');
    expect(plan.historicalCertification?.evidenceSessionIds).toEqual(['session-easy', 'session-critical']);

    const sameIdContentChange = planRecertification({
      existing: original,
      previousBlueprint,
      nextBlueprint: editorial,
      now: NOW,
      actorUid: 'system',
      mapping: { changedRuleIds: ['rule-privacy'], unitIdsByRuleId: { 'rule-privacy': ['u1'] } },
    });
    expect(sameIdContentChange).toMatchObject({
      changed: true,
      reassessmentScope: 'targeted',
      affectedUnitIds: ['u1'],
      outstandingRuleIds: ['rule-privacy'],
    });
  });

  it('broadens reassessment when old-to-new content mapping is uncertain', () => {
    const previousBlueprint = learningBlueprint();
    const next = learningBlueprint({
      id: 'blueprint-v2',
      curriculumVersion: 'v2',
      requiredScenarioGates: { ...previousBlueprint.requiredScenarioGates, 's-critical': ['rule-optout', 'rule-new'] },
    });
    const plan = planRecertification({
      existing: certified(),
      previousBlueprint,
      nextBlueprint: next,
      now: NOW,
      actorUid: 'system',
    });
    expect(plan.reassessmentScope).toBe('full');
    expect(plan.uncertainMapping).toBe(true);
    expect(plan.affectedUnitIds).toEqual(['u1', 'u2']);
    expect(plan.affectedScenarioIds).toEqual(['s-easy', 's-critical']);
  });

  it('labels legacy unverified and replay progress without granting current credit', () => {
    expect(labelLegacyProgress({ provenance: 'imported_legacy', currentCurriculumVersion: 'v2', curriculumVersion: 'v1' }))
      .toMatchObject({ label: 'historical_unverified', countsTowardCurrentRequirements: false });
    expect(labelLegacyProgress({
      provenance: 'imported_legacy',
      currentCurriculumVersion: 'v2',
      curriculumVersion: 'v2',
      evidenceStatus: 'verified',
    })).toMatchObject({ label: 'current_verified', countsTowardCurrentRequirements: true });
    expect(labelLegacyProgress({ provenance: 'replay', currentCurriculumVersion: 'v2', evidenceStatus: 'verified' }).label)
      .toBe('replay_excluded');
  });
});
