import { createHash, randomUUID } from 'node:crypto';
import type { PublicSimScenario } from '@/lib/schemas/curriculum';
import { SimEvaluationSchema, type SimEvaluation } from '@/lib/schemas/analytics';
import {
  ScenarioStateSchema,
  SimulationEventSchema,
  SyntheticOutboxRecordSchema,
  type ScenarioQAFixture,
  type ScenarioState,
  type DispositionValidation,
  type SimulationAction,
  type SimulationAssessmentEligibility,
  type SimulationEvent,
  type SimulationGateResult,
  type SyntheticOutboxRecord,
} from '@/lib/schemas/simulation-state';
import { ServiceError } from './errors';
import { FAKE_PAYMENT_TOKENS } from '@/lib/schemas/simulation-constants';

export { FAKE_PAYMENT_TOKENS } from '@/lib/schemas/simulation-constants';

const CANONICAL_GATE_IDS = [
  'local_time',
  'opt_out',
  'identity_privacy',
  'voicemail_sms',
  'correct_link',
  'offer_limit',
  'clinical_boundary',
  'payment_data',
  'renewal_confirmation',
  'medical_answer_boundary',
  'refund_boundary',
  'repeat_cancellation',
  'pricing_passive',
  'upgrade_sequence',
  'recording_disclosure',
  'severe_reaction',
  'unnecessary_dial',
  'escalation_privacy',
  'adverse_reaction_restart',
  'nail_photo_branch',
  'affordability_calculation',
] as const;

type GateId = (typeof CANONICAL_GATE_IDS)[number];
type EventDraft = Omit<SimulationEvent, 'id' | 'sessionId' | 'sequence' | 'stateHash' | 'occurredAt'>;

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
}

export function hashScenarioState(state: ScenarioState): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(stableValue(state))).digest('hex')}`;
}

export function createInitialScenarioState(scenario: Pick<PublicSimScenario, 'context' | 'evidenceRequirements'>): ScenarioState {
  if (!scenario.context || !scenario.evidenceRequirements) {
    throw new ServiceError(409, 'SCENARIO_CONTEXT_REQUIRED', 'This scenario needs its context and evidence checklist before a new run can start.');
  }
  const required = scenario.evidenceRequirements.requiredInspections;
  return ScenarioStateSchema.parse({
    lifecycle: required.length === 0 ? 'ready_to_dial' : 'pre_call',
    context: scenario.context,
    inspectionIds: [],
    identityVerified: false,
    localTimeValidated: false,
    recordingDisclosureRequired: scenario.context.direction !== 'inbound' || scenario.context.queue === 'renewals',
    recordingDisclosed: false,
    contactReached: null,
    customerIntent: null,
    clinicalRiskBranch: null,
    optOut: false,
    suppressionRecorded: false,
    customerAskedPrice: false,
    pricingDiscussed: false,
    selectedPlanId: null,
    baseRecoveryCommitted: false,
    offerAssetIds: [],
    smsPermissionGranted: false,
    sentLinkAssetIds: [],
    workflowActionIds: [],
    recording: 'inactive',
    paymentState: 'not_started',
    patientCompletionIds: [],
    organicCompletionIds: [],
    escalationReceiptIds: [],
    noteReceiptIds: [],
    callbackAt: null,
    selectedDisposition: null,
    dispositionCorrect: null,
    wrapUpComplete: false,
    abortReason: null,
  });
}

export function syntheticLocalMinutes(context: ScenarioState['context']): number | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: context.syntheticTimezone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(context.syntheticNow));
    const hour = Number(parts.find((part) => part.type === 'hour')?.value);
    const minute = Number(parts.find((part) => part.type === 'minute')?.value);
    return Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : null;
  } catch {
    return null;
  }
}

export function isWithinSyntheticCallingWindow(context: ScenarioState['context']): boolean {
  const minutes = syntheticLocalMinutes(context);
  return minutes !== null && minutes >= 9 * 60 && minutes <= 21 * 60;
}

/** Rejects payment, credential and direct-identifier input before it can reach persistence or an AI prompt. */
export function assertSafeSyntheticText(text: string, field = 'text', operational = false): void {
  const cardLike = /(?:\d[ -]*?){13,19}/;
  const directIdentifier = /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|(?:\+?\d[ .-]?){10,15}/;
  const credential = /\b(?:password|passcode|cvv|cvc|ssn|social security)\s*(?:is|=|:)?\s*\S+/i;
  if (cardLike.test(text) || credential.test(text) || (operational && directIdentifier.test(text))) {
    throw new ServiceError(400, 'SENSITIVE_DATA_REJECTED', `Use only designated synthetic values in ${field}. No payment, credential, or direct-identifier data is accepted.`);
  }
  if (operational && /\b(?:diagnos(?:is|ed)|medication|symptom|disease|condition|dose|dosage|health detail)\b/i.test(text)) {
    throw new ServiceError(400, 'SENSITIVE_DATA_REJECTED', `Keep clinical details out of ${field}. Use only the synthetic order ID and structured correction fields.`);
  }
}

function nextSequence(events: SimulationEvent[]): number {
  return events.reduce((maximum, event) => Math.max(maximum, event.sequence), 0) + 1;
}

function makeEvent(
  sessionId: string,
  events: SimulationEvent[],
  state: ScenarioState,
  draft: EventDraft,
  now: Date,
  id: string = randomUUID(),
): SimulationEvent {
  return SimulationEventSchema.parse({
    ...draft,
    id,
    sessionId,
    sequence: nextSequence(events),
    stateHash: hashScenarioState(state),
    occurredAt: now.toISOString(),
  });
}

export function appendDialogueEvent(input: {
  sessionId: string;
  state: ScenarioState;
  events: SimulationEvent[];
  actor: 'learner' | 'customer';
  content: string;
  provenance: 'learner' | 'deterministic' | 'local_ai' | 'manual_chat' | 'replay';
  runtimeProvenance?: SimulationEvent['runtimeProvenance'];
  now?: Date;
  eventId?: string;
}): { state: ScenarioState; event: SimulationEvent } {
  if (input.actor === 'learner') assertSafeSyntheticText(input.content, 'the call transcript');
  let state = input.state;
  if (input.actor === 'customer') {
    if (/\b(?:stop calling|do not call|don't call|remove me|opt out|not interested)\b/i.test(input.content)) {
      state = { ...state, optOut: true, customerIntent: 'not_interested' };
    }
    if (/\b(?:how much|what(?:'s| is) the price|what does it cost|price please)\b/i.test(input.content)) {
      state = { ...state, customerAskedPrice: true };
    }
    if (/\b(?:severe reaction|trouble breathing|nitrate|heart medication|blood pressure|interaction|adverse reaction)\b/i.test(input.content)) {
      state = { ...state, clinicalRiskBranch: 'reaction_or_interaction' };
    }
  } else if (/\$\s?\d|\b(?:price|pricing|cost|per month|monthly)\b/i.test(input.content)) {
    state = { ...state, pricingDiscussed: true };
  }
  const event = makeEvent(input.sessionId, input.events, state, {
    actor: input.actor,
    type: 'utterance',
    payload: { content: input.content, synthetic: true },
    provenance: input.provenance,
    runtimeProvenance: input.runtimeProvenance,
  }, input.now ?? new Date(), input.eventId);
  return { state, event };
}

export function appendEvaluationEvent(input: {
  sessionId: string;
  state: ScenarioState;
  events: SimulationEvent[];
  evaluation: SimEvaluation;
  now?: Date;
  eventId?: string;
}): { state: ScenarioState; event: SimulationEvent } {
  const state = { ...input.state, lifecycle: 'evaluated' as const };
  const event = makeEvent(input.sessionId, input.events, state, {
    actor: 'engine',
    type: 'evaluate',
    payload: {
      overallScorePct: input.evaluation.overallScorePct,
      passed: input.evaluation.passed,
      assessmentEligible: input.evaluation.assessmentEligibility?.eligible ?? false,
      synthetic: true,
    },
    provenance: 'deterministic',
  }, input.now ?? new Date(), input.eventId);
  return { state, event };
}

function expectedLinkAssetId(state: ScenarioState): string {
  const { context } = state;
  const product = context.product.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  if (context.caseBranch.includes('pre_sale')) return `quiz-${product}`;
  if (context.queue === 'medical_chat') return 'portal-pending-information';
  if (context.product === 'NAD+' && context.stage === 'score') return 'nad-results-personalized';
  if (context.product === 'ZoliraRx' && context.stage === 'checkout') return 'zolirarx-fungus-checkout';
  return `${product}-${context.stage}-link`;
}

function eventForBlockedAction(
  sessionId: string,
  events: SimulationEvent[],
  state: ScenarioState,
  type: SimulationEvent['type'],
  reason: string,
  payload: Record<string, unknown>,
  now: Date,
  eventId?: string,
): SimulationEvent {
  return makeEvent(sessionId, events, state, {
    actor: 'engine',
    type,
    payload: { ...payload, status: 'blocked', reason, synthetic: true },
    provenance: 'deterministic',
  }, now, eventId);
}

export interface ActionApplication {
  state: ScenarioState;
  event: SimulationEvent;
  outboxRecord: SyntheticOutboxRecord | null;
}

function requireLifecycle(state: ScenarioState, allowed: ScenarioState['lifecycle'][]): void {
  if (!allowed.includes(state.lifecycle)) {
    throw new ServiceError(409, 'INVALID_SCENARIO_TRANSITION', `This action is not available while the scenario is ${state.lifecycle}.`);
  }
}

export function applySimulationAction(input: {
  sessionId: string;
  scenario: PublicSimScenario;
  state: ScenarioState;
  events: SimulationEvent[];
  action: SimulationAction;
  now?: Date;
  eventId?: string;
}): ActionApplication {
  const { sessionId, scenario, state: original, events, action } = input;
  const now = input.now ?? new Date();
  let state = original;
  let draft: EventDraft;
  let outboxRecord: SyntheticOutboxRecord | null = null;
  const blocked = (type: SimulationEvent['type'], reason: string, payload: Record<string, unknown> = {}): ActionApplication => ({
    state,
    event: eventForBlockedAction(sessionId, events, state, type, reason, payload, now, input.eventId),
    outboxRecord: null,
  });

  if (action.type === 'abort') {
    requireLifecycle(state, ['pre_call', 'ready_to_dial', 'in_call', 'wrap_up']);
    state = { ...state, lifecycle: 'aborted', abortReason: action.reason, wrapUpComplete: false };
    draft = { actor: 'learner', type: 'abort', payload: { reason: action.reason }, provenance: 'learner' };
  } else if (action.type === 'inspect') {
    requireLifecycle(state, ['pre_call', 'ready_to_dial']);
    const inspectionIds = [...new Set([...state.inspectionIds, action.inspectionId])];
    const localTimeValidated = action.inspectionId === 'local_time' ? isWithinSyntheticCallingWindow(state.context) : state.localTimeValidated;
    const required = scenario.evidenceRequirements?.requiredInspections ?? [];
    state = {
      ...state,
      inspectionIds,
      localTimeValidated,
      lifecycle: required.every((id) => inspectionIds.includes(id)) ? 'ready_to_dial' : 'pre_call',
    };
    draft = {
      actor: 'learner', type: 'inspect', provenance: 'learner',
      payload: { inspectionId: action.inspectionId, localTimeEligible: action.inspectionId === 'local_time' ? localTimeValidated : undefined, synthetic: true },
    };
  } else if (action.type === 'dial') {
    requireLifecycle(state, ['pre_call', 'ready_to_dial']);
    const missing = (scenario.evidenceRequirements?.requiredInspections ?? []).filter((id) => !state.inspectionIds.includes(id));
    if (missing.length > 0) return blocked('dial', 'missing_precall_inspections', { missingInspectionIds: missing });
    if (state.context.direction !== 'inbound' && !state.localTimeValidated) return blocked('dial', 'outside_local_calling_window');
    const contact = state.context.contactState === 'third_party' ? 'third_party' : state.context.contactState === 'voicemail' ? 'voicemail' : 'patient';
    state = { ...state, lifecycle: 'in_call', contactReached: contact, recording: 'active' };
    draft = { actor: 'learner', type: 'dial', payload: { status: 'connected', contactReached: contact, synthetic: true }, provenance: 'learner' };
  } else if (action.type === 'set_contact') {
    requireLifecycle(state, ['in_call']);
    state = { ...state, contactReached: action.contact };
    draft = { actor: 'engine', type: 'contact', payload: { contactReached: action.contact }, provenance: 'deterministic' };
  } else if (action.type === 'verify_identity') {
    requireLifecycle(state, ['in_call']);
    if (state.contactReached !== 'patient') return blocked('verify_identity', 'patient_not_reached');
    state = { ...state, identityVerified: true };
    draft = { actor: 'learner', type: 'verify_identity', payload: { verified: true, synthetic: true }, provenance: 'learner' };
  } else if (action.type === 'record_disclosure') {
    requireLifecycle(state, ['in_call']);
    state = { ...state, recordingDisclosed: true };
    draft = { actor: 'learner', type: 'record', payload: { disclosure: true }, provenance: 'learner' };
  } else if (action.type === 'set_opt_out') {
    requireLifecycle(state, ['in_call']);
    state = { ...state, optOut: true, customerIntent: 'not_interested' };
    draft = { actor: 'customer', type: 'utterance', payload: { content: 'Synthetic customer requested no further contact.', intent: 'opt_out' }, provenance: 'deterministic' };
  } else if (action.type === 'set_price_context') {
    requireLifecycle(state, ['in_call']);
    state = {
      ...state,
      customerAskedPrice: state.customerAskedPrice || action.customerAskedPrice,
      selectedPlanId: action.selectedPlanId,
      baseRecoveryCommitted: state.baseRecoveryCommitted || action.baseRecoveryCommitted,
    };
    draft = { actor: 'engine', type: 'workflow', payload: { actionId: 'price_context', customerAskedPrice: action.customerAskedPrice, selectedPlanId: action.selectedPlanId, baseRecoveryCommitted: action.baseRecoveryCommitted }, provenance: 'deterministic' };
  } else if (action.type === 'offer') {
    requireLifecycle(state, ['in_call']);
    if (state.optOut || state.contactReached !== 'patient') return blocked('offer', 'contact_not_eligible', { assetId: action.assetId });
    if (state.context.caseBranch.includes('repeat_cancel') || state.context.caseBranch.includes('severe_reaction') || state.context.caseBranch.includes('adverse_reaction')) {
      return blocked('offer', 'no_offer_branch', { assetId: action.assetId });
    }
    if (state.offerAssetIds.length >= 2) {
      state = { ...state, offerAssetIds: [...state.offerAssetIds, action.assetId] };
      return blocked('offer', 'offer_limit_exceeded', { assetId: action.assetId, offerCount: state.offerAssetIds.length });
    }
    state = { ...state, offerAssetIds: [...state.offerAssetIds, action.assetId] };
    draft = { actor: 'learner', type: 'offer', payload: { assetId: action.assetId, status: 'recorded', synthetic: true }, provenance: 'learner' };
  } else if (action.type === 'grant_sms_permission') {
    requireLifecycle(state, ['in_call']);
    if (state.optOut || state.contactReached !== 'patient') return blocked('sms', 'permission_not_available');
    state = { ...state, smsPermissionGranted: true };
    draft = { actor: 'customer', type: 'sms', payload: { verbalPermission: true }, provenance: 'deterministic' };
  } else if (action.type === 'send_sms') {
    requireLifecycle(state, ['in_call']);
    if (state.contactReached === 'voicemail') return blocked('sms', 'voicemail_sms_forbidden', { assetId: action.assetId });
    if (state.optOut || state.contactReached !== 'patient') return blocked('sms', 'contact_not_eligible', { assetId: action.assetId });
    if (!state.smsPermissionGranted) return blocked('sms', 'verbal_permission_required', { assetId: action.assetId });
    const event = makeEvent(sessionId, events, { ...state, sentLinkAssetIds: [...state.sentLinkAssetIds, action.assetId] }, {
      actor: 'learner', type: 'sms', payload: { assetId: action.assetId, stage: state.context.stage, status: 'fake_sent', synthetic: true }, provenance: 'learner',
    }, now, input.eventId);
    state = { ...state, sentLinkAssetIds: [...state.sentLinkAssetIds, action.assetId] };
    outboxRecord = SyntheticOutboxRecordSchema.parse({
      id: randomUUID(), sessionId, kind: 'fake_sms', destination: 'SYNTHETIC TRAINING outbox', assetId: action.assetId,
      displayText: `SYNTHETIC TRAINING — approved symbolic asset ${action.assetId}; no URL opened and no SMS sent.`,
      eventId: event.id, createdAt: now.toISOString(), synthetic: true,
    });
    return { state, event, outboxRecord };
  } else if (action.type === 'recording') {
    requireLifecycle(state, ['in_call']);
    state = { ...state, recording: action.state };
    draft = { actor: 'learner', type: 'record', payload: { recording: action.state }, provenance: 'learner' };
  } else if (action.type === 'secure_payment') {
    requireLifecycle(state, ['in_call']);
    if (state.context.queue !== 'renewals') return blocked('payment', 'payment_not_applicable');
    if (state.recording !== 'paused') return blocked('payment', 'recording_not_paused');
    if (action.fakeToken !== FAKE_PAYMENT_TOKENS.success && action.fakeToken !== FAKE_PAYMENT_TOKENS.failure) {
      return blocked('payment', 'designated_fake_token_required');
    }
    const succeeded = action.fakeToken === FAKE_PAYMENT_TOKENS.success;
    state = { ...state, paymentState: succeeded ? 'confirmation_shown' : 'update_failed' };
    draft = { actor: 'engine', type: 'payment', payload: { outcome: succeeded ? 'confirmation_shown' : 'update_failed', designatedFakeToken: true }, provenance: 'deterministic' };
  } else if (action.type === 'workflow') {
    requireLifecycle(state, ['in_call']);
    state = { ...state, workflowActionIds: [...new Set([...state.workflowActionIds, action.actionId])] };
    const payload: Record<string, unknown> = { actionId: action.actionId, synthetic: true };
    if (action.actionId === 'affordability_next_only') Object.assign(payload, { amountCents: 7425, duration: 'next_order_only' });
    draft = { actor: 'learner', type: action.actionId.includes('subscription') ? 'subscription_update' : action.actionId.includes('order') ? 'order_update' : 'workflow', payload, provenance: 'learner' };
  } else if (action.type === 'patient_completion') {
    requireLifecycle(state, action.organic ? ['pre_call', 'ready_to_dial', 'in_call'] : ['in_call']);
    state = action.organic
      ? { ...state, organicCompletionIds: [...new Set([...state.organicCompletionIds, action.completionId])] }
      : { ...state, patientCompletionIds: [...new Set([...state.patientCompletionIds, action.completionId])] };
    draft = { actor: 'customer', type: 'patient_completion', payload: { completionId: action.completionId, organic: action.organic, synthetic: true }, provenance: 'deterministic' };
  } else if (action.type === 'escalate') {
    requireLifecycle(state, ['pre_call', 'ready_to_dial', 'in_call']);
    try {
      assertSafeSyntheticText(action.requestedCorrection, 'escalation', true);
      assertSafeSyntheticText(action.vertical, 'escalation', true);
    } catch {
      return blocked('escalate', 'privacy_validation_failed', { channel: action.channel });
    }
    if (!action.channel.startsWith('fake-') || !action.orderId.startsWith('SYN-')) return blocked('escalate', 'synthetic_channel_and_order_required');
    const receiptId = `fake-receipt-${nextSequence(events)}`;
    state = { ...state, escalationReceiptIds: [...state.escalationReceiptIds, receiptId] };
    const event = makeEvent(sessionId, events, state, {
      actor: 'learner', type: 'escalate', payload: { channel: action.channel, orderId: action.orderId, vertical: action.vertical, requestedCorrection: action.requestedCorrection, receiptId }, provenance: 'learner',
    }, now, input.eventId);
    outboxRecord = SyntheticOutboxRecordSchema.parse({
      id: randomUUID(), sessionId, kind: 'fake_slack', destination: action.channel, assetId: null,
      displayText: `SYNTHETIC TRAINING — ${action.orderId}; ${action.vertical}; ${action.requestedCorrection}`,
      eventId: event.id, createdAt: now.toISOString(), synthetic: true,
    });
    return { state, event, outboxRecord };
  } else if (action.type === 'note') {
    requireLifecycle(state, ['pre_call', 'ready_to_dial', 'in_call']);
    assertSafeSyntheticText(action.text, 'notes', true);
    const receiptId = `fake-note-${nextSequence(events)}`;
    state = { ...state, noteReceiptIds: [...state.noteReceiptIds, receiptId] };
    draft = { actor: 'learner', type: 'note', payload: { text: action.text, receiptId, synthetic: true }, provenance: 'learner' };
  } else if (action.type === 'suppress') {
    requireLifecycle(state, ['pre_call', 'ready_to_dial', 'in_call']);
    state = { ...state, suppressionRecorded: true };
    draft = { actor: 'learner', type: 'suppress', payload: { suppressed: true, synthetic: true }, provenance: 'learner' };
  } else if (action.type === 'callback') {
    requireLifecycle(state, ['pre_call', 'ready_to_dial', 'in_call']);
    if (new Date(action.callbackAt) <= new Date(state.context.syntheticNow)) throw new ServiceError(400, 'CALLBACK_IN_PAST', 'Choose a synthetic callback time after the scenario time.');
    state = { ...state, callbackAt: action.callbackAt };
    draft = { actor: 'learner', type: 'callback', payload: { callbackAt: action.callbackAt, synthetic: true }, provenance: 'learner' };
  } else if (action.type === 'wrap_up') {
    requireLifecycle(state, ['pre_call', 'ready_to_dial', 'in_call']);
    const validation = validateDisposition(state, action.disposition);
    state = { ...state, selectedDisposition: action.disposition, dispositionCorrect: validation.valid };
    const missing = missingWrapUpEvidence(scenario, state);
    if (!validation.valid || missing.length > 0) {
      return blocked('disposition', !validation.valid ? 'disposition_state_mismatch' : 'wrap_up_evidence_missing', {
        disposition: action.disposition, reasons: validation.reasons, missingEvidence: missing,
      });
    }
    state = { ...state, lifecycle: 'wrap_up', wrapUpComplete: true };
    draft = { actor: 'learner', type: 'disposition', payload: { disposition: action.disposition, valid: true, synthetic: true }, provenance: 'learner' };
  } else {
    const exhaustive: never = action;
    throw new ServiceError(400, 'UNKNOWN_SIMULATION_ACTION', `Unsupported action ${JSON.stringify(exhaustive)}.`);
  }

  return { state, event: makeEvent(sessionId, events, state, draft, now, input.eventId), outboxRecord };
}

export function validateDisposition(state: ScenarioState, disposition: NonNullable<ScenarioState['selectedDisposition']>): DispositionValidation {
  const reasons: string[] = [];
  if (disposition === 'Recovered') {
    if (state.context.queue === 'renewals' && state.paymentState !== 'confirmation_shown') reasons.push('Recovered requires an actual synthetic card-update confirmation.');
    if (state.context.queue === 'medical_chat' && state.patientCompletionIds.length === 0) reasons.push('Recovered requires the synthetic patient reply/upload completion, not approval or a promise.');
    if (!['renewals', 'medical_chat'].includes(state.context.queue) && state.paymentState !== 'confirmation_shown' && !state.workflowActionIds.includes('recovery_confirmed')) {
      reasons.push('Recovered requires the track-defined recovery confirmation action; sending a link is not confirmation.');
    }
  }
  if (disposition === 'Organic' && state.organicCompletionIds.length === 0) reasons.push('Organic requires evidence that the customer completed the target action before the call.');
  if (disposition === 'Callback scheduled' && !state.callbackAt) reasons.push('Callback scheduled requires a specific synthetic date and time.');
  if (disposition === "Didn't reply" && !['voicemail', 'no_answer'].includes(state.contactReached ?? '')) reasons.push("Didn't reply requires a voicemail or no-answer contact state.");
  if (disposition === 'Not interested' && !state.optOut && !state.workflowActionIds.includes('cancellation_completed') && !state.workflowActionIds.includes('not_interested')) {
    reasons.push('Not interested requires an observed refusal, opt-out, or completed cancellation branch.');
  }
  if (disposition === 'Lost' && !state.context.caseBranch.includes('expired') && !state.context.caseBranch.includes('adverse_reaction')) {
    reasons.push('Lost is limited to the approved expired/terminal case branch.');
  }
  if (state.context.caseBranch.includes('expired') && disposition === 'Lost' && state.escalationReceiptIds.length === 0) reasons.push('An expired Medical Chat case requires escalation before Lost.');
  return { disposition, valid: reasons.length === 0, reasons };
}

export function missingWrapUpEvidence(scenario: PublicSimScenario, state: ScenarioState): string[] {
  const requirements = scenario.evidenceRequirements;
  if (!requirements) return ['scenario evidence requirements'];
  const missing: string[] = [];
  for (const actionId of requirements.requiredWorkflowActions) if (!state.workflowActionIds.includes(actionId)) missing.push(`workflow:${actionId}`);
  for (const evidence of requirements.requiredWrapUpEvidence) {
    if (evidence === 'note' && state.noteReceiptIds.length === 0) missing.push('note');
    if (evidence === 'suppression' && !state.suppressionRecorded) missing.push('suppression');
    if (evidence === 'escalation' && state.escalationReceiptIds.length === 0) missing.push('escalation');
    if (evidence === 'callback' && !state.callbackAt) missing.push('callback');
  }
  return missing;
}

function sourceRefs(scenario: PublicSimScenario, gateId: string) {
  return scenario.evidenceRequirements?.gateSourceRefs[gateId] ?? [];
}

export function evaluateDeterministicGates(
  scenario: PublicSimScenario,
  state: ScenarioState,
  events: SimulationEvent[],
): SimulationGateResult[] {
  const required = new Set(scenario.evidenceRequirements?.requiredGateIds ?? []);
  const results: SimulationGateResult[] = [];
  const add = (ruleId: GateId, applicable: boolean, status: SimulationGateResult['status'], evidenceEventIds: string[], learnerFeedback: string, trainerDetail: string, severity: SimulationGateResult['severity'] = 'critical') => {
    if (!applicable && !required.has(ruleId)) return;
    results.push({ ruleId, sourceRefs: sourceRefs(scenario, ruleId), severity, status: applicable ? status : 'not_observed', evidenceEventIds: [...new Set(evidenceEventIds)], learnerFeedback, trainerDetail });
  };
  const learner = events.filter((event) => event.actor === 'learner' && event.type === 'utterance');
  const dials = events.filter((event) => event.type === 'dial');
  const sms = events.filter((event) => event.type === 'sms' && event.payload.assetId);
  const offers = events.filter((event) => event.type === 'offer');
  const outbound = state.context.direction !== 'inbound';
  const localEvents = events.filter((event) => (event.type === 'inspect' && event.payload.inspectionId === 'local_time') || event.type === 'dial');
  const localFailed = dials.some((event) => event.payload.status === 'blocked') || (dials.length > 0 && !state.localTimeValidated);
  add('local_time', outbound, localFailed ? 'fail' : dials.some((event) => event.payload.status === 'connected') && state.localTimeValidated ? 'pass' : 'not_observed', localEvents.map((event) => event.id), 'Validate the lead’s synthetic local time before dialing.', 'Dial requires a local_time inspection and a 09:00–21:00 lead-local timestamp.');

  const optIndex = events.findIndex((event) => event.type === 'utterance' && event.payload.intent === 'opt_out' || event.actor === 'customer' && event.type === 'utterance' && /\b(?:stop calling|do not call|don't call|remove me|opt out|not interested)\b/i.test(String(event.payload.content ?? '')));
  const optViolations = events.filter((event, index) => optIndex >= 0 && index > optIndex && ['offer', 'sms'].includes(event.type) && !event.payload.verbalPermission);
  add('opt_out', state.optOut || required.has('opt_out'), optViolations.length > 0 || (state.wrapUpComplete && !state.suppressionRecorded) ? 'fail' : state.optOut && state.suppressionRecorded ? 'pass' : 'not_observed', [...optViolations, ...events.filter((event) => event.type === 'suppress')].map((event) => event.id), 'After opt-out, stop offers and SMS and record permanent suppression.', `Opt-out event index ${optIndex}; ${optViolations.length} subsequent offer/SMS attempts.`);

  const identityEvents = events.filter((event) => event.type === 'verify_identity');
  const verifiedSequence = identityEvents[0]?.sequence ?? Number.POSITIVE_INFINITY;
  const protectedPattern = /\b(?:order|subscription|account|billing|card|charge|refund|neurocalm|liftrx|trishot|quattro|zolira|nad\+|medical question|identity request)\b/i;
  const privacyViolations = learner.filter((event) => event.sequence < verifiedSequence && protectedPattern.test(String(event.payload.content ?? '')));
  const genericContact = state.contactReached === 'third_party' || state.contactReached === 'voicemail';
  const identityApplicable = ['customer_support', 'medical_chat', 'renewals'].includes(state.context.queue) || genericContact;
  add('identity_privacy', identityApplicable, privacyViolations.length > 0 ? 'fail' : state.identityVerified || genericContact && privacyViolations.length === 0 && learner.length > 0 ? 'pass' : 'not_observed', [...privacyViolations, ...identityEvents].map((event) => event.id), 'Verify the patient before protected details; use only a generic callback message for third parties or voicemail.', `${privacyViolations.length} protected learner utterances occurred before verification.`);

  add('voicemail_sms', state.contactReached === 'voicemail', sms.length > 0 ? 'fail' : state.contactReached === 'voicemail' && state.wrapUpComplete ? 'pass' : 'not_observed', sms.map((event) => event.id), 'Do not invoke SMS on a voicemail branch.', `${sms.length} SMS attempts observed in the voicemail branch.`);

  const expectedAsset = expectedLinkAssetId(state);
  const wrongLinks = sms.filter((event) => event.payload.assetId !== expectedAsset);
  const sentLinks = sms.filter((event) => event.payload.status === 'fake_sent');
  add('correct_link', sentLinks.length > 0 || required.has('correct_link'), wrongLinks.length > 0 ? 'fail' : sentLinks.length > 0 ? 'pass' : 'not_observed', sms.map((event) => event.id), 'Use the approved personalized asset for this product and stage.', `Expected ${expectedAsset}; observed ${sms.map((event) => String(event.payload.assetId)).join(', ') || 'none'}.`);

  add('offer_limit', state.context.queue === 'recovery' || required.has('offer_limit'), offers.length > 2 ? 'fail' : offers.length > 0 ? 'pass' : 'not_observed', offers.map((event) => event.id), 'Stay within the approved offer and re-offer limit.', `${offers.length} offer attempts observed; maximum 2.`, 'major');

  if (state.context.product === 'NAD+' && state.context.stage === 'score') {
    const priceQuestion = events.find((event) => event.actor === 'customer' && /\b(?:how much|what(?:'s| is) the price|what does it cost|price please)\b/i.test(String(event.payload.content ?? '')));
    const earlyPrice = learner.filter((event) => /\$\s?\d|\b(?:price|pricing|cost|per month|monthly)\b/i.test(String(event.payload.content ?? '')) && (!priceQuestion || event.sequence < priceQuestion.sequence));
    add('pricing_passive', true, earlyPrice.length > 0 ? 'fail' : learner.length > 0 ? 'pass' : 'not_observed', [...earlyPrice, ...(priceQuestion ? [priceQuestion] : [])].map((event) => event.id), 'On a Score call, discuss price only after the customer asks.', `${earlyPrice.length} unsolicited pricing utterances observed.`);
  }

  const upgrade = offers.find((event) => String(event.payload.assetId).includes('trishot-upgrade'));
  const baseCommit = events.find((event) => event.type === 'workflow' && event.payload.baseRecoveryCommitted === true);
  add('upgrade_sequence', Boolean(upgrade) || required.has('upgrade_sequence'), upgrade && (!baseCommit || upgrade.sequence < baseCommit.sequence) ? 'fail' : upgrade ? 'pass' : 'not_observed', [...(upgrade ? [upgrade] : []), ...(baseCommit ? [baseCommit] : [])].map((event) => event.id), 'Commit the TriShot base recovery before one soft upgrade offer.', 'Upgrade sequence is derived from event order, not dialogue claims.');

  const clinicalApplicable = /medical|clinical|interaction|irritation|severe_reaction|adverse_reaction|not_diagnosis/.test(state.context.caseBranch);
  const unsafeClinical = learner.filter((event) => /\b(?:yes,? (?:it(?:'s| is) )?safe|safe to (?:take|use)|you have|you'?re diagnosed|i diagnose|will cure|guaranteed to cure|safe with nitrates)\b/i.test(String(event.payload.content ?? '')));
  const physicianRoute = learner.find((event) => /\b(?:physician|medical team|doctor|911|emergency services)\b/i.test(String(event.payload.content ?? '')));
  add('clinical_boundary', clinicalApplicable, unsafeClinical.length > 0 ? 'fail' : physicianRoute ? 'pass' : 'not_observed', [...unsafeClinical, ...(physicianRoute ? [physicianRoute] : [])].map((event) => event.id), 'Do not diagnose or give safety reassurance; route clinical questions to the approved medical path.', `${unsafeClinical.length} prohibited clinical statements observed.`);

  if (state.context.queue === 'medical_chat') {
    const answerViolations = learner.filter((event) => /\b(?:send (?:me|it to me)|text me|read (?:me|out)|tell me your (?:medication|answer)|i'?ll (?:fill|enter|submit)|i can take your id)\b/i.test(String(event.payload.content ?? '')));
    add('medical_answer_boundary', true, answerViolations.length > 0 ? 'fail' : state.patientCompletionIds.length > 0 && answerViolations.length === 0 ? 'pass' : 'not_observed', answerViolations.map((event) => event.id), 'The patient must read, answer, select, and upload in their own portal; never receive or coach the answer.', `${answerViolations.length} agent answer/ID receipt attempts observed.`);
  }

  if (state.context.queue === 'renewals') {
    const payments = events.filter((event) => event.type === 'payment');
    const paymentUnsafe = payments.filter((event) => event.payload.reason === 'recording_not_paused' || event.payload.reason === 'designated_fake_token_required');
    const resumed = events.some((event) => event.type === 'record' && event.payload.recording === 'active' && payments.some((payment) => payment.sequence < event.sequence));
    add('payment_data', true, paymentUnsafe.length > 0 ? 'fail' : payments.some((event) => ['confirmation_shown', 'update_failed'].includes(String(event.payload.outcome))) && resumed ? 'pass' : 'not_observed', [...payments, ...events.filter((event) => event.type === 'record')].map((event) => event.id), 'Pause recording, use only the designated fake token, wait for the outcome, then resume recording.', `${paymentUnsafe.length} unsafe payment attempts; resume observed: ${resumed}.`);
    const successClaim = learner.filter((event) => /\b(?:card (?:is |was )?updated|payment (?:is |was )?fixed|you'?re all set)\b/i.test(String(event.payload.content ?? '')) && !events.some((payment) => payment.type === 'payment' && payment.payload.outcome === 'confirmation_shown' && payment.sequence < event.sequence));
    const recoveredWithoutConfirmation = events.filter((event) => event.type === 'disposition' && event.payload.disposition === 'Recovered' && state.paymentState !== 'confirmation_shown');
    add('renewal_confirmation', true, successClaim.length > 0 || recoveredWithoutConfirmation.length > 0 ? 'fail' : state.paymentState === 'confirmation_shown' ? 'pass' : 'not_observed', [...successClaim, ...recoveredWithoutConfirmation, ...payments].map((event) => event.id), 'A promise or form submission is not recovery; wait for confirmation_shown.', `${successClaim.length} premature success claims observed.`);
  }

  if (state.context.caseBranch.includes('severe_reaction')) {
    const emergency = learner.find((event) => /\b(?:911|emergency services)\b/i.test(String(event.payload.content ?? '')));
    const unsafeAction = events.find((event) => ['offer', 'workflow', 'subscription_update'].includes(event.type) && (!emergency || event.sequence < emergency.sequence));
    add('severe_reaction', true, unsafeAction || !emergency && state.wrapUpComplete ? 'fail' : emergency ? 'pass' : 'not_observed', [...(emergency ? [emergency] : []), ...(unsafeAction ? [unsafeAction] : [])].map((event) => event.id), 'Give 911 guidance for current severe symptoms before any sales or cancellation workflow.', 'Emergency guidance is checked by event sequence.');
  }

  if (state.context.caseBranch.includes('repeat_cancel')) {
    const retentionOffers = [...offers, ...learner.filter((event) => /\b(?:discount|special offer|save you money|25%)\b/i.test(String(event.payload.content ?? '')))];
    add('repeat_cancellation', true, retentionOffers.length > 0 ? 'fail' : state.workflowActionIds.includes('cancellation_completed') ? 'pass' : 'not_observed', retentionOffers.map((event) => event.id), 'A repeat cancellation receives no retention offer; complete the approved cancellation/escalation path.', `${retentionOffers.length} retention offer attempts observed.`);
  }

  if (state.context.caseBranch.includes('refund')) {
    const refundViolations = learner.filter((event) => /\b(?:i(?:'ll| will) refund|refund (?:is )?approved|no refund|can'?t refund|cannot refund)\b/i.test(String(event.payload.content ?? '')));
    add('refund_boundary', true, refundViolations.length > 0 ? 'fail' : state.escalationReceiptIds.length > 0 ? 'pass' : 'not_observed', [...refundViolations, ...events.filter((event) => event.type === 'escalate')].map((event) => event.id), 'Escalate refund decisions without promising or refusing a refund.', `${refundViolations.length} refund promise/refusal statements observed.`);
  }

  const noCall = /already_replied|no_doctor_question|organic_stale/.test(state.context.caseBranch);
  const noCallResolutionObserved = state.organicCompletionIds.length > 0 || state.inspectionIds.includes('doctor_patient_chat');
  add('unnecessary_dial', noCall, dials.length > 0 ? 'fail' : noCallResolutionObserved ? 'pass' : 'not_observed', [...dials, ...events.filter((event) => event.type === 'patient_completion')].map((event) => event.id), 'Inspect first: do not chase a case already resolved or lacking a doctor question.', `${dials.length} unnecessary dial attempts observed.`);

  const blockedEscalations = events.filter((event) => event.type === 'escalate' && event.payload.status === 'blocked');
  const acceptedEscalations = events.filter((event) => event.type === 'escalate' && event.payload.receiptId);
  add('escalation_privacy', acceptedEscalations.length > 0 || blockedEscalations.length > 0 || required.has('escalation_privacy'), blockedEscalations.length > 0 ? 'fail' : acceptedEscalations.length > 0 ? 'pass' : 'not_observed', [...blockedEscalations, ...acceptedEscalations].map((event) => event.id), 'Use only synthetic order IDs and structured fields; exclude direct identifiers and health details.', `${blockedEscalations.length} blocked escalation attempts observed.`);

  if (state.context.caseBranch.includes('adverse_reaction')) {
    const restarts = events.filter((event) => ['workflow', 'subscription_update', 'payment'].includes(event.type) && /restart|card_update/.test(String(event.payload.actionId ?? event.type)));
    add('adverse_reaction_restart', true, restarts.length > 0 ? 'fail' : state.escalationReceiptIds.length > 0 ? 'pass' : 'not_observed', restarts.map((event) => event.id), 'An adverse reaction stops card/restart work and routes to the medical team.', `${restarts.length} restart attempts observed.`);
  }

  if (state.context.caseBranch.includes('nail_photo')) {
    const wrongBranch = events.filter((event) => event.type === 'workflow' && /doctor_message|find_doctor/.test(String(event.payload.actionId)));
    add('nail_photo_branch', true, wrongBranch.length > 0 ? 'fail' : state.patientCompletionIds.some((id) => id.includes('photo')) ? 'pass' : 'not_observed', wrongBranch.map((event) => event.id), 'Use the synthetic image-box upload branch, not a doctor-message search.', `${wrongBranch.length} wrong-branch actions observed.`);
  }

  if (state.context.caseBranch.includes('affordability')) {
    const discounts = events.filter((event) => event.type === 'workflow' && String(event.payload.actionId).startsWith('affordability'));
    const correct = discounts.some((event) => event.payload.amountCents === 7425 && event.payload.duration === 'next_order_only');
    add('affordability_calculation', true, correct ? 'pass' : discounts.length > 0 || state.wrapUpComplete ? 'fail' : 'not_observed', discounts.map((event) => event.id), 'Apply the exact synthetic $74.25 next-order-only action in the approved sequence.', 'Expected amountCents=7425 and duration=next_order_only.', 'major');
  }

  const recordingApplicable = state.recordingDisclosureRequired && (dials.length > 0 || required.has('recording_disclosure'));
  add('recording_disclosure', recordingApplicable, recordingApplicable && !state.recordingDisclosed && state.wrapUpComplete ? 'fail' : state.recordingDisclosed ? 'pass' : 'not_observed', events.filter((event) => event.type === 'record').map((event) => event.id), 'Give the recording disclosure where required.', 'Disclosure is a required recorded action.', 'major');

  for (const ruleId of required) {
    if (!results.some((result) => result.ruleId === ruleId)) {
      results.push({
        ruleId,
        sourceRefs: sourceRefs(scenario, ruleId),
        severity: 'critical',
        status: CANONICAL_GATE_IDS.includes(ruleId as GateId) ? 'not_observed' : 'needs_review',
        evidenceEventIds: [],
        learnerFeedback: 'Required scenario evidence has not been observed.',
        trainerDetail: CANONICAL_GATE_IDS.includes(ruleId as GateId) ? 'The required gate did not produce evidence in this branch.' : 'The required gate ID is not registered in the deterministic rule engine.',
      });
    }
  }
  return results;
}

export function assessmentEligibility(
  scenario: PublicSimScenario,
  state: ScenarioState,
  events: SimulationEvent[],
  gates = evaluateDeterministicGates(scenario, state, events),
): SimulationAssessmentEligibility {
  const requirements = scenario.evidenceRequirements;
  const reasons: string[] = [];
  const learnerTurns = events.filter((event) => event.actor === 'learner' && event.type === 'utterance').length;
  if (!requirements) reasons.push('Scenario evidence requirements are missing.');
  if (state.lifecycle !== 'wrap_up' && state.lifecycle !== 'evaluated') reasons.push('Complete wrap-up before evaluation.');
  if (requirements && learnerTurns < requirements.minimumLearnerTurns) reasons.push(`At least ${requirements.minimumLearnerTurns} learner turn(s) are required.`);
  if (requirements) {
    for (const id of requirements.requiredInspections) if (!state.inspectionIds.includes(id)) reasons.push(`Missing pre-call inspection: ${id}.`);
    reasons.push(...missingWrapUpEvidence(scenario, state).map((item) => `Missing wrap-up/workflow evidence: ${item}.`));
    for (const id of requirements.requiredGateIds) {
      const gate = gates.find((result) => result.ruleId === id);
      if (!gate || gate.status === 'not_observed' || gate.status === 'needs_review') reasons.push(`Required gate has insufficient evidence: ${id}.`);
    }
  }
  const disposition = state.selectedDisposition ? validateDisposition(state, state.selectedDisposition) : null;
  if (!disposition?.valid) reasons.push(...(disposition?.reasons ?? ['Select a canonical disposition.']));
  const criticalFailures = gates.filter((gate) => gate.severity === 'critical' && gate.status === 'fail').length;
  const majorFailures = gates.filter((gate) => gate.severity === 'major' && gate.status === 'fail').length;
  if (criticalFailures > (requirements?.maximumCriticalFailures ?? 0)) reasons.push('A deterministic critical rule failed.');
  if (majorFailures > (requirements?.maximumMajorFailures ?? 0)) reasons.push('A deterministic major rule failed.');
  return {
    eligible: reasons.length === 0,
    reasons: [...new Set(reasons)],
    minimumEvidenceMet: Boolean(requirements && learnerTurns >= requirements.minimumLearnerTurns && missingWrapUpEvidence(scenario, state).length === 0),
    dispositionValid: disposition?.valid === true,
    deterministicCriticalFailure: criticalFailures > 0,
  };
}

export function runScenarioQAFixture(
  scenario: PublicSimScenario,
  fixture: ScenarioQAFixture,
): { passed: boolean; state: ScenarioState; events: SimulationEvent[]; gates: SimulationGateResult[]; eligibility: SimulationAssessmentEligibility; errors: string[] } {
  let state = createInitialScenarioState(scenario);
  let events: SimulationEvent[] = [];
  const errors: string[] = [];
  for (const [index, step] of fixture.steps.entries()) {
    const now = new Date(Date.parse(scenario.context!.syntheticNow) + index * 1000);
    try {
      if (step.learnerUtterance) {
        const applied = appendDialogueEvent({ sessionId: `qa-${fixture.id}`, state, events, actor: 'learner', content: step.learnerUtterance, provenance: 'learner', now, eventId: `qa-${fixture.id}-${events.length + 1}` });
        state = applied.state;
        events = [...events, applied.event];
      }
      if (step.action) {
        const applied = applySimulationAction({ sessionId: `qa-${fixture.id}`, scenario, state, events, action: step.action, now, eventId: `qa-${fixture.id}-${events.length + 1}` });
        state = applied.state;
        events = [...events, applied.event];
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'Unknown scripted action error.');
    }
  }
  const gates = evaluateDeterministicGates(scenario, state, events);
  const eligibility = assessmentEligibility(scenario, state, events, gates);
  const expectedMatches = fixture.expectedGateResults.every((expected) => gates.some((gate) => gate.ruleId === expected.ruleId && gate.status === expected.status));
  const passed = expectedMatches && (fixture.kind === 'golden_pass' ? eligibility.eligible && state.selectedDisposition === fixture.expectedDisposition : !eligibility.eligible);
  return { passed, state, events, gates, eligibility, errors };
}

/** Model coaching can lower a score through the rubric, but can never reverse deterministic evidence. */
export function applyDeterministicAssessment(input: {
  evaluation: SimEvaluation;
  gates: SimulationGateResult[];
  eligibility: SimulationAssessmentEligibility;
  disposition: DispositionValidation;
}): SimEvaluation {
  const failures = input.gates.filter((gate) => gate.status === 'fail');
  const deterministicReason = failures.length > 0
    ? failures.map((gate) => `${gate.ruleId}: ${gate.learnerFeedback}`).join(' ')
    : input.eligibility.eligible
      ? null
      : input.eligibility.reasons.join(' ');
  const coaching = [
    ...failures.map((gate) => `${gate.learnerFeedback} [${gate.evidenceEventIds.join(', ') || 'no event evidence'}]`),
    ...input.eligibility.reasons,
    ...input.evaluation.coachingImprovements,
  ];
  const criterionResults = input.evaluation.criterionResults.map((criterion) => ({
    ...criterion,
    evidenceEventIds: criterion.evidenceEventIds ?? [],
  }));
  return SimEvaluationSchema.parse({
    ...input.evaluation,
    overallScorePct: input.eligibility.eligible ? input.evaluation.overallScorePct : Math.min(59, input.evaluation.overallScorePct),
    passed: input.evaluation.passed && input.eligibility.eligible && input.disposition.valid,
    autoFailedReason: deterministicReason ?? input.evaluation.autoFailedReason,
    dispositionCorrect: input.disposition.valid,
    summaryFeedback: input.eligibility.eligible
      ? input.evaluation.summaryFeedback
      : `Assessment evidence is incomplete or failed a required rule. ${input.evaluation.summaryFeedback}`,
    coachingImprovements: [...new Set(coaching)].slice(0, 8),
    criterionResults,
    gateResults: input.gates,
    assessmentEligibility: input.eligibility,
    dispositionValidation: input.disposition,
    evidenceEventIds: [...new Set([
      ...input.gates.flatMap((gate) => gate.evidenceEventIds),
      ...criterionResults.flatMap((criterion) => criterion.evidenceEventIds),
    ])],
  });
}
