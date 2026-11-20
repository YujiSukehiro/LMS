import { describe, expect, it } from 'vitest';
import { createProvenance } from '@/lib/ai/provenance';
import { PublicSimScenarioSchema, SecretSimScenarioConfigSchema } from '@/lib/schemas/curriculum';
import { buildAssessmentBlueprint, evaluateKnowledgeMastery } from '@/lib/services/certification';
import { appendDialogueEvent, runScenarioQAFixture } from '@/lib/services/scenario-state';
import {
  completeVerbalWrapUp,
  createVerbalScenarioState,
  evaluateVerbalPracticeGates,
  verbalAssessmentEligibility,
} from '@/lib/services/verbal-practice';
import {
  ensureVerbalScenarioDefaults,
  ensureVerbalSecretDefaults,
  normalizeCanonicalDispositions,
} from '@/lib/services/verbal-defaults';
import { drillAttempt, learningBlueprint, RULE_IDS_BY_DRILL } from './helpers/learning-service-fixtures';

describe('verbal practice normalization and evaluation', () => {
  it('normalizes canonical dispositions and clears dialer/CRM requirements', () => {
    expect(normalizeCanonicalDispositions(['unknown', 'callback scheduled', 'recovered'])).toEqual([
      'Callback scheduled',
      'Recovered',
      "Didn't reply",
    ]);

    const raw = PublicSimScenarioSchema.parse({
      id: 'sim-verbal-1',
      title: 'Refill Verbal Practice',
      difficulty: 'STANDARD',
      counterpartyRoleLabel: 'Patient',
      contextTicketSummary: 'Refill question over voice.',
      openingMessage: 'Hi, I need clarity on my NeuroCalmRx refill.',
      dispositionOptions: ['Custom A', 'Recovered', 'Lost'],
      evidenceRequirements: {
        minimumLearnerTurns: 2,
        requiredInspections: ['order_history'],
        requiredWorkflowActions: ['verify_identity', 'save_offer_step'],
        requiredWrapUpEvidence: ['note'],
        requiredGateIds: ['pre_call_inspection'],
        requiredCustomerConcerns: [],
        expectedDurationMinutes: null,
        gateSourceRefs: {},
        maximumCriticalFailures: 0,
        maximumMajorFailures: 0,
      },
    });

    const clean = ensureVerbalScenarioDefaults(raw, {
      divisionId: 'TELEHEALTH',
      product: 'NeuroCalmRx',
      sourceRevision: 'rev-1',
      curriculumVersion: 'v1',
    });
    expect(clean.evidenceRequirements?.requiredInspections).toEqual([]);
    expect(clean.evidenceRequirements?.requiredWorkflowActions).toEqual([]);
    expect(clean.evidenceRequirements?.requiredWrapUpEvidence).toEqual([]);
    expect(clean.evidenceRequirements?.requiredGateIds).toEqual([]);
    expect(clean.evidenceRequirements?.minimumLearnerTurns).toBe(2);
    expect(clean.context?.product).toBe('NeuroCalmRx');

    const secret = ensureVerbalSecretDefaults(
      clean,
      SecretSimScenarioConfigSchema.parse({
        scenarioId: clean.id,
        personaName: 'Taylor Bennett',
        personaBackstoryAndMood: 'Concerned caller.',
        hiddenFactsToRevealOnlyWhenAsked: [],
        conditionalBehaviors: [],
        expectedDisposition: 'Not In Options',
        autoFailTriggers: [],
        rubricCriteria: [
          {
            id: 'c1',
            competencyPillarId: 'p_compliance',
            criterionLabel: 'Verify identity',
            evaluationRule: 'Ask for name, DOB, and ZIP.',
            weight: 34,
            sourcePages: [1],
          },
          {
            id: 'c2',
            competencyPillarId: 'p_policy',
            criterionLabel: 'Keep non-clinical scope',
            evaluationRule: 'Refer dosing questions to Clinical Tier 2.',
            weight: 33,
            sourcePages: [1],
          },
          {
            id: 'c3',
            competencyPillarId: 'p_discovery',
            criterionLabel: 'Confirm next steps',
            evaluationRule: 'Read back callback expectations clearly.',
            weight: 33,
            sourcePages: [2],
          },
        ],
      }),
      true,
    );

    expect(clean.dispositionOptions).toContain(secret.expectedDisposition);
    expect(secret.qaFixtures).toHaveLength(2);
    for (const fixture of secret.qaFixtures ?? []) {
      const qaResult = runScenarioQAFixture(clean, fixture);
      expect(qaResult.passed).toBe(true);
    }
  });

  it('starts in_call immediately and evaluates purely on spoken turns without dialer actions', () => {
    const scenario = ensureVerbalScenarioDefaults(
      PublicSimScenarioSchema.parse({
        id: 'sim-verbal-2',
        title: 'Empathy & Verification Practice',
        difficulty: 'STANDARD',
        counterpartyRoleLabel: 'Caller',
        contextTicketSummary: 'Verbal role-play.',
        openingMessage: 'Why did my shipment stall?',
        dispositionOptions: ['Callback scheduled', 'Recovered', 'Lost'],
      }),
    );

    const state0 = createVerbalScenarioState(scenario);
    expect(state0.lifecycle).toBe('in_call');

    const e1 = appendDialogueEvent({
      sessionId: 'sess-1',
      state: state0,
      events: [],
      actor: 'customer',
      content: scenario.openingMessage,
      provenance: 'deterministic',
      eventId: 'e1',
    });
    const e2 = appendDialogueEvent({
      sessionId: 'sess-1',
      state: e1.state,
      events: [e1.event],
      actor: 'learner',
      content: 'Could you share your full name, date of birth, and ZIP code so I can check your status?',
      provenance: 'learner',
      eventId: 'e2',
    });
    const e3 = appendDialogueEvent({
      sessionId: 'sess-1',
      state: e2.state,
      events: [e1.event, e2.event],
      actor: 'learner',
      content: 'I will transfer your clinical questions to Clinical Support Tier 2 right away.',
      provenance: 'learner',
      eventId: 'e3',
    });

    const events = [e1.event, e2.event, e3.event];
    const wrapped = completeVerbalWrapUp({
      scenario,
      state: e3.state,
      events,
      selectedDisposition: 'Callback scheduled',
    });
    expect(wrapped.state.lifecycle).toBe('wrap_up');
    expect(wrapped.state.wrapUpComplete).toBe(true);
    expect(wrapped.eligibility.eligible).toBe(true);
    expect(wrapped.gates.some((g) => g.status === 'fail')).toBe(false);
    expect(wrapped.dispositionValidation.valid).toBe(true);
  });

  it('flags a spoken opt-out violation when learner continues pitching afterward', () => {
    const scenario = ensureVerbalScenarioDefaults(
      PublicSimScenarioSchema.parse({
        id: 'sim-optout',
        title: 'Opt-Out Boundary',
        difficulty: 'HIGH_PRESSURE',
        counterpartyRoleLabel: 'Caller',
        contextTicketSummary: 'Verbal role-play.',
        openingMessage: 'Please take me off your call list and stop calling me.',
        dispositionOptions: ['Not interested', 'Callback scheduled', 'Lost'],
      }),
    );
    const state0 = createVerbalScenarioState(scenario);
    const c1 = appendDialogueEvent({
      sessionId: 'sess-opt',
      state: state0,
      events: [],
      actor: 'customer',
      content: 'Stop calling me and take me off your list.',
      provenance: 'deterministic',
      eventId: 'c1',
    });
    const l1 = appendDialogueEvent({
      sessionId: 'sess-opt',
      state: c1.state,
      events: [c1.event],
      actor: 'learner',
      content: 'Wait, before you go I can still give you 50% off this plan!',
      provenance: 'learner',
      eventId: 'l1',
    });
    const gates = evaluateVerbalPracticeGates(scenario, l1.state, [c1.event, l1.event]);
    const optGate = gates.find((g) => g.ruleId === 'opt_out');
    expect(optGate?.status).toBe('fail');
    const eligibility = verbalAssessmentEligibility(scenario, l1.state, [c1.event, l1.event], gates);
    expect(eligibility.deterministicCriticalFailure).toBe(true);
    expect(eligibility.eligible).toBe(false);
  });

  it('supports optional policy flags in evaluateKnowledgeMastery without altering default varied_retrieval gate', () => {
    const blueprint = learningBlueprint();
    const initialOnly = [
      drillAttempt({ id: 'a1', attemptKind: 'initial', correct: true }),
      drillAttempt({ id: 'a2', unitId: 'u2', drillId: 'u2-d1', attemptKind: 'initial', correct: true }),
    ];
    const strict = evaluateKnowledgeMastery({
      learnerId: 'learner-1',
      blueprint,
      drillAttempts: initialOnly,
      ruleIdsByDrillId: RULE_IDS_BY_DRILL,
    });
    expect(strict.masteredRuleIds).toEqual([]);

    const sameSitting = evaluateKnowledgeMastery({
      learnerId: 'learner-1',
      blueprint,
      drillAttempts: initialOnly,
      ruleIdsByDrillId: RULE_IDS_BY_DRILL,
      masteryPolicy: { allowInitialCorrect: true },
    });
    expect(sameSitting.masteredRuleIds).toEqual(['rule-privacy', 'rule-optout']);

    const spacedOnly = evaluateKnowledgeMastery({
      learnerId: 'learner-1',
      blueprint,
      drillAttempts: initialOnly.map((a) => ({ ...a, attemptKind: 'spaced_review' as const, provenance: 'live' })),
      ruleIdsByDrillId: RULE_IDS_BY_DRILL,
      masteryPolicy: { allowSpacedReviewAsMastery: true },
    });
    expect(spacedOnly.masteredRuleIds).toEqual(['rule-privacy', 'rule-optout']);
    expect(buildAssessmentBlueprint).toBeDefined();
    expect(createProvenance).toBeDefined();
  });
});
