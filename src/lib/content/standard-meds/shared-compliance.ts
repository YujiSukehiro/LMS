import { STANDARD_MEDS_SHARED_RULE_IDS as R } from './rules';
import { card, fillBlank, matchPairs, multipleChoice, sequence, trueFalse, unit } from './curriculum-builders';
import type { StandardMedsTrackSpec } from './track-spec';

/** Shared-rule retrieval is projected into each call pack with track-specific examples and drill mappings. */
export function sharedComplianceUnit(spec: StandardMedsTrackSpec) {
  const code = spec.code;
  const key = 'shared-compliance';
  const pages = spec.sharedPages;
  return unit(
    code,
    key,
    2,
    'Shared call gates and medical boundaries',
    `Apply the inherited Standard Meds gates to ${spec.title}; these rules stop unsafe or incorrectly routed actions.`,
    7,
    [
      card(
        code,
        key,
        1,
        'Identity, permission, and contact limits come before recovery',
        `For ${spec.title}, identify as a Standard Meds caller rather than a doctor, answer human/AI questions honestly, dial only 09:00–21:00 lead-local time, and disclose recording where required. A clear refusal ends offers and triggers permanent suppression.`,
        'A polite call is still non-compliant when contact gates fail.',
        ['Check local time and recording requirements before the pitch', 'Stop immediately after a clear opt-out'],
        ['Do not hide AI status or imply clinical authority', 'Do not continue with another offer after refusal'],
        pages,
      ),
      card(
        code,
        key,
        2,
        'Links and clinical statements need exact boundaries',
        `${spec.sharedLinkExample} may be used only after the required customer state and permission. Never invoke SMS on voicemail, invent an arrangement, cross-sell, promise approval, diagnose, or use false urgency; respect the approved offer/re-offer limit.`,
        'The correct next action can be no action: stop, suppress, escalate, or close.',
        ['Select only the approved stage-matched synthetic asset', 'Route medical questions without reassurance'],
        ['Do not send a link to voicemail', 'Do not invent discounts, urgency, approval, or extra re-offers'],
        pages,
      ),
    ],
    [
      multipleChoice({
        code, unitKey: key, index: 1, pillar: 'compliance_boundaries', sourcePages: pages,
        prompt: `How should a ${spec.title} caller handle identity and a direct “are you a robot?” question?`,
        explanation: 'Both identity gates apply: Standard Meds/non-doctor identification and an honest human/AI answer.',
        ruleIds: [R[0], R[1]],
        correct: 'Identify as Standard Meds, not a doctor, and answer the AI question honestly',
        distractors: ['Say the call is from the physician’s office', 'Avoid the AI question and start the offer', 'Claim to be a human regardless of the actual channel'],
      }),
      sequence({
        code, unitKey: key, index: 2, pillar: 'verification_crm', sourcePages: pages,
        prompt: `Order the pre-contact checks for this ${spec.title} outbound attempt.`,
        explanation: 'The dial window and recording requirement are contact gates, not wrap-up tasks.',
        ruleIds: [R[2], R[3]],
        steps: ['Validate the lead-local time is 09:00–21:00', 'Check whether recording disclosure is required', 'Disclose recording when required before the pitch', 'Continue only while contact permission remains valid'],
      }),
      matchPairs({
        code, unitKey: key, index: 3, pillar: 'compliance_boundaries', sourcePages: pages,
        prompt: 'Match each shared-rule trigger to the required action.',
        explanation: 'Opt-out, voicemail, cross-sell, and invented-arrangement cases require different stopped actions.',
        ruleIds: [R[4], R[5], R[6], R[10]],
        pairs: [
          ['Clear request to stop calling', 'Suppress permanently and end without another offer'],
          ['Voicemail reached', 'Leave only the approved generic message; send no SMS'],
          ['Another product seems relevant', 'Keep this recovery call to one product'],
          ['Caller requests an unapproved coupon', 'Decline improvisation and use only approved terms'],
        ],
      }),
      trueFalse({
        code, unitKey: key, index: 4, pillar: 'escalation_triage', sourcePages: pages,
        prompt: 'Does this response stay inside the shared medical and approval boundaries?',
        explanation: 'Safety, diagnosis, cure, approval, and urgency claims require a boundary or physician route, not reassurance.',
        ruleIds: [R[7], R[8], R[9]],
        statement: spec.sharedMedicalExample,
        isCompliant: false,
      }),
      fillBlank({
        code, unitKey: key, index: 5, pillar: 'workflow_execution', sourcePages: pages,
        prompt: `Complete the asset rule for ${spec.sharedLinkExample}.`,
        explanation: 'The approved stage-specific link follows the required state and consent; voicemail never triggers a send.',
        ruleIds: [R[10], R[12]],
        before: 'Send the correct approved link only after the required state and ',
        after: '; never invoke a send to voicemail.',
        correctWord: 'permission',
        distractors: ['assumption', 'urgency', 're-offer'],
      }),
      multipleChoice({
        code, unitKey: key, index: 6, pillar: 'retention_objection', sourcePages: pages,
        prompt: `The approved re-offer limit is exhausted on this ${spec.title} call, but the lead has not opted out. What happens next?`,
        explanation: 'The offer cap prevents additional pressure even without an explicit opt-out; close using the approved branch.',
        ruleIds: [R[11]],
        correct: 'Stop offering and complete the approved close and disposition',
        distractors: ['Reframe the same offer as a new one', 'Add a countdown to force a decision', 'Switch to another product instead'],
      }),
    ],
  );
}
