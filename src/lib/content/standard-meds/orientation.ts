import { TrackUnitSchema } from '@/lib/schemas/curriculum';
import { getStandardMedsSource, STANDARD_MEDS_SOURCES } from './sources';
import { card, matchPairs, multipleChoice, sequence, trueFalse, unit } from './curriculum-builders';
import { publicationBlockersFor, STANDARD_MEDS_SME_DECISION_IDS } from './publication';
import type { StandardMedsOrientationPack } from './types';

const code = 'SM-00' as const;
const source = getStandardMedsSource(code);

const units = [
  unit(code, 'source-navigation', 0, 'Navigate the Standard Meds source hub', 'Find the eight call tracks, their queue roles, and the shared-rule sources without treating the overview as call certification.', 4, [
    card(code, 'source-navigation', 1, 'The overview is a registry, not a call track', 'SM-00 explains the training hub and relationships among nine PDFs. Use it to locate SM-01 through SM-08 and their curriculum roles; it supplies no standalone call scenario, disposition, offer, or certification track.', 'Orientation ends at source navigation and bundle readiness.', ['Choose the call pack whose queue matches the task', 'Use SM-01 pages 14–15 as the primary shared-rule source'], ['Do not create SM-00 call simulations', 'Do not infer operational details absent from a track source'], [1, 2]),
    card(code, 'source-navigation', 2, 'Track structure follows customer and queue state', 'SM-01 through SM-05 cover product recovery with track-specific stages; SM-06 is inbound support and retention; SM-07 is pending-information outbound service; SM-08 is failed-payment renewal service. SM-02 pages 10–12 cross-check the shared foundation rather than replacing track-specific rules.', 'The code identifies a source and curriculum role, not a reusable generic script.', ['Cross-check shared rules with SM-02 pages 10–12', 'Read each track’s own funnel and workflow section'], ['Do not apply recovery sales behavior to support or renewals', 'Do not treat Medical Chat recovery as approval'], [1, 2]),
  ], [
    matchPairs({ code, unitKey: 'source-navigation', index: 1, pillar: 'workflow_execution', prompt: 'Match each source code to its curriculum role.', explanation: 'The overview is a navigation layer over five recovery tracks and three service tracks.', sourcePages: [1, 2], ruleIds: ['SM00_SOURCE_NAVIGATION'], pairs: [['SM-01 through SM-05', 'Product-specific recovery tracks'], ['SM-06', 'Inbound support and retention'], ['SM-07', 'Pending-information service'], ['SM-08', 'Failed-payment renewal service']] }),
    multipleChoice({ code, unitKey: 'source-navigation', index: 2, pillar: 'compliance_boundaries', prompt: 'Where is the primary shared-foundation source for product recovery?', explanation: 'Document 06 names NeuroCalmRx pages 14–15 as primary and LiftRx pages 10–12 as the cross-check.', sourcePages: [1, 2], ruleIds: ['SM00_SHARED_INHERITANCE'], correct: 'SM-01 pages 14–15, cross-checked with SM-02 pages 10–12', distractors: ['SM-00 pages 1–2 only', 'SM-08 payment screens only', 'Any live product page without review'] }),
    trueFalse({ code, unitKey: 'source-navigation', index: 3, pillar: 'compliance_boundaries', prompt: 'Is this a valid use of SM-00?', explanation: 'The overview must remain orientation/source navigation and never become artificial call certification.', sourcePages: [1, 2], ruleIds: ['SM00_ORIENTATION_ONLY'], statement: 'A learner can complete SM-00 instead of a product or service call track to earn call certification.', isCompliant: false }),
    sequence({ code, unitKey: 'source-navigation', index: 4, pillar: 'workflow_execution', prompt: 'Order the route from a training need to the correct source.', explanation: 'Queue recognition precedes source selection; shared rules are then inherited alongside the track-specific source.', sourcePages: [1, 2], ruleIds: ['SM00_SOURCE_NAVIGATION', 'SM00_SHARED_INHERITANCE'], steps: ['Identify recovery, support, pending-information, or renewal work', 'Select the matching SM-01 through SM-08 source', 'Attach the shared foundation and relevant references', 'Review track-specific stages, assets, and scenarios'] }),
  ]),
  unit(code, 'bundle-readiness', 1, 'Check source registration and publication readiness', 'Verify hashes, page extraction, inheritance, exact evidence, and open decisions before any track can be published.', 4, [
    card(code, 'bundle-readiness', 1, 'Registration proves bytes and extraction, not approval', 'Each of the nine registrations records the actual PDF SHA-256, page count, and per-page raw-text hash, character count, and extraction flags. Raw text remains in the source-upload flow. These checks establish revision identity and extraction quality; they do not establish exact claim support or trainer approval.', 'A valid hash identifies content; it does not approve the curriculum.', ['Compare registered hashes with the actual local files', 'Review every extraction flag and affected page'], ['Do not store manifest page text as a substitute for evidence', 'Do not treat registration as trainer sign-off'], [1, 2]),
    card(code, 'bundle-readiness', 2, 'Publication waits for evidence, assets, and SME decisions', 'Before publication, every claim and rubric needs matching exact excerpts and trainer approval, operational assets need scoped approval and effective dates, and flagged interfaces need transcription or structured actions. SME-01 through SME-10 remain explicit decisions; unresolved items block their affected content.', 'A schema-valid synthetic draft remains unpublished while any required blocker is open.', ['Record approver identity against exact source and curriculum versions', 'Keep each SME decision scoped to its affected assets'], ['Do not invent SME resolutions or effective dates', 'Do not publish synthetic links as live operational assets'], [1, 2]),
  ], [
    sequence({ code, unitKey: 'bundle-readiness', index: 1, pillar: 'verification_crm', prompt: 'Order the local source-registration checks.', explanation: 'Actual file bytes and extraction output produce the manifest; trainer review is a separate later gate.', sourcePages: [1, 2], ruleIds: ['SM00_SOURCE_INTEGRITY'], steps: ['Read each supplied local PDF and hash its bytes', 'Extract pages and record count, hashes, characters, and flags', 'Validate all nine registrations against the source inventory', 'Submit exact evidence and assets for separate trainer review'] }),
    trueFalse({ code, unitKey: 'bundle-readiness', index: 2, pillar: 'compliance_boundaries', prompt: 'Does a complete registration manifest permit publication?', explanation: 'Hashes and extraction metadata establish source identity only; exact evidence, approvals, assets, and SME decisions remain required.', sourcePages: [1, 2], ruleIds: ['SM00_PUBLICATION_GATE'], statement: 'Nine matching PDF hashes and page counts are sufficient to publish all eight call packs.', isCompliant: false }),
    matchPairs({ code, unitKey: 'bundle-readiness', index: 3, pillar: 'escalation_triage', prompt: 'Match each readiness gap to its required owner action.', explanation: 'Different blockers require different evidence and approval work; none is resolved by schema validity.', sourcePages: [1, 2], ruleIds: ['SM00_PUBLICATION_GATE'], pairs: [['Page reference without exact excerpt', 'Attach matching excerpt and trainer approval'], ['Image-heavy interface extraction', 'Provide transcription or structured action asset'], ['Open SME conflict', 'Record explicit owner decision and scope'], ['Synthetic operational link', 'Approve exact scoped asset before live use']] }),
    multipleChoice({ code, unitKey: 'bundle-readiness', index: 4, pillar: 'verification_crm', prompt: 'What belongs in this text-free registration manifest?', explanation: 'The manifest carries source identity and extraction metadata while raw text stays in the established source-upload evidence flow.', sourcePages: [1, 2], ruleIds: ['SM00_SOURCE_INTEGRITY'], correct: 'File/page hashes, page counts, character counts, and extraction flags', distractors: ['Full raw patient and source text', 'Trainer approvals invented during generation', 'Live operational URLs and payment data'] }),
  ]),
].map((candidate) => TrackUnitSchema.parse(candidate));

const contentItemCount = units.reduce((count, item) => count + item.briefingCards.length + item.drills.length, 0);
export const STANDARD_MEDS_ORIENTATION_PACK: StandardMedsOrientationPack = {
  kind: 'orientation',
  code,
  title: 'Standard Meds source orientation',
  source,
  units,
  sourceRegistry: STANDARD_MEDS_SOURCES,
  syntheticLinks: [],
  openSmeDecisionIds: [...STANDARD_MEDS_SME_DECISION_IDS],
  publication: {
    eligible: false,
    approvalStatus: 'draft',
    blockers: publicationBlockersFor(source, contentItemCount, ['source-registry-metadata'], [...STANDARD_MEDS_SME_DECISION_IDS]),
  },
};
