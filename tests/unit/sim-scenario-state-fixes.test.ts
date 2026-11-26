import { describe, expect, it } from 'vitest';
import type { PublicSimScenario } from '@/lib/schemas/curriculum';
import type { SimEvaluation } from '@/lib/schemas/analytics';
import type { ScenarioState, SimulationEvent } from '@/lib/schemas/simulation-state';
import {
  appendDialogueEvent,
  applyDeterministicAssessment,
  createInitialScenarioState,
  customerDialoguePolicy,
  evaluateDeterministicGates,
} from '@/lib/services/scenario-state';
import { countsTowardDailySimLimit } from '@/lib/services/sim-session-limits';
import { finalizeScenario, toCanonicalDisposition, type ScenarioGeneration } from '@/lib/ai/prompts/sim-builder';

const scenario = {
  id: 's1', title: 'T', difficulty: 'STANDARD', counterpartyRoleLabel: 'Lead', contextTicketSummary: 'C', openingMessage: 'Hi',
  dispositionOptions: ['Recovered', 'Not interested', 'Lost'], maxTurns: 8, passScoreThreshold: 80,
  context: {
    direction: 'outbound', queue: 'recovery', product: 'NeuroCalmRx', stage: 'dosage', contactState: 'lead', pricingPosture: 'active',
    caseBranch: 'dosage_base', syntheticTimezone: 'America/Boise', syntheticNow: '2026-01-15T17:00:00.000Z', sourceRevision: 'r', curriculumVersion: 'v',
  },
  evidenceRequirements: {
    minimumLearnerTurns: 0, requiredInspections: [], requiredWorkflowActions: [], requiredWrapUpEvidence: [], requiredGateIds: [],
    requiredCustomerConcerns: [], expectedDurationMinutes: null, gateSourceRefs: {}, maximumCriticalFailures: 0, maximumMajorFailures: 0,
  },
} as PublicSimScenario;

function say(state: ScenarioState, events: SimulationEvent[], actor: 'learner' | 'customer', content: string, policy?: { optOut: boolean; clinicalRisk: boolean }) {
  const applied = appendDialogueEvent({ sessionId: 'x', state, events, actor, content, provenance: actor === 'learner' ? 'learner' : 'local_ai', customerPolicy: policy });
  return { state: applied.state, events: [...events, applied.event] };
}

describe('customer state from dialogue', () => {
  const initial = createInitialScenarioState(scenario);

  it('does not treat a hesitant "not interested" as an opt-out', () => {
    for (const line of ["I'm not interested in the price yet, tell me more.", "Honestly I'm not interested right now but maybe.", 'Remember me?']) {
      expect(say(initial, [], 'customer', line).state.optOut).toBe(false);
    }
  });

  it('opts out only on explicit phrases and records the intent on the event', () => {
    for (const line of ['Please stop calling me.', 'Remove me from your list.', "I'm not interested in the offer.", "Don't call me again."]) {
      const { state, events } = say(initial, [], 'customer', line);
      expect(state.optOut).toBe(true);
      expect(events[0]!.payload.intent).toBe('opt_out');
    }
  });

  it('never lets learner text drive customer state', () => {
    const { state } = say(initial, [], 'learner', 'If you say stop calling me I will remove you. Any severe reaction?');
    expect(state.optOut).toBe(false);
    expect(state.clinicalRiskBranch).toBeNull();
  });

  it('respects a scenario policy that does not allow opt-out or clinical branches', () => {
    const policy = { optOut: false, clinicalRisk: false };
    const { state } = say(initial, [], 'customer', 'Stop calling me. I am having a severe reaction.', policy);
    expect(state.optOut).toBe(false);
    expect(state.clinicalRiskBranch).toBeNull();
    expect(say(initial, [], 'customer', 'I take blood pressure medication.').state.clinicalRiskBranch).toBeNull();
    expect(say(initial, [], 'customer', 'I am having trouble breathing.').state.clinicalRiskBranch).toBe('reaction_or_interaction');
  });

  it('derives the policy from the secret scenario', () => {
    expect(customerDialoguePolicy({ context: { caseBranch: 'dosage_base' }, conditionalBehaviors: ['If pushed, the caller asks to be removed from the list (opt out).'] })).toEqual({ optOut: true, clinicalRisk: false });
    expect(customerDialoguePolicy({ context: { caseBranch: 'severe_reaction' }, conditionalBehaviors: [] })).toEqual({ optOut: false, clinicalRisk: true });
  });

  it('anchors the opt-out gate to the recorded intent, not loose keywords', () => {
    let run = say(initial, [], 'customer', "I'm not interested in hearing the price right now.");
    expect(evaluateDeterministicGates(scenario, run.state, run.events).some((gate) => gate.ruleId === 'opt_out')).toBe(false);
    run = say(initial, [], 'customer', 'Stop calling me.');
    expect(evaluateDeterministicGates(scenario, run.state, run.events).find((gate) => gate.ruleId === 'opt_out')).toBeDefined();
  });
});

const evaluation: SimEvaluation = {
  overallScorePct: 90, passed: true, autoFailedReason: null, dispositionCorrect: false, summaryFeedback: 'ok',
  strengthsHighlighted: [], coachingImprovements: [], criterionResults: [], evaluatedAt: 1,
};

describe('applyDeterministicAssessment', () => {
  it('keeps dispositionCorrect = judged correctness AND server validity', () => {
    const eligible = { eligible: true, reasons: [], minimumEvidenceMet: true, dispositionValid: true, deterministicCriticalFailure: false };
    const valid = { disposition: 'Lost' as const, valid: true, reasons: [] };
    expect(applyDeterministicAssessment({ evaluation, gates: [], eligibility: eligible, disposition: valid }).dispositionCorrect).toBe(false);
    expect(applyDeterministicAssessment({ evaluation: { ...evaluation, dispositionCorrect: true }, gates: [], eligibility: eligible, disposition: valid }).dispositionCorrect).toBe(true);
    const invalid = { ...valid, valid: false, reasons: ['nope'] };
    const result = applyDeterministicAssessment({ evaluation: { ...evaluation, dispositionCorrect: true }, gates: [], eligibility: eligible, disposition: invalid });
    expect(result.dispositionCorrect).toBe(false);
    expect(result.dispositionValidation).toEqual(invalid);
  });

  it('reports eligibility reasons separately instead of as an auto-fail', () => {
    const ineligible = { eligible: false, reasons: ['At least 2 learner turn(s) are required.'], minimumEvidenceMet: false, dispositionValid: true, deterministicCriticalFailure: false };
    const result = applyDeterministicAssessment({ evaluation, gates: [], eligibility: ineligible, disposition: { disposition: 'Recovered', valid: true, reasons: [] } });
    expect(result.autoFailedReason).toBeNull();
    expect(result.passed).toBe(false);
    expect(result.assessmentEligibility?.reasons).toEqual(ineligible.reasons);
  });
});

describe('daily Simulation limit counting', () => {
  it('counts only sessions with at least 2 learner replies (legacy docs still count)', () => {
    expect(countsTowardDailySimLimit({ status: 'ACTIVE', turnCount: 0 })).toBe(false);
    expect(countsTowardDailySimLimit({ status: 'ABANDONED', turnCount: 0 })).toBe(false);
    expect(countsTowardDailySimLimit({ status: 'READY_FOR_EVAL', turnCount: 0 })).toBe(false);
    expect(countsTowardDailySimLimit({ status: 'EVALUATED', turnCount: 0 })).toBe(false);
    expect(countsTowardDailySimLimit({ status: 'EVALUATED', turnCount: 1 })).toBe(false);
    expect(countsTowardDailySimLimit({ status: 'ACTIVE', turnCount: 1 })).toBe(false);
    expect(countsTowardDailySimLimit({ status: 'ACTIVE', turnCount: 2 })).toBe(true);
    expect(countsTowardDailySimLimit({ status: 'ABANDONED', turnCount: 3 })).toBe(true);
    expect(countsTowardDailySimLimit({ status: 'ACTIVE' })).toBe(true); // legacy docs
  });
});

function generation(patch: { options?: string[]; expected?: string } = {}): ScenarioGeneration {
  const criterion = (weight: number) => ({ competencyPillarId: 'p1', criterionLabel: 'L'.repeat(140), evaluationRule: 'Rule', weight, sourcePages: [1] });
  return {
    publicScenario: {
      title: 'A very long synthetic title '.repeat(6), difficulty: 'edge case', counterpartyRoleLabel: 'Lead', contextTicketSummary: 'Ticket',
      openingMessage: 'Hi', dispositionOptions: patch.options ?? ['Sale - recovered', 'Customer declined', 'Call back later'], maxTurns: '9', passScoreThreshold: 80,
    },
    secretConfig: {
      personaName: 'Dana', personaBackstoryAndMood: 'Calm', hiddenFactsToRevealOnlyWhenAsked: 'Order SYN-1', conditionalBehaviors: [], expectedDisposition: patch.expected ?? 'Sale - recovered',
      autoFailTriggers: ['x'.repeat(300)], rubricCriteria: [criterion(50), criterion(30), criterion(20)],
    },
  };
}

describe('Sim Builder finalize', () => {
  it('maps free-form dispositions onto the canonical list', () => {
    expect(toCanonicalDisposition('recovered')).toBe('Recovered');
    expect(toCanonicalDisposition('Customer declined')).toBe('Not interested');
    expect(toCanonicalDisposition('Voicemail left')).toBe("Didn't reply");
    expect(toCanonicalDisposition('Escalated to supervisor')).toBe('Escalated');
    expect(toCanonicalDisposition('Something else entirely')).toBeNull();
  });

  it('produces a runnable scenario: canonical options, trimmed text, context and evidence requirements', () => {
    const pair = finalizeScenario(generation(), 's1', { pillarIds: ['p1'], allowedPages: [1], scenarioDefaults: { divisionId: 'OUTBOUND', product: 'NeuroCalmRx', sourceRevision: 'rev-1' } });
    expect(pair.publicScenario.dispositionOptions).toEqual(['Recovered', 'Callback scheduled', 'Not interested']);
    expect(pair.secretConfig.expectedDisposition).toBe('Recovered');
    expect(pair.publicScenario.title.length).toBeLessThanOrEqual(80);
    expect(pair.publicScenario.difficulty).toBe('EDGE_CASE');
    expect(pair.publicScenario.maxTurns).toBe(9);
    expect(pair.secretConfig.autoFailTriggers[0]!.length).toBeLessThanOrEqual(180);
    expect(pair.secretConfig.hiddenFactsToRevealOnlyWhenAsked).toEqual(['Order SYN-1']);
    expect(pair.publicScenario.context).toMatchObject({ direction: 'outbound', product: 'NeuroCalmRx', sourceRevision: 'rev-1' });
    expect(pair.publicScenario.evidenceRequirements).toMatchObject({ requiredInspections: ['local_time'], requiredWorkflowActions: ['recovery_confirmed'] });
    // The fresh draft can start (no 409 SCENARIO_CONTEXT_REQUIRED).
    expect(() => createInitialScenarioState(pair.publicScenario)).not.toThrow();
  });

  it('fills to at least three canonical options', () => {
    const pair = finalizeScenario(generation({ options: ['Lost'], expected: 'Lost' }), 's2', { pillarIds: ['p1'], allowedPages: [1] });
    expect(pair.publicScenario.dispositionOptions.length).toBeGreaterThanOrEqual(3);
    expect(pair.publicScenario.dispositionOptions).toContain('Lost');
    expect(pair.publicScenario.context?.caseBranch).toContain('expired');
  });
});
