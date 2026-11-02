import type { PublicSimScenario } from '@/lib/schemas/curriculum';
import type { ScenarioQAFixture, ScenarioState, ScriptedSimulationStep, SimulationAction } from '@/lib/schemas/simulation-state';
import { FAKE_PAYMENT_TOKENS } from '@/lib/schemas/simulation-constants';

type CanonicalDisposition = NonNullable<ScenarioState['selectedDisposition']>;

export const STANDARD_MEDS_SCENARIO_IDS = [
  'NC-DOSAGE-BASE', 'NC-CHECKOUT-FRICTION', 'NC-OPT-OUT', 'NC-VOICEMAIL', 'NC-MEDICAL-BOUNDARY', 'NC-OFFER-LIMIT',
  'LR-DOSAGE-BASE', 'LR-CHECKOUT-FRICTION', 'LR-IRRITATION-BOUNDARY', 'LR-NO-FALSE-CLAIM', 'LR-OPT-OUT-VOICEMAIL',
  'ED-QUATTRO-BASE', 'ED-TRISHOT-UPGRADE', 'ED-PRICE-CLARITY', 'ED-INTERACTION-STOP', 'ED-PRIVACY', 'ED-SHARED-GATES',
  'ZR-DOSAGE-PACKAGE', 'ZR-CHECKOUT-HOST', 'ZR-ZERO-DUE', 'ZR-MEDICAL-BOUNDARY', 'ZR-TIMELINE', 'ZR-SHARED-GATES',
  'NAD-SCORE-PASSIVE', 'NAD-SCORE-PRICE-ASKED', 'NAD-CHECKOUT-INSTALLMENTS', 'NAD-THIRD-PARTY', 'NAD-SCORE-NOT-DIAGNOSIS', 'NAD-MEDICAL-BOUNDARY', 'NAD-SHARED-GATES',
  'CS-SEVERE-REACTION', 'CS-REPEAT-CANCEL', 'CS-AFFORDABILITY', 'CS-PAUSE', 'CS-UNRECOGNIZED-PURCHASE', 'CS-UPGRADE-EXCEPTION', 'CS-LATE-TRACKING', 'CS-DAMAGED-PACKAGE', 'CS-REFUND', 'CS-THIRD-PARTY', 'CS-STOP-CONTACT', 'CS-PRE-SALE',
  'MC-IDENTITY-RECOVERY', 'MC-CLINICAL-RECOVERY', 'MC-NAIL-PHOTO', 'MC-ALREADY-REPLIED', 'MC-NO-DOCTOR-QUESTION', 'MC-DAY-PRIORITY', 'MC-ID-EMAIL-ALTERNATIVE', 'MC-THIRD-PARTY-VOICEMAIL', 'MC-EXPIRED-EXCEPTION',
  'RN-CONFIRMED-UPDATE', 'RN-FAILED-UPDATE', 'RN-SELF-SERVICE', 'RN-ORGANIC-STALE', 'RN-DECLINE-PRIVACY', 'RN-CANCEL', 'RN-ADVERSE-REACTION', 'RN-THIRD-PARTY', 'RN-NO-INVENTED-ARRANGEMENT',
] as const;

export type StandardMedsScenarioId = (typeof STANDARD_MEDS_SCENARIO_IDS)[number];

type Queue = NonNullable<PublicSimScenario['context']>['queue'];
type Stage = NonNullable<PublicSimScenario['context']>['stage'];

const PRODUCTS: Record<string, string> = { NC: 'NeuroCalmRx', LR: 'LiftRx', ED: 'TriShot', ZR: 'ZoliraRx', NAD: 'NAD+', CS: 'All Products', MC: 'Pending Information', RN: 'Renewals' };
const QUEUES: Record<string, Queue> = { NC: 'recovery', LR: 'recovery', ED: 'recovery', ZR: 'recovery', NAD: 'recovery', CS: 'customer_support', MC: 'medical_chat', RN: 'renewals' };

function branchFor(id: string): string {
  return id.toLowerCase().replaceAll('-', '_');
}

function stageFor(id: string): Stage {
  const prefix = id.split('-')[0]!;
  if (prefix === 'CS') return 'support_case';
  if (prefix === 'MC') return 'pending_info';
  if (prefix === 'RN') return 'renewal_declined';
  if (id.includes('CHECKOUT')) return 'checkout';
  if (id.includes('SCORE')) return 'score';
  if (prefix === 'ED') return 'dosage_checkout';
  return 'dosage';
}

function dispositionFor(id: string): CanonicalDisposition {
  if (/OPT-OUT|SHARED-GATES|REPEAT-CANCEL|UNRECOGNIZED-PURCHASE|STOP-CONTACT|RN-CANCEL|SEVERE-REACTION/.test(id)) return 'Not interested';
  if (/VOICEMAIL/.test(id) && !/OPT-OUT|THIRD-PARTY/.test(id)) return "Didn't reply";
  if (/ALREADY-REPLIED|ORGANIC-STALE/.test(id)) return 'Organic';
  if (/EXPIRED|ADVERSE-REACTION/.test(id)) return 'Lost';
  if (/THIRD-PARTY|FAILED-UPDATE|UPGRADE-EXCEPTION|LATE-TRACKING|DAMAGED-PACKAGE|CS-REFUND|NO-DOCTOR-QUESTION|NO-INVENTED/.test(id)) return 'Callback scheduled';
  return 'Recovered';
}

function isNoCall(id: string): boolean {
  return /ALREADY-REPLIED|NO-DOCTOR-QUESTION|ORGANIC-STALE/.test(id);
}

function isThirdParty(id: string): boolean {
  return id.includes('THIRD-PARTY');
}

function isVoicemail(id: string): boolean {
  return id === 'NC-VOICEMAIL';
}

function requiredInspections(id: string): string[] {
  const prefix = id.split('-')[0]!;
  if (prefix === 'CS') return ['patient_order', 'subscription_state'];
  if (prefix === 'MC') return ['tenant_pending', 'order_date', 'doctor_patient_chat', 'local_time'];
  if (prefix === 'RN') return ['product_plan_amount', 'notes', 'current_state', 'local_time'];
  return ['product_stage', 'local_time', 'offer_state'];
}

function requiredWorkflowActions(id: string): string[] {
  if (/SEVERE-REACTION|REPEAT-CANCEL|UNRECOGNIZED-PURCHASE|RN-CANCEL/.test(id)) return ['cancellation_completed'];
  if (id === 'CS-AFFORDABILITY') return ['affordability_next_only', 'recovery_confirmed'];
  if (id === 'CS-PAUSE') return ['pause_one_month', 'recovery_confirmed'];
  if (id === 'MC-NAIL-PHOTO') return ['portal_image_box_guidance'];
  if (id.startsWith('MC-') || id.startsWith('RN-') || dispositionFor(id) !== 'Recovered') return [];
  return ['recovery_confirmed'];
}

function requiredGateIds(id: string): string[] {
  const gates: string[] = [];
  const prefix = id.split('-')[0]!;
  if (prefix !== 'CS' && !isNoCall(id)) gates.push('local_time', 'recording_disclosure');
  if (['customer_support', 'medical_chat', 'renewals'].includes(QUEUES[prefix]!) && !isNoCall(id)) gates.push('identity_privacy');
  if (/OPT-OUT|SHARED-GATES|STOP-CONTACT/.test(id)) gates.push('opt_out');
  if (isVoicemail(id)) gates.push('voicemail_sms');
  if ((prefix !== 'CS' && prefix !== 'MC' && prefix !== 'RN' && !/OPT-OUT|VOICEMAIL|THIRD-PARTY|SHARED-GATES/.test(id)) || id === 'CS-PRE-SALE') gates.push('correct_link');
  if (id.includes('OFFER-LIMIT')) gates.push('offer_limit');
  if (id === 'NAD-SCORE-PASSIVE' || id === 'NAD-SCORE-PRICE-ASKED') gates.push('pricing_passive');
  if (id === 'ED-TRISHOT-UPGRADE') gates.push('upgrade_sequence');
  if (/MEDICAL-BOUNDARY|IRRITATION-BOUNDARY|INTERACTION-STOP|NOT-DIAGNOSIS/.test(id)) gates.push('clinical_boundary');
  if (id === 'CS-SEVERE-REACTION') gates.push('severe_reaction');
  if (id === 'CS-REPEAT-CANCEL') gates.push('repeat_cancellation');
  if (id === 'CS-AFFORDABILITY') gates.push('affordability_calculation');
  if (id === 'CS-REFUND') gates.push('refund_boundary');
  if (/UPGRADE-EXCEPTION|LATE-TRACKING|DAMAGED-PACKAGE|CS-REFUND|EXPIRED|ADVERSE-REACTION/.test(id)) gates.push('escalation_privacy');
  if (isNoCall(id)) gates.push('unnecessary_dial');
  if (id.startsWith('MC-') && !isNoCall(id) && !isThirdParty(id)) gates.push('medical_answer_boundary');
  if (id === 'MC-NAIL-PHOTO') gates.push('nail_photo_branch');
  if (id === 'RN-ADVERSE-REACTION') gates.push('adverse_reaction_restart');
  if (id.startsWith('RN-') && !isNoCall(id) && !isThirdParty(id) && !/CANCEL|ADVERSE/.test(id)) gates.push('payment_data');
  if (/RN-CONFIRMED-UPDATE|RN-SELF-SERVICE|RN-DECLINE-PRIVACY/.test(id)) gates.push('renewal_confirmation');
  return [...new Set(gates)];
}

function requiredWrapUpEvidence(id: string): string[] {
  const evidence = ['note'];
  if (/OPT-OUT|SHARED-GATES|STOP-CONTACT/.test(id)) evidence.push('suppression');
  if (dispositionFor(id) === 'Callback scheduled') evidence.push('callback');
  if (/UPGRADE-EXCEPTION|LATE-TRACKING|DAMAGED-PACKAGE|CS-REFUND|EXPIRED|ADVERSE-REACTION/.test(id)) evidence.push('escalation');
  return evidence;
}

/** Explicit synthetic context for every document-06 scenario; these QA definitions are not publication approval. */
export function buildStandardMedsScenario(id: StandardMedsScenarioId): PublicSimScenario {
  const prefix = id.split('-')[0]!;
  const queue = QUEUES[prefix]!;
  const stage = stageFor(id);
  return {
    id,
    title: `SYNTHETIC QA — ${id}`,
    difficulty: /BOUNDARY|THIRD|EXPIRED|ADVERSE|SEVERE/.test(id) ? 'EDGE_CASE' : 'STANDARD',
    counterpartyRoleLabel: isThirdParty(id) ? 'Synthetic third party' : isVoicemail(id) ? 'Synthetic voicemail' : 'Synthetic customer',
    contextTicketSummary: `SYNTHETIC TRAINING — ${queue} / ${stage}. No live patient, order, link, or external action.`,
    openingMessage: isVoicemail(id) ? 'Synthetic voicemail tone.' : 'This is a synthetic training customer.',
    dispositionOptions: ['Recovered', 'Callback scheduled', "Didn't reply", 'Not interested', 'Organic', 'Lost'],
    maxTurns: 8,
    passScoreThreshold: 80,
    context: {
      direction: queue === 'customer_support' ? 'inbound' : 'outbound',
      queue,
      product: PRODUCTS[prefix]!,
      stage,
      contactState: isThirdParty(id) ? 'third_party' : isVoicemail(id) ? 'voicemail' : queue === 'recovery' ? 'lead' : 'existing_patient',
      pricingPosture: id.startsWith('NAD-SCORE') ? 'passive' : queue === 'recovery' ? 'active' : 'not_applicable',
      caseBranch: branchFor(id),
      syntheticTimezone: 'America/Boise',
      syntheticNow: '2026-01-15T17:00:00.000Z',
      sourceRevision: 'synthetic-qa-source-not-approved-for-publication',
      curriculumVersion: 'synthetic-qa-v1',
    },
    evidenceRequirements: {
      minimumLearnerTurns: isNoCall(id) || isVoicemail(id) ? 0 : isThirdParty(id) || /OPT-OUT|SHARED-GATES|STOP-CONTACT/.test(id) ? 1 : 2,
      requiredInspections: requiredInspections(id),
      requiredWorkflowActions: requiredWorkflowActions(id),
      requiredWrapUpEvidence: requiredWrapUpEvidence(id),
      requiredGateIds: requiredGateIds(id),
      requiredCustomerConcerns: [],
      expectedDurationMinutes: 8,
      gateSourceRefs: {},
      maximumCriticalFailures: 0,
      maximumMajorFailures: 0,
    },
  };
}

function action(action: SimulationAction): ScriptedSimulationStep {
  return { action };
}

function expectedLink(id: StandardMedsScenarioId): string {
  const scenario = buildStandardMedsScenario(id);
  const context = scenario.context!;
  const product = context.product.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  if (id === 'CS-PRE-SALE') return `quiz-${product}`;
  if (context.product === 'NAD+' && context.stage === 'score') return 'nad-results-personalized';
  if (context.product === 'ZoliraRx' && context.stage === 'checkout') return 'zolirarx-fungus-checkout';
  return `${product}-${context.stage}-link`;
}

function needsEscalation(id: string): boolean {
  return /UPGRADE-EXCEPTION|LATE-TRACKING|DAMAGED-PACKAGE|CS-REFUND|EXPIRED|ADVERSE-REACTION/.test(id);
}

function passSteps(id: StandardMedsScenarioId): ScriptedSimulationStep[] {
  const definition = buildStandardMedsScenario(id);
  const disposition = dispositionFor(id);
  const steps: ScriptedSimulationStep[] = definition.evidenceRequirements!.requiredInspections.map((inspectionId) => action({ type: 'inspect', inspectionId }));
  if (isNoCall(id)) {
    if (disposition === 'Organic') steps.push(action({ type: 'patient_completion', completionId: 'organic_before_call', organic: true }));
  } else {
    steps.push(action({ type: 'dial' }));
    if (definition.evidenceRequirements!.requiredGateIds.includes('recording_disclosure')) steps.push(action({ type: 'record_disclosure' }));
    if (!isThirdParty(id) && !isVoicemail(id) && definition.context!.queue !== 'recovery') steps.push(action({ type: 'verify_identity' }));
    if (id === 'CS-SEVERE-REACTION') {
      steps.push({ learnerUtterance: 'Call 911 or emergency services now for current severe symptoms.' });
    } else if (/MEDICAL-BOUNDARY|IRRITATION-BOUNDARY|INTERACTION-STOP|NOT-DIAGNOSIS/.test(id)) {
      steps.push({ learnerUtterance: 'I will route that question to the physician or medical team without giving advice.' });
    } else if (!isVoicemail(id)) {
      steps.push({ learnerUtterance: isThirdParty(id) ? 'May I arrange a generic callback for the patient?' : 'I will follow the approved process and explain the next step clearly.' });
    }
    if (/OPT-OUT|SHARED-GATES|STOP-CONTACT/.test(id)) steps.push(action({ type: 'set_opt_out' }), action({ type: 'suppress' }));
    if (definition.evidenceRequirements!.requiredGateIds.includes('correct_link')) {
      steps.push(action({ type: 'grant_sms_permission' }), action({ type: 'send_sms', assetId: expectedLink(id) }));
    }
    if (id === 'ED-TRISHOT-UPGRADE') steps.push(action({ type: 'set_price_context', customerAskedPrice: true, selectedPlanId: 'trishot-base', baseRecoveryCommitted: true }), action({ type: 'offer', assetId: 'trishot-upgrade-12' }));
    if (id.includes('OFFER-LIMIT')) steps.push(action({ type: 'offer', assetId: 'base-offer' }), action({ type: 'offer', assetId: 'approved-reoffer' }));
    if (id.startsWith('RN-') && definition.evidenceRequirements!.requiredGateIds.includes('payment_data')) {
      steps.push(action({ type: 'recording', state: 'paused' }), action({ type: 'secure_payment', fakeToken: id === 'RN-FAILED-UPDATE' ? FAKE_PAYMENT_TOKENS.failure : FAKE_PAYMENT_TOKENS.success }), action({ type: 'recording', state: 'active' }));
    }
    for (const actionId of definition.evidenceRequirements!.requiredWorkflowActions) steps.push(action({ type: 'workflow', actionId }));
    if (id.startsWith('MC-') && !isThirdParty(id)) {
      const completionId = id === 'MC-NAIL-PHOTO' ? 'patient_photo_uploaded' : id === 'MC-CLINICAL-RECOVERY' ? 'patient_clinical_completed' : 'patient_id_submitted';
      steps.push(action({ type: 'patient_completion', completionId, organic: false }));
    }
    if (needsEscalation(id)) steps.push(action({ type: 'escalate', channel: 'fake-support', orderId: 'SYN-100', vertical: definition.context!.queue, requestedCorrection: 'Review the synthetic case branch.' }));
    if (!isVoicemail(id) && !/OPT-OUT|SHARED-GATES|STOP-CONTACT/.test(id) && definition.evidenceRequirements!.minimumLearnerTurns > 1) {
      steps.push({ learnerUtterance: isThirdParty(id) ? 'I will keep this generic and protect privacy.' : 'I will confirm the observed outcome and record the approved wrap-up.' });
    }
  }
  if (disposition === 'Callback scheduled') steps.push(action({ type: 'callback', callbackAt: '2026-01-16T17:00:00.000Z' }));
  steps.push(action({ type: 'note', text: 'Synthetic training evidence recorded.' }));
  steps.push(action({ type: 'wrap_up', disposition }));
  return steps;
}

function failFixture(id: StandardMedsScenarioId): { gateId: string; steps: ScriptedSimulationStep[] } {
  const definition = buildStandardMedsScenario(id);
  const connected = definition.evidenceRequirements!.requiredInspections.map((inspectionId) => action({ type: 'inspect', inspectionId }));
  if (!isNoCall(id)) connected.push(action({ type: 'dial' }));
  if (isNoCall(id)) return { gateId: 'unnecessary_dial', steps: [...connected, action({ type: 'dial' })] };
  if (isVoicemail(id)) return { gateId: 'voicemail_sms', steps: [...connected, action({ type: 'send_sms', assetId: expectedLink(id) })] };
  if (/OPT-OUT|SHARED-GATES|STOP-CONTACT/.test(id)) return { gateId: 'opt_out', steps: [...connected, action({ type: 'set_opt_out' }), action({ type: 'offer', assetId: 'forbidden-after-opt-out' })] };
  if (id === 'NAD-SCORE-PASSIVE') return { gateId: 'pricing_passive', steps: [...connected, { learnerUtterance: 'The price is $199 per month.' }] };
  if (isThirdParty(id)) return { gateId: 'identity_privacy', steps: [...connected, { learnerUtterance: 'I am calling about the NAD+ assessment and medical question.' }] };
  if (id === 'ED-TRISHOT-UPGRADE') return { gateId: 'upgrade_sequence', steps: [...connected, action({ type: 'offer', assetId: 'trishot-upgrade-12' })] };
  if (id.includes('OFFER-LIMIT')) return { gateId: 'offer_limit', steps: [...connected, action({ type: 'offer', assetId: 'one' }), action({ type: 'offer', assetId: 'two' }), action({ type: 'offer', assetId: 'three' })] };
  if (/MEDICAL-BOUNDARY|IRRITATION-BOUNDARY|INTERACTION-STOP|NOT-DIAGNOSIS/.test(id)) return { gateId: 'clinical_boundary', steps: [...connected, { learnerUtterance: 'Yes, it is safe to use and will cure the condition.' }] };
  if (id === 'CS-SEVERE-REACTION') return { gateId: 'severe_reaction', steps: [...connected, action({ type: 'offer', assetId: 'retention-before-911' })] };
  if (id === 'CS-REPEAT-CANCEL') return { gateId: 'repeat_cancellation', steps: [...connected, action({ type: 'offer', assetId: 'retention-offer' })] };
  if (id === 'CS-AFFORDABILITY') return { gateId: 'affordability_calculation', steps: [...connected, action({ type: 'workflow', actionId: 'affordability_wrong_amount' })] };
  if (/UPGRADE-EXCEPTION|LATE-TRACKING|DAMAGED-PACKAGE|CS-REFUND/.test(id)) return { gateId: 'escalation_privacy', steps: [...connected, action({ type: 'escalate', channel: 'fake-support', orderId: 'SYN-100', vertical: 'support', requestedCorrection: 'Contact patient@example.com about medication' })] };
  if (id === 'MC-NAIL-PHOTO') return { gateId: 'nail_photo_branch', steps: [...connected, action({ type: 'workflow', actionId: 'find_doctor_message' })] };
  if (id.startsWith('MC-')) return { gateId: 'medical_answer_boundary', steps: [...connected, { learnerUtterance: 'Send me your ID and tell me your medication list.' }] };
  if (id === 'RN-ADVERSE-REACTION') return { gateId: 'adverse_reaction_restart', steps: [...connected, action({ type: 'workflow', actionId: 'subscription_restart' })] };
  if (id.startsWith('RN-')) return { gateId: 'payment_data', steps: [...connected, action({ type: 'secure_payment', fakeToken: FAKE_PAYMENT_TOKENS.success })] };
  if (id === 'CS-STOP-CONTACT') return { gateId: 'opt_out', steps: connected };
  if (definition.evidenceRequirements!.requiredGateIds.includes('correct_link')) {
    return { gateId: 'correct_link', steps: [...connected, action({ type: 'grant_sms_permission' }), action({ type: 'send_sms', assetId: 'generic-wrong-link' })] };
  }
  return { gateId: 'identity_privacy', steps: [...connected, { learnerUtterance: 'I can discuss your subscription, billing, and card before verification.' }] };
}

function combinedVoicemailFixtures(id: StandardMedsScenarioId): ScenarioQAFixture[] {
  const definition = buildStandardMedsScenario(id);
  const inspections = definition.evidenceRequirements!.requiredInspections.map((inspectionId) => action({ type: 'inspect' as const, inspectionId }));
  const passSteps: ScriptedSimulationStep[] = [
    ...inspections,
    action({ type: 'dial' }),
    action({ type: 'record_disclosure' }),
    { learnerUtterance: 'I will leave only an approved generic callback message without protected details.' },
  ];
  if (id === 'LR-OPT-OUT-VOICEMAIL') {
    passSteps.push(action({ type: 'set_opt_out' }), action({ type: 'suppress' }));
  } else {
    passSteps.push(action({ type: 'callback', callbackAt: '2026-01-16T17:00:00.000Z' }));
  }
  passSteps.push(
    action({ type: 'set_contact', contact: 'voicemail' }),
    action({ type: 'note', text: 'Synthetic voicemail branch; no SMS and no protected disclosure.' }),
    action({ type: 'wrap_up', disposition: "Didn't reply" }),
  );
  return [
    {
      id: `${id}-VOICEMAIL-GOLDEN-PASS`,
      title: `${id} separate zero-SMS voicemail golden pass`,
      kind: 'golden_pass',
      steps: passSteps,
      expectedDisposition: "Didn't reply",
      expectedGateResults: [...definition.evidenceRequirements!.requiredGateIds, 'voicemail_sms'].map((ruleId) => ({ ruleId, status: 'pass' })),
    },
    {
      id: `${id}-VOICEMAIL-GOLDEN-CRITICAL-FAIL`,
      title: `${id} separate voicemail SMS critical fail`,
      kind: 'golden_critical_fail',
      steps: [...inspections, action({ type: 'dial' }), action({ type: 'set_contact', contact: 'voicemail' }), action({ type: 'send_sms', assetId: 'forbidden-voicemail-link' })],
      expectedDisposition: dispositionFor(id),
      expectedGateResults: [{ ruleId: 'voicemail_sms', status: 'fail' }],
    },
  ];
}

export function standardMedsQAFixtures(id: StandardMedsScenarioId): ScenarioQAFixture[] {
  const definition = buildStandardMedsScenario(id);
  const failure = failFixture(id);
  return [
    {
      id: `${id}-GOLDEN-PASS`,
      title: `${id} scripted golden pass`,
      kind: 'golden_pass',
      steps: passSteps(id),
      expectedDisposition: dispositionFor(id),
      expectedGateResults: definition.evidenceRequirements!.requiredGateIds.map((ruleId) => ({ ruleId, status: 'pass' })),
    },
    {
      id: `${id}-GOLDEN-CRITICAL-FAIL`,
      title: `${id} scripted critical fail`,
      kind: 'golden_critical_fail',
      steps: failure.steps,
      expectedDisposition: dispositionFor(id),
      expectedGateResults: [{ ruleId: failure.gateId, status: 'fail' }],
    },
    ...(/OPT-OUT-VOICEMAIL|THIRD-PARTY-VOICEMAIL/.test(id) ? combinedVoicemailFixtures(id) : []),
  ];
}
