/**
 * Starting scripts for the "Add golden pass draft" / "Add critical-fail draft" buttons. The Studio has no step
 * editor, so a one-utterance placeholder could never pass for a generated Live Call Sim (it needs the required
 * inspections, learner turns, workflow and wrap-up evidence). These drafts are built only from the scenario's
 * own structured requirements: no source evidence or SME decision is invented, and the trainer still runs
 * scripted QA (and the publish gate re-runs it) to confirm the result.
 */
import type { PublicSimScenario } from '@/lib/schemas/curriculum';
import type { ScenarioQAFixture, SimulationAction } from '@/lib/schemas/simulation-state';

type Step = ScenarioQAFixture['steps'][number];
type Disposition = ScenarioQAFixture['expectedDisposition'];

const LEARNER_TURNS = [
  'Synthetic learner turn: I follow the approved call flow for this stage.',
  'Synthetic learner turn: I address the concern with the approved Playbook guidance.',
  'Synthetic learner turn: I confirm the next step and close the call.',
];

function action(value: SimulationAction): Step {
  return { action: value };
}

/** One day after the scenario's synthetic clock, for a "Callback scheduled" wrap-up. */
function callbackAt(scenario: PublicSimScenario): string {
  const base = Date.parse(scenario.context?.syntheticNow ?? '2026-01-15T17:00:00.000Z');
  return new Date(base + 24 * 60 * 60 * 1000).toISOString();
}

function dispositionSteps(scenario: PublicSimScenario, disposition: Disposition, workflowIds: Set<string>): Step[] {
  switch (disposition) {
    case 'Recovered':
      return workflowIds.has('recovery_confirmed') ? [] : [action({ type: 'workflow', actionId: 'recovery_confirmed' })];
    case 'Callback scheduled':
      return [action({ type: 'callback', callbackAt: callbackAt(scenario) })];
    case 'Not interested':
      return workflowIds.has('not_interested') ? [] : [action({ type: 'workflow', actionId: 'not_interested' })];
    default:
      return [];
  }
}

function reachesPatient(scenario: PublicSimScenario): boolean {
  const contact = scenario.context?.contactState;
  return contact !== 'third_party' && contact !== 'voicemail';
}

export function draftQAFixtureSteps(kind: ScenarioQAFixture['kind'], scenario: PublicSimScenario, disposition: Disposition): Step[] {
  const requirements = scenario.evidenceRequirements;
  const outbound = scenario.context?.direction !== 'inbound';
  const inspections = [...new Set([...(outbound ? ['local_time'] : []), ...(requirements?.requiredInspections ?? [])])];
  const turns = Math.max(1, requirements?.minimumLearnerTurns ?? 1);
  const learner = Array.from({ length: turns }, (_, index) => ({ learnerUtterance: LEARNER_TURNS[index % LEARNER_TURNS.length] }));
  const note = action({ type: 'note', text: 'Synthetic QA note: call outcome recorded.' });

  // Inbound calls still start in pre_call/ready_to_dial (see createInitialScenarioState); answering the call is the
  // `dial` transition, so every inbound script dials after its inspections and before any in-call step.
  const answerInbound = outbound ? [] : [...inspections.map((inspectionId) => action({ type: 'inspect', inspectionId })), action({ type: 'dial' })];
  const disclosure =
    !outbound && scenario.context?.queue === 'renewals' ? [action({ type: 'record_disclosure' })] : [];

  if (kind === 'golden_critical_fail') {
    // Outbound: dialing before the local-time inspection is a deterministic critical failure.
    if (outbound) return [action({ type: 'dial' }), ...learner, note, action({ type: 'wrap_up', disposition })];
    return [...answerInbound, ...learner, action({ type: 'wrap_up', disposition })];
  }

  const workflowIds = new Set(requirements?.requiredWorkflowActions ?? []);
  const wrapUp = new Set(requirements?.requiredWrapUpEvidence ?? []);
  const steps: Step[] = [
    ...(outbound
      ? [...inspections.map((inspectionId) => action({ type: 'inspect', inspectionId })), action({ type: 'dial' }), action({ type: 'record_disclosure' })]
      : [
          ...answerInbound,
          ...disclosure,
          // Verify before any account detail so identity-privacy queues record a clean pass.
          ...(reachesPatient(scenario) ? [action({ type: 'verify_identity' })] : []),
        ]),
    ...learner,
    ...[...workflowIds].map((actionId) => action({ type: 'workflow', actionId })),
    ...dispositionSteps(scenario, disposition, workflowIds),
  ];
  if (wrapUp.has('suppression')) steps.push(action({ type: 'suppress' }));
  if (wrapUp.has('callback') && disposition !== 'Callback scheduled') steps.push(action({ type: 'callback', callbackAt: callbackAt(scenario) }));
  steps.push(note, action({ type: 'wrap_up', disposition }));
  return steps;
}

/** Gate expectations the draft script is built to produce. */
export function draftExpectedGateResults(kind: ScenarioQAFixture['kind'], scenario: PublicSimScenario): ScenarioQAFixture['expectedGateResults'] {
  const requiredGates = (scenario.evidenceRequirements?.requiredGateIds ?? []).filter(Boolean);
  const outbound = scenario.context?.direction !== 'inbound';
  if (kind === 'golden_pass') {
    if (requiredGates.length > 0) return requiredGates.map((ruleId) => ({ ruleId, status: 'pass' as const }));
    if (outbound) return [{ ruleId: 'local_time', status: 'pass' as const }];
    // Inbound has no local-time gate. Recovery queues always evaluate offer_limit; every other queue
    // evaluates identity_privacy, which the draft script satisfies with verify_identity.
    return scenario.context?.queue === 'recovery'
      ? [{ ruleId: 'offer_limit', status: 'not_observed' as const }]
      : [{ ruleId: 'identity_privacy', status: 'pass' as const }];
  }
  return [{ ruleId: outbound ? 'local_time' : requiredGates[0] ?? 'local_time', status: 'fail' as const }];
}
