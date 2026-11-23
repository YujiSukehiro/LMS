import {
  PublicSimScenarioSchema,
  SecretSimScenarioConfigSchema,
  type PublicSimScenario,
  type SecretSimScenarioConfig,
} from '@/lib/schemas/curriculum';
import type { DivisionId } from '@/lib/schemas/domain';
import {
  ScenarioContextSchema,
  ScenarioEvidenceRequirementsSchema,
  type ScenarioQAFixture,
} from '@/lib/schemas/simulation-state';
import { CanonicalDispositionSchema, SALES_DISPOSITIONS, SERVICE_DISPOSITIONS } from '@/lib/schemas/source-truth';
import { draftExpectedGateResults, draftQAFixtureSteps } from '@/components/studio/editor/qa-fixture-drafts';

const CANONICAL_DISPOSITIONS = CanonicalDispositionSchema.options;
const DEFAULT_SYNTHETIC_NOW = '2026-01-15T17:00:00.000Z';
const DEFAULT_SYNTHETIC_TIMEZONE = 'America/Chicago';

export interface VerbalScenarioDefaultsContext {
  divisionId?: DivisionId;
  product?: string;
  sourceRevision?: string | null;
  curriculumVersion?: string;
}

export function normalizeCanonicalDispositions(options: readonly string[]): string[] {
  const valid = options
    .map((option) => CANONICAL_DISPOSITIONS.find((c) => c.toLowerCase() === option.trim().toLowerCase()))
    .filter((option): option is (typeof CANONICAL_DISPOSITIONS)[number] => Boolean(option));
  const unique = [...new Set(valid)];
  const service = unique.some((option) => option === 'Resolved' || option === 'Escalated');
  for (const fallback of service ? SERVICE_DISPOSITIONS : SALES_DISPOSITIONS) {
    if (unique.length >= 3) break;
    if (!unique.includes(fallback)) unique.push(fallback);
  }
  return unique.slice(0, 6);
}

/**
 * Normalize a scenario for pure Verbal Practice in Studio: keeps public dialogue fields and
 * source revision intact while clearing dialer/CRM UI requirements (`requiredInspections`,
 * `requiredWorkflowActions`, `requiredWrapUpEvidence`, `requiredGateIds`).
 */
export function ensureVerbalScenarioDefaults(
  scenario: PublicSimScenario,
  defaults: VerbalScenarioDefaultsContext = {},
): PublicSimScenario {
  const dispositionOptions = normalizeCanonicalDispositions(scenario.dispositionOptions);
  const existingContext = scenario.context;
  const sourceRevision =
    (existingContext?.sourceRevision && existingContext.sourceRevision !== 'generated-draft'
      ? existingContext.sourceRevision
      : defaults.sourceRevision) ||
    existingContext?.sourceRevision ||
    'generated-draft';
  const context = ScenarioContextSchema.parse({
    direction: existingContext?.direction ?? (defaults.divisionId === 'INBOUND' ? 'inbound' : 'outbound'),
    queue: existingContext?.queue ?? (defaults.divisionId === 'TELEHEALTH' ? 'customer_support' : 'recovery'),
    product: existingContext?.product || defaults.product || 'Verbal Practice',
    stage: existingContext?.stage ?? 'support_case',
    contactState: existingContext?.contactState ?? 'existing_patient',
    pricingPosture: existingContext?.pricingPosture ?? 'not_applicable',
    caseBranch: existingContext?.caseBranch || 'verbal_practice',
    syntheticTimezone: existingContext?.syntheticTimezone || DEFAULT_SYNTHETIC_TIMEZONE,
    syntheticNow: existingContext?.syntheticNow || DEFAULT_SYNTHETIC_NOW,
    sourceRevision,
    curriculumVersion: existingContext?.curriculumVersion || defaults.curriculumVersion || 'draft',
  });
  const evidenceRequirements = ScenarioEvidenceRequirementsSchema.parse({
    minimumLearnerTurns: Math.max(1, scenario.evidenceRequirements?.minimumLearnerTurns ?? 2),
    requiredInspections: [],
    requiredWorkflowActions: [],
    requiredWrapUpEvidence: [],
    requiredGateIds: [],
    requiredCustomerConcerns: scenario.evidenceRequirements?.requiredCustomerConcerns ?? [],
    expectedDurationMinutes: null,
    gateSourceRefs: {},
    maximumCriticalFailures: 0,
    maximumMajorFailures: 0,
  });

  return PublicSimScenarioSchema.parse({
    ...scenario,
    dispositionOptions,
    context,
    evidenceRequirements,
  });
}

function buildVerbalQaFixtures(
  scenario: PublicSimScenario,
  expectedDisposition: ScenarioQAFixture['expectedDisposition'],
): ScenarioQAFixture[] {
  const outbound = scenario.context?.direction !== 'inbound';
  const safePassDisposition: ScenarioQAFixture['expectedDisposition'] =
    expectedDisposition === 'Recovered' &&
    (scenario.context?.queue === 'renewals' || scenario.context?.queue === 'medical_chat')
      ? 'Callback scheduled'
      : expectedDisposition === 'Lost' || expectedDisposition === "Didn't reply" || expectedDisposition === 'Organic'
        ? 'Callback scheduled'
        : expectedDisposition;

  const passFixture: ScenarioQAFixture = {
    id: `verbal-pass-${scenario.id}`,
    title: 'Verbal golden pass',
    kind: 'golden_pass',
    steps: draftQAFixtureSteps('golden_pass', scenario, safePassDisposition),
    expectedDisposition: safePassDisposition,
    // opt_out is not evaluated unless the customer opts out, so it can never be the inbound pass expectation.
    expectedGateResults: draftExpectedGateResults('golden_pass', scenario),
  };

  const failFixture: ScenarioQAFixture = outbound
    ? {
        id: `verbal-fail-${scenario.id}`,
        title: 'Verbal golden critical fail',
        kind: 'golden_critical_fail',
        steps: draftQAFixtureSteps('golden_critical_fail', scenario, 'Callback scheduled'),
        expectedDisposition: 'Callback scheduled',
        expectedGateResults: draftExpectedGateResults('golden_critical_fail', scenario),
      }
    : {
        id: `verbal-fail-${scenario.id}`,
        title: 'Verbal golden critical fail',
        kind: 'golden_critical_fail',
        steps: [
          // Inbound scenarios start ready_to_dial; answering (`dial`) must come before any in-call action.
          { action: { type: 'dial' } },
          { action: { type: 'set_opt_out' } },
          { learnerUtterance: 'Synthetic learner turn: continuing without suppression.' },
          { action: { type: 'wrap_up', disposition: 'Not interested' } },
        ],
        expectedDisposition: 'Not interested',
        expectedGateResults: [{ ruleId: 'opt_out', status: 'fail' }],
      };

  return [passFixture, failFixture];
}

/** Ensure hidden scenario rubric config has valid canonical defaults for Verbal Practice saving/publishing. */
export function ensureVerbalSecretDefaults(
  scenario: PublicSimScenario,
  secret: SecretSimScenarioConfig,
  forceRefreshQaFixtures = false,
): SecretSimScenarioConfig {
  const options = normalizeCanonicalDispositions(scenario.dispositionOptions);
  const validExpected = options.find((option) => option === secret.expectedDisposition);
  const expectedDisposition = (validExpected ?? options[0] ?? 'Recovered') as ScenarioQAFixture['expectedDisposition'];
  const existingFixtures = secret.qaFixtures ?? [];
  const hasBothFixtures =
    existingFixtures.some((fixture) => fixture.kind === 'golden_pass') &&
    existingFixtures.some((fixture) => fixture.kind === 'golden_critical_fail');

  return SecretSimScenarioConfigSchema.parse({
    ...secret,
    expectedDisposition,
    qaFixtures: forceRefreshQaFixtures || !hasBothFixtures
      ? buildVerbalQaFixtures(ensureVerbalScenarioDefaults(scenario), expectedDisposition)
      : existingFixtures,
  });
}

function hasBothQaFixtures(secret: SecretSimScenarioConfig | undefined): boolean {
  const fixtures = secret?.qaFixtures ?? [];
  return fixtures.some((fixture) => fixture.kind === 'golden_pass') && fixtures.some((fixture) => fixture.kind === 'golden_critical_fail');
}

/**
 * Bring Verbal Practice scenarios and their secret configs to a publishable shape: canonical context,
 * verbal evidence requirements, and scripted golden-pass / critical-fail QA fixtures.
 *
 * With `onlyIncomplete`, scenarios that already have context, evidence requirements and both fixtures are
 * left exactly as the trainer saved them; only incomplete pairs (for example Tracks generated before
 * fixtures were created at build time) are normalized. `changed` reports whether anything was rewritten.
 */
export function normalizeVerbalScenarioPairs<S extends SecretSimScenarioConfig>(args: {
  scenarios: readonly PublicSimScenario[];
  secrets: readonly S[];
  defaults: VerbalScenarioDefaultsContext;
  onlyIncomplete?: boolean;
}): { scenarios: PublicSimScenario[]; secrets: SecretSimScenarioConfig[]; changed: boolean } {
  const secretById = new Map(args.secrets.map((secret) => [secret.scenarioId, secret]));
  let changed = false;
  const normalizedIds = new Set<string>();
  const scenarios = args.scenarios.map((scenario) => {
    const complete = Boolean(scenario.context && scenario.evidenceRequirements) && hasBothQaFixtures(secretById.get(scenario.id));
    if (args.onlyIncomplete && complete) return scenario;
    normalizedIds.add(scenario.id);
    const next = ensureVerbalScenarioDefaults(scenario, args.defaults);
    if (JSON.stringify(next) !== JSON.stringify(scenario)) changed = true;
    return next;
  });
  const scenarioById = new Map(scenarios.map((scenario) => [scenario.id, scenario]));
  const secrets = args.secrets.map((secret) => {
    const scenario = scenarioById.get(secret.scenarioId);
    if (!scenario || !normalizedIds.has(secret.scenarioId)) return secret;
    const next = ensureVerbalSecretDefaults(scenario, secret);
    if (JSON.stringify(next) !== JSON.stringify(secret)) changed = true;
    return next;
  });
  return { scenarios, secrets, changed };
}
