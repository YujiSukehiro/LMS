import type { PublicSimScenario } from '@/lib/schemas/curriculum';
import {
  type DispositionValidation,
  type ScenarioState,
  type SimulationAssessmentEligibility,
  type SimulationEvent,
  type SimulationGateResult,
} from '@/lib/schemas/simulation-state';
import { CanonicalDispositionSchema } from '@/lib/schemas/source-truth';
import {
  CUSTOMER_OPT_OUT_PATTERN,
  CUSTOMER_PRICE_QUESTION_PATTERN,
  createInitialScenarioState,
} from './scenario-state';
import { ensureVerbalScenarioDefaults } from './verbal-defaults';

const UNSAFE_CLINICAL_PATTERN =
  /\b(?:yes,? (?:it(?:'s| is) )?safe|safe to (?:take|use)|you have|you'?re diagnosed|i diagnose|will cure|guaranteed to cure|safe with nitrates)\b/i;
const CLINICAL_ROUTE_PATTERN = /\b(?:physician|medical team|clinical|doctor|911|emergency services)\b/i;
const MEDICAL_ANSWER_PATTERN =
  /\b(?:send (?:me|it to me)|text me|read (?:me|out)|tell me your (?:medication|answer)|i'?ll (?:fill|enter|submit)|i can take your id)\b/i;
const EMERGENCY_PATTERN = /\b(?:911|emergency services)\b/i;
const REFUND_PROMISE_PATTERN =
  /\b(?:i(?:'ll| will) refund|refund (?:is )?approved|no refund|can'?t refund|cannot refund)\b/i;
const RETENTION_OFFER_PATTERN = /\b(?:discount|special offer|save you money|25%|50% off|free month)\b/i;
const PRICE_TALK_PATTERN = /\$\s?\d|\b(?:price|pricing|cost|per month|monthly)\b/i;

function sourceRefs(scenario: PublicSimScenario, gateId: string) {
  return scenario.evidenceRequirements?.gateSourceRefs[gateId] ?? [];
}

/**
 * Start a Verbal Practice session directly in `in_call` without requiring any pre-call dialer
 * inspections, dial click, or UI disclosure toggles.
 */
export function createVerbalScenarioState(scenario: PublicSimScenario): ScenarioState {
  const normalized =
    scenario.context && scenario.evidenceRequirements
      ? scenario
      : ensureVerbalScenarioDefaults(scenario);
  const initial = createInitialScenarioState(normalized);
  return {
    ...initial,
    lifecycle: 'in_call',
    contactReached: 'patient',
    localTimeValidated: true,
    identityVerified: true,
    recordingDisclosed: true,
    recording: 'inactive',
    inspectionIds: [...(normalized.evidenceRequirements?.requiredInspections ?? [])],
  };
}

/**
 * Evaluate ONLY verbal/transcript compliance boundaries (no dialer UI actions such as local-time
 * inspect, dial button, fake SMS, fake payment tokens, or recording pause toggles).
 */
export function evaluateVerbalPracticeGates(
  scenario: PublicSimScenario,
  state: ScenarioState,
  events: SimulationEvent[],
): SimulationGateResult[] {
  const required = new Set(scenario.evidenceRequirements?.requiredGateIds ?? []);
  const results: SimulationGateResult[] = [];
  const learner = events.filter((event) => event.actor === 'learner' && event.type === 'utterance');

  const add = (
    ruleId: string,
    applicable: boolean,
    status: SimulationGateResult['status'],
    evidenceEventIds: string[],
    learnerFeedback: string,
    trainerDetail: string,
    severity: SimulationGateResult['severity'] = 'critical',
  ) => {
    if (!applicable && !required.has(ruleId)) return;
    results.push({
      ruleId,
      sourceRefs: sourceRefs(scenario, ruleId),
      severity,
      status: applicable ? status : 'not_observed',
      evidenceEventIds: [...new Set(evidenceEventIds)],
      learnerFeedback,
      trainerDetail,
    });
  };

  // Spoken opt-out boundary: if caller opted out, learner must not keep pitching offers afterward.
  const anchoredOptIndex = events.findIndex((event) => event.type === 'utterance' && event.payload.intent === 'opt_out');
  const optIndex =
    anchoredOptIndex >= 0 || !state.optOut
      ? anchoredOptIndex
      : events.findIndex(
          (event) =>
            event.type === 'utterance' &&
            event.actor === 'customer' &&
            CUSTOMER_OPT_OUT_PATTERN.test(String(event.payload.content ?? '')),
        );
  const spokenOptViolations =
    optIndex >= 0
      ? events.filter(
          (event, index) =>
            index > optIndex &&
            event.actor === 'learner' &&
            event.type === 'utterance' &&
            RETENTION_OFFER_PATTERN.test(String(event.payload.content ?? '')),
        )
      : [];
  if (state.optOut || required.has('opt_out')) {
    add(
      'opt_out',
      state.optOut,
      spokenOptViolations.length > 0 ? 'fail' : state.wrapUpComplete ? 'pass' : 'not_observed',
      spokenOptViolations.map((event) => event.id),
      'After an opt-out request, stop all offers and respect the do-not-contact preference.',
      `Opt-out at event ${optIndex}; ${spokenOptViolations.length} subsequent offer utterances.`,
    );
  }

  const clinicalApplicable =
    /medical|clinical|interaction|irritation|severe_reaction|adverse_reaction|not_diagnosis/.test(state.context.caseBranch) ||
    required.has('clinical_boundary');
  if (clinicalApplicable) {
    const unsafeClinical = learner.filter((event) => UNSAFE_CLINICAL_PATTERN.test(String(event.payload.content ?? '')));
    const medicalRoute = learner.find((event) => CLINICAL_ROUTE_PATTERN.test(String(event.payload.content ?? '')));
    add(
      'clinical_boundary',
      true,
      unsafeClinical.length > 0 ? 'fail' : medicalRoute ? 'pass' : state.wrapUpComplete && learner.length > 0 ? 'pass' : 'not_observed',
      [...unsafeClinical, ...(medicalRoute ? [medicalRoute] : [])].map((event) => event.id),
      'Do not diagnose or give safety reassurance; route clinical questions to the approved medical path.',
      `${unsafeClinical.length} prohibited clinical statements observed.`,
    );
  }

  if (state.context.queue === 'medical_chat' || required.has('medical_answer_boundary')) {
    const answerViolations = learner.filter((event) => MEDICAL_ANSWER_PATTERN.test(String(event.payload.content ?? '')));
    add(
      'medical_answer_boundary',
      true,
      answerViolations.length > 0 ? 'fail' : learner.length > 0 ? 'pass' : 'not_observed',
      answerViolations.map((event) => event.id),
      'The patient must complete medical answers and uploads directly in their portal.',
      `${answerViolations.length} answer-collection boundary violations observed.`,
    );
  }

  if (state.context.caseBranch.includes('severe_reaction') || required.has('severe_reaction')) {
    const emergency = learner.find((event) => EMERGENCY_PATTERN.test(String(event.payload.content ?? '')));
    add(
      'severe_reaction',
      true,
      !emergency && state.wrapUpComplete ? 'fail' : emergency ? 'pass' : 'not_observed',
      emergency ? [emergency.id] : [],
      'Give 911 emergency guidance for severe symptoms before any sales or cancellation steps.',
      'Checked spoken emergency guidance in transcript.',
    );
  }

  if (state.context.caseBranch.includes('refund') || required.has('refund_boundary')) {
    const refundViolations = learner.filter((event) => REFUND_PROMISE_PATTERN.test(String(event.payload.content ?? '')));
    add(
      'refund_boundary',
      true,
      refundViolations.length > 0 ? 'fail' : learner.length > 0 ? 'pass' : 'not_observed',
      refundViolations.map((event) => event.id),
      'Route refund decisions per policy without promising or refusing a refund prematurely.',
      `${refundViolations.length} premature refund promises/refusals observed.`,
    );
  }

  if (state.context.caseBranch.includes('repeat_cancel') || required.has('repeat_cancellation')) {
    const retentionViolations = learner.filter((event) => RETENTION_OFFER_PATTERN.test(String(event.payload.content ?? '')));
    add(
      'repeat_cancellation',
      true,
      retentionViolations.length > 0 ? 'fail' : learner.length > 0 ? 'pass' : 'not_observed',
      retentionViolations.map((event) => event.id),
      'Honor repeat cancellation requests with zero retention offers.',
      `${retentionViolations.length} retention offer attempts observed.`,
    );
  }

  if ((state.context.product === 'NAD+' && state.context.stage === 'score') || required.has('pricing_passive')) {
    const priceQuestion = events.find(
      (event) => event.actor === 'customer' && CUSTOMER_PRICE_QUESTION_PATTERN.test(String(event.payload.content ?? '')),
    );
    const earlyPrice = learner.filter(
      (event) =>
        PRICE_TALK_PATTERN.test(String(event.payload.content ?? '')) &&
        (!priceQuestion || event.sequence < priceQuestion.sequence),
    );
    add(
      'pricing_passive',
      true,
      earlyPrice.length > 0 ? 'fail' : learner.length > 0 ? 'pass' : 'not_observed',
      [...earlyPrice, ...(priceQuestion ? [priceQuestion] : [])].map((event) => event.id),
      'Discuss pricing only after the caller asks about price.',
      `${earlyPrice.length} unsolicited pricing statements observed.`,
    );
  }

  // Legacy dialer-action gate IDs that may appear on existing published blueprints (e.g. identity_privacy,
  // local_time) pass once the learner engages verbally unless a spoken rule failed.
  for (const ruleId of required) {
    if (results.some((result) => result.ruleId === ruleId)) continue;
    results.push({
      ruleId,
      sourceRefs: sourceRefs(scenario, ruleId),
      severity: 'critical',
      status: learner.length > 0 ? 'pass' : 'not_observed',
      evidenceEventIds: learner.map((event) => event.id),
      learnerFeedback: 'Assessed through verbal transcript and Playbook rubric.',
      trainerDetail: 'Verbal-only mode satisfies legacy dialer action gates without mock CRM clicks.',
    });
  }

  return results;
}

export function verbalAssessmentEligibility(
  scenario: PublicSimScenario,
  state: ScenarioState,
  events: SimulationEvent[],
  gates: SimulationGateResult[],
): SimulationAssessmentEligibility {
  const minTurns = Math.max(1, scenario.evidenceRequirements?.minimumLearnerTurns ?? 1);
  const learnerTurns = events.filter((event) => event.actor === 'learner' && event.type === 'utterance').length;
  const reasons: string[] = [];
  if (state.lifecycle !== 'wrap_up' && state.lifecycle !== 'evaluated') {
    reasons.push('Finish your verbal practice before grading.');
  }
  if (learnerTurns < minTurns) {
    reasons.push(`Send at least ${minTurns} verbal ${minTurns === 1 ? 'reply' : 'replies'} before grading.`);
  }
  const criticalFailures = gates.filter((gate) => gate.severity === 'critical' && gate.status === 'fail').length;
  const majorFailures = gates.filter((gate) => gate.severity === 'major' && gate.status === 'fail').length;
  if (criticalFailures > (scenario.evidenceRequirements?.maximumCriticalFailures ?? 0)) {
    reasons.push('A critical Playbook rule failed.');
  }
  if (majorFailures > (scenario.evidenceRequirements?.maximumMajorFailures ?? 0)) {
    reasons.push('A major Playbook rule failed.');
  }
  return {
    eligible: reasons.length === 0,
    reasons,
    minimumEvidenceMet: learnerTurns >= minTurns,
    dispositionValid: true,
    deterministicCriticalFailure: criticalFailures > 0,
  };
}

/**
 * Finalize a Verbal Practice session for evaluation and certification eligibility without requiring
 * mock CRM notes, callbacks, escalations, or dialer disposition clicks.
 */
export function completeVerbalWrapUp(input: {
  scenario: PublicSimScenario;
  state: ScenarioState;
  events: SimulationEvent[];
  selectedDisposition: string;
}): {
  state: ScenarioState;
  gates: SimulationGateResult[];
  eligibility: SimulationAssessmentEligibility;
  dispositionValidation: DispositionValidation;
} {
  const parsedDisposition = CanonicalDispositionSchema.safeParse(input.selectedDisposition);
  const disposition = parsedDisposition.success ? parsedDisposition.data : 'Recovered';
  const requirements = input.scenario.evidenceRequirements;

  const wrappedState: ScenarioState = {
    ...input.state,
    lifecycle: 'wrap_up',
    contactReached: input.state.contactReached ?? 'patient',
    localTimeValidated: true,
    identityVerified: true,
    recordingDisclosed: true,
    workflowActionIds: [
      ...new Set([...input.state.workflowActionIds, ...(requirements?.requiredWorkflowActions ?? [])]),
    ],
    noteReceiptIds:
      input.state.noteReceiptIds.length > 0 ? input.state.noteReceiptIds : ['verbal-practice-note'],
    suppressionRecorded:
      input.state.suppressionRecorded || Boolean(requirements?.requiredWrapUpEvidence.includes('suppression')),
    escalationReceiptIds:
      input.state.escalationReceiptIds.length > 0
        ? input.state.escalationReceiptIds
        : requirements?.requiredWrapUpEvidence.includes('escalation')
          ? ['verbal-practice-escalation']
          : [],
    callbackAt:
      input.state.callbackAt ??
      (requirements?.requiredWrapUpEvidence.includes('callback') ? input.state.context.syntheticNow : null),
    selectedDisposition: disposition,
    dispositionCorrect: true,
    wrapUpComplete: true,
  };

  const gates = evaluateVerbalPracticeGates(input.scenario, wrappedState, input.events);
  const eligibility = verbalAssessmentEligibility(input.scenario, wrappedState, input.events, gates);
  const dispositionValidation: DispositionValidation = {
    disposition,
    valid: true,
    reasons: [],
  };

  return { state: wrappedState, gates, eligibility, dispositionValidation };
}
