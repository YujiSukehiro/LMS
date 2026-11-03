import {
  EvalRubricsDocSchema,
  TrackVersionDocSchema,
  type CanonicalPillarKey,
  type CompetencyPillar,
  type SecretSimScenarioConfig,
} from '@/lib/schemas/curriculum';
import { STANDARD_MEDS_SCENARIO_IDS, buildStandardMedsScenario, standardMedsQAFixtures, type StandardMedsScenarioId } from '@/lib/content/standard-meds-scenarios';
import { getStandardMedsSource } from './sources';
import { STANDARD_MEDS_SHARED_RULE_IDS, STANDARD_MEDS_TRACK_RULE_IDS } from './rules';
import { publicationBlockersFor } from './publication';
import { pillarId } from './curriculum-builders';
import { sharedComplianceUnit } from './shared-compliance';
import { RECOVERY_TRACK_SPECS } from './recovery-content';
import { SERVICE_TRACK_SPECS } from './service-content';
import type { StandardMedsTrackSpec } from './track-spec';
import type { StandardMedsCallCode, StandardMedsCallPack } from './types';

export const STANDARD_MEDS_TRACK_SPECS: readonly StandardMedsTrackSpec[] = [...RECOVERY_TRACK_SPECS, ...SERVICE_TRACK_SPECS];
const CONTENT_CREATED_AT = Date.parse('2026-01-01T00:00:00.000Z');

const PILLAR_LABELS: Record<CanonicalPillarKey, [string, string]> = {
  verification_crm: ['Verification and queue inspection', 'Verify the contact, current record, local time, and branch before acting.'],
  product_offer_terms: ['Product and offer terms', 'Use track-specific product, plan, price, and live-offer boundaries.'],
  retention_objection: ['Objection and recovery sequence', 'Handle objections within approved offer, upgrade, and cancellation sequences.'],
  escalation_triage: ['Medical and exception triage', 'Route medical, privacy, payment, and operational exceptions without overclaiming.'],
  compliance_boundaries: ['Compliance and privacy', 'Apply shared contact, clinical, privacy, and disclosure gates.'],
  empathy_communication: ['Empathy and discreet communication', 'Use professional, non-judgmental communication appropriate to the customer state.'],
  closing_next_steps: ['Confirmation and wrap-up', 'Use the correct next asset, observed outcome, and canonical disposition.'],
  workflow_execution: ['Workflow and link execution', 'Inspect state and execute the correct synthetic workflow and stage-specific asset.'],
};

function pillarsFor(spec: StandardMedsTrackSpec): CompetencyPillar[] {
  const keys: CanonicalPillarKey[] = ['verification_crm', 'product_offer_terms', 'retention_objection', 'escalation_triage', 'compliance_boundaries', 'empathy_communication', 'closing_next_steps', 'workflow_execution'];
  return keys.map((key) => ({ id: pillarId(spec.code, key), key, label: PILLAR_LABELS[key][0], description: `${spec.title}: ${PILLAR_LABELS[key][1]}` }));
}

function scenarioIdsFor(spec: StandardMedsTrackSpec): StandardMedsScenarioId[] {
  return STANDARD_MEDS_SCENARIO_IDS.filter((id) => id.startsWith(`${spec.scenarioPrefix}-`));
}

function secretFor(spec: StandardMedsTrackSpec, scenarioId: StandardMedsScenarioId, versionId: string, index: number): SecretSimScenarioConfig {
  const scenario = buildStandardMedsScenario(scenarioId);
  const requirements = scenario.evidenceRequirements!;
  const fixtures = standardMedsQAFixtures(scenarioId);
  const expectedDisposition = fixtures[0]!.expectedDisposition;
  const rubricPages = [...new Set(spec.units.flatMap((unit) => unit.briefingCards.flatMap((card) => card.sourcePages)))].sort((a, b) => a - b);
  const firstPillar = pillarId(spec.code, 'verification_crm');
  const secondPillar = pillarId(spec.code, 'compliance_boundaries');
  const thirdPillar = pillarId(spec.code, 'closing_next_steps');
  return {
    scenarioId,
    personaName: `Synthetic ${spec.scenarioPrefix} actor ${index + 1}`,
    personaBackstoryAndMood: `A fictional ${spec.title} training counterpart for ${scenarioId}; cooperative only when the learner follows the inspected ${scenario.context!.caseBranch} branch. No real customer, order, health, identity, or payment data.`,
    hiddenFactsToRevealOnlyWhenAsked: [
      `Synthetic queue: ${scenario.context!.queue}; stage: ${scenario.context!.stage}.`,
      `Synthetic branch: ${scenario.context!.caseBranch}; product context: ${scenario.context!.product}.`,
      `Observed wrap-up must be ${expectedDisposition}; approval is never inferred from recovery.`,
    ],
    conditionalBehaviors: [spec.simulationBehavior],
    expectedDisposition,
    autoFailTriggers: requirements.requiredGateIds.map((gateId) => `Violate required deterministic gate ${gateId} for ${scenarioId}.`),
    rubricCriteria: [
      {
        id: `${scenarioId.toLowerCase()}-inspection`, competencyPillarId: firstPillar, criterionLabel: 'Required pre-call and branch inspection', weight: 30, sourcePages: rubricPages,
        evaluationRule: `Require these inspections before the applicable action: ${requirements.requiredInspections.join(', ')}. Preserve the ${scenario.context!.stage} stage and ${scenario.context!.caseBranch} branch.`,
      },
      {
        id: `${scenarioId.toLowerCase()}-gates`, competencyPillarId: secondPillar, criterionLabel: 'Track and shared deterministic gates', weight: 40, sourcePages: rubricPages,
        evaluationRule: `Satisfy every required gate: ${requirements.requiredGateIds.join(', ')}. No medical, privacy, link, payment, or offer workaround is permitted.`,
      },
      {
        id: `${scenarioId.toLowerCase()}-wrap`, competencyPillarId: thirdPillar, criterionLabel: 'Observed workflow and canonical wrap-up', weight: 30, sourcePages: rubricPages,
        evaluationRule: `Complete workflow actions [${requirements.requiredWorkflowActions.join(', ') || 'none'}], wrap-up evidence [${requirements.requiredWrapUpEvidence.join(', ')}], and disposition ${expectedDisposition}.`,
      },
    ],
    qaFixtures: fixtures,
  };
}

function buildCallPack(spec: StandardMedsTrackSpec): StandardMedsCallPack {
  const source = getStandardMedsSource(spec.code);
  const versionId = `draft-${spec.code.toLowerCase()}-v1`;
  const scenarioIds = scenarioIdsFor(spec);
  if (scenarioIds.length === 0) throw new Error(`${spec.code} has no document-06 scenario coverage.`);
  const scenarios = scenarioIds.map((id) => {
    const scenario = buildStandardMedsScenario(id);
    return {
      ...scenario,
      context: {
        ...scenario.context!,
        sourceRevision: source.revisionId,
        curriculumVersion: versionId,
      },
    };
  });
  const version = TrackVersionDocSchema.parse({
    versionId,
    trackId: source.trackId!,
    versionNumber: 1,
    competencyPillars: pillarsFor(spec),
    units: [...spec.units, sharedComplianceUnit(spec)],
    simScenarios: scenarios,
    sourceBundleId: `standard-meds-${spec.code.toLowerCase()}-bundle-unapproved`,
    sourceRevision: source.revisionId,
    requiredRuleIds: [...STANDARD_MEDS_SHARED_RULE_IDS, ...STANDARD_MEDS_TRACK_RULE_IDS[spec.code]],
    publishedAt: null,
    createdAt: CONTENT_CREATED_AT,
  });
  const evalRubrics = EvalRubricsDocSchema.parse({
    trackId: version.trackId,
    versionId,
    scenarios: scenarioIds.map((id, index) => secretFor(spec, id, versionId, index)),
    updatedAt: CONTENT_CREATED_AT,
  });
  const contentItemCount = version.units.reduce((count, unit) => count + unit.briefingCards.length + unit.drills.length, 0)
    + evalRubrics.scenarios.reduce((count, scenario) => count + scenario.rubricCriteria.length, 0);
  const assetIds = spec.syntheticLinks.map((link) => link.id);
  return {
    kind: 'call_training',
    code: spec.code,
    title: spec.title,
    source,
    inheritedSourceCodes: spec.inheritedSourceCodes,
    version,
    evalRubrics,
    syntheticLinks: spec.syntheticLinks,
    openSmeDecisionIds: spec.openSmeDecisionIds,
    publication: {
      eligible: false,
      approvalStatus: 'draft',
      blockers: publicationBlockersFor(source, contentItemCount, assetIds, spec.openSmeDecisionIds),
    },
  };
}

export const STANDARD_MEDS_CALL_PACKS: readonly StandardMedsCallPack[] = STANDARD_MEDS_TRACK_SPECS.map(buildCallPack);

export function getStandardMedsCallPack(code: StandardMedsCallCode): StandardMedsCallPack {
  const pack = STANDARD_MEDS_CALL_PACKS.find((candidate) => candidate.code === code);
  if (!pack) throw new Error(`Unknown Standard Meds call pack ${code}.`);
  return pack;
}
