/**
 * LogiCall Pulse demo seed.
 *
 *   npm run seed:local                  (tsx --env-file=.env.local scripts/seed-demo.ts)
 *   tsx scripts/seed-demo.ts --dry-run  (build + validate every document, write nothing)
 *
 * Writes the 8 default Cohorts, demo users for all 5 roles (email + LC-ID logins), one complete
 * PUBLISHED Track ("MVP Retention & Escalations") with its Playbook source pages, and realistic
 * sample progress (enrollments, evaluated Simulation sessions, user stats, analytics rollups).
 *
 * Safety: refuses to run unless FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST are set,
 * or the `--allow-production` flag is passed. Idempotent: users are upserted by email and every
 * other document has a deterministic ID.
 */
import { applicationDefault, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import {
  CohortDocSchema,
  UserDocSchema,
  type CohortDoc,
  type DivisionId,
  type PillarStat,
  type UserDoc,
  type UserRole,
} from '../src/lib/schemas/domain';
import {
  DRAFT_VERSION_ID,
  EVAL_RUBRICS_DOC_ID,
  EvalRubricsDocSchema,
  FILL_BLANK_TOKEN,
  PublicSimScenarioSchema,
  SecretSimScenarioConfigSchema,
  SOURCE_PAGES_PER_BATCH,
  SourcePageBatchDocSchema,
  TrackDocSchema,
  TrackVersionDocSchema,
  type CompetencyPillar,
  type EvalRubricsDoc,
  type PublicSimScenario,
  type SecretSimScenarioConfig,
  type SourcePageBatchDoc,
  type TrackDoc,
  type TrackUnit,
  type TrackVersionDoc,
} from '../src/lib/schemas/curriculum';
import {
  AnalyticsRollupDocSchema,
  EnrollmentDocSchema,
  SimSessionDocSchema,
  enrollmentIdFor,
  rollupIdForCohort,
  rollupIdForDivision,
  rollupIdForGlobal,
  rollupIdForTrack,
  type AnalyticsRollupDoc,
  type EnrollmentDoc,
  type SimCriterionResult,
  type SimMessage,
  type SimSessionDoc,
} from '../src/lib/schemas/analytics';
import {
  CANONICAL_PILLARS,
  DEFAULT_COHORTS,
  LC_ID_EMAIL_DOMAIN,
  SIM_AUTO_FAIL_SCORE_CAP,
  SIM_DISPOSITION_PENALTY,
  XP_RULES,
} from '../src/lib/schemas/constants';
import {
  CanonicalDispositionSchema,
  ClaimEvidenceSchema,
  OperationalAssetSchema,
  SharedRulePackSchema,
  SourceBundleSchema,
  SourceConflictSchema,
  SourcePageEvidenceSchema,
  type ClaimEvidence,
  type OperationalAsset,
  type SharedRulePack,
  type SourceBundle,
  type SourceConflict,
  type SourceExcerptRef,
  type SourcePageEvidence,
} from '../src/lib/schemas/source-truth';
import type { ScenarioQAFixture } from '../src/lib/schemas/simulation-state';
import { runScenarioQAFixture } from '../src/lib/services/scenario-state';
import { buildAssessmentBlueprint } from '../src/lib/services/certification';
import { ensureVerbalScenarioDefaults, ensureVerbalSecretDefaults } from '../src/lib/services/verbal-defaults';
import { buildRuleIdsByDrillId } from '../src/lib/services/learning-evidence';
import { buildLearningAnalytics } from '../src/lib/services/learning-analytics';
import type { AssessmentBlueprintDoc, CertificationDoc, DrillAttemptDoc, ReviewScheduleDoc, ScenarioCoverageDoc } from '../src/lib/schemas/learning';
import {
  SEED_DRILL_SPACING_MINUTES,
  seedCheckpointAttempts,
  seedCoverageAndCertification,
  seedSimSessionEvidence,
  type SeedSimScript,
} from './seed-learning-evidence';
import { evaluatePublicationGates, extractionQualityFlags, normalizeSourceText } from '../src/lib/services/source-evidence';
import {
  computeSourceBundleRevisionHash,
  hashSourceBytes,
  hashSourcePageContent,
  sourcePageEvidenceId,
} from '../src/lib/services/source-store';

// ---------------------------------------------------------------------------
// 0. Flags and safety gate
// ---------------------------------------------------------------------------

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');
const ALLOW_PRODUCTION = args.has('--allow-production');
const DEMO_PASSWORD = 'PulseDemo!2026';
const TRACK_ID = 'demo-mvp-retention';
const VERBAL_TRACK_ID = 'demo-verbal-neurocalm';
const BLOCKED_TRACK_ID = 'demo-unresolved-price';
const SOURCE_BUNDLE_ID = 'bundle-demo-mvp-retention';
const BLOCKED_SOURCE_BUNDLE_ID = 'bundle-demo-unresolved-price';
const SOURCE_DOCUMENT_ID = 'doc-demo-mvp-playbook';
const SOURCE_DOCUMENT_REVISION = 'demo-mvp-playbook-revision-1';
const RULE_PACK_ID = 'pack-demo-mvp-foundations';
const RULE_ID = 'rule-demo-mvp-identity-verification';
const TRACK_DIVISION: DivisionId = 'INBOUND';
const PUBLISHED_VERSION_ID = 'v1';
const NOW = Date.now();
const DAY_MS = 24 * 60 * 60 * 1000;

if (!DRY_RUN && !ALLOW_PRODUCTION) {
  const missing = ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST'].filter((name) => !process.env[name]);
  if (missing.length > 0) {
    console.error(
      `Refusing to seed: ${missing.join(' and ')} not set. Start the emulators (npm run emulators) and run ` +
        '`npm run seed:local`, or pass --allow-production to write to a real project.',
    );
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// 1. Helpers
// ---------------------------------------------------------------------------

function daysAgo(days: number, hourOffset = 0): number {
  return NOW - days * DAY_MS + hourOffset * 60 * 60 * 1000;
}

function utcDateKey(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

function lcEmail(lcNumber: string): string {
  return `${lcNumber.toLowerCase()}@${LC_ID_EMAIL_DOMAIN}`;
}

function canonicalLabel(key: string): string {
  return CANONICAL_PILLARS.find((pillar) => pillar.key === key)?.label ?? key;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

// ---------------------------------------------------------------------------
// 2. Cohorts
// ---------------------------------------------------------------------------

const JOIN_CODES: Record<string, string | null> = {
  INTERNAL: null,
  THS: 'THS-7842',
  NGA: 'NGA-3159',
  DOZ: 'DOZ-5520',
  ZIM: 'ZIM-6604',
  MRR: 'MRR-2718',
  CALL_CORE: 'CORE-4471',
  LATAM_DIRECT: 'LATAM-9305',
};

// ---------------------------------------------------------------------------
// 3. Demo users
// ---------------------------------------------------------------------------

interface DemoUser {
  key: string;
  displayName: string;
  email: string | null;
  lcNumber: string | null;
  role: UserRole;
  partnerCohortId: string;
  divisionIds: DivisionId[];
  active: boolean;
}

const ALL_DIVISIONS: DivisionId[] = ['TELEHEALTH', 'INBOUND', 'OUTBOUND'];

const DEMO_USERS: DemoUser[] = [
  { key: 'super-admin', displayName: 'Connor', email: 'connor@logicall.io', lcNumber: null, role: 'SUPER_ADMIN', partnerCohortId: 'INTERNAL', divisionIds: ALL_DIVISIONS, active: true },
  { key: 'ops-admin', displayName: 'Avery Collins', email: 'ops.admin@logicall.io', lcNumber: null, role: 'ADMIN', partnerCohortId: 'INTERNAL', divisionIds: ALL_DIVISIONS, active: true },
  { key: 'trainer', displayName: 'Jordan Ellis', email: 'trainer@logicall.io', lcNumber: null, role: 'TRAINER', partnerCohortId: 'INTERNAL', divisionIds: ALL_DIVISIONS, active: true },
  { key: 'sup-ths', displayName: 'Lucia Morales', email: null, lcNumber: 'LC-2001', role: 'PARTNER_SUPERVISOR', partnerCohortId: 'THS', divisionIds: ['TELEHEALTH', 'INBOUND'], active: true },
  { key: 'sup-doz', displayName: 'Tunde Bakare', email: null, lcNumber: 'LC-2002', role: 'PARTNER_SUPERVISOR', partnerCohortId: 'DOZ', divisionIds: ['INBOUND'], active: true },
  { key: 'agent-1042', displayName: 'Sofia Herrera', email: null, lcNumber: 'LC-1042', role: 'AGENT', partnerCohortId: 'THS', divisionIds: ['TELEHEALTH', 'INBOUND'], active: true },
  { key: 'agent-1043', displayName: 'Diego Castillo', email: null, lcNumber: 'LC-1043', role: 'AGENT', partnerCohortId: 'THS', divisionIds: ['TELEHEALTH', 'INBOUND'], active: true },
  { key: 'agent-1044', displayName: 'Ana Ruiz', email: null, lcNumber: 'LC-1044', role: 'AGENT', partnerCohortId: 'THS', divisionIds: ['TELEHEALTH', 'INBOUND'], active: true },
  { key: 'agent-1045', displayName: 'Marco Vega', email: null, lcNumber: 'LC-1045', role: 'AGENT', partnerCohortId: 'THS', divisionIds: ['TELEHEALTH', 'INBOUND'], active: false },
  { key: 'agent-1050', displayName: 'Chidi Okafor', email: null, lcNumber: 'LC-1050', role: 'AGENT', partnerCohortId: 'DOZ', divisionIds: ['INBOUND'], active: true },
  { key: 'agent-1051', displayName: 'Grace Mensah', email: null, lcNumber: 'LC-1051', role: 'AGENT', partnerCohortId: 'DOZ', divisionIds: ['INBOUND'], active: true },
  { key: 'agent-1060', displayName: 'Riley Chen', email: null, lcNumber: 'LC-1060', role: 'AGENT', partnerCohortId: 'INTERNAL', divisionIds: ALL_DIVISIONS, active: true },
];

function signInEmail(user: DemoUser): string {
  if (user.lcNumber) return lcEmail(user.lcNumber);
  if (user.email) return user.email;
  throw new Error(`Demo user ${user.key} has no sign-in identifier.`);
}

// ---------------------------------------------------------------------------
// 4. Playbook source pages (synthetic, the Track content is grounded in these)
// ---------------------------------------------------------------------------

const PLAYBOOK_PAGES: string[] = [
  'MVP MEMBERSHIP RETENTION & ESCALATIONS PLAYBOOK. Page 1. Purpose and scope. This Playbook applies to every agent on the MVP Retention inbound queue. Members call to cancel, to dispute a charge, or to report a problem with the MVP Wellness Membership (Plus plan, 39 USD per month; Basic plan, 19 USD per month). Agents must verify identity, discover the reason for the call, follow the save-offer ladder in order, escalate to the correct queue, and log the correct disposition code before the call ends.',
  'Page 2. Call opening and identity verification. Step 1: greet the member with your first name. Step 2: state that the call is on a recorded line. Step 3: verify 3 identity points: full name, date of birth, and ZIP code on file. Step 4: open the member account in the Atlas CRM. If 2 or more identity points do not match, do not discuss any account details. Offer a secure callback to the email address on file and end the call politely.',
  'Page 3. Atlas CRM documentation. Open the member account in Atlas before you discuss the account. Log the reason code while the call is live, not after the call. Write every note in the format Reason / Offer / Outcome. Record each save offer that you made and the member answer. Never paste card numbers, bank numbers, or symptom details beyond a one-line summary into Atlas notes.',
  'Page 4. Discovery. Before you make any offer, ask one open-ended probe to find the real reason for the cancellation, for example: "What made you decide to cancel today?" Map the answer to one reason category: Price, Not Using, Travel or Moving, Side Effects, Billing Error, Other. A Side Effects or Billing Error answer stops the save-offer ladder: go to the escalation rules on page 8.',
  'Page 5. The save-offer ladder. Use the steps in this order and never skip a step that fits the reason. Step 1: acknowledge and discover. Step 2: Price or value concern: offer 50% off the next 2 billing cycles. Step 3: Travel, Moving or temporary non-use: offer a pause of up to 60 days (1 pause per 12 months). Step 4: Not using all features: offer a downgrade to the Basic plan at 19 USD per month. Step 5: process the cancellation. Never invent an offer, a free month, or a gift card that is not on this ladder.',
  'Page 6. Honoring a firm cancellation. Make a maximum of 2 save offers on one call. If the member declines 2 offers, or repeats a clear request to cancel after 1 offer, process the cancellation at once. Read the cancellation confirmation number to the member. The cancellation is effective at the end of the current billing cycle. Do not transfer a member to another queue only to avoid a cancellation.',
  'Page 7. Refund rules. A full refund of the most recent charge is allowed only when the charge is 14 days old or less. For a charge 15 to 30 days old, a 50% credit is allowed only with supervisor approval. For a charge more than 30 days old, no refund is allowed. Always check the charge date in Atlas before you say anything about a refund. Never promise a refund amount before you check the charge date.',
  'Page 8. Escalation triage. Clinical: any report of a side effect or adverse reaction goes to Clinical Support Tier 2 by warm transfer. Do not give medical advice. If the member describes emergency symptoms (chest pain, trouble breathing, fainting), tell the member to call 911 at once. Billing Disputes: a chargeback threat, a duplicate charge, or an unknown charge goes to the Billing Disputes queue with a ticket. Supervisor: a legal threat, a media threat, or abusive language after 1 warning goes to the on-duty supervisor.',
  'Page 9. Required information for every escalation ticket. Record: member ID, best callback number, a one-line summary, and what you already offered. Clinical tickets also need the symptom start date and the product name. Billing tickets also need the charge date and the charge amount. Tell the member which team will help next and the expected callback time: Clinical Tier 2 within 4 hours, Billing Disputes within 2 business days.',
  'Page 10. Compliance boundaries. Never give medical advice, a diagnosis, or an instruction to stop or change a product. Never promise an outcome that another team decides. Never ask for or repeat a full card number; the last 4 digits are enough. Honor every do-not-call request and log it in Atlas. Read the recorded-line statement at the start of every call.',
  'Page 11. Empathy and de-escalation. Acknowledge the feeling first, then the facts. Apologize for the experience, not for the Playbook rule. Use the member name. If the member uses abusive language, give 1 calm warning. If the abusive language continues after the warning, transfer to the on-duty supervisor. Keep promises small and exact: say what you will do now and what happens next.',
  'Page 12. Disposition codes. Log exactly one disposition before the call ends: Recovered (the member accepted a save offer such as the 50% discount, the 60-Day Pause, or the Basic downgrade, and you confirmed it in Atlas); Callback scheduled (a Clinical Tier 2 or Billing Disputes callback is booked for a specific time); Not interested (the member declined every offer or the cancellation was processed); Didn\'t reply; Organic; Lost. When an escalation and a save offer happen on the same call, the escalation has priority: log Callback scheduled.',
];

// ---------------------------------------------------------------------------
// 5. Track content
// ---------------------------------------------------------------------------

const PILLARS: CompetencyPillar[] = [
  { id: 'pillar_verification', key: 'verification_crm', label: 'Identity Verification & Atlas Notes', description: 'Verify the 3 identity points before account talk and document every call in Atlas while it is live.' },
  { id: 'pillar_save_offer', key: 'retention_objection', label: 'Save-Offer Ladder', description: 'Discover the real reason, then use the save-offer ladder in order with a maximum of 2 offers.' },
  { id: 'pillar_escalation', key: 'escalation_triage', label: 'Escalation Triage', description: 'Send side effects, chargeback threats, and legal threats to the correct queue with a complete ticket.' },
  { id: 'pillar_compliance', key: 'compliance_boundaries', label: 'Refund & Clinical Boundaries', description: 'Apply the 14-day refund rule, give no medical advice, and protect payment data.' },
];

const UNITS: TrackUnit[] = [
  {
    id: 'unit_verify_document',
    orderIndex: 0,
    title: 'Verify & Document Every Call',
    summary: 'Open each call correctly, verify 3 identity points, and keep Atlas notes live and clean.',
    estimatedMinutes: 6,
    briefingCards: [
      {
        id: 'card_verify_three_points',
        headline: 'Verify 3 Identity Points First',
        bodyMarkdown:
          'Greet the member with your first name and read the **recorded-line** statement. Then verify **full name, date of birth, and ZIP code** on file. If 2 or more points do not match, do not discuss the account.',
        keyTakeaway: 'No account talk until name, date of birth, and ZIP code match.',
        doList: ['Say your first name and the recorded-line statement', 'Verify all 3 points before account details'],
        dontList: ['Do not confirm a plan or charge before verification', 'Do not skip the recorded-line statement'],
        sourcePages: [2, 10],
      },
      {
        id: 'card_atlas_notes',
        headline: 'Log Atlas Notes While the Call Is Live',
        bodyMarkdown:
          'Open the member account in **Atlas** before you discuss it. Log the reason code during the call. Write each note as **Reason / Offer / Outcome** and record every save offer with the member answer.',
        keyTakeaway: 'Reason / Offer / Outcome, written during the call.',
        doList: ['Log the reason code during the call', 'Record each offer and the member answer'],
        dontList: ['Do not write notes from memory after the call'],
        sourcePages: [3],
      },
      {
        id: 'card_failed_verification',
        headline: 'Failed Verification and Payment Data',
        bodyMarkdown:
          'When verification fails, offer a **secure callback to the email address on file** and end the call politely. Never ask for or repeat a full card number. The last 4 digits are enough, and card data never goes into Atlas notes.',
        keyTakeaway: 'Failed verification = secure callback by email. Last 4 digits only.',
        doList: ['Offer the secure email callback', 'Use only the last 4 card digits'],
        dontList: ['Do not paste card or bank numbers into Atlas', 'Do not give hints about which point failed'],
        sourcePages: [2, 3, 10],
      },
    ],
    drills: [
      {
        id: 'drill_u1_mc_identity_points',
        kind: 'MULTIPLE_CHOICE',
        competencyPillarId: 'pillar_verification',
        prompt: 'A member calls to cancel. Which 3 identity points must you verify before you discuss the account?',
        explanation: 'The Playbook requires full name, date of birth, and ZIP code on file (page 2).',
        sourcePages: [2],
        options: [
          { id: 'a', text: 'Full name, date of birth, and ZIP code on file' },
          { id: 'b', text: 'Full name, email address, and full card number' },
          { id: 'c', text: 'Member ID, plan name, and last charge amount' },
          { id: 'd', text: 'Phone number, street address, and date of birth' },
        ],
        correctOptionId: 'a',
      },
      {
        id: 'drill_u1_tf_card_number',
        kind: 'TRUE_FALSE_SPOT',
        competencyPillarId: 'pillar_compliance',
        prompt: 'Does this agent action follow the Playbook?',
        explanation: 'Agents never ask for or repeat a full card number. The last 4 digits are enough (page 10).',
        sourcePages: [10],
        statement: 'To confirm the billing account, the agent asks the member to read the full card number on the call.',
        isCompliant: false,
      },
      {
        id: 'drill_u1_seq_call_opening',
        kind: 'SEQUENCE_ORDER',
        competencyPillarId: 'pillar_verification',
        prompt: 'Put the call-opening steps in the correct order.',
        explanation: 'Greet, state the recorded line, verify 3 points, then open the account in Atlas (page 2).',
        sourcePages: [2],
        orderedSteps: [
          { id: 's1', text: 'Greet the member with your first name' },
          { id: 's2', text: 'State that the call is on a recorded line' },
          { id: 's3', text: 'Verify full name, date of birth, and ZIP code' },
          { id: 's4', text: 'Open the member account in Atlas' },
        ],
      },
      {
        id: 'drill_u1_match_notes',
        kind: 'MATCH_PAIRS',
        competencyPillarId: 'pillar_verification',
        prompt: 'Match each Atlas note field to the correct content.',
        explanation: 'Atlas notes use Reason / Offer / Outcome (page 3).',
        sourcePages: [3],
        pairs: [
          { id: 'p1', leftPrompt: 'Reason', rightMatch: 'Price concern after a rate change' },
          { id: 'p2', leftPrompt: 'Offer', rightMatch: '50% off the next 2 billing cycles' },
          { id: 'p3', leftPrompt: 'Outcome', rightMatch: 'Member accepted; plan stays active' },
        ],
      },
      {
        id: 'drill_u1_fill_callback',
        kind: 'FILL_BLANK_CHOICE',
        competencyPillarId: 'pillar_verification',
        prompt: 'Complete the Playbook rule.',
        explanation: 'When 2 or more points fail, offer a secure callback to the email address on file (page 2).',
        sourcePages: [2],
        sentenceTemplate: `If 2 or more identity points do not match, offer a secure callback to the ${FILL_BLANK_TOKEN} on file.`,
        wordBank: ['email address', 'mobile number', 'mailing address', 'work number'],
        correctWord: 'email address',
      },
    ],
  },
  {
    id: 'unit_save_offer_ladder',
    orderIndex: 1,
    title: 'Run the Save-Offer Ladder',
    summary: 'Find the real reason, match it to the correct offer, and honor a firm cancellation.',
    estimatedMinutes: 7,
    briefingCards: [
      {
        id: 'card_discovery',
        headline: 'Discover the Real Reason First',
        bodyMarkdown:
          'Before any offer, ask one open-ended probe: *"What made you decide to cancel today?"* Map the answer to **Price, Not Using, Travel or Moving, Side Effects, Billing Error, or Other**. Side Effects and Billing Error stop the ladder.',
        keyTakeaway: 'One open-ended probe before any offer.',
        doList: ['Ask one open-ended discovery probe', 'Map the answer to a reason category'],
        dontList: ['Do not lead with a discount', 'Do not use the ladder for side effects or billing errors'],
        sourcePages: [4],
      },
      {
        id: 'card_ladder_order',
        headline: 'Climb the Ladder in Order',
        bodyMarkdown:
          'Price or value: **50% off the next 2 billing cycles**. Travel or temporary non-use: **pause up to 60 days** (1 per 12 months). Not using all features: **downgrade to Basic at 19 USD per month**. Then process the cancellation.',
        keyTakeaway: 'Match the offer to the reason. Never invent an offer.',
        doList: ['Match the offer to the reason category', 'Say the exact offer terms'],
        dontList: ['Do not offer free months or gift cards', 'Do not skip a step that fits the reason'],
        sourcePages: [5],
      },
      {
        id: 'card_firm_cancel',
        headline: 'Honor a Firm Cancellation',
        bodyMarkdown:
          'Make a maximum of **2 save offers**. If the member declines 2 offers, or repeats a clear cancel request after 1 offer, process the cancellation at once and read the **confirmation number**. It takes effect at the end of the billing cycle.',
        keyTakeaway: 'Two offers maximum, then cancel and read the confirmation number.',
        doList: ['Read the cancellation confirmation number', 'Explain the end-of-cycle effective date'],
        dontList: ['Do not make a 3rd offer', 'Do not transfer to avoid a cancellation'],
        sourcePages: [6],
      },
    ],
    drills: [
      {
        id: 'drill_u2_mc_price_offer',
        kind: 'MULTIPLE_CHOICE',
        competencyPillarId: 'pillar_save_offer',
        prompt: 'A member says the Plus plan is too expensive. What is the first save offer?',
        explanation: 'A price or value concern gets 50% off the next 2 billing cycles (page 5).',
        sourcePages: [5],
        options: [
          { id: 'a', text: 'One free month of the Plus plan' },
          { id: 'b', text: '50% off the next 2 billing cycles' },
          { id: 'c', text: 'A 60-day pause' },
          { id: 'd', text: 'A 25 USD gift card' },
        ],
        correctOptionId: 'b',
      },
      {
        id: 'drill_u2_tf_free_months',
        kind: 'TRUE_FALSE_SPOT',
        competencyPillarId: 'pillar_save_offer',
        prompt: 'Does this agent action follow the Playbook?',
        explanation: 'Agents must never invent an offer that is not on the ladder (page 5).',
        sourcePages: [5],
        statement: 'To save a frustrated member, the agent offers 3 free months because the member has been loyal for 2 years.',
        isCompliant: false,
      },
      {
        id: 'drill_u2_seq_ladder',
        kind: 'SEQUENCE_ORDER',
        competencyPillarId: 'pillar_save_offer',
        prompt: 'Put the save-offer ladder steps in Playbook order.',
        explanation: 'Acknowledge and discover, discount, pause, downgrade, then cancel (page 5).',
        sourcePages: [5],
        orderedSteps: [
          { id: 's1', text: 'Acknowledge and discover the reason' },
          { id: 's2', text: 'Offer 50% off the next 2 billing cycles' },
          { id: 's3', text: 'Offer a pause of up to 60 days' },
          { id: 's4', text: 'Offer a downgrade to the Basic plan' },
          { id: 's5', text: 'Process the cancellation' },
        ],
      },
      {
        id: 'drill_u2_match_reason_offer',
        kind: 'MATCH_PAIRS',
        competencyPillarId: 'pillar_save_offer',
        prompt: 'Match each cancellation reason to the best-fit save offer.',
        explanation: 'Price gets the discount, travel gets the pause, low feature use gets the Basic downgrade (page 5).',
        sourcePages: [5],
        pairs: [
          { id: 'p1', leftPrompt: 'The monthly price is too high', rightMatch: '50% off the next 2 billing cycles' },
          { id: 'p2', leftPrompt: 'Traveling for work for 6 weeks', rightMatch: 'Pause of up to 60 days' },
          { id: 'p3', leftPrompt: 'Uses only the basic features', rightMatch: 'Downgrade to Basic at 19 USD per month' },
        ],
      },
      {
        id: 'drill_u2_fill_max_offers',
        kind: 'FILL_BLANK_CHOICE',
        competencyPillarId: 'pillar_save_offer',
        prompt: 'Complete the Playbook rule.',
        explanation: 'A maximum of 2 save offers per call, then process the cancellation (page 6).',
        sourcePages: [6],
        sentenceTemplate: `After the member declines ${FILL_BLANK_TOKEN} save offers, process the cancellation at once.`,
        wordBank: ['two', 'three', 'one', 'four'],
        correctWord: 'two',
      },
    ],
  },
  {
    id: 'unit_escalation_triage',
    orderIndex: 2,
    title: 'Triage Escalations & Refunds',
    summary: 'Route side effects, chargeback threats, and legal threats correctly and apply the refund rules.',
    estimatedMinutes: 7,
    briefingCards: [
      {
        id: 'card_clinical',
        headline: 'Side Effects Go to Clinical Tier 2',
        bodyMarkdown:
          'Any side effect or adverse reaction goes to **Clinical Support Tier 2** by warm transfer. Give **no medical advice**. For chest pain, trouble breathing, or fainting, tell the member to **call 911 at once**.',
        keyTakeaway: 'Side effect = warm transfer to Clinical Tier 2. No medical advice.',
        doList: ['Warm transfer to Clinical Tier 2', 'Record the symptom start date and product name'],
        dontList: ['Do not tell the member to stop or change a product', 'Do not make a save offer first'],
        sourcePages: [8, 9, 10],
      },
      {
        id: 'card_billing_supervisor',
        headline: 'Chargebacks to Billing, Legal Threats to Supervisor',
        bodyMarkdown:
          'A **chargeback threat, duplicate charge, or unknown charge** goes to **Billing Disputes** with a ticket. A **legal threat, media threat, or abusive language after 1 warning** goes to the on-duty **supervisor**.',
        keyTakeaway: 'Money disputes to Billing Disputes. Legal threats to the supervisor.',
        doList: ['Record charge date and amount on billing tickets', 'Give 1 calm warning for abusive language'],
        dontList: ['Do not argue about a chargeback'],
        sourcePages: [8, 9, 11],
      },
      {
        id: 'card_refund_rule',
        headline: 'Apply the 14-Day Refund Rule',
        bodyMarkdown:
          'Check the charge date in Atlas first. **14 days or less: full refund** of the latest charge. **15 to 30 days: 50% credit** with supervisor approval. **More than 30 days: no refund.**',
        keyTakeaway: 'Check the charge date before you say anything about a refund.',
        doList: ['Check the charge date in Atlas first', 'Get supervisor approval for a 50% credit'],
        dontList: ['Do not promise a refund amount before you check'],
        sourcePages: [7],
      },
    ],
    drills: [
      {
        id: 'drill_u3_mc_side_effect',
        kind: 'MULTIPLE_CHOICE',
        competencyPillarId: 'pillar_escalation',
        prompt: 'A member reports daily headaches since starting the MVP supplement pack and wants to cancel. What do you do first?',
        explanation: 'A side effect report stops the ladder and goes to Clinical Support Tier 2 by warm transfer (pages 4 and 8).',
        sourcePages: [4, 8],
        options: [
          { id: 'a', text: 'Offer 50% off the next 2 billing cycles' },
          { id: 'b', text: 'Tell the member to stop the product and drink more water' },
          { id: 'c', text: 'Warm transfer the member to Clinical Support Tier 2' },
          { id: 'd', text: 'Process the cancellation and end the call' },
        ],
        correctOptionId: 'c',
      },
      {
        id: 'drill_u3_tf_medical_advice',
        kind: 'TRUE_FALSE_SPOT',
        competencyPillarId: 'pillar_compliance',
        prompt: 'Does this agent action follow the Playbook?',
        explanation: 'Agents never give medical advice or tell a member to stop a product (page 10).',
        sourcePages: [10],
        statement: 'The agent tells a member with headaches to stop the supplement for a week and then try a half dose.',
        isCompliant: false,
      },
      {
        id: 'drill_u3_seq_ticket',
        kind: 'SEQUENCE_ORDER',
        competencyPillarId: 'pillar_escalation',
        prompt: 'Put the clinical escalation steps in the correct order.',
        explanation: 'Acknowledge, collect ticket facts, warm transfer, then log the disposition (pages 8, 9, 12).',
        sourcePages: [8, 9, 12],
        orderedSteps: [
          { id: 's1', text: 'Acknowledge the symptom and say help is next' },
          { id: 's2', text: 'Record member ID, callback number, and symptom start date' },
          { id: 's3', text: 'Warm transfer to Clinical Support Tier 2' },
          { id: 's4', text: 'Log the disposition Callback scheduled' },
        ],
      },
      {
        id: 'drill_u3_match_queue',
        kind: 'MATCH_PAIRS',
        competencyPillarId: 'pillar_escalation',
        prompt: 'Match each situation to the correct escalation route.',
        explanation: 'Side effects to Clinical Tier 2, chargebacks to Billing Disputes, legal threats to the supervisor (page 8).',
        sourcePages: [8],
        pairs: [
          { id: 'p1', leftPrompt: 'Rash after the first week of use', rightMatch: 'Clinical Support Tier 2' },
          { id: 'p2', leftPrompt: 'Threat to reverse the charge with the bank', rightMatch: 'Billing Disputes queue' },
          { id: 'p3', leftPrompt: 'Threat to call a lawyer', rightMatch: 'On-duty supervisor' },
          { id: 'p4', leftPrompt: 'Two identical charges this month', rightMatch: 'Billing Disputes ticket' },
        ],
      },
      {
        id: 'drill_u3_fill_refund_days',
        kind: 'FILL_BLANK_CHOICE',
        competencyPillarId: 'pillar_compliance',
        prompt: 'Complete the Playbook rule.',
        explanation: 'A full refund applies only when the latest charge is 14 days old or less (page 7).',
        sourcePages: [7],
        sentenceTemplate: `A full refund of the latest charge applies only when the charge is ${FILL_BLANK_TOKEN} days old or less.`,
        wordBank: ['14', '30', '7', '60'],
        correctWord: '14',
      },
    ],
  },
];

const SCENARIOS: PublicSimScenario[] = [
  {
    id: 'sim_price_cancel',
    title: 'Price Objection Cancellation',
    difficulty: 'STANDARD',
    counterpartyRoleLabel: 'Inbound Member',
    contextTicketSummary:
      'Queue: MVP Retention · Campaign: MVP · Channel: Inbound voice · Plan: Plus (39 USD per month) · Member since 2025 · Reason on IVR: Cancel membership',
    accountOnFile: ['Name: Dana Whitfield', 'DOB: 03/14/1988', 'ZIP: 78704', 'Plan: Plus, 39 USD per month'],
    openingMessage:
      "Hi, I need to cancel my MVP membership today. Honestly it's just too expensive right now and I'm not really using it.",
    // Only canonical dispositions (CanonicalDispositionSchema); the wrap-up rejects anything else.
    dispositionOptions: ['Recovered', 'Callback scheduled', 'Not interested', 'Lost'],
    maxTurns: 8,
    passScoreThreshold: 80,
  },
  {
    id: 'sim_side_effect_refund',
    title: 'Side-Effect Refund Demand',
    difficulty: 'HIGH_PRESSURE',
    counterpartyRoleLabel: 'Upset Member',
    contextTicketSummary:
      'Queue: MVP Retention · Campaign: MVP · Channel: Inbound voice · Plan: Plus with supplement pack · Last charge on file: 39 USD · Reason on IVR: Billing inquiry',
    accountOnFile: ['Name: Marcus Reyes', 'DOB: 11/02/1979', 'ZIP: 30318', 'Last charge: 39 USD, 9 days ago'],
    openingMessage:
      "I've had headaches every single day since I started your supplement pack. I want all of my money back right now, or I'm calling my bank to reverse the charge.",
    // Only canonical dispositions (CanonicalDispositionSchema); the wrap-up rejects anything else.
    dispositionOptions: ['Recovered', 'Callback scheduled', 'Not interested', 'Lost'],
    maxTurns: 10,
    passScoreThreshold: 80,
  },
];

const SECRET_SCENARIOS: SecretSimScenarioConfig[] = [
  {
    scenarioId: 'sim_price_cancel',
    personaName: 'Dana Whitfield',
    personaBackstoryAndMood:
      'Dana is a polite but busy project coordinator who has been a Plus member for 14 months. Dana feels the price is high for how little the service was used lately and wants a quick call. Dana is calm unless the agent pushes offers that do not fit.',
    hiddenFactsToRevealOnlyWhenAsked: [
      'Dana will travel for work for the next 7 weeks and will not use the service during that time.',
      'Dana would keep the membership if billing stops while away.',
      'Dana verifies with date of birth 03/14/1988 and ZIP code 78704.',
    ],
    conditionalBehaviors: [
      'If the agent offers the 50% discount first, say it still costs money while you are away and ask if there is anything else.',
      'If the agent offers a pause of up to 60 days, accept it and ask when billing starts again.',
      'If the agent makes an offer before asking why you want to cancel, become short and repeat that you want to cancel.',
    ],
    expectedDisposition: 'Recovered',
    autoFailTriggers: [
      'The agent discusses plan or billing details before verifying full name, date of birth, and ZIP code.',
      'The agent offers a discount, free month, or gift that is not on the Playbook save-offer ladder.',
    ],
    rubricCriteria: [
      { id: 'crit_price_verify', competencyPillarId: 'pillar_verification', criterionLabel: 'Verified 3 identity points before account talk', evaluationRule: 'Full name, date of birth, and ZIP code are verified before any plan, price, or billing detail is discussed (page 2).', weight: 25, sourcePages: [2] },
      { id: 'crit_price_discovery', competencyPillarId: 'pillar_save_offer', criterionLabel: 'Discovered the real reason before offering', evaluationRule: 'The agent asks an open-ended discovery probe and learns about the travel before making the matching offer (pages 4-5).', weight: 35, sourcePages: [4, 5] },
      { id: 'crit_price_offer_terms', competencyPillarId: 'pillar_save_offer', criterionLabel: 'Stated exact ladder terms only', evaluationRule: 'Every offer matches the ladder terms exactly (50% off 2 cycles, pause up to 60 days, Basic at 19 USD). No invented offers (page 5).', weight: 20, sourcePages: [5] },
      { id: 'crit_price_close', competencyPillarId: 'pillar_verification', criterionLabel: 'Confirmed the outcome and next billing date', evaluationRule: 'The agent confirms the accepted outcome, when billing restarts, and that it is noted in Atlas (pages 3 and 12).', weight: 20, sourcePages: [3, 12] },
    ],
  },
  {
    scenarioId: 'sim_side_effect_refund',
    personaName: 'Marcus Reyes',
    personaBackstoryAndMood:
      'Marcus is a frustrated warehouse supervisor who started the supplement pack 9 days ago. Marcus is worried about the headaches and angry about paying for something that made him feel worse. He calms down when the agent takes the symptom seriously and explains the exact next steps.',
    hiddenFactsToRevealOnlyWhenAsked: [
      'The latest charge was 9 days ago for 39 USD.',
      'The headaches started 5 days ago. There is no chest pain, no trouble breathing, and no fainting.',
      'Marcus verifies with date of birth 11/02/1979 and ZIP code 30318.',
    ],
    conditionalBehaviors: [
      'If the agent makes a save offer before addressing the headaches, become angrier and repeat the chargeback threat.',
      'If the agent explains the warm transfer to Clinical Tier 2 and that a charge 9 days old qualifies for review under the 14-day rule, calm down and agree.',
      'If the agent asks about emergency symptoms, confirm there are none.',
    ],
    expectedDisposition: 'Callback scheduled',
    autoFailTriggers: [
      'The agent gives medical advice or tells the member to stop, reduce, or change a product.',
      'The agent promises a refund amount before checking the charge date.',
    ],
    rubricCriteria: [
      { id: 'crit_se_route', competencyPillarId: 'pillar_escalation', criterionLabel: 'Routed the side effect to Clinical Tier 2', evaluationRule: 'The agent stops the save-offer ladder and arranges a warm transfer to Clinical Support Tier 2 (pages 4 and 8).', weight: 35, sourcePages: [4, 8] },
      { id: 'crit_se_no_advice', competencyPillarId: 'pillar_compliance', criterionLabel: 'Gave no medical advice and checked for emergency symptoms', evaluationRule: 'No medical advice or product instructions. The agent checks for chest pain, trouble breathing, or fainting (pages 8 and 10).', weight: 25, sourcePages: [8, 10] },
      { id: 'crit_se_refund_rule', competencyPillarId: 'pillar_compliance', criterionLabel: 'Applied the refund rule after checking the charge date', evaluationRule: 'The agent checks the charge date first and explains that a charge 14 days old or less qualifies for a full refund review (page 7).', weight: 20, sourcePages: [7] },
      { id: 'crit_se_ticket', competencyPillarId: 'pillar_escalation', criterionLabel: 'Collected the required ticket facts', evaluationRule: 'Member ID, callback number, symptom start date, and product name are collected, and the 4-hour callback window is stated (page 9).', weight: 20, sourcePages: [9] },
    ],
  },
];

/** Fixed synthetic clock for seeded scenarios (11:00 in America/Chicago). */
const SEED_SCENARIO_SYNTHETIC_NOW = '2026-01-15T17:00:00.000Z';
const SEED_CALLBACK_AT = '2026-01-15T21:00:00.000Z';

interface SeedScenarioRuntime {
  caseBranch: string;
  product: string;
  requiredInspections: string[];
  requiredWorkflowActions: string[];
  requiredWrapUpEvidence: string[];
  /** Deterministic gates and the Playbook page that grounds each one. */
  gatePages: Record<string, number>;
  qaFixtures: ScenarioQAFixture[];
}

/**
 * Runtime context, evidence checklist and scripted QA fixtures per seeded scenario. Without these a new
 * Sim run cannot start (409 SCENARIO_CONTEXT_REQUIRED) and the publication gates block the Track.
 */
const SCENARIO_RUNTIME: Record<string, SeedScenarioRuntime> = {
  sim_price_cancel: {
    caseBranch: 'existing_patient_cancellation_save',
    product: 'MVP Plus',
    requiredInspections: ['member_account'],
    requiredWorkflowActions: ['recovery_confirmed'],
    requiredWrapUpEvidence: ['note'],
    gatePages: { identity_privacy: 2 },
    qaFixtures: [
      {
        id: 'qa-price-golden-pass',
        title: 'Verify, discover the travel, offer the pause, confirm',
        kind: 'golden_pass',
        steps: [
          { action: { type: 'inspect', inspectionId: 'member_account' } },
          { action: { type: 'dial' } },
          { action: { type: 'verify_identity' } },
          { learnerUtterance: 'Thank you, you are verified. Before anything else, what is making you want to cancel today?' },
          { learnerUtterance: 'Since you will be away for 7 weeks, I can pause the membership for up to 60 days at no charge. Would that help?' },
          { action: { type: 'workflow', actionId: 'recovery_confirmed' } },
          { action: { type: 'note', text: 'Synthetic note: member accepted the 60-day pause and the restart date was confirmed.' } },
          { action: { type: 'wrap_up', disposition: 'Recovered' } },
        ],
        expectedDisposition: 'Recovered',
        expectedGateResults: [{ ruleId: 'identity_privacy', status: 'pass' }],
      },
      {
        id: 'qa-price-critical-fail',
        title: 'Discusses billing before verifying identity',
        kind: 'golden_critical_fail',
        steps: [
          { action: { type: 'inspect', inspectionId: 'member_account' } },
          { action: { type: 'dial' } },
          { learnerUtterance: 'I can see your billing is 39 USD per month on the Plus plan.' },
          { action: { type: 'verify_identity' } },
          { action: { type: 'workflow', actionId: 'recovery_confirmed' } },
          { action: { type: 'note', text: 'Synthetic note: member accepted the pause.' } },
          { action: { type: 'wrap_up', disposition: 'Recovered' } },
        ],
        expectedDisposition: 'Recovered',
        expectedGateResults: [{ ruleId: 'identity_privacy', status: 'fail' }],
      },
    ],
  },
  sim_side_effect_refund: {
    caseBranch: 'clinical_side_effect_callback',
    product: 'MVP Plus supplement pack',
    requiredInspections: ['charge_history'],
    requiredWorkflowActions: [],
    requiredWrapUpEvidence: ['callback', 'note'],
    gatePages: { identity_privacy: 2, clinical_boundary: 10 },
    qaFixtures: [
      {
        id: 'qa-side-effect-golden-pass',
        title: 'Verify, check emergency signs, book the Tier 2 callback',
        kind: 'golden_pass',
        steps: [
          { action: { type: 'inspect', inspectionId: 'charge_history' } },
          { action: { type: 'dial' } },
          { action: { type: 'verify_identity' } },
          { learnerUtterance: 'I am sorry about the headaches. Is there any chest pain, trouble breathing, or fainting right now?' },
          { learnerUtterance: 'Thank you. Our medical team at Clinical Support Tier 2 will call you back within 4 hours, and a charge 9 days old qualifies for a refund review.' },
          { action: { type: 'callback', callbackAt: SEED_CALLBACK_AT } },
          { action: { type: 'note', text: 'Synthetic note: Clinical Tier 2 callback booked within the 4-hour window.' } },
          { action: { type: 'wrap_up', disposition: 'Callback scheduled' } },
        ],
        expectedDisposition: 'Callback scheduled',
        expectedGateResults: [{ ruleId: 'identity_privacy', status: 'pass' }, { ruleId: 'clinical_boundary', status: 'pass' }],
      },
      {
        id: 'qa-side-effect-critical-fail',
        title: 'Gives safety reassurance instead of routing to Clinical',
        kind: 'golden_critical_fail',
        steps: [
          { action: { type: 'inspect', inspectionId: 'charge_history' } },
          { action: { type: 'dial' } },
          { action: { type: 'verify_identity' } },
          { learnerUtterance: 'It is safe to take a half portion for now, so there is no need to escalate.' },
          { action: { type: 'callback', callbackAt: SEED_CALLBACK_AT } },
          { action: { type: 'note', text: 'Synthetic note: callback booked.' } },
          { action: { type: 'wrap_up', disposition: 'Callback scheduled' } },
        ],
        expectedDisposition: 'Callback scheduled',
        expectedGateResults: [{ ruleId: 'clinical_boundary', status: 'fail' }],
      },
    ],
  },
};

/** Public scenarios bound to the approved source revision, with an explicit context and evidence checklist. */
function runnableScenarios(sourceRevision: string): PublicSimScenario[] {
  return SCENARIOS.map((scenario) => {
    const runtime = SCENARIO_RUNTIME[scenario.id];
    if (!runtime) throw new Error(`Scenario ${scenario.id} has no seeded runtime.`);
    return PublicSimScenarioSchema.parse({
      ...scenario,
      context: {
        direction: 'inbound',
        queue: 'customer_support',
        product: runtime.product,
        stage: 'support_case',
        contactState: 'existing_patient',
        pricingPosture: 'not_applicable',
        caseBranch: runtime.caseBranch,
        syntheticTimezone: 'America/Chicago',
        syntheticNow: SEED_SCENARIO_SYNTHETIC_NOW,
        sourceRevision,
        curriculumVersion: PUBLISHED_VERSION_ID,
      },
      evidenceRequirements: {
        minimumLearnerTurns: 2,
        requiredInspections: runtime.requiredInspections,
        requiredWorkflowActions: runtime.requiredWorkflowActions,
        requiredWrapUpEvidence: runtime.requiredWrapUpEvidence,
        requiredGateIds: Object.keys(runtime.gatePages),
        requiredCustomerConcerns: [],
        expectedDurationMinutes: null,
        gateSourceRefs: Object.fromEntries(Object.entries(runtime.gatePages).map(([gateId, page]) => [gateId, [mainExcerpt(page)]])),
        maximumCriticalFailures: 0,
        maximumMajorFailures: 0,
      },
    });
  });
}

/** Secret configs with trainer-approved rubric evidence and the scripted QA fixtures the publish gate needs. */
function groundedSecrets(trainerUid: string, approvedAt: number): SecretSimScenarioConfig[] {
  return SECRET_SCENARIOS.map((secret) => SecretSimScenarioConfigSchema.parse({
    ...secret,
    rubricCriteria: secret.rubricCriteria.map((criterion) => ({
      ...criterion,
      evidence: [approvedClaim(`evidence-${criterion.id}`, criterion.evaluationRule, criterion.sourcePages, trainerUid, approvedAt)],
    })),
    qaFixtures: SCENARIO_RUNTIME[secret.scenarioId]?.qaFixtures ?? [],
  }));
}

// ---------------------------------------------------------------------------
// 6. Sample progress
// ---------------------------------------------------------------------------

type CriterionScore = 0 | 50 | 100;

interface SimAttemptPlan {
  scenarioId: string;
  daysAgo: number;
  selectedDisposition: string;
  autoFailedReason: string | null;
  criterionScores: CriterionScore[];
  transcript: Array<[SimMessage['role'], string]>;
  summaryFeedback: string;
  strengths: string[];
  improvements: string[];
  evidence: string[];
  coaching: string[];
  betterExamples: Array<string | null>;
}

interface ProgressPlan {
  userKey: string;
  /** unitId -> first-try result per drill (same order as unit.drills) */
  units: Array<{ unitId: string; daysAgo: number; firstTry: boolean[] }>;
  sims: SimAttemptPlan[];
  streakDays: number;
}

const PRICE_PASS_TRANSCRIPT: SimAttemptPlan['transcript'] = [
  ['counterparty', SCENARIOS[0].openingMessage],
  ['agent', 'Thanks for calling MVP, this is Sofia on a recorded line. I can help with that. Can I have your full name, date of birth, and ZIP code on file?'],
  ['counterparty', 'Dana Whitfield, March 14 1988, ZIP 78704.'],
  ['agent', 'Thank you, Dana, you are verified. Before I process anything, what made you decide to cancel today?'],
  ['counterparty', "Mostly the price. And I'm traveling for work for the next seven weeks, so I won't even use it."],
  ['agent', 'That makes sense. Since you will be away, I can pause your membership for up to 60 days with no billing during the pause. Would that work better than cancelling?'],
  ['counterparty', 'Oh, that actually works. When would billing start again?'],
  ['agent', 'Your pause starts today and billing restarts in 60 days. I have noted the pause in your account and you will get an email confirmation.'],
];

const PRICE_FAIL_TRANSCRIPT: SimAttemptPlan['transcript'] = [
  ['counterparty', SCENARIOS[0].openingMessage],
  ['agent', 'Hi, this is Riley. I see you are on the Plus plan at 39 a month. I can give you a free month if you stay.'],
  ['counterparty', "A free month doesn't really help me. I just want to cancel."],
  ['agent', 'Okay, I can also do 50% off for two months. Can I get your name and date of birth?'],
  ['counterparty', "Dana Whitfield, March 14 1988. I'm traveling for weeks, so I still won't use it."],
  ['agent', 'Understood. I will cancel the membership for you now.'],
];

const SIDE_EFFECT_PASS_TRANSCRIPT: SimAttemptPlan['transcript'] = [
  ['counterparty', SCENARIOS[1].openingMessage],
  ['agent', 'I am sorry you are feeling unwell, that is important. This is Riley on a recorded line. Before anything else, are you having chest pain, trouble breathing, or fainting?'],
  ['counterparty', "No, nothing like that. Just headaches for about five days."],
  ['agent', 'Thank you. Can I verify your full name, date of birth, and ZIP code on file?'],
  ['counterparty', 'Marcus Reyes, November 2 1979, 30318.'],
  ['agent', 'Thank you, Marcus. I cannot give medical advice, so I will warm transfer you to our medical team at Clinical Support Tier 2. I see your last charge was 9 days ago, which is inside our 14-day window, so the refund review is part of this ticket.'],
  ['counterparty', "Okay. That's fair. What happens next?"],
  ['agent', 'I have your member ID, callback number, the start date of the headaches, and the product name on the ticket. Clinical Tier 2 will call you back within 4 hours if the transfer drops.'],
];

const SIDE_EFFECT_FAIL_TRANSCRIPT: SimAttemptPlan['transcript'] = [
  ['counterparty', SCENARIOS[1].openingMessage],
  ['agent', 'I understand. Before you cancel, I can offer you 50% off your next two months.'],
  ['counterparty', "Are you serious? I'm getting headaches and you're trying to sell me something? I'm calling my bank."],
  ['agent', 'Sorry about that. Maybe stop taking the supplement for a few days and see if the headaches go away. I can give you a full refund of 39 dollars.'],
  ['counterparty', 'Fine. Just send me the refund.'],
  ['agent', 'I will send you to Billing Disputes for the refund.'],
];

/** The Sofia variant of the passing side-effect call (same Playbook moves, her name). */
const SIDE_EFFECT_PASS_TRANSCRIPT_SOFIA: SimAttemptPlan['transcript'] = SIDE_EFFECT_PASS_TRANSCRIPT.map(
  ([role, content]) => [role, content.replace('This is Riley', 'This is Sofia')],
);

/** How each seeded call is replayed through the Simulation engine (verify point and panel actions). */
const SIM_SCRIPTS = new Map<SimAttemptPlan['transcript'], SeedSimScript>([
  [PRICE_PASS_TRANSCRIPT, {
    verifyBeforeMessageIndex: 3,
    postCallActions: [
      { type: 'workflow', actionId: 'recovery_confirmed' },
      { type: 'note', text: 'Synthetic note: member accepted the 60-day pause; billing restart date confirmed.' },
    ],
  }],
  [PRICE_FAIL_TRANSCRIPT, {
    verifyBeforeMessageIndex: 5,
    postCallActions: [
      { type: 'workflow', actionId: 'cancellation_completed' },
      { type: 'note', text: 'Synthetic note: membership cancelled.' },
    ],
  }],
  ...[SIDE_EFFECT_PASS_TRANSCRIPT, SIDE_EFFECT_PASS_TRANSCRIPT_SOFIA].map((transcript): [SimAttemptPlan['transcript'], SeedSimScript] => [transcript, {
    verifyBeforeMessageIndex: 5,
    postCallActions: [
      { type: 'callback', callbackAt: SEED_CALLBACK_AT },
      { type: 'note', text: 'Synthetic note: Clinical Tier 2 callback booked within the 4-hour window.' },
    ],
  }]),
  [SIDE_EFFECT_FAIL_TRANSCRIPT, {
    verifyBeforeMessageIndex: Number.POSITIVE_INFINITY,
    postCallActions: [{ type: 'note', text: 'Synthetic note: sent to Billing Disputes.' }],
  }],
]);

const PROGRESS: ProgressPlan[] = [
  {
    userKey: 'agent-1042',
    streakDays: 5,
    units: [
      { unitId: 'unit_verify_document', daysAgo: 6, firstTry: [true, true, true, false, true] },
      { unitId: 'unit_save_offer_ladder', daysAgo: 4, firstTry: [true, true, false, true, true] },
      { unitId: 'unit_escalation_triage', daysAgo: 2, firstTry: [true, true, true, true, false] },
    ],
    sims: [
      {
        scenarioId: 'sim_price_cancel',
        daysAgo: 1,
        selectedDisposition: 'Recovered',
        autoFailedReason: null,
        criterionScores: [100, 100, 100, 50],
        transcript: PRICE_PASS_TRANSCRIPT,
        summaryFeedback: 'Strong call. You verified first, discovered the travel, and matched the pause offer to the real reason.',
        strengths: ['Verified all 3 identity points before account talk', 'Open-ended discovery probe found the travel reason'],
        improvements: ['Say the exact restart date for billing, not only "in 60 days"'],
        evidence: [
          'Can I have your full name, date of birth, and ZIP code on file?',
          'Before I process anything, what made you decide to cancel today?',
          'I can pause your membership for up to 60 days with no billing during the pause.',
          'Billing restarts in 60 days. I have noted the pause in your account.',
        ],
        coaching: [
          'Correct order: recorded-line statement, then all 3 identity points.',
          'Good open-ended probe before any offer.',
          'Offer terms match the ladder exactly.',
          'Give the calendar date when billing restarts.',
        ],
        betterExamples: [null, null, null, 'Your pause ends on the 15th of next month and billing restarts that day. I noted it in Atlas.'],
      },
      {
        scenarioId: 'sim_side_effect_refund',
        daysAgo: 0,
        selectedDisposition: 'Callback scheduled',
        autoFailedReason: null,
        criterionScores: [100, 100, 100, 50],
        transcript: SIDE_EFFECT_PASS_TRANSCRIPT_SOFIA,
        summaryFeedback: 'Calm, safe triage. You checked for emergency symptoms first, gave no medical advice, and booked the Clinical Tier 2 callback.',
        strengths: ['Checked for emergency symptoms before anything else', 'Explained the 14-day refund review after checking the charge date'],
        improvements: ['Read the callback number back before you end the call'],
        evidence: [
          'I will warm transfer you to our medical team at Clinical Support Tier 2.',
          'Are you having chest pain, trouble breathing, or fainting?',
          'Your last charge was 9 days ago, which is inside our 14-day window.',
          'I have your member ID, callback number, the start date of the headaches, and the product name on the ticket.',
        ],
        coaching: [
          'Correct route and warm transfer.',
          'Good emergency check with no medical advice.',
          'Correct refund rule after checking the date.',
          'Confirm the callback number out loud.',
        ],
        betterExamples: [null, null, null, 'Can I read back your callback number so Clinical Tier 2 can reach you?'],
      },
    ],
  },
  {
    userKey: 'agent-1043',
    streakDays: 2,
    units: [
      { unitId: 'unit_verify_document', daysAgo: 3, firstTry: [true, false, true, true, false] },
      { unitId: 'unit_save_offer_ladder', daysAgo: 1, firstTry: [false, true, false, true, true] },
    ],
    sims: [],
  },
  {
    userKey: 'agent-1045',
    streakDays: 0,
    units: [{ unitId: 'unit_verify_document', daysAgo: 9, firstTry: [true, false, false, true, true] }],
    sims: [],
  },
  {
    userKey: 'agent-1050',
    streakDays: 3,
    units: [
      { unitId: 'unit_verify_document', daysAgo: 7, firstTry: [true, true, false, true, true] },
      { unitId: 'unit_save_offer_ladder', daysAgo: 5, firstTry: [true, false, true, false, true] },
      { unitId: 'unit_escalation_triage', daysAgo: 3, firstTry: [false, false, true, true, false] },
    ],
    sims: [
      {
        scenarioId: 'sim_side_effect_refund',
        daysAgo: 1,
        selectedDisposition: 'Not interested',
        autoFailedReason: 'The agent told the member to stop taking the supplement (medical advice).',
        criterionScores: [50, 0, 0, 50],
        transcript: SIDE_EFFECT_FAIL_TRANSCRIPT,
        summaryFeedback: 'This call needed a clinical escalation. A save offer came first, medical advice was given, and a refund was promised before the charge date was checked.',
        strengths: ['Stayed polite when the member became angry'],
        improvements: [
          'A side effect report stops the ladder: warm transfer to Clinical Tier 2',
          'Never tell a member to stop or change a product',
          'Check the charge date before you mention a refund',
        ],
        evidence: [
          'I will send you to Billing Disputes for the refund.',
          'Maybe stop taking the supplement for a few days and see if the headaches go away.',
          'I can give you a full refund of 39 dollars.',
          'I understand. Before you cancel, I can offer you 50% off your next two months.',
        ],
        coaching: [
          'Side effects go to Clinical Support Tier 2, not Billing Disputes.',
          'This is medical advice and an auto-fail trigger.',
          'Check the charge date in Atlas before you promise any amount.',
          'Collect member ID, callback number, symptom start date, and product name.',
        ],
        betterExamples: [
          'I am going to warm transfer you to our Clinical Support Tier 2 team now.',
          'I cannot give medical advice. Are you having chest pain, trouble breathing, or fainting?',
          'Let me check the charge date first. It was 9 days ago, so it is inside the 14-day window for review.',
          'Can I confirm your callback number and the day the headaches started?',
        ],
      },
    ],
  },
  {
    userKey: 'agent-1051',
    streakDays: 1,
    units: [{ unitId: 'unit_verify_document', daysAgo: 0, firstTry: [true, true, true, true, false] }],
    sims: [],
  },
  {
    userKey: 'agent-1060',
    streakDays: 8,
    units: [
      { unitId: 'unit_verify_document', daysAgo: 8, firstTry: [true, true, true, true, true] },
      { unitId: 'unit_save_offer_ladder', daysAgo: 6, firstTry: [true, false, true, true, true] },
      { unitId: 'unit_escalation_triage', daysAgo: 5, firstTry: [true, true, true, false, true] },
    ],
    sims: [
      {
        scenarioId: 'sim_price_cancel',
        daysAgo: 4,
        selectedDisposition: 'Not interested',
        autoFailedReason: 'The agent discussed plan and price details before verification and offered a free month that is not on the ladder.',
        criterionScores: [0, 50, 0, 50],
        transcript: PRICE_FAIL_TRANSCRIPT,
        summaryFeedback: 'Verification came after account talk and the first offer was not on the ladder. The travel reason was a clear fit for the 60-day pause.',
        strengths: ['Processed the cancellation without arguing'],
        improvements: ['Verify all 3 identity points before account details', 'Ask why the member wants to cancel before any offer'],
        evidence: [
          'I see you are on the Plus plan at 39 a month.',
          'I can give you a free month if you stay.',
          'I can give you a free month if you stay.',
          'I will cancel the membership for you now.',
        ],
        coaching: [
          'Plan and price are account details: verify first.',
          'Ask an open-ended discovery probe before any offer.',
          'A free month is not on the save-offer ladder.',
          'Read the confirmation number and the effective date.',
        ],
        betterExamples: [
          'Can I have your full name, date of birth, and ZIP code on file?',
          'What made you decide to cancel today?',
          'Since you will be away, I can pause your membership for up to 60 days.',
          'Your confirmation number is on its way by email; the cancellation takes effect at the end of this billing cycle.',
        ],
      },
      {
        scenarioId: 'sim_side_effect_refund',
        daysAgo: 2,
        selectedDisposition: 'Callback scheduled',
        autoFailedReason: null,
        criterionScores: [100, 100, 100, 50],
        transcript: SIDE_EFFECT_PASS_TRANSCRIPT,
        summaryFeedback: 'Excellent triage. You checked for emergency symptoms, gave no medical advice, and routed the call to Clinical Tier 2 with the refund window explained.',
        strengths: ['Checked for emergency symptoms first', 'Applied the 14-day refund rule after checking the charge date'],
        improvements: ['Confirm the callback number out loud before the transfer'],
        evidence: [
          'I will warm transfer you to our medical team at Clinical Support Tier 2.',
          'Are you having chest pain, trouble breathing, or fainting?',
          'Your last charge was 9 days ago, which is inside our 14-day window.',
          'I have your member ID, callback number, the start date of the headaches, and the product name on the ticket.',
        ],
        coaching: [
          'Correct route and warm transfer.',
          'Good emergency check with no medical advice.',
          'Correct refund rule after checking the date.',
          'Read the callback number back to the member to confirm it.',
        ],
        betterExamples: [null, null, null, 'Can I read back your callback number to make sure Clinical Tier 2 can reach you?'],
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// 7. Build every document (pure, validated)
// ---------------------------------------------------------------------------

interface SeedUserRecord {
  demo: DemoUser;
  uid: string;
  email: string;
}

interface BuiltProgress {
  userDocs: UserDoc[];
  enrollments: EnrollmentDoc[];
  simSessions: SimSessionDoc[];
  rollups: AnalyticsRollupDoc[];
  drillAttempts: DrillAttemptDoc[];
  reviewSchedules: ReviewScheduleDoc[];
  scenarioCoverage: ScenarioCoverageDoc[];
  certifications: CertificationDoc[];
}

const pillarById = new Map(PILLARS.map((pillar) => [pillar.id, pillar]));
const unitById = new Map(UNITS.map((unit) => [unit.id, unit]));
const scenarioById = new Map(SCENARIOS.map((scenario) => [scenario.id, scenario]));
const secretById = new Map(SECRET_SCENARIOS.map((secret) => [secret.scenarioId, secret]));

function pillarKeyFor(pillarId: string): string {
  const pillar = pillarById.get(pillarId);
  if (!pillar) throw new Error(`Unknown CompetencyPillar ${pillarId}`);
  return pillar.key;
}

function buildCohorts(existingCreatedAt: Map<string, number>, agentCounts: Map<string, number>): CohortDoc[] {
  return DEFAULT_COHORTS.map((cohort) =>
    CohortDocSchema.parse({
      id: cohort.id,
      name: cohort.name,
      isInternal: cohort.isInternal,
      defaultDivisionIds: [...cohort.defaultDivisionIds],
      activeAgentCount: agentCounts.get(cohort.id) ?? 0,
      joinCode: JOIN_CODES[cohort.id] ?? null,
      joinCodeEnabled: Boolean(JOIN_CODES[cohort.id]),
      createdAt: existingCreatedAt.get(cohort.id) ?? NOW,
      updatedAt: NOW,
    }),
  );
}

interface SourceFixture {
  bundle: SourceBundle;
  pages: SourcePageEvidence[];
  rulePacks: SharedRulePack[];
  assets: OperationalAsset[];
  conflicts: SourceConflict[];
}

function mainExcerpt(pageNumber: number, exactText = PLAYBOOK_PAGES[pageNumber - 1]): SourceExcerptRef {
  if (!exactText) throw new Error(`Unknown synthetic Playbook page ${pageNumber}.`);
  return {
    documentId: SOURCE_DOCUMENT_ID,
    revisionId: SOURCE_DOCUMENT_REVISION,
    pageNumber,
    exactText,
    fromApprovedTranscription: false,
  };
}

function approvedClaim(
  id: string,
  claim: string,
  pageNumbers: number[],
  trainerUid: string,
  reviewedAt: number,
): ClaimEvidence {
  return ClaimEvidenceSchema.parse({
    id,
    claim,
    ruleIds: pageNumbers.includes(2) ? [RULE_ID] : [],
    excerpts: pageNumbers.map((pageNumber) => mainExcerpt(pageNumber)),
    support: 'supported',
    approvalStatus: 'approved',
    critical: false,
    requiresInterfaceDetails: false,
    reviewerUid: trainerUid,
    reviewedAt,
  });
}

function buildApprovedSourceFixture(trainerUid: string, createdAt: number, approvedAt: number): {
  units: TrackUnit[];
  review: SourceFixture;
} {
  const units: TrackUnit[] = UNITS.map((unit) => ({
    ...unit,
    briefingCards: unit.briefingCards.map((card) => ({
      ...card,
      evidence: [approvedClaim(`evidence-${card.id}`, card.keyTakeaway, card.sourcePages, trainerUid, approvedAt)],
    })),
    drills: unit.drills.map((drill) => ({
      ...drill,
      evidence: [approvedClaim(`evidence-${drill.id}`, drill.prompt, drill.sourcePages, trainerUid, approvedAt)],
    })),
  }));

  const document = {
    id: SOURCE_DOCUMENT_ID,
    revisionId: SOURCE_DOCUMENT_REVISION,
    bundleId: SOURCE_BUNDLE_ID,
    trackId: TRACK_ID,
    role: 'shared_foundation' as const,
    fileName: 'MVP_Retention_Escalations_Playbook.pdf',
    storagePath: `playbooks/${TRACK_ID}/${createdAt}-MVP_Retention_Escalations_Playbook.pdf`,
    sourceVersion: 'synthetic-demo-v1',
    effectiveDate: null,
    uploadedAt: createdAt,
    uploadedByUid: trainerUid,
    contentHash: hashSourceBytes(buildPlaybookPdf(PLAYBOOK_PAGES)),
    pageCount: PLAYBOOK_PAGES.length,
    inheritanceOrder: 0,
    excluded: false,
    exclusionReason: null,
  };
  let pages = PLAYBOOK_PAGES.map((rawText, index) => SourcePageEvidenceSchema.parse({
    id: sourcePageEvidenceId(SOURCE_DOCUMENT_ID, index + 1),
    documentId: SOURCE_DOCUMENT_ID,
    revisionId: SOURCE_DOCUMENT_REVISION,
    pageNumber: index + 1,
    rawText,
    normalizedText: normalizeSourceText(rawText),
    contentHash: hashSourcePageContent(rawText),
    characterCount: rawText.length,
    extractionFlags: extractionQualityFlags(rawText),
    transcription: null,
    approvedExcerpts: [],
  }));
  const bundleIdentity = {
    documents: [document],
    sharedRulePackIds: [RULE_PACK_ID],
    precedencePolicyId: 'standard-meds-precedence-v1',
  };
  const revisionHash = computeSourceBundleRevisionHash(bundleIdentity, pages);
  const bundle = SourceBundleSchema.parse({
    schemaVersion: 1,
    id: SOURCE_BUNDLE_ID,
    trackId: TRACK_ID,
    ...bundleIdentity,
    conflictIds: [],
    status: 'approved',
    revisionHash,
    approvedSourceRevision: revisionHash,
    approvedByUid: trainerUid,
    approvedAt,
    createdAt,
    updatedAt: approvedAt,
  });
  const ruleEvidence = approvedClaim(
    'evidence-rule-demo-mvp-identity-verification',
    'Verify full name, date of birth, and ZIP code before account details.',
    [2],
    trainerUid,
    approvedAt,
  );
  const rulePacks = [SharedRulePackSchema.parse({
    id: RULE_PACK_ID,
    revision: 'synthetic-demo-rules-v1',
    title: 'MVP synthetic shared foundations',
    sourceDocumentIds: [SOURCE_DOCUMENT_ID],
    rules: [{
      id: RULE_ID,
      packId: RULE_PACK_ID,
      title: 'Verify three identity points',
      statement: 'Verify full name, date of birth, and ZIP code on file before discussing account details.',
      severity: 'critical',
      applicableTrackIds: [TRACK_ID],
      channels: ['voice'],
      stages: ['verification'],
      evidence: ruleEvidence,
      requiredKnowledge: true,
      requiredScenarioCoverage: true,
      sourceRevision: revisionHash,
      approvalStatus: 'approved',
      approvedByUid: trainerUid,
      approvedAt,
    }],
    approvalStatus: 'approved',
    createdAt,
    updatedAt: approvedAt,
  })];
  const assets: OperationalAsset[] = [
    OperationalAssetSchema.parse({
      id: 'offer-demo-mvp-price-discount',
      trackId: TRACK_ID,
      product: 'MVP Plus',
      context: 'existing_patient_discount',
      stage: 'save_offer',
      sourceRefs: [mainExcerpt(5)],
      effectiveFrom: null,
      effectiveTo: null,
      status: 'approved',
      approvedByUid: trainerUid,
      approvedAt,
      kind: 'offer',
      label: '50% off the next 2 billing cycles',
      amountCents: null,
      comparisonAmountCents: 3900,
      recurringInterval: 'monthly',
      duration: 'plan_term',
      discountBasisPoints: 5000,
      calculation: 'Apply 50% off to each of the next 2 billing cycles only.',
      sequence: 1,
      prerequisites: ['Price or value concern'],
    }),
    OperationalAssetSchema.parse({
      id: 'offer-demo-mvp-travel-pause',
      trackId: TRACK_ID,
      product: 'MVP Plus',
      context: 'existing_patient_cancellation',
      stage: 'save_offer',
      sourceRefs: [mainExcerpt(5)],
      effectiveFrom: null,
      effectiveTo: null,
      status: 'approved',
      approvedByUid: trainerUid,
      approvedAt,
      kind: 'offer',
      label: 'Pause up to 60 days',
      amountCents: 0,
      comparisonAmountCents: 3900,
      recurringInterval: 'monthly',
      duration: 'plan_term',
      discountBasisPoints: null,
      calculation: 'Pause billing for up to 60 days; limit 1 pause per 12 months.',
      sequence: 2,
      prerequisites: ['Travel, Moving or temporary non-use'],
    }),
  ];
  const excerpts = [
    ...units.flatMap((unit) => [
      ...unit.briefingCards.flatMap((card) => card.evidence?.flatMap((item) => item.excerpts) ?? []),
      ...unit.drills.flatMap((drill) => drill.evidence?.flatMap((item) => item.excerpts) ?? []),
    ]),
    ...rulePacks.flatMap((pack) => pack.rules.flatMap((rule) => rule.evidence.excerpts)),
    ...assets.flatMap((asset) => asset.sourceRefs),
  ];
  pages = pages.map((page) => SourcePageEvidenceSchema.parse({
    ...page,
    approvedExcerpts: excerpts.filter((excerpt) =>
      excerpt.documentId === page.documentId &&
      excerpt.revisionId === page.revisionId &&
      excerpt.pageNumber === page.pageNumber
    ),
  }));
  return { units, review: { bundle, pages, rulePacks, assets, conflicts: [] } };
}

function buildTrackDocs(trainerUid: string): {
  track: TrackDoc;
  draft: TrackVersionDoc;
  published: TrackVersionDoc;
  draftSecrets: EvalRubricsDoc;
  publishedSecrets: EvalRubricsDoc;
  sourceBatches: SourcePageBatchDoc[];
  sourceReview: SourceFixture;
} {
  // Validate content invariants that the schemas do not check.
  for (const unit of UNITS) {
    const kinds = new Set(unit.drills.map((drill) => drill.kind));
    if (kinds.size !== 5) throw new Error(`Unit ${unit.id} must cover all 5 Drill kinds.`);
    for (const drill of unit.drills) {
      pillarKeyFor(drill.competencyPillarId);
      if (drill.kind === 'FILL_BLANK_CHOICE') {
        if (!drill.sentenceTemplate.includes(FILL_BLANK_TOKEN)) throw new Error(`${drill.id} has no blank token.`);
        if (!drill.wordBank.includes(drill.correctWord)) throw new Error(`${drill.id} correctWord not in wordBank.`);
      }
      if (drill.kind === 'MULTIPLE_CHOICE' && !drill.options.some((option) => option.id === drill.correctOptionId)) {
        throw new Error(`${drill.id} correctOptionId does not match an option.`);
      }
    }
  }
  for (const secret of SECRET_SCENARIOS) {
    const total = secret.rubricCriteria.reduce((sum, criterion) => sum + criterion.weight, 0);
    if (total !== 100) throw new Error(`Rubric weights for ${secret.scenarioId} sum to ${total}, not 100.`);
    const scenario = scenarioById.get(secret.scenarioId);
    if (!scenario) throw new Error(`Secret config ${secret.scenarioId} has no public scenario.`);
    if (!scenario.dispositionOptions.includes(secret.expectedDisposition)) {
      throw new Error(`Expected disposition for ${secret.scenarioId} is not a disposition option.`);
    }
    secret.rubricCriteria.forEach((criterion) => pillarKeyFor(criterion.competencyPillarId));
  }
  for (const pillar of PILLARS) {
    if (!CANONICAL_PILLARS.some((canonical) => canonical.key === pillar.key)) {
      throw new Error(`CompetencyPillar ${pillar.id} uses a non-canonical key ${pillar.key}.`);
    }
  }

  const createdAt = daysAgo(14);
  const publishedAt = daysAgo(12);
  const unitMinutes = UNITS.reduce((sum, unit) => sum + unit.estimatedMinutes, 0);
  const sourceFixture = buildApprovedSourceFixture(trainerUid, createdAt, publishedAt);

  const track = TrackDocSchema.parse({
    id: TRACK_ID,
    title: 'MVP Retention & Escalations',
    campaignCode: 'MVP',
    divisionId: TRACK_DIVISION,
    status: 'PUBLISHED',
    generationProgress: { step: 'READY', percent: 100, message: 'Track is ready.' },
    sourcePdfStoragePath: `playbooks/${TRACK_ID}/${createdAt}-MVP_Retention_Escalations_Playbook.pdf`,
    sourcePdfFileName: 'MVP_Retention_Escalations_Playbook.pdf',
    sourcePageCount: PLAYBOOK_PAGES.length,
    activeSourceBundleId: SOURCE_BUNDLE_ID,
    currentDraftVersionId: DRAFT_VERSION_ID,
    publishedVersionId: PUBLISHED_VERSION_ID,
    assignedCohortIds: ['ALL'],
    competencyPillars: PILLARS,
    unitCount: UNITS.length,
    simScenarioCount: SCENARIOS.length,
    estimatedTotalMinutes: unitMinutes + SCENARIOS.length * 6,
    createdByUid: trainerUid,
    createdAt,
    updatedAt: publishedAt,
  });

  const versionBase = {
    trackId: TRACK_ID,
    competencyPillars: PILLARS,
    units: sourceFixture.units,
    simScenarios: runnableScenarios(sourceFixture.review.bundle.revisionHash),
    sourceBundleId: SOURCE_BUNDLE_ID,
    sourceRevision: sourceFixture.review.bundle.revisionHash,
    requiredRuleIds: [RULE_ID],
  };
  const published = TrackVersionDocSchema.parse({
    ...versionBase,
    versionId: PUBLISHED_VERSION_ID,
    versionNumber: 1,
    publishedAt,
    createdAt: publishedAt,
  });
  const draft = TrackVersionDocSchema.parse({
    ...versionBase,
    versionId: DRAFT_VERSION_ID,
    versionNumber: 2,
    publishedAt: null,
    createdAt,
  });
  const publishedSecrets = EvalRubricsDocSchema.parse({
    trackId: TRACK_ID,
    versionId: PUBLISHED_VERSION_ID,
    scenarios: groundedSecrets(trainerUid, publishedAt),
    updatedAt: publishedAt,
  });
  const draftSecrets = EvalRubricsDocSchema.parse({
    trackId: TRACK_ID,
    versionId: DRAFT_VERSION_ID,
    scenarios: groundedSecrets(trainerUid, publishedAt),
    updatedAt: publishedAt,
  });

  const sourceBatches: SourcePageBatchDoc[] = [];
  for (let start = 0; start < PLAYBOOK_PAGES.length; start += SOURCE_PAGES_PER_BATCH) {
    const slice = PLAYBOOK_PAGES.slice(start, start + SOURCE_PAGES_PER_BATCH);
    const batchNumber = start / SOURCE_PAGES_PER_BATCH + 1;
    sourceBatches.push(
      SourcePageBatchDocSchema.parse({
        id: `batch-${String(batchNumber).padStart(3, '0')}`,
        trackId: TRACK_ID,
        startPage: start + 1,
        endPage: start + slice.length,
        pages: slice.map((text, index) => ({ pageNumber: start + index + 1, text })),
        createdAt,
      }),
    );
  }

  return { track, draft, published, draftSecrets, publishedSecrets, sourceBatches, sourceReview: sourceFixture.review };
}

function buildVerbalDemoTrackDocs(trainerUid: string): {
  track: TrackDoc;
  draft: TrackVersionDoc;
  published: TrackVersionDoc;
  draftSecrets: EvalRubricsDoc;
  publishedSecrets: EvalRubricsDoc;
  sourceBatches: SourcePageBatchDoc[];
  sourceReview: SourceFixture;
} {
  const bundleId = 'bundle-demo-verbal-neurocalm';
  const documentId = 'doc-demo-verbal-neurocalm';
  const revisionId = 'demo-verbal-neurocalm-rev-1';
  const packId = 'pack-demo-verbal-neurocalm';
  const createdAt = daysAgo(5);
  const publishedAt = daysAgo(4);

  const pagesText = [
    'NeuroCalmRx Verbal Agent Guide Page 1. Always verify full name, date of birth, and ZIP code on file before discussing any order, refill, or billing record. Agents must remain strictly within non-clinical scope: never adjust dosages, interpret symptoms as a diagnosis, or recommend medical changes. Direct all clinical dosing questions to Clinical Support Tier 2.',
    'NeuroCalmRx Verbal Agent Guide Page 2. Screen immediately for urgent red-flag symptoms including chest pain, shortness of breath, fainting, or severe dizziness, and initiate a warm transfer to Clinical Support Tier 2 with a read-back of the caller phone number. Honor every spoken opt-out or stop-calling request immediately with zero additional save offers or persuasion attempts.',
  ];

  let pages = pagesText.map((rawText, index) =>
    SourcePageEvidenceSchema.parse({
      id: sourcePageEvidenceId(documentId, index + 1),
      documentId,
      revisionId,
      pageNumber: index + 1,
      rawText,
      normalizedText: normalizeSourceText(rawText),
      contentHash: hashSourcePageContent(rawText),
      characterCount: rawText.length,
      extractionFlags: extractionQualityFlags(rawText),
      transcription: null,
      approvedExcerpts: [],
    }),
  );

  const excerpt = (pageNumber: number): SourceExcerptRef => ({
    documentId,
    revisionId,
    pageNumber,
    exactText: pagesText[pageNumber - 1]!,
    fromApprovedTranscription: false,
  });

  const approvedEvidence = (id: string, claim: string, ruleIds: string[], pageNumbers: number[]): ClaimEvidence =>
    ClaimEvidenceSchema.parse({
      id,
      claim,
      ruleIds,
      excerpts: pageNumbers.map((pageNumber) => excerpt(pageNumber)),
      support: 'supported',
      approvalStatus: 'approved',
      critical: false,
      requiresInterfaceDetails: false,
      reviewerUid: trainerUid,
      reviewedAt: publishedAt,
    });

  const document = {
    id: documentId,
    revisionId,
    bundleId,
    trackId: VERBAL_TRACK_ID,
    role: 'product' as const,
    fileName: 'NeuroCalmRx_Verbal_Playbook.pdf',
    storagePath: `playbooks/${VERBAL_TRACK_ID}/${createdAt}-NeuroCalmRx_Verbal_Playbook.pdf`,
    sourceVersion: 'neurocalm-verbal-v1',
    effectiveDate: null,
    uploadedAt: createdAt,
    uploadedByUid: trainerUid,
    contentHash: hashSourceBytes(Buffer.from(pagesText.join('\n\n'), 'utf8')),
    pageCount: pagesText.length,
    inheritanceOrder: 0,
    excluded: false,
    exclusionReason: null,
  };

  const bundleIdentity = {
    documents: [document],
    sharedRulePackIds: [packId],
    precedencePolicyId: 'standard-meds-precedence-v1',
  };
  const revisionHash = computeSourceBundleRevisionHash(bundleIdentity, pages);
  const bundle = SourceBundleSchema.parse({
    schemaVersion: 1,
    id: bundleId,
    trackId: VERBAL_TRACK_ID,
    ...bundleIdentity,
    conflictIds: [],
    status: 'approved',
    revisionHash,
    approvedSourceRevision: revisionHash,
    approvedByUid: trainerUid,
    approvedAt: publishedAt,
    createdAt,
    updatedAt: publishedAt,
  });

  const ruleDefs = [
    {
      id: 'rule-nc-identity',
      title: 'Verify full name, date of birth, and ZIP code',
      statement: 'Verify full name, date of birth, and ZIP code before discussing any order or billing detail.',
      page: 1,
      stage: 'verification',
    },
    {
      id: 'rule-nc-scope',
      title: 'Maintain non-clinical scope boundaries',
      statement: 'Never adjust dosages or give medical advice; refer clinical dosing questions to Clinical Support Tier 2.',
      page: 1,
      stage: 'compliance',
    },
    {
      id: 'rule-nc-escalation',
      title: 'Screen red-flag symptoms and warm-transfer',
      statement: 'Screen for chest pain, shortness of breath, fainting, or severe dizziness and warm-transfer to Clinical Support Tier 2.',
      page: 2,
      stage: 'escalation',
    },
    {
      id: 'rule-nc-optout',
      title: 'Honor spoken opt-out immediately',
      statement: 'Stop all save offers immediately when a caller asks to opt out or stop calling.',
      page: 2,
      stage: 'compliance',
    },
  ] as const;

  const rulePacks = [
    SharedRulePackSchema.parse({
      id: packId,
      revision: 'neurocalm-verbal-rules-v1',
      title: 'NeuroCalmRx Verbal Core Rules',
      sourceDocumentIds: [documentId],
      rules: ruleDefs.map((rule) => ({
        id: rule.id,
        packId,
        title: rule.title,
        statement: rule.statement,
        severity: 'critical',
        applicableTrackIds: [VERBAL_TRACK_ID],
        channels: ['voice'],
        stages: [rule.stage],
        evidence: approvedEvidence(`ev-${rule.id}`, rule.statement, [rule.id], [rule.page]),
        requiredKnowledge: true,
        requiredScenarioCoverage: false,
        sourceRevision: revisionHash,
        approvalStatus: 'approved',
        approvedByUid: trainerUid,
        approvedAt: publishedAt,
      })),
      approvalStatus: 'approved',
      createdAt,
      updatedAt: publishedAt,
    }),
  ];

  const units: TrackUnit[] = [
    {
      id: 'unit-nc-1',
      orderIndex: 0,
      title: 'Verbal Identity & Scope Boundaries',
      summary: 'Verify callers cleanly and stay inside non-clinical verbal boundaries.',
      estimatedMinutes: 6,
      briefingCards: [
        {
          id: 'card-nc-1-verify',
          headline: 'Three-Point Verbal Verification',
          bodyMarkdown: 'Before mentioning any order date, refill, or billing balance, confirm **full name, date of birth, and ZIP code** verbally.',
          keyTakeaway: 'Confirm full name, DOB, and ZIP before discussing any account details.',
          doList: ['Ask for full name, date of birth, and ZIP code at call opening'],
          dontList: ['Never cite refill dates or card charges before full verification'],
          sourcePages: [1],
          evidence: [approvedEvidence('ev-card-nc-1a', 'Verify full name, DOB, and ZIP before discussing order details.', ['rule-nc-identity'], [1])],
        },
        {
          id: 'card-nc-1-scope',
          headline: 'Strict Non-Clinical Verbal Scope',
          bodyMarkdown: 'Never adjust doses or interpret symptoms as medical guidance. Refer all clinical questions to **Clinical Support Tier 2**.',
          keyTakeaway: 'Never offer medical advice or dosage changes; refer to Clinical Tier 2.',
          doList: ['State clearly that clinical dosing questions go to Clinical Support Tier 2'],
          dontList: ['Never advise changing a prescribed schedule or splitting tablets'],
          sourcePages: [1],
          evidence: [approvedEvidence('ev-card-nc-1b', 'Never adjust dosages or offer medical advice.', ['rule-nc-scope'], [1])],
        },
      ],
      drills: [
        {
          id: 'drill-nc-1-identity',
          kind: 'MULTIPLE_CHOICE',
          competencyPillarId: 'pillar_verification',
          ruleIds: ['rule-nc-identity'],
          prompt: 'Before checking a caller’s NeuroCalmRx refill status, which three items must you verify verbally?',
          options: [
            { id: 'a', text: 'Full name, date of birth, and ZIP code' },
            { id: 'b', text: 'First name, phone number, and pharmacy name' },
            { id: 'c', text: 'Email address and last 4 digits of card only' },
            { id: 'd', text: 'ZIP code and prescribing doctor name only' },
          ],
          correctOptionId: 'a',
          explanation: 'Always confirm full name, date of birth, and ZIP code before discussing account or refill records.',
          sourcePages: [1],
          evidence: [approvedEvidence('ev-drill-nc-1a', 'Verify full name, date of birth, and ZIP code.', ['rule-nc-identity'], [1])],
        },
        {
          id: 'drill-nc-1-scope',
          kind: 'TRUE_FALSE_SPOT',
          competencyPillarId: 'pillar_compliance',
          ruleIds: ['rule-nc-scope'],
          statement: 'Agent says: "You can take half a dose tonight if the bottle feels too strong until you reach your doctor."',
          isCompliant: false,
          prompt: 'Evaluate whether this spoken agent statement follows NeuroCalmRx scope rules:',
          explanation: 'Adjusting dosages violates non-clinical scope. Route dosing questions to Clinical Support Tier 2.',
          sourcePages: [1],
          evidence: [approvedEvidence('ev-drill-nc-1b', 'Never adjust dosages or give medical advice.', ['rule-nc-scope'], [1])],
        },
        {
          id: 'drill-nc-1-escalation',
          kind: 'MULTIPLE_CHOICE',
          competencyPillarId: 'pillar_escalation',
          ruleIds: ['rule-nc-escalation'],
          prompt: 'When a patient mentions dizziness after starting NeuroCalmRx, what must your verbal screening cover first?',
          options: [
            { id: 'a', text: 'Screen for red-flag symptoms like chest pain or fainting and prepare a Clinical Tier 2 warm transfer' },
            { id: 'b', text: 'Immediately offer a 50% retention discount to keep the subscription active' },
            { id: 'c', text: 'Tell the caller mild dizziness always goes away within 48 hours' },
            { id: 'd', text: 'End the call and mark the ticket resolved' },
          ],
          correctOptionId: 'a',
          explanation: 'Screen immediately for red-flag symptoms and warm-transfer urgent cases to Clinical Support Tier 2.',
          sourcePages: [2],
          evidence: [approvedEvidence('ev-drill-nc-1c', 'Screen immediately for red-flag symptoms and warm-transfer to Clinical Tier 2.', ['rule-nc-escalation'], [2])],
        },
        {
          id: 'drill-nc-1-optout',
          kind: 'TRUE_FALSE_SPOT',
          competencyPillarId: 'pillar_compliance',
          ruleIds: ['rule-nc-optout'],
          statement: 'Caller says "Please stop calling me." Agent replies: "I understand completely—I will make sure no further outreach calls are placed."',
          isCompliant: true,
          prompt: 'Does this spoken agent response satisfy the opt-out compliance rule?',
          explanation: 'Honoring a spoken opt-out immediately without pitching additional save offers is compliant.',
          sourcePages: [2],
          evidence: [approvedEvidence('ev-drill-nc-1d', 'Honor spoken opt-out requests immediately with zero additional pitches.', ['rule-nc-optout'], [2])],
        },
      ],
    },
    {
      id: 'unit-nc-2',
      orderIndex: 1,
      title: 'Verbal Escalation & Opt-Out Mastery',
      summary: 'Apply escalation read-backs and zero-pitch opt-outs in high-pressure conversations.',
      estimatedMinutes: 6,
      briefingCards: [
        {
          id: 'card-nc-2-escalation',
          headline: 'Warm-Transfer Read-Back Habit',
          bodyMarkdown: 'Before transferring a symptomatic patient to **Clinical Support Tier 2**, confirm their **callback number out loud** so the clinical specialist can reconnect if dropped.',
          keyTakeaway: 'Screen red flags and read back the callback number before warm transfer.',
          doList: ['Ask for chest pain, breathing trouble, fainting, or severe dizziness', 'Read back callback number verbally'],
          dontList: ['Never cold-drop a symptomatic caller into voicemail'],
          sourcePages: [2],
          evidence: [approvedEvidence('ev-card-nc-2a', 'Warm transfer with read-back of the caller phone number.', ['rule-nc-escalation'], [2])],
        },
        {
          id: 'card-nc-2-optout',
          headline: 'Zero-Pitch After Spoken Opt-Out',
          bodyMarkdown: 'The instant a caller says "take me off your list" or "stop calling," stop every save offer and close courteously.',
          keyTakeaway: 'Zero save offers after any spoken opt-out request.',
          doList: ['Confirm outreach stops right away and close politely'],
          dontList: ['Never pitch a discount or pause after an opt-out request'],
          sourcePages: [2],
          evidence: [approvedEvidence('ev-card-nc-2b', 'Honor every spoken opt-out immediately with zero additional save offers.', ['rule-nc-optout'], [2])],
        },
      ],
      drills: [
        {
          id: 'drill-nc-2-identity',
          kind: 'TRUE_FALSE_SPOT',
          competencyPillarId: 'pillar_verification',
          ruleIds: ['rule-nc-identity'],
          variationOfDrillId: 'drill-nc-1-identity',
          statement: 'Caller refuses to share date of birth, so the agent reads out their last order total to prove who is calling.',
          isCompliant: false,
          prompt: 'Evaluate this verbal shortcut during verification:',
          explanation: 'Never reveal order or payment data when full 3-point verbal verification (name, DOB, ZIP) is incomplete.',
          sourcePages: [1],
          evidence: [approvedEvidence('ev-drill-nc-2a', 'Verify full name, date of birth, and ZIP code before account details.', ['rule-nc-identity'], [1])],
        },
        {
          id: 'drill-nc-2-scope',
          kind: 'MULTIPLE_CHOICE',
          competencyPillarId: 'pillar_compliance',
          ruleIds: ['rule-nc-scope'],
          variationOfDrillId: 'drill-nc-1-scope',
          prompt: 'Which spoken reply stays strictly inside NeuroCalmRx non-clinical scope when asked about side effects?',
          options: [
            { id: 'a', text: 'Let me check for urgent symptoms and connect you with our medical specialists at Clinical Support Tier 2.' },
            { id: 'b', text: 'That reaction is harmless if you drink extra water with dinner.' },
            { id: 'c', text: 'Switch to taking it every other day until Friday.' },
            { id: 'd', text: 'Most patients tolerate it fine after week two, so keep taking the full amount.' },
          ],
          correctOptionId: 'a',
          explanation: 'Connecting the patient to Clinical Support Tier 2 avoids medical advice while routing safely.',
          sourcePages: [1],
          evidence: [approvedEvidence('ev-drill-nc-2b', 'Direct all clinical dosing questions to Clinical Support Tier 2.', ['rule-nc-scope'], [1])],
        },
        {
          id: 'drill-nc-2-escalation',
          kind: 'TRUE_FALSE_SPOT',
          competencyPillarId: 'pillar_escalation',
          ruleIds: ['rule-nc-escalation'],
          variationOfDrillId: 'drill-nc-1-escalation',
          statement: 'Agent screens for chest pain and fainting, reads back the callback number, and introduces the caller to Clinical Support Tier 2.',
          isCompliant: true,
          prompt: 'Evaluate this Clinical Tier 2 escalation sequence:',
          explanation: 'Screening for red-flag symptoms plus reading back the callback number completes a safe warm transfer.',
          sourcePages: [2],
          evidence: [approvedEvidence('ev-drill-nc-2c', 'Screen red-flag symptoms and warm-transfer with callback number read-back.', ['rule-nc-escalation'], [2])],
        },
        {
          id: 'drill-nc-2-optout',
          kind: 'MULTIPLE_CHOICE',
          competencyPillarId: 'pillar_compliance',
          ruleIds: ['rule-nc-optout'],
          variationOfDrillId: 'drill-nc-1-optout',
          prompt: 'A caller interrupts your greeting to say "Remove my number and stop calling me." What is the compliant spoken response?',
          options: [
            { id: 'a', text: 'Acknowledge immediately, confirm no further calls, and end courteously without mentioning any offer.' },
            { id: 'b', text: 'Offer a quick 50% discount before confirming the opt-out.' },
            { id: 'c', text: 'Ask why they want to opt out so you can rebut their objection.' },
            { id: 'd', text: 'Suggest pausing refills for 30 days first.' },
          ],
          correctOptionId: 'a',
          explanation: 'Any save pitch after an opt-out violates compliance; honor the opt-out immediately.',
          sourcePages: [2],
          evidence: [approvedEvidence('ev-drill-nc-2d', 'Honor spoken opt-out immediately with zero additional save offers.', ['rule-nc-optout'], [2])],
        },
      ],
    },
  ];

  const baseScenario = ensureVerbalScenarioDefaults(
    PublicSimScenarioSchema.parse({
      id: 'scenario-nc-verbal-1',
      title: 'Refill & Mild Dizziness Verbal Triage',
      difficulty: 'STANDARD',
      counterpartyRoleLabel: 'Existing Patient',
      contextTicketSummary: 'Verbal role-play · Patient calling about a NeuroCalmRx refill and mild dizziness.',
      accountOnFile: ['Name: Taylor Bennett', 'DOB: 1984-07-12', 'ZIP: 60611', 'Callback number: 555-0194'],
      openingMessage: 'Hi, I got my NeuroCalmRx refill yesterday and felt a little dizzy this morning—should I take half a dose tonight or get a refund?',
      dispositionOptions: ['Callback scheduled', 'Escalated', 'Recovered'],
      maxTurns: 6,
      passScoreThreshold: 75,
    }),
    { divisionId: 'TELEHEALTH', product: 'NeuroCalmRx', sourceRevision: revisionHash, curriculumVersion: PUBLISHED_VERSION_ID },
  );

  const baseSecret = ensureVerbalSecretDefaults(
    baseScenario,
    SecretSimScenarioConfigSchema.parse({
      scenarioId: baseScenario.id,
      personaName: 'Taylor Bennett',
      personaBackstoryAndMood: 'Worried existing patient seeking clear guidance on side effects and next steps without jargon.',
      hiddenFactsToRevealOnlyWhenAsked: [
        'Full name: Taylor Bennett, DOB: 1984-07-12, ZIP: 60611.',
        'Callback number is 555-0194; no chest pain or fainting.',
      ],
      conditionalBehaviors: [
        'Cooperate warmly if the agent verifies identity first and avoids giving dosing advice.',
      ],
      expectedDisposition: 'Callback scheduled',
      autoFailTriggers: ['Giving dosing or medical advice instead of escalating to Clinical Support Tier 2.'],
      rubricCriteria: [
        {
          id: 'c-nc-1',
          competencyPillarId: 'pillar_verification',
          criterionLabel: 'Verify three identity points before account details',
          evaluationRule: 'Ask for full name, date of birth, and ZIP code before discussing account or refill status.',
          weight: 34,
          sourcePages: [1],
          evidence: [approvedEvidence('ev-rubric-nc-1', 'Verify full name, date of birth, and ZIP code.', ['rule-nc-identity'], [1])],
        },
        {
          id: 'c-nc-2',
          competencyPillarId: 'pillar_compliance',
          criterionLabel: 'Maintain strict non-clinical scope',
          evaluationRule: 'Do not adjust dosages or give medical advice; route clinical questions to Clinical Support Tier 2.',
          weight: 33,
          sourcePages: [1],
          evidence: [approvedEvidence('ev-rubric-nc-2', 'Never adjust dosages; refer to Clinical Tier 2.', ['rule-nc-scope'], [1])],
        },
        {
          id: 'c-nc-3',
          competencyPillarId: 'pillar_escalation',
          criterionLabel: 'Screen red flags and confirm warm transfer callback',
          evaluationRule: 'Screen for chest pain, breathing trouble, fainting, or severe dizziness and read back callback number.',
          weight: 33,
          sourcePages: [2],
          evidence: [approvedEvidence('ev-rubric-nc-3', 'Screen red flags and read back callback number before transfer.', ['rule-nc-escalation'], [2])],
        },
      ],
    }),
    true,
  );

  const allExcerpts = [
    ...units.flatMap((unit) => [
      ...unit.briefingCards.flatMap((card) => card.evidence?.flatMap((e) => e.excerpts) ?? []),
      ...unit.drills.flatMap((drill) => drill.evidence?.flatMap((e) => e.excerpts) ?? []),
    ]),
    ...rulePacks.flatMap((pack) => pack.rules.flatMap((rule) => rule.evidence.excerpts)),
    ...baseSecret.rubricCriteria.flatMap((c) => c.evidence?.flatMap((e) => e.excerpts) ?? []),
  ];
  pages = pages.map((page) =>
    SourcePageEvidenceSchema.parse({
      ...page,
      approvedExcerpts: allExcerpts.filter((ex) => ex.pageNumber === page.pageNumber),
    }),
  );

  const track = TrackDocSchema.parse({
    id: VERBAL_TRACK_ID,
    title: 'NeuroCalmRx Verbal Mastery',
    campaignCode: 'NEUROCALM-VERBAL',
    divisionId: 'TELEHEALTH',
    status: 'PUBLISHED',
    generationProgress: { step: 'READY', percent: 100, message: 'Verbal Track ready.' },
    sourcePdfStoragePath: `playbooks/${VERBAL_TRACK_ID}/${createdAt}-NeuroCalmRx_Verbal_Playbook.pdf`,
    sourcePdfFileName: 'NeuroCalmRx_Verbal_Playbook.pdf',
    sourcePageCount: pagesText.length,
    activeSourceBundleId: bundleId,
    currentDraftVersionId: DRAFT_VERSION_ID,
    publishedVersionId: PUBLISHED_VERSION_ID,
    assignedCohortIds: ['ALL'],
    competencyPillars: PILLARS,
    unitCount: units.length,
    simScenarioCount: 1,
    estimatedTotalMinutes: 18,
    createdByUid: trainerUid,
    createdAt,
    updatedAt: publishedAt,
  });

  const versionBase = {
    trackId: VERBAL_TRACK_ID,
    competencyPillars: PILLARS,
    units,
    simScenarios: [baseScenario],
    sourceBundleId: bundleId,
    sourceRevision: revisionHash,
    requiredRuleIds: ruleDefs.map((r) => r.id),
  };
  const published = TrackVersionDocSchema.parse({
    ...versionBase,
    versionId: PUBLISHED_VERSION_ID,
    versionNumber: 1,
    publishedAt,
    createdAt: publishedAt,
  });
  const draft = TrackVersionDocSchema.parse({
    ...versionBase,
    versionId: DRAFT_VERSION_ID,
    versionNumber: 2,
    publishedAt: null,
    createdAt,
  });
  const publishedSecrets = EvalRubricsDocSchema.parse({
    trackId: VERBAL_TRACK_ID,
    versionId: PUBLISHED_VERSION_ID,
    scenarios: [baseSecret],
    updatedAt: publishedAt,
  });
  const draftSecrets = EvalRubricsDocSchema.parse({
    trackId: VERBAL_TRACK_ID,
    versionId: DRAFT_VERSION_ID,
    scenarios: [baseSecret],
    updatedAt: createdAt,
  });
  const sourceBatches: SourcePageBatchDoc[] = [
    SourcePageBatchDocSchema.parse({
      id: 'batch-001',
      trackId: VERBAL_TRACK_ID,
      startPage: 1,
      endPage: pagesText.length,
      pages: pagesText.map((text, index) => ({ pageNumber: index + 1, text })),
      createdAt,
    }),
  ];

  return {
    track,
    draft,
    published,
    draftSecrets,
    publishedSecrets,
    sourceBatches,
    sourceReview: { bundle, pages, rulePacks, assets: [], conflicts: [] },
  };
}

function buildBlockedSourceFixture(trainerUid: string): {
  track: TrackDoc;
  draft: TrackVersionDoc;
  draftSecrets: EvalRubricsDoc;
  review: SourceFixture;
} {
  const documentId = 'doc-demo-unresolved-price-policy';
  const revisionId = 'demo-unresolved-price-revision-1';
  const rulePackId = 'pack-demo-unresolved-price';
  const ruleId = 'rule-demo-unresolved-price-decision';
  const conflictId = 'DEMO-UNRESOLVED-PRICE';
  const createdAt = daysAgo(2);
  const sourceTexts = [
    'Synthetic Recovery Price Policy A. The recovery checkout price is 99 USD. This fixture is deliberately unresolved. Two synthetic policy pages disagree about the checkout price. Do not select either price until an SME records a decision. This text exists only to exercise the publication gate and is not operational guidance.',
    'Synthetic Recovery Price Policy B. The recovery checkout price is 109 USD. This fixture is deliberately unresolved. Two synthetic policy pages disagree about the checkout price. Do not select either price until an SME records a decision. This text exists only to exercise the publication gate and is not operational guidance.',
  ];
  const excerpt = (pageNumber: number): SourceExcerptRef => ({
    documentId,
    revisionId,
    pageNumber,
    exactText: sourceTexts[pageNumber - 1],
    fromApprovedTranscription: false,
  });
  const evidence = (id: string, claim: string): ClaimEvidence => ClaimEvidenceSchema.parse({
    id,
    claim,
    ruleIds: [ruleId],
    excerpts: [excerpt(1), excerpt(2)],
    support: 'supported',
    approvalStatus: 'approved',
    critical: true,
    requiresInterfaceDetails: false,
    reviewerUid: trainerUid,
    reviewedAt: createdAt,
  });
  const pages = sourceTexts.map((rawText, index) => SourcePageEvidenceSchema.parse({
    id: sourcePageEvidenceId(documentId, index + 1),
    documentId,
    revisionId,
    pageNumber: index + 1,
    rawText,
    normalizedText: normalizeSourceText(rawText),
    contentHash: hashSourcePageContent(rawText),
    characterCount: rawText.length,
    extractionFlags: extractionQualityFlags(rawText),
    transcription: null,
    approvedExcerpts: [excerpt(index + 1)],
  }));
  const document = {
    id: documentId,
    revisionId,
    bundleId: BLOCKED_SOURCE_BUNDLE_ID,
    trackId: BLOCKED_TRACK_ID,
    role: 'product' as const,
    fileName: 'synthetic-unresolved-price-policy.txt',
    storagePath: `synthetic/${BLOCKED_TRACK_ID}/unresolved-price-policy.txt`,
    sourceVersion: 'synthetic-conflict-v1',
    effectiveDate: null,
    uploadedAt: createdAt,
    uploadedByUid: trainerUid,
    contentHash: hashSourceBytes(Buffer.from(sourceTexts.join('\n\n'), 'utf8')),
    pageCount: sourceTexts.length,
    inheritanceOrder: 0,
    excluded: false,
    exclusionReason: null,
  };
  const bundleIdentity = {
    documents: [document],
    sharedRulePackIds: [rulePackId],
    precedencePolicyId: 'standard-meds-precedence-v1',
  };
  const revisionHash = computeSourceBundleRevisionHash(bundleIdentity, pages);
  const bundle = SourceBundleSchema.parse({
    schemaVersion: 1,
    id: BLOCKED_SOURCE_BUNDLE_ID,
    trackId: BLOCKED_TRACK_ID,
    ...bundleIdentity,
    conflictIds: [conflictId],
    status: 'needs_sme',
    revisionHash,
    approvedSourceRevision: null,
    approvedByUid: null,
    approvedAt: null,
    createdAt,
    updatedAt: createdAt,
  });
  const rulePacks = [SharedRulePackSchema.parse({
    id: rulePackId,
    revision: 'synthetic-conflict-rules-v1',
    title: 'Synthetic unresolved price policy',
    sourceDocumentIds: [documentId],
    rules: [{
      id: ruleId,
      packId: rulePackId,
      title: 'Unresolved price requires an SME decision',
      statement: 'Do not select either price until an SME records a decision.',
      severity: 'critical',
      applicableTrackIds: [BLOCKED_TRACK_ID],
      channels: ['voice'],
      stages: ['checkout'],
      evidence: evidence('evidence-rule-demo-unresolved-price', 'Do not select either conflicting price without an SME decision.'),
      requiredKnowledge: true,
      requiredScenarioCoverage: false,
      sourceRevision: revisionHash,
      approvalStatus: 'approved',
      approvedByUid: trainerUid,
      approvedAt: createdAt,
    }],
    approvalStatus: 'approved',
    createdAt,
    updatedAt: createdAt,
  })];
  const assets: OperationalAsset[] = [OperationalAssetSchema.parse({
    id: 'offer-demo-unresolved-price',
    trackId: BLOCKED_TRACK_ID,
    product: 'Synthetic Recovery',
    context: 'recovery',
    stage: 'checkout',
    sourceRefs: [excerpt(1), excerpt(2)],
    effectiveFrom: null,
    effectiveTo: null,
    status: 'draft',
    approvedByUid: null,
    approvedAt: null,
    kind: 'offer',
    label: 'Unresolved synthetic recovery price — do not use',
    amountCents: null,
    comparisonAmountCents: null,
    recurringInterval: null,
    duration: 'next_order_only',
    discountBasisPoints: null,
    calculation: null,
    sequence: 1,
    prerequisites: [],
  })];
  const conflicts = [SourceConflictSchema.parse({
    id: conflictId,
    trackId: BLOCKED_TRACK_ID,
    sourceRefs: [excerpt(1), excerpt(2)],
    affectedProducts: ['Synthetic Recovery'],
    affectedContexts: ['recovery'],
    affectedStages: ['checkout'],
    affectedAssetIds: ['offer-demo-unresolved-price'],
    affectedRuleIds: [ruleId],
    detectedValues: ['99 USD', '109 USD'],
    severity: 'critical',
    status: 'open',
    decision: null,
    decisionOwnerUid: null,
    decidedAt: null,
    effectiveFrom: null,
    effectiveTo: null,
    downstreamInvalidationStatus: 'not_required',
  })];
  const card = {
    ...UNITS[0].briefingCards[0],
    id: 'card-demo-unresolved-price',
    headline: 'Unresolved Synthetic Price Conflict',
    bodyMarkdown: 'Two synthetic policy pages disagree on the recovery checkout price. **Do not select either price until an SME records a decision.**',
    keyTakeaway: 'The 99 USD and 109 USD conflict is unresolved; do not choose a price.',
    doList: ['Escalate the conflicting price sources for an SME decision'],
    dontList: ['Do not infer that either price is approved'],
    sourcePages: [1, 2],
    evidence: [evidence('evidence-card-demo-unresolved-price', 'The synthetic recovery price is unresolved and must not be selected.')],
  };
  const drill = {
    ...UNITS[0].drills[0],
    id: 'drill-demo-unresolved-price',
    prompt: 'Two synthetic sources list 99 USD and 109 USD. What must happen before a price is used?',
    explanation: 'The conflict is open. Only an explicit SME decision can resolve it.',
    sourcePages: [1, 2],
    options: [
      { id: 'a', text: 'Use the lower price automatically' },
      { id: 'b', text: 'Wait for an explicit SME decision' },
      { id: 'c', text: 'Use the most recent page without review' },
      { id: 'd', text: 'Average the two prices' },
    ],
    correctOptionId: 'b',
    evidence: [evidence('evidence-drill-demo-unresolved-price', 'An explicit SME decision is required before either price can be used.')],
  };
  const units: TrackUnit[] = [{
    ...UNITS[0],
    id: 'unit-demo-unresolved-price',
    title: 'Resolve Synthetic Price Conflict',
    briefingCards: [1, 2].map((index) => ({
      ...card,
      id: index === 1 ? card.id : `${card.id}-${index}`,
      evidence: [evidence(`evidence-card-demo-unresolved-price-${index}`, 'The synthetic recovery price is unresolved and must not be selected.')],
    })),
    drills: [1, 2, 3, 4].map((index) => ({
      ...drill,
      id: index === 1 ? drill.id : `${drill.id}-${index}`,
      evidence: [evidence(`evidence-drill-demo-unresolved-price-${index}`, 'An explicit SME decision is required before either price can be used.')],
    })),
  }];
  const track = TrackDocSchema.parse({
    id: BLOCKED_TRACK_ID,
    title: 'Synthetic Unresolved Price Gate',
    campaignCode: 'SYNTH-BLOCKED',
    divisionId: TRACK_DIVISION,
    status: 'DRAFT',
    generationProgress: { step: 'READY', percent: 100, message: 'Synthetic blocked fixture is ready for gate testing.' },
    sourcePdfStoragePath: `synthetic/${BLOCKED_TRACK_ID}/unresolved-price-policy.txt`,
    sourcePdfFileName: 'synthetic-unresolved-price-policy.txt',
    sourcePageCount: sourceTexts.length,
    activeSourceBundleId: BLOCKED_SOURCE_BUNDLE_ID,
    currentDraftVersionId: DRAFT_VERSION_ID,
    publishedVersionId: null,
    assignedCohortIds: [],
    competencyPillars: PILLARS,
    unitCount: units.length,
    simScenarioCount: 1,
    estimatedTotalMinutes: 12,
    createdByUid: trainerUid,
    createdAt,
    updatedAt: createdAt,
  });
  const draft = TrackVersionDocSchema.parse({
    trackId: BLOCKED_TRACK_ID,
    versionId: DRAFT_VERSION_ID,
    versionNumber: 1,
    competencyPillars: PILLARS,
    units,
    simScenarios: [runnableScenarios(revisionHash)[0]],
    sourceBundleId: BLOCKED_SOURCE_BUNDLE_ID,
    sourceRevision: revisionHash,
    requiredRuleIds: [ruleId],
    publishedAt: null,
    createdAt,
  });
  const draftSecrets = EvalRubricsDocSchema.parse({
    trackId: BLOCKED_TRACK_ID,
    versionId: DRAFT_VERSION_ID,
    scenarios: [SECRET_SCENARIOS[0]],
    updatedAt: createdAt,
  });
  return { track, draft, draftSecrets, review: { bundle, pages, rulePacks, assets, conflicts } };
}

interface ScopeAccumulator {
  totalCertifications: number;
  totalUnitCompletions: number;
  totalSimAttempts: number;
  totalSimPasses: number;
  pillarAggregates: Record<string, { pillarLabel: string; sampleCount: number; scoreSum: number }>;
  missedItemCounts: Record<string, { trackId: string; itemId: string; itemLabel: string; missCount: number }>;
}

function emptyScope(): ScopeAccumulator {
  return {
    totalCertifications: 0,
    totalUnitCompletions: 0,
    totalSimAttempts: 0,
    totalSimPasses: 0,
    pillarAggregates: {},
    missedItemCounts: {},
  };
}

function addPillarSample(target: ScopeAccumulator['pillarAggregates'], key: string, score: number): void {
  const entry = target[key] ?? { pillarLabel: canonicalLabel(key), sampleCount: 0, scoreSum: 0 };
  entry.sampleCount += 1;
  entry.scoreSum += score;
  target[key] = entry;
}

function evaluateAttempt(plan: SimAttemptPlan): { overallScorePct: number; passed: boolean; dispositionCorrect: boolean; criterionResults: SimCriterionResult[] } {
  const secret = secretById.get(plan.scenarioId);
  const scenario = scenarioById.get(plan.scenarioId);
  if (!secret || !scenario) throw new Error(`Unknown scenario ${plan.scenarioId}`);
  if (plan.criterionScores.length !== secret.rubricCriteria.length) {
    throw new Error(`Attempt on ${plan.scenarioId} needs ${secret.rubricCriteria.length} criterion scores.`);
  }
  const raw = secret.rubricCriteria.reduce((sum, criterion, index) => sum + criterion.weight * plan.criterionScores[index], 0) / 100;
  const dispositionCorrect = plan.selectedDisposition === secret.expectedDisposition;
  let score = raw - (dispositionCorrect ? 0 : SIM_DISPOSITION_PENALTY);
  if (plan.autoFailedReason) score = Math.min(score, SIM_AUTO_FAIL_SCORE_CAP);
  const overallScorePct = Math.max(0, Math.min(100, Math.round(score)));
  const passed = !plan.autoFailedReason && overallScorePct >= scenario.passScoreThreshold;
  const criterionResults = secret.rubricCriteria.map((criterion, index) => ({
    criterionId: criterion.id,
    competencyPillarId: criterion.competencyPillarId,
    criterionLabel: criterion.criterionLabel,
    score: plan.criterionScores[index],
    agentQuoteEvidence: plan.evidence[index] ?? '',
    coachingNote: plan.coaching[index] ?? '',
    betterResponseExample: plan.betterExamples[index] ?? null,
  }));
  return { overallScorePct, passed, dispositionCorrect, criterionResults };
}

function buildProgress(users: SeedUserRecord[], version: TrackVersionDoc, blueprint: AssessmentBlueprintDoc): BuiltProgress {
  const ruleIdsByDrillId = buildRuleIdsByDrillId(version);
  const versionScenarioById = new Map(version.simScenarios.map((scenario) => [scenario.id, scenario]));
  const drillAttempts: DrillAttemptDoc[] = [];
  const reviewSchedules: ReviewScheduleDoc[] = [];
  const scenarioCoverage: ScenarioCoverageDoc[] = [];
  const certifications: CertificationDoc[] = [];
  const byKey = new Map(users.map((record) => [record.demo.key, record]));
  const scopes = new Map<string, { meta: Pick<AnalyticsRollupDoc, 'scopeType' | 'divisionId' | 'partnerCohortId' | 'trackId'>; acc: ScopeAccumulator }>();
  const scope = (id: string, meta: Pick<AnalyticsRollupDoc, 'scopeType' | 'divisionId' | 'partnerCohortId' | 'trackId'>) => {
    let entry = scopes.get(id);
    if (!entry) {
      entry = { meta, acc: emptyScope() };
      scopes.set(id, entry);
    }
    return entry.acc;
  };
  // Make sure the core rollups exist even with no activity.
  scope(rollupIdForGlobal(), { scopeType: 'GLOBAL', divisionId: null, partnerCohortId: null, trackId: null });
  scope(rollupIdForDivision(TRACK_DIVISION), { scopeType: 'DIVISION', divisionId: TRACK_DIVISION, partnerCohortId: null, trackId: null });
  scope(rollupIdForTrack(TRACK_ID), { scopeType: 'TRACK', divisionId: TRACK_DIVISION, partnerCohortId: null, trackId: TRACK_ID });
  for (const cohortId of ['THS', 'DOZ', 'INTERNAL']) {
    scope(rollupIdForCohort(cohortId), { scopeType: 'COHORT', divisionId: null, partnerCohortId: cohortId, trackId: null });
  }

  const userDocs: UserDoc[] = [];
  const enrollments: EnrollmentDoc[] = [];
  const simSessions: SimSessionDoc[] = [];
  const planByUser = new Map(PROGRESS.map((plan) => [plan.userKey, plan]));

  for (const record of users) {
    const { demo, uid, email } = record;
    const plan = planByUser.get(demo.key);
    const skill: Record<string, PillarStat> = {};
    const addSkill = (key: string, score: number) => {
      const stat = skill[key] ?? { pillarKey: key, pillarLabel: canonicalLabel(key), attempts: 0, weightedScoreSum: 0, averageScore: 0 };
      stat.attempts += 1;
      stat.weightedScoreSum += score;
      stat.averageScore = Math.round((stat.weightedScoreSum / stat.attempts) * 10) / 10;
      skill[key] = stat;
    };
    const userScopes = plan
      ? [
          scope(rollupIdForGlobal(), { scopeType: 'GLOBAL', divisionId: null, partnerCohortId: null, trackId: null }),
          scope(rollupIdForDivision(TRACK_DIVISION), { scopeType: 'DIVISION', divisionId: TRACK_DIVISION, partnerCohortId: null, trackId: null }),
          scope(rollupIdForCohort(demo.partnerCohortId), { scopeType: 'COHORT', divisionId: null, partnerCohortId: demo.partnerCohortId, trackId: null }),
          scope(rollupIdForTrack(TRACK_ID), { scopeType: 'TRACK', divisionId: TRACK_DIVISION, partnerCohortId: null, trackId: TRACK_ID }),
        ]
      : [];

    let totalXp = 0;
    let simulationsPassed = 0;
    let certified = false;
    let lastActivityAt = 0;

    if (plan) {
      const completedUnitIds: string[] = [];
      const unitScores: EnrollmentDoc['unitScores'] = {};
      let xpEarned = 0;
      const learnerAttempts: DrillAttemptDoc[] = [];
      const learnerSchedules = new Map<string, ReviewScheduleDoc>();
      const learnerSessions: SimSessionDoc[] = [];

      for (const unitPlan of plan.units) {
        const unit = unitById.get(unitPlan.unitId);
        if (!unit) throw new Error(`Unknown Unit ${unitPlan.unitId}`);
        if (unitPlan.firstTry.length !== unit.drills.length) throw new Error(`Progress for ${unitPlan.unitId} needs ${unit.drills.length} results.`);
        const completedAt = daysAgo(unitPlan.daysAgo, -2);
        // Each Drill once, then each miss again; the last submission lands at completedAt.
        const submissions = unit.drills.length + unitPlan.firstTry.filter((ok) => !ok).length;
        learnerAttempts.push(...seedCheckpointAttempts({
          learnerId: uid,
          partnerCohortId: demo.partnerCohortId,
          version,
          unitId: unit.id,
          firstTry: unitPlan.firstTry,
          startedAt: completedAt - submissions * SEED_DRILL_SPACING_MINUTES * 60_000,
          ruleIdsByDrillId,
          previousAttempts: learnerAttempts,
          schedules: learnerSchedules,
        }));
        let correct = 0;
        unit.drills.forEach((drill, index) => {
          const passedFirstTry = unitPlan.firstTry[index];
          const key = pillarKeyFor(drill.competencyPillarId);
          const score = passedFirstTry ? 100 : 0;
          addSkill(key, score);
          for (const acc of userScopes) {
            addPillarSample(acc.pillarAggregates, key, score);
            if (!passedFirstTry) {
              const missKey = `${TRACK_ID}__${drill.id}`;
              const entry = acc.missedItemCounts[missKey] ?? { trackId: TRACK_ID, itemId: drill.id, itemLabel: truncate(drill.kind === 'TRUE_FALSE_SPOT' ? drill.statement : drill.prompt, 120), missCount: 0 };
              entry.missCount += 1;
              acc.missedItemCounts[missKey] = entry;
            }
          }
          if (passedFirstTry) correct += 1;
        });
        const misses = unit.drills.length - correct;
        xpEarned += correct * XP_RULES.perFirstTryCorrectDrill + misses * XP_RULES.perRecoveredDrill + XP_RULES.unitCompletionBonus;
        completedUnitIds.push(unit.id);
        unitScores[unit.id] = { firstTryAccuracyPct: Math.round((correct / unit.drills.length) * 100), attemptsCount: 1, completedAt };
        userScopes.forEach((acc) => (acc.totalUnitCompletions += 1));
        lastActivityAt = Math.max(lastActivityAt, completedAt);
      }

      const passedScenarioIds: string[] = [];
      let bestSimScorePct: number | null = null;
      let certifiedAt: number | null = null;

      plan.sims.forEach((attempt, attemptIndex) => {
        const scenario = scenarioById.get(attempt.scenarioId);
        if (!scenario) throw new Error(`Unknown scenario ${attempt.scenarioId}`);
        const startedAt = daysAgo(attempt.daysAgo, -1);
        const judged = evaluateAttempt(attempt);
        const evaluatedAt = startedAt + 9 * 60 * 1000;
        const messages: SimMessage[] = attempt.transcript.map(([role, content], index) => ({
          id: `m${String(index + 1).padStart(2, '0')}`,
          role,
          content,
          createdAt: startedAt + index * 45 * 1000,
        }));
        const sessionId = `seed-${uid}-${attempt.scenarioId}-${attemptIndex + 1}`;
        const script = SIM_SCRIPTS.get(attempt.transcript);
        const runnable = versionScenarioById.get(attempt.scenarioId);
        if (!script || !runnable) throw new Error(`Seeded call ${sessionId} has no engine script.`);
        const disposition = CanonicalDispositionSchema.parse(attempt.selectedDisposition);
        // Same engine as a live call: deterministic gates, eligibility and the score cap come from the server rules.
        const engine = seedSimSessionEvidence({
          sessionId,
          scenario: runnable,
          transcript: attempt.transcript,
          script,
          disposition,
          startedAt,
          judged: {
            overallScorePct: judged.overallScorePct,
            passed: judged.passed,
            autoFailedReason: attempt.autoFailedReason,
            dispositionCorrect: judged.dispositionCorrect,
            summaryFeedback: attempt.summaryFeedback,
            strengthsHighlighted: attempt.strengths,
            coachingImprovements: attempt.improvements,
            criterionResults: judged.criterionResults,
            evaluatedAt,
          },
        });
        const session = SimSessionDocSchema.parse({
          id: sessionId,
          userId: uid,
          userDisplayName: demo.displayName,
          partnerCohortId: demo.partnerCohortId,
          divisionId: TRACK_DIVISION,
          trackId: TRACK_ID,
          versionId: PUBLISHED_VERSION_ID,
          scenarioId: attempt.scenarioId,
          scenarioTitle: scenario.title,
          status: 'EVALUATED',
          turnCount: messages.filter((message) => message.role === 'agent').length,
          messages,
          ...engine,
          startedAt,
          updatedAt: evaluatedAt,
        });
        simSessions.push(session);
        learnerSessions.push(session);
        const result = session.evaluation!;
        for (const criterion of result.criterionResults) {
          const key = pillarKeyFor(criterion.competencyPillarId);
          const score = Number(criterion.score);
          addSkill(key, score);
          userScopes.forEach((acc) => addPillarSample(acc.pillarAggregates, key, score));
        }
        userScopes.forEach((acc) => {
          acc.totalSimAttempts += 1;
          if (result.passed) acc.totalSimPasses += 1;
        });
        bestSimScorePct = Math.max(bestSimScorePct ?? 0, result.overallScorePct);
        if (result.passed) {
          simulationsPassed += 1;
          xpEarned += XP_RULES.simulationPass;
        }
        lastActivityAt = Math.max(lastActivityAt, evaluatedAt);
      });

      // Coverage and certification exactly as the evaluate route computes them from this evidence.
      const provisional = EnrollmentDocSchema.parse({
        id: enrollmentIdFor(uid, TRACK_ID),
        userId: uid,
        userDisplayName: demo.displayName,
        partnerCohortId: demo.partnerCohortId,
        divisionId: TRACK_DIVISION,
        trackId: TRACK_ID,
        trackTitle: 'MVP Retention & Escalations',
        versionId: PUBLISHED_VERSION_ID,
        status: 'IN_PROGRESS',
        completedUnitIds,
        passedScenarioIds: [],
        unitScores,
        bestSimScorePct,
        xpEarned,
        progressPct: 0,
        certifiedAt: null,
        lastActivityAt,
      });
      const evidence = seedCoverageAndCertification({
        learnerId: uid,
        partnerCohortId: demo.partnerCohortId,
        blueprint,
        version,
        enrollment: provisional,
        drillAttempts: learnerAttempts,
        sessions: learnerSessions,
        ruleIdsByDrillId,
      });
      drillAttempts.push(...learnerAttempts);
      reviewSchedules.push(...learnerSchedules.values());
      scenarioCoverage.push(...evidence.coverage);
      if (evidence.certification) certifications.push(evidence.certification);
      passedScenarioIds.push(...evidence.eligibility.scenarios.passedScenarioIds);
      certifiedAt = evidence.certification?.certifiedAt ? Date.parse(evidence.certification.certifiedAt) : null;

      certified = certifiedAt !== null;
      if (certified) userScopes.forEach((acc) => (acc.totalCertifications += 1));
      totalXp = xpEarned;
      const progressSteps = UNITS.length + 1;
      const progressDone = completedUnitIds.length + (passedScenarioIds.length > 0 ? 1 : 0);

      enrollments.push(
        EnrollmentDocSchema.parse({
          id: enrollmentIdFor(uid, TRACK_ID),
          userId: uid,
          userDisplayName: demo.displayName,
          partnerCohortId: demo.partnerCohortId,
          divisionId: TRACK_DIVISION,
          trackId: TRACK_ID,
          trackTitle: 'MVP Retention & Escalations',
          versionId: PUBLISHED_VERSION_ID,
          status: certified ? 'CERTIFIED' : completedUnitIds.length > 0 ? 'IN_PROGRESS' : 'NOT_STARTED',
          completedUnitIds,
          passedScenarioIds,
          unitScores,
          bestSimScorePct,
          xpEarned,
          progressPct: Math.round((progressDone / progressSteps) * 100),
          certifiedAt: certified ? certifiedAt : null,
          ...(certified ? { certificationEvidenceLabel: 'current_verified', certificationProvenance: 'certification_register' } : {}),
          lastActivityAt,
        }),
      );
    }

    const pillarAverages = Object.values(skill).map((stat) => stat.averageScore);
    const readiness = pillarAverages.length > 0 ? Math.round(pillarAverages.reduce((sum, value) => sum + value, 0) / pillarAverages.length) : 0;

    userDocs.push(
      UserDocSchema.parse({
        uid,
        email,
        authMethod: demo.lcNumber ? 'LC_ID_PASSWORD' : 'EMAIL_PASSWORD',
        lcNumber: demo.lcNumber,
        displayName: demo.displayName,
        role: demo.role,
        partnerCohortId: demo.partnerCohortId,
        divisionIds: demo.divisionIds,
        active: demo.active,
        deactivatedAt: demo.active ? null : daysAgo(1),
        stats: {
          totalXp,
          currentStreakDays: plan && demo.active ? plan.streakDays : 0,
          lastActiveDateUtc: lastActivityAt > 0 ? utcDateKey(lastActivityAt) : null,
          tracksCertifiedCount: certified ? 1 : 0,
          simulationsPassedCount: simulationsPassed,
          overallReadinessScore: readiness,
        },
        skillScoresByPillar: skill,
        preferences: { soundEffects: true, compactMode: false, theme: 'light' },
        createdAt: daysAgo(20),
        updatedAt: NOW,
      }),
    );
  }

  const rollups = [...scopes.entries()].map(([id, { meta, acc }]) =>
    AnalyticsRollupDocSchema.parse({
      id,
      ...meta,
      totalCertifications: acc.totalCertifications,
      totalUnitCompletions: acc.totalUnitCompletions,
      totalSimAttempts: acc.totalSimAttempts,
      totalSimPasses: acc.totalSimPasses,
      pillarAggregates: acc.pillarAggregates,
      missedItemCounts: acc.missedItemCounts,
      updatedAt: NOW,
    }),
  );

  if (!byKey.has('trainer')) throw new Error('The trainer demo user is required.');
  return { userDocs, enrollments, simSessions, rollups, drillAttempts, reviewSchedules, scenarioCoverage, certifications };
}

// ---------------------------------------------------------------------------
// 8. Minimal text PDF for the Playbook (so Studio can preview the source file)
// ---------------------------------------------------------------------------

function wrapText(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    if ((line + ' ' + word).trim().length > width) {
      lines.push(line);
      line = word;
    } else {
      line = (line + ' ' + word).trim();
    }
  }
  if (line) lines.push(line);
  return lines;
}

function buildPlaybookPdf(pages: string[]): Buffer {
  const escape = (value: string) => value.replace(/[^\x20-\x7e]/g, '-').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const objects: string[] = [];
  const pageObjectIds: number[] = [];
  // 1: catalog, 2: pages, 3: font, then (page, content) pairs
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  let nextId = 4;
  for (const text of pages) {
    const pageId = nextId++;
    const contentId = nextId++;
    const lines = wrapText(text, 88);
    const stream = ['BT', '/F1 11 Tf', '14 TL', '56 760 Td', ...lines.map((line) => `(${escape(line)}) Tj T*`), 'ET'].join('\n');
    objects[contentId] = `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`;
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`;
    pageObjectIds.push(pageId);
  }
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageObjectIds.length} >>`;

  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let id = 1; id < nextId; id++) {
    offsets[id] = Buffer.byteLength(body, 'latin1');
    body += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(body, 'latin1');
  body += `xref\n0 ${nextId}\n0000000000 65535 f \n`;
  for (let id = 1; id < nextId; id++) body += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${nextId} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

// ---------------------------------------------------------------------------
// 9. Writers
// ---------------------------------------------------------------------------

function initAdmin(): App {
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || 'logicall-pulse-dev';
  const storageBucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || undefined;
  const existing = getApps()[0];
  if (existing) return existing;
  const emulated = Boolean(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST);
  return emulated
    ? initializeApp({ projectId, storageBucket })
    : initializeApp({ credential: applicationDefault(), projectId, storageBucket });
}

function errorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

async function upsertAuthUser(auth: Auth, demo: DemoUser): Promise<SeedUserRecord> {
  const email = signInEmail(demo);
  const claims = { role: demo.role, partnerCohortId: demo.partnerCohortId, divisionIds: demo.divisionIds, active: demo.active };
  let uid: string;
  try {
    const existing = await auth.getUserByEmail(email);
    uid = existing.uid;
    await auth.updateUser(uid, { password: DEMO_PASSWORD, displayName: demo.displayName, disabled: !demo.active });
    await auth.setCustomUserClaims(uid, { ...(existing.customClaims ?? {}), ...claims });
  } catch (error) {
    if (errorCode(error) !== 'auth/user-not-found') throw error;
    const created = await auth.createUser({
      uid: `seed-${demo.key}`,
      email,
      password: DEMO_PASSWORD,
      displayName: demo.displayName,
      emailVerified: true,
      disabled: !demo.active,
    });
    uid = created.uid;
    await auth.setCustomUserClaims(uid, claims);
  }
  if (!demo.active) await auth.revokeRefreshTokens(uid);
  return { demo, uid, email };
}

function sourceReviewWrites(review: SourceFixture): Array<{ path: string; data: object }> {
  const { bundle } = review;
  const root = `tracks/${bundle.trackId}/sourceBundles/${bundle.id}`;
  return [
    { path: root, data: bundle },
    ...review.pages.map((page) => ({ path: `${root}/pageEvidence/${page.id}`, data: page })),
    ...review.rulePacks.map((pack) => ({ path: `${root}/rulePacks/${pack.id}`, data: pack })),
    ...review.assets.map((asset) => ({ path: `${root}/assets/${asset.id}`, data: asset })),
    ...review.conflicts.map((conflict) => ({ path: `${root}/conflicts/${conflict.id}`, data: conflict })),
  ];
}

/** Drop `undefined` fields (optional engine fields such as runtimeProvenance); Firestore rejects them. */
function withoutUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map(withoutUndefined) as T;
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined).map(([key, item]) => [key, withoutUndefined(item)]),
    ) as T;
  }
  return value;
}

async function writeAll(db: Firestore, docs: Array<{ path: string; data: object }>): Promise<void> {
  const CHUNK = 400;
  for (let i = 0; i < docs.length; i += CHUNK) {
    const batch = db.batch();
    for (const doc of docs.slice(i, i + CHUNK)) batch.set(db.doc(doc.path), withoutUndefined(doc.data));
    await batch.commit();
  }
}

function printCredentials(users: SeedUserRecord[]): void {
  const cohortJoinRows = DEFAULT_COHORTS.map((cohort) => ({ Cohort: cohort.id, 'Join code': JOIN_CODES[cohort.id] ?? '(invite only)' }));
  console.log('\nDemo sign-in credentials (password for every account: ' + DEMO_PASSWORD + ')');
  console.table(
    users.map(({ demo }) => ({
      'Sign in with': demo.lcNumber ?? demo.email ?? '',
      Name: demo.displayName,
      Role: demo.role,
      Cohort: demo.partnerCohortId,
      Status: demo.active ? 'active' : 'DEACTIVATED',
    })),
  );
  console.log('Cohort join codes (open /join/<code>):');
  console.table(cohortJoinRows);
}

function publishedBlueprint(trackDocs: ReturnType<typeof buildTrackDocs>): AssessmentBlueprintDoc {
  return buildAssessmentBlueprint(trackDocs.published, { createdAt: new Date(trackDocs.published.publishedAt ?? trackDocs.published.createdAt) });
}

/**
 * Every surface must agree: the enrollment/home "Certified" label, the certification register,
 * and the Track page's learning evidence (built here with the same analytics function the page uses).
 */
function assertProgressConsistent(progress: BuiltProgress, trackDocs: ReturnType<typeof buildTrackDocs>, blueprint: AssessmentBlueprintDoc) {
  const ruleIdsByDrillId = buildRuleIdsByDrillId(trackDocs.published);
  const problems: string[] = [];
  for (const enrollment of progress.enrollments) {
    const learnerId = enrollment.userId;
    const mine = <T extends { learnerId: string }>(items: T[]) => items.filter((item) => item.learnerId === learnerId);
    const certification = progress.certifications.find((item) => item.learnerId === learnerId) ?? null;
    const analytics = buildLearningAnalytics({
      learnerId,
      blueprint,
      enrollment,
      drillAttempts: mine(progress.drillAttempts),
      scenarioCoverage: mine(progress.scenarioCoverage),
      simSessions: progress.simSessions.filter((session) => session.userId === learnerId),
      reviewSchedules: mine(progress.reviewSchedules),
      ruleIdsByDrillId,
      certificationStatus: certification?.status ?? 'not_started',
      now: new Date(NOW),
    });
    const user = progress.userDocs.find((doc) => doc.uid === learnerId);
    const certifiedLabel = enrollment.status === 'CERTIFIED';
    if (certifiedLabel !== (analytics.certificationStatus === 'certified')) problems.push(`${learnerId}: enrollment ${enrollment.status} vs evidence ${analytics.certificationStatus}`);
    if (certifiedLabel !== (user?.stats.tracksCertifiedCount === 1)) problems.push(`${learnerId}: user stats disagree with enrollment ${enrollment.status}`);
    if (certifiedLabel && analytics.currentMastery.ratio !== 1) problems.push(`${learnerId}: certified but mastery is ${analytics.currentMastery.ratio}`);
    const passed = new Set(mine(progress.scenarioCoverage).filter((row) => row.status === 'passed').map((row) => row.scenarioId));
    if ([...passed].sort().join() !== [...enrollment.passedScenarioIds].sort().join()) problems.push(`${learnerId}: passedScenarioIds disagree with coverage`);
    if (analytics.contentCompletion.completed !== enrollment.completedUnitIds.length) problems.push(`${learnerId}: content completion ${analytics.contentCompletion.completed} vs ${enrollment.completedUnitIds.length} Units`);
  }
  if (progress.certifications.length === 0) problems.push('No seeded agent is certified; the demo needs at least one.');
  if (problems.length > 0) throw new Error(`Seeded learning evidence is inconsistent:\n${problems.join('\n')}`);
}

/** The seeded published Track must pass the same gates as the publish route (secrets and scripted QA included). */
function assertApprovedTrackPublishable(trackDocs: ReturnType<typeof buildTrackDocs>) {
  const approvedDraftGate = evaluatePublicationGates({
    draft: trackDocs.draft, ...trackDocs.sourceReview, secrets: trackDocs.draftSecrets.scenarios, runScenarioQAFixture, now: NOW,
  });
  const approvedPublishedGate = evaluatePublicationGates({
    draft: trackDocs.published, ...trackDocs.sourceReview, secrets: trackDocs.publishedSecrets.scenarios, runScenarioQAFixture, now: NOW,
  });
  if (!approvedDraftGate.eligible || !approvedPublishedGate.eligible) {
    throw new Error(`Approved source fixture failed publication gates: ${JSON.stringify([...approvedDraftGate.issues, ...approvedPublishedGate.issues])}`);
  }
  return { approvedDraftGate, approvedPublishedGate };
}

async function main(): Promise<void> {
  if (DRY_RUN) {
    const fakeUsers: SeedUserRecord[] = DEMO_USERS.map((demo) => ({ demo, uid: `seed-${demo.key}`, email: signInEmail(demo) }));
    const trackDocs = buildTrackDocs('seed-trainer');
    const verbalDocs = buildVerbalDemoTrackDocs('seed-trainer');
    const blockedDocs = buildBlockedSourceFixture('seed-trainer');
    const progress = buildProgress(fakeUsers, trackDocs.published, publishedBlueprint(trackDocs));
    assertProgressConsistent(progress, trackDocs, publishedBlueprint(trackDocs));
    const cohorts = buildCohorts(new Map(), new Map());
    const pdf = buildPlaybookPdf(PLAYBOOK_PAGES);
    const { approvedDraftGate } = assertApprovedTrackPublishable(trackDocs);
    assertApprovedTrackPublishable(verbalDocs);
    const blockedGate = evaluatePublicationGates({ draft: blockedDocs.draft, ...blockedDocs.review, now: NOW });
    if (!blockedGate.issues.some((issue) => issue.code === 'SME_DECISION_REQUIRED' && issue.affectedId === 'DEMO-UNRESOLVED-PRICE')) {
      throw new Error(`Blocked source fixture did not require its unresolved SME decision: ${JSON.stringify(blockedGate.issues)}`);
    }
    console.log('Dry run: every document passed schema validation and both publication-gate fixtures behaved as expected.');
    console.log({
      cohorts: cohorts.length,
      users: progress.userDocs.length,
      units: trackDocs.published.units.length,
      drills: trackDocs.published.units.reduce((sum, unit) => sum + unit.drills.length, 0),
      scenarios: trackDocs.published.simScenarios.length,
      sourceBatches: trackDocs.sourceBatches.length,
      sourceFixtures: {
        approved: { bundleId: SOURCE_BUNDLE_ID, eligible: approvedDraftGate.eligible, issues: approvedDraftGate.issues.length },
        blocked: { bundleId: BLOCKED_SOURCE_BUNDLE_ID, eligible: blockedGate.eligible, issueCodes: blockedGate.issues.map((issue) => issue.code) },
      },
      enrollments: progress.enrollments.length,
      simSessions: progress.simSessions.map((session) => `${session.userDisplayName}: ${session.scenarioId} ${session.evaluation?.overallScorePct}% ${session.evaluation?.passed ? 'PASS' : 'FAIL'}`),
      readiness: progress.userDocs.filter((user) => user.stats.overallReadinessScore > 0).map((user) => `${user.displayName}: ${user.stats.overallReadinessScore}`),
      rollups: progress.rollups.map((rollup) => `${rollup.id} units=${rollup.totalUnitCompletions} sims=${rollup.totalSimAttempts}/${rollup.totalSimPasses} certs=${rollup.totalCertifications}`),
      pdfBytes: pdf.length,
    });
    return;
  }

  const app = initAdmin();
  const auth = getAuth(app);
  const db = getFirestore(app);
  console.log(`Seeding project "${app.options.projectId}"${process.env.FIRESTORE_EMULATOR_HOST ? ' (emulators)' : ' (PRODUCTION)'}...`);

  // Users (Auth + claims) first, so the Track can name its creator.
  const users: SeedUserRecord[] = [];
  for (const demo of DEMO_USERS) users.push(await upsertAuthUser(auth, demo));
  const trainer = users.find((record) => record.demo.key === 'trainer');
  if (!trainer) throw new Error('The trainer demo user was not created.');

  const trackDocs = buildTrackDocs(trainer.uid);
  assertApprovedTrackPublishable(trackDocs);
  const blueprint = publishedBlueprint(trackDocs);
  const verbalDocs = buildVerbalDemoTrackDocs(trainer.uid);
  assertApprovedTrackPublishable(verbalDocs);
  const verbalBlueprint = publishedBlueprint(verbalDocs);
  const blockedDocs = buildBlockedSourceFixture(trainer.uid);
  const progress = buildProgress(users, trackDocs.published, blueprint);
  assertProgressConsistent(progress, trackDocs, blueprint);

  const writes: Array<{ path: string; data: object }> = [
    { path: `tracks/${TRACK_ID}`, data: trackDocs.track },
    { path: `tracks/${TRACK_ID}/versions/${PUBLISHED_VERSION_ID}`, data: trackDocs.published },
    { path: `tracks/${TRACK_ID}/versions/${DRAFT_VERSION_ID}`, data: trackDocs.draft },
    { path: `tracks/${TRACK_ID}/versions/${PUBLISHED_VERSION_ID}/secrets/${EVAL_RUBRICS_DOC_ID}`, data: trackDocs.publishedSecrets },
    { path: `tracks/${TRACK_ID}/versions/${DRAFT_VERSION_ID}/secrets/${EVAL_RUBRICS_DOC_ID}`, data: trackDocs.draftSecrets },
    // The publish route writes this with the version; without it Sim evaluation and learning evidence fail (409 ASSESSMENT_BLUEPRINT_MISSING).
    {
      path: `assessmentBlueprints/assessment_${TRACK_ID}_${PUBLISHED_VERSION_ID}`,
      data: blueprint,
    },
    ...trackDocs.sourceBatches.map((batch) => ({ path: `tracks/${TRACK_ID}/sourcePages/${batch.id}`, data: batch })),
    ...sourceReviewWrites(trackDocs.sourceReview),
    { path: `tracks/${VERBAL_TRACK_ID}`, data: verbalDocs.track },
    { path: `tracks/${VERBAL_TRACK_ID}/versions/${PUBLISHED_VERSION_ID}`, data: verbalDocs.published },
    { path: `tracks/${VERBAL_TRACK_ID}/versions/${DRAFT_VERSION_ID}`, data: verbalDocs.draft },
    { path: `tracks/${VERBAL_TRACK_ID}/versions/${PUBLISHED_VERSION_ID}/secrets/${EVAL_RUBRICS_DOC_ID}`, data: verbalDocs.publishedSecrets },
    { path: `tracks/${VERBAL_TRACK_ID}/versions/${DRAFT_VERSION_ID}/secrets/${EVAL_RUBRICS_DOC_ID}`, data: verbalDocs.draftSecrets },
    {
      path: `assessmentBlueprints/assessment_${VERBAL_TRACK_ID}_${PUBLISHED_VERSION_ID}`,
      data: verbalBlueprint,
    },
    ...verbalDocs.sourceBatches.map((batch) => ({ path: `tracks/${VERBAL_TRACK_ID}/sourcePages/${batch.id}`, data: batch })),
    ...sourceReviewWrites(verbalDocs.sourceReview),
    { path: `tracks/${BLOCKED_TRACK_ID}`, data: blockedDocs.track },
    { path: `tracks/${BLOCKED_TRACK_ID}/versions/${DRAFT_VERSION_ID}`, data: blockedDocs.draft },
    { path: `tracks/${BLOCKED_TRACK_ID}/versions/${DRAFT_VERSION_ID}/secrets/${EVAL_RUBRICS_DOC_ID}`, data: blockedDocs.draftSecrets },
    ...sourceReviewWrites(blockedDocs.review),
    ...progress.userDocs.map((user) => ({ path: `users/${user.uid}`, data: user })),
    ...progress.enrollments.map((enrollment) => ({ path: `enrollments/${enrollment.id}`, data: enrollment })),
    ...progress.simSessions.map((session) => ({ path: `simSessions/${session.id}`, data: session })),
    ...progress.rollups.map((rollup) => ({ path: `analyticsRollups/${rollup.id}`, data: rollup })),
    ...progress.drillAttempts.map((attempt) => ({ path: `drillAttempts/${attempt.id}`, data: attempt })),
    ...progress.reviewSchedules.map((schedule) => ({ path: `reviewSchedules/${schedule.id}`, data: schedule })),
    ...progress.scenarioCoverage.map((coverage) => ({ path: `scenarioCoverage/${coverage.id}`, data: coverage })),
    ...progress.certifications.map((certification) => ({ path: `certifications/${certification.id}`, data: certification })),
  ];
  await writeAll(db, writes);

  // Cohorts last: activeAgentCount comes from the real users collection (includes non-seed users).
  const existingCohorts = await db.collection('cohorts').get();
  const createdAtById = new Map(
    existingCohorts.docs.flatMap((doc) => {
      const value = doc.get('createdAt');
      return typeof value === 'number' ? [[doc.id, value] as const] : [];
    }),
  );
  const agentCounts = new Map<string, number>();
  for (const cohort of DEFAULT_COHORTS) {
    const snap = await db
      .collection('users')
      .where('partnerCohortId', '==', cohort.id)
      .where('role', '==', 'AGENT')
      .where('active', '==', true)
      .count()
      .get();
    agentCounts.set(cohort.id, snap.data().count);
  }
  const cohorts = buildCohorts(createdAtById, agentCounts);
  await writeAll(db, cohorts.map((cohort) => ({ path: `cohorts/${cohort.id}`, data: cohort })));

  // Playbook PDF (best effort: the Storage emulator may not be running).
  try {
    const bucketName = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
    const storage = getStorage(app);
    const bucket = bucketName ? storage.bucket(bucketName) : storage.bucket();
    await bucket.file(trackDocs.track.sourcePdfStoragePath).save(buildPlaybookPdf(PLAYBOOK_PAGES), {
      contentType: 'application/pdf',
      resumable: false,
    });
    console.log(`Uploaded Playbook PDF to ${trackDocs.track.sourcePdfStoragePath}`);
  } catch (error) {
    console.warn('Playbook PDF upload skipped (Storage is not available):', error instanceof Error ? error.message : error);
  }

  console.log(
    `Wrote ${cohorts.length} Cohorts, ${progress.userDocs.length} users, 1 Track (${UNITS.length} Units, ${SCENARIOS.length} Simulations), ` +
      `${progress.enrollments.length} enrollments, ${progress.simSessions.length} Simulation sessions, ${progress.rollups.length} rollups.`,
  );
  printCredentials(users);
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error('Seed failed:', error);
    process.exit(1);
  },
);
