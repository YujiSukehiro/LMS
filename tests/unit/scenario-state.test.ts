import { describe, expect, it } from 'vitest';
import type { PublicSimScenario } from '@/lib/schemas/curriculum';
import type { SimulationAction, SimulationEvent, ScenarioState } from '@/lib/schemas/simulation-state';
import {
  FAKE_PAYMENT_TOKENS,
  applyDeterministicAssessment,
  applySimulationAction,
  appendDialogueEvent,
  assessmentEligibility,
  createInitialScenarioState,
  evaluateDeterministicGates,
  validateDisposition,
} from '@/lib/services/scenario-state';

function scenario(patch: {
  id?: string;
  context?: Partial<NonNullable<PublicSimScenario['context']>>;
  evidence?: Partial<NonNullable<PublicSimScenario['evidenceRequirements']>>;
} = {}): PublicSimScenario {
  return {
    id: patch.id ?? 'NC-DOSAGE-BASE',
    title: 'Synthetic scenario',
    difficulty: 'STANDARD',
    counterpartyRoleLabel: 'Synthetic lead',
    contextTicketSummary: 'SYNTHETIC TRAINING',
    openingMessage: 'Hello.',
    dispositionOptions: ['Recovered', 'Callback scheduled', "Didn't reply", 'Not interested', 'Organic', 'Lost'],
    maxTurns: 8,
    passScoreThreshold: 80,
    context: {
      direction: 'outbound',
      queue: 'recovery',
      product: 'NeuroCalmRx',
      stage: 'dosage',
      contactState: 'lead',
      pricingPosture: 'active',
      caseBranch: 'dosage_base',
      syntheticTimezone: 'America/Boise',
      syntheticNow: '2026-01-15T17:00:00.000Z',
      sourceRevision: 'synthetic-source-revision',
      curriculumVersion: 'synthetic-curriculum-v1',
      ...patch.context,
    },
    evidenceRequirements: {
      minimumLearnerTurns: 2,
      requiredInspections: ['product_stage', 'local_time'],
      requiredWorkflowActions: ['recovery_confirmed'],
      requiredWrapUpEvidence: ['note'],
      requiredGateIds: ['local_time', 'correct_link', 'recording_disclosure'],
      requiredCustomerConcerns: [],
      expectedDurationMinutes: 8,
      gateSourceRefs: {},
      maximumCriticalFailures: 0,
      maximumMajorFailures: 0,
      ...patch.evidence,
    },
  };
}

function run(start: ScenarioState, definition: PublicSimScenario, actions: SimulationAction[], initialEvents: SimulationEvent[] = []) {
  let state = start;
  let events = initialEvents;
  const outboxes = [];
  for (const action of actions) {
    const applied = applySimulationAction({ sessionId: 'synthetic-session', scenario: definition, state, events, action });
    state = applied.state;
    events = [...events, applied.event];
    if (applied.outboxRecord) outboxes.push(applied.outboxRecord);
  }
  return { state, events, outboxes };
}

function utterances(definition: PublicSimScenario, state: ScenarioState, events: SimulationEvent[], texts: string[]) {
  let nextState = state;
  let nextEvents = events;
  for (const content of texts) {
    const applied = appendDialogueEvent({ sessionId: 'synthetic-session', state: nextState, events: nextEvents, actor: 'learner', content, provenance: 'learner' });
    nextState = applied.state;
    nextEvents = [...nextEvents, applied.event];
  }
  return { state: nextState, events: nextEvents };
}

const preCall: SimulationAction[] = [{ type: 'inspect', inspectionId: 'product_stage' }, { type: 'inspect', inspectionId: 'local_time' }, { type: 'dial' }];

function passingRun() {
  const definition = scenario();
  const initial = createInitialScenarioState(definition);
  const connected = run(initial, definition, [...preCall, { type: 'record_disclosure' }]);
  const spoken = utterances(definition, connected.state, connected.events, [
    'I will explain the plan clearly and answer your process questions.',
    'With your permission, I will use the approved next step.',
  ]);
  const finished = run(spoken.state, definition, [
    { type: 'grant_sms_permission' },
    { type: 'send_sms', assetId: 'neurocalmrx-dosage-link' },
    { type: 'workflow', actionId: 'recovery_confirmed' },
    { type: 'note', text: 'Synthetic call outcome recorded.' },
    { type: 'wrap_up', disposition: 'Recovered' },
  ], spoken.events);
  return { definition, ...finished };
}

describe('server-owned scenario lifecycle and evidence', () => {
  it('fails closed when a new scenario lacks context', () => {
    expect(() => createInitialScenarioState({})).toThrow(/context and evidence checklist/);
  });

  it('supports a complete evidence-producing golden pass', () => {
    const result = passingRun();
    expect(result.state.lifecycle).toBe('wrap_up');
    expect(assessmentEligibility(result.definition, result.state, result.events).eligible).toBe(true);
    expect(result.outboxes).toHaveLength(1);
    expect(result.outboxes[0]!.displayText).toContain('SYNTHETIC TRAINING');
    expect(new Set(result.events.map((event) => event.id)).size).toBe(result.events.length);
    expect(result.events.map((event) => event.sequence)).toEqual(result.events.map((_, index) => index + 1));
    expect(result.events.every((event) => event.stateHash.startsWith('sha256:'))).toBe(true);
  });

  it('requires wrap-up, minimum turns, and workflow evidence', () => {
    const definition = scenario();
    const connected = run(createInitialScenarioState(definition), definition, preCall);
    const gates = evaluateDeterministicGates(definition, connected.state, connected.events);
    const eligibility = assessmentEligibility(definition, connected.state, connected.events, gates);
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.reasons.join(' ')).toMatch(/wrap-up|learner turn|workflow/);
  });

  it('blocks a dial at 21:05 lead-local time with critical evidence', () => {
    const definition = scenario({ context: { syntheticNow: '2026-01-16T04:05:00.000Z' } });
    const result = run(createInitialScenarioState(definition), definition, preCall);
    expect(result.state.lifecycle).toBe('ready_to_dial');
    expect(evaluateDeterministicGates(definition, result.state, result.events).find((gate) => gate.ruleId === 'local_time')?.status).toBe('fail');
  });

  it('records an incorrect initial disposition and prevents Recovered without confirmation', () => {
    const definition = scenario();
    const connected = run(createInitialScenarioState(definition), definition, preCall);
    const result = run(connected.state, definition, [{ type: 'wrap_up', disposition: 'Recovered' }], connected.events);
    expect(result.state.lifecycle).toBe('in_call');
    expect(result.events.at(-1)?.payload.status).toBe('blocked');
    expect(validateDisposition(result.state, 'Recovered').valid).toBe(false);
  });
});

describe('deterministic link, offer, privacy, and clinical gates', () => {
  it('fails a dosage call that selects the checkout asset', () => {
    const definition = scenario();
    const connected = run(createInitialScenarioState(definition), definition, [...preCall, { type: 'grant_sms_permission' }, { type: 'send_sms', assetId: 'neurocalmrx-checkout-link' }]);
    expect(evaluateDeterministicGates(definition, connected.state, connected.events).find((gate) => gate.ruleId === 'correct_link')?.status).toBe('fail');
  });

  it('blocks voicemail SMS and produces no outbox message', () => {
    const definition = scenario({ context: { contactState: 'voicemail' }, evidence: { requiredWorkflowActions: [], requiredWrapUpEvidence: [], minimumLearnerTurns: 0, requiredGateIds: ['voicemail_sms'] } });
    const result = run(createInitialScenarioState(definition), definition, [...preCall, { type: 'send_sms', assetId: 'neurocalmrx-dosage-link' }]);
    expect(result.outboxes).toHaveLength(0);
    expect(evaluateDeterministicGates(definition, result.state, result.events).find((gate) => gate.ruleId === 'voicemail_sms')?.status).toBe('fail');
  });

  it('fails unsolicited NAD+ Score pricing', () => {
    const definition = scenario({ context: { product: 'NAD+', stage: 'score', caseBranch: 'score_passive', pricingPosture: 'passive' }, evidence: { requiredGateIds: ['pricing_passive'] } });
    const connected = run(createInitialScenarioState(definition), definition, preCall);
    const spoken = utterances(definition, connected.state, connected.events, ['The price is $199 per month.']);
    expect(evaluateDeterministicGates(definition, spoken.state, spoken.events).find((gate) => gate.ruleId === 'pricing_passive')?.status).toBe('fail');
  });

  it('rejects generic NAD+ results and ZoliraRx checkout hosts', () => {
    for (const [product, stage, assetId] of [['NAD+', 'score', 'generic-results'], ['ZoliraRx', 'checkout', 'generic-checkout']] as const) {
      const definition = scenario({ context: { product, stage, caseBranch: `${product}-link` }, evidence: { requiredGateIds: ['correct_link'] } });
      const result = run(createInitialScenarioState(definition), definition, [...preCall, { type: 'grant_sms_permission' }, { type: 'send_sms', assetId }]);
      expect(evaluateDeterministicGates(definition, result.state, result.events).find((gate) => gate.ruleId === 'correct_link')?.status).toBe('fail');
    }
  });

  it('fails a TriShot upgrade before base commitment', () => {
    const definition = scenario({ context: { product: 'TriShot', stage: 'dosage_checkout', caseBranch: 'trishot_upgrade' }, evidence: { requiredGateIds: ['upgrade_sequence'] } });
    const result = run(createInitialScenarioState(definition), definition, [...preCall, { type: 'offer', assetId: 'trishot-upgrade-12' }]);
    expect(evaluateDeterministicGates(definition, result.state, result.events).find((gate) => gate.ruleId === 'upgrade_sequence')?.status).toBe('fail');
  });

  it('fails a third offer attempt', () => {
    const definition = scenario({ evidence: { requiredGateIds: ['offer_limit'] } });
    const result = run(createInitialScenarioState(definition), definition, [...preCall, { type: 'offer', assetId: 'base' }, { type: 'offer', assetId: 'reoffer' }, { type: 'offer', assetId: 'third-pressure' }]);
    expect(evaluateDeterministicGates(definition, result.state, result.events).find((gate) => gate.ruleId === 'offer_limit')?.status).toBe('fail');
  });

  it('fails ED safety reassurance and NAD+ illness interpretation', () => {
    for (const [product, branch, text] of [['TriShot', 'interaction_stop', 'Yes, it is safe with nitrates.'], ['NAD+', 'score_not_diagnosis', 'You have a serious illness.']] as const) {
      const definition = scenario({ context: { product, caseBranch: branch }, evidence: { requiredGateIds: ['clinical_boundary'] } });
      const connected = run(createInitialScenarioState(definition), definition, preCall);
      const spoken = utterances(definition, connected.state, connected.events, [text]);
      expect(evaluateDeterministicGates(definition, spoken.state, spoken.events).find((gate) => gate.ruleId === 'clinical_boundary')?.status).toBe('fail');
    }
  });

  it('fails a severe-reaction sales action before 911 guidance', () => {
    const definition = scenario({ context: { direction: 'inbound', queue: 'customer_support', stage: 'support_case', contactState: 'existing_patient', caseBranch: 'severe_reaction' }, evidence: { requiredInspections: [], requiredGateIds: ['severe_reaction'] } });
    const result = run(createInitialScenarioState(definition), definition, [{ type: 'dial' }, { type: 'offer', assetId: 'retention' }]);
    expect(evaluateDeterministicGates(definition, result.state, result.events).find((gate) => gate.ruleId === 'severe_reaction')?.status).toBe('fail');
  });

  it('fails a retention offer on repeat cancellation', () => {
    const definition = scenario({ context: { direction: 'inbound', queue: 'customer_support', stage: 'support_case', contactState: 'existing_patient', caseBranch: 'repeat_cancel' }, evidence: { requiredInspections: [], requiredGateIds: ['repeat_cancellation'] } });
    const result = run(createInitialScenarioState(definition), definition, [{ type: 'dial' }, { type: 'offer', assetId: 'discount' }]);
    expect(evaluateDeterministicGates(definition, result.state, result.events).find((gate) => gate.ruleId === 'repeat_cancellation')?.status).toBe('fail');
  });

  it('records exact $74.25 next-order-only affordability evidence', () => {
    const definition = scenario({ context: { direction: 'inbound', queue: 'customer_support', stage: 'support_case', contactState: 'existing_patient', caseBranch: 'affordability' }, evidence: { requiredInspections: [], requiredGateIds: ['affordability_calculation'] } });
    const result = run(createInitialScenarioState(definition), definition, [{ type: 'dial' }, { type: 'workflow', actionId: 'affordability_next_only' }]);
    expect(result.events.at(-1)?.payload).toMatchObject({ amountCents: 7425, duration: 'next_order_only' });
    expect(evaluateDeterministicGates(definition, result.state, result.events).find((gate) => gate.ruleId === 'affordability_calculation')?.status).toBe('pass');
  });

  it('blocks identifiers and health details in escalation without a fake Slack receipt', () => {
    const definition = scenario({ context: { direction: 'inbound', queue: 'customer_support', stage: 'support_case', contactState: 'existing_patient', caseBranch: 'refund' }, evidence: { requiredInspections: [], requiredGateIds: ['escalation_privacy'] } });
    const result = run(createInitialScenarioState(definition), definition, [{ type: 'dial' }, { type: 'escalate', channel: 'fake-support', orderId: 'SYN-100', vertical: 'support', requestedCorrection: 'Email patient@example.com about medication' }]);
    expect(result.outboxes).toHaveLength(0);
    expect(evaluateDeterministicGates(definition, result.state, result.events).find((gate) => gate.ruleId === 'escalation_privacy')?.status).toBe('fail');
  });

  it('penalizes unnecessary dialing of an already-resolved case', () => {
    const definition = scenario({ context: { queue: 'medical_chat', stage: 'pending_info', caseBranch: 'already_replied' }, evidence: { requiredGateIds: ['unnecessary_dial'] } });
    const result = run(createInitialScenarioState(definition), definition, preCall);
    expect(evaluateDeterministicGates(definition, result.state, result.events).find((gate) => gate.ruleId === 'unnecessary_dial')?.status).toBe('fail');
  });

  it('fails nail-photo and Medical Chat answer-boundary violations', () => {
    const nail = scenario({ context: { queue: 'medical_chat', stage: 'pending_info', caseBranch: 'nail_photo' }, evidence: { requiredGateIds: ['nail_photo_branch'] } });
    const nailResult = run(createInitialScenarioState(nail), nail, [...preCall, { type: 'workflow', actionId: 'find_doctor_message' }]);
    expect(evaluateDeterministicGates(nail, nailResult.state, nailResult.events).find((gate) => gate.ruleId === 'nail_photo_branch')?.status).toBe('fail');

    const clinical = scenario({ context: { queue: 'medical_chat', stage: 'pending_info', caseBranch: 'clinical_recovery' }, evidence: { requiredGateIds: ['medical_answer_boundary'] } });
    const connected = run(createInitialScenarioState(clinical), clinical, preCall);
    const spoken = utterances(clinical, connected.state, connected.events, ['Tell me your medication list and I will submit it.']);
    expect(evaluateDeterministicGates(clinical, spoken.state, spoken.events).find((gate) => gate.ruleId === 'medical_answer_boundary')?.status).toBe('fail');
  });
});

describe('payment safety and judge overlay', () => {
  const renewal = () => scenario({
    context: { direction: 'outbound', queue: 'renewals', stage: 'renewal_declined', contactState: 'existing_patient', caseBranch: 'confirmed_update' },
    evidence: { requiredWorkflowActions: [], requiredGateIds: ['payment_data', 'renewal_confirmation'] },
  });

  it('blocks a card form while recording is active and never logs the token', () => {
    const definition = renewal();
    const result = run(createInitialScenarioState(definition), definition, [...preCall, { type: 'secure_payment', fakeToken: FAKE_PAYMENT_TOKENS.success }]);
    expect(evaluateDeterministicGates(definition, result.state, result.events).find((gate) => gate.ruleId === 'payment_data')?.status).toBe('fail');
    expect(JSON.stringify(result.events)).not.toContain(FAKE_PAYMENT_TOKENS.success);
  });

  it('accepts only the designated fake token while paused and requires resume', () => {
    const definition = renewal();
    const result = run(createInitialScenarioState(definition), definition, [...preCall, { type: 'recording', state: 'paused' }, { type: 'secure_payment', fakeToken: FAKE_PAYMENT_TOKENS.success }, { type: 'recording', state: 'active' }]);
    expect(result.state.paymentState).toBe('confirmation_shown');
    expect(evaluateDeterministicGates(definition, result.state, result.events).find((gate) => gate.ruleId === 'payment_data')?.status).toBe('pass');
    expect(JSON.stringify(result.events)).not.toContain(FAKE_PAYMENT_TOKENS.success);
  });

  it('fails an adverse-reaction subscription restart', () => {
    const definition = scenario({ context: { queue: 'renewals', stage: 'renewal_declined', contactState: 'existing_patient', caseBranch: 'adverse_reaction' }, evidence: { requiredGateIds: ['adverse_reaction_restart'] } });
    const result = run(createInitialScenarioState(definition), definition, [...preCall, { type: 'workflow', actionId: 'subscription_restart' }]);
    expect(evaluateDeterministicGates(definition, result.state, result.events).find((gate) => gate.ruleId === 'adverse_reaction_restart')?.status).toBe('fail');
  });

  it('does not let a perfect AI judge reverse a critical failure', () => {
    const result = passingRun();
    const evaluation = applyDeterministicAssessment({
      evaluation: {
        overallScorePct: 100,
        passed: true,
        autoFailedReason: null,
        dispositionCorrect: true,
        summaryFeedback: 'Perfect.',
        strengthsHighlighted: [],
        coachingImprovements: [],
        criterionResults: [],
        evaluatedAt: Date.now(),
      },
      gates: [{ ruleId: 'clinical_boundary', sourceRefs: [], severity: 'critical', status: 'fail', evidenceEventIds: [result.events[0]!.id], learnerFeedback: 'Use the clinical boundary.', trainerDetail: 'Synthetic failure.' }],
      eligibility: { eligible: false, reasons: ['A deterministic critical rule failed.'], minimumEvidenceMet: true, dispositionValid: true, deterministicCriticalFailure: true },
      disposition: { disposition: 'Recovered', valid: true, reasons: [] },
    });
    expect(evaluation.passed).toBe(false);
    expect(evaluation.overallScorePct).toBeLessThan(60);
    expect(evaluation.evidenceEventIds).toContain(result.events[0]!.id);
  });
});
