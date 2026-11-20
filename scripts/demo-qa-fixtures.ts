/**
 * Demo-recording helper: scripted QA fixtures (golden pass + critical fail) for a generated scenario,
 * derived from its own context and evidence checklist. The publish gate requires both; in the product a
 * Trainer writes them in "Scripted scenario QA". Each fixture is executed with the real engine
 * (runScenarioQAFixture) before it is returned, so a fixture that does not behave is never written.
 */
import type { PublicSimScenario } from '../src/lib/schemas/curriculum';
import type { ScenarioQAFixture, SimulationAction } from '../src/lib/schemas/simulation-state';
import { runScenarioQAFixture } from '../src/lib/services/scenario-state';

type Disposition = ScenarioQAFixture['expectedDisposition'];
type Step = ScenarioQAFixture['steps'][number];

const say = (learnerUtterance: string): Step => ({ learnerUtterance });
const act = (action: SimulationAction): Step => ({ action });

/** Synthetic callback one day after the scenario clock. */
function callbackAt(scenario: PublicSimScenario): string {
  return new Date(Date.parse(scenario.context!.syntheticNow) + 24 * 3_600_000).toISOString();
}

function wrapUpSteps(scenario: PublicSimScenario, disposition: Disposition): Step[] {
  const requirements = scenario.evidenceRequirements!;
  const steps: Step[] = requirements.requiredWorkflowActions.map((actionId) => act({ type: 'workflow', actionId }));
  const wrap = new Set(requirements.requiredWrapUpEvidence);
  if (disposition === 'Callback scheduled') wrap.add('callback');
  if (disposition === 'Not interested') steps.push(act({ type: 'set_opt_out' }), act({ type: 'suppress' }));
  if (disposition === 'Lost') wrap.add('escalation');
  if (wrap.has('callback')) steps.push(act({ type: 'callback', callbackAt: callbackAt(scenario) }));
  if (wrap.has('escalation')) {
    steps.push(act({ type: 'escalate', channel: 'fake-support', orderId: 'SYN-TRAINING', vertical: scenario.context!.queue, requestedCorrection: 'Synthetic training follow-up.' }));
  }
  if (wrap.has('suppression') && disposition !== 'Not interested') steps.push(act({ type: 'suppress' }));
  steps.push(act({ type: 'note', text: 'Synthetic training evidence recorded.' }));
  steps.push(act({ type: 'wrap_up', disposition }));
  return steps;
}

function goldenPassSteps(scenario: PublicSimScenario, disposition: Disposition): Step[] {
  const requirements = scenario.evidenceRequirements!;
  const steps: Step[] = requirements.requiredInspections.map((inspectionId) => act({ type: 'inspect', inspectionId }));
  if (disposition === 'Organic') steps.push(act({ type: 'patient_completion', completionId: 'organic_before_call', organic: true }));
  steps.push(act({ type: 'dial' }));
  if (scenario.context!.contactState !== 'voicemail') {
    if (scenario.context!.direction !== 'inbound') steps.push(act({ type: 'record_disclosure' }));
    steps.push(act({ type: 'verify_identity' }));
  }
  const turns = Math.max(requirements.minimumLearnerTurns, 2);
  const lines = [
    'Thank you for taking my call. I will follow the approved call flow.',
    'I will confirm the outcome and record the wrap-up.',
    'Is there anything else I can help with today?',
  ];
  for (let index = 0; index < turns; index++) steps.push(say(lines[index % lines.length]));
  return [...steps, ...wrapUpSteps(scenario, disposition)];
}

/** Fixtures for a generated scenario, or [] when this helper cannot script a passing and a failing path. */
export function demoQAFixtures(scenario: PublicSimScenario, expectedDisposition: Disposition): ScenarioQAFixture[] {
  if (!scenario.context || !scenario.evidenceRequirements) return [];
  const passSteps = goldenPassSteps(scenario, expectedDisposition);
  const probe = runScenarioQAFixture(scenario, {
    id: `${scenario.id}-probe`, title: 'probe', kind: 'golden_pass', steps: passSteps, expectedDisposition,
    expectedGateResults: [{ ruleId: 'local_time', status: 'not_observed' }],
  });
  if (probe.errors.length > 0 || !probe.eligibility.eligible) return [];
  const required = new Set(scenario.evidenceRequirements.requiredGateIds);
  const passGates = probe.gates.filter((gate) => gate.status === 'pass' && (required.size === 0 || required.has(gate.ruleId)));
  if (passGates.length === 0) return [];
  const pass: ScenarioQAFixture = {
    id: `${scenario.id}-GOLDEN-PASS`,
    title: 'Scripted golden pass from the scenario checklist',
    kind: 'golden_pass',
    steps: passSteps,
    expectedDisposition,
    expectedGateResults: passGates.map((gate) => ({ ruleId: gate.ruleId, status: 'pass' as const })),
  };

  // Critical fail: dial before the local-time inspection (outbound), or discuss the account before verifying.
  const failSteps: Step[] = scenario.context.direction !== 'inbound'
    ? [act({ type: 'dial' }), act({ type: 'note', text: 'Synthetic blocked-call evidence recorded.' }), act({ type: 'wrap_up', disposition: expectedDisposition })]
    : [
        ...scenario.evidenceRequirements.requiredInspections.map((inspectionId) => act({ type: 'inspect', inspectionId })),
        act({ type: 'dial' }),
        say('I can see your account and your last billing charge here.'),
        ...wrapUpSteps(scenario, expectedDisposition),
      ];
  const failProbe = runScenarioQAFixture(scenario, {
    id: `${scenario.id}-probe-fail`, title: 'probe', kind: 'golden_critical_fail', steps: failSteps, expectedDisposition,
    expectedGateResults: [{ ruleId: 'local_time', status: 'not_observed' }],
  });
  const failed = failProbe.gates.find((gate) => gate.status === 'fail' && gate.severity === 'critical');
  if (!failed || failProbe.eligibility.eligible) return [pass];
  const fail: ScenarioQAFixture = {
    id: `${scenario.id}-GOLDEN-CRITICAL-FAIL`,
    title: `Scripted critical fail (${failed.ruleId})`,
    kind: 'golden_critical_fail',
    steps: failSteps,
    expectedDisposition,
    expectedGateResults: [{ ruleId: failed.ruleId, status: 'fail' }],
  };
  return [pass, fail].filter((fixture) => runScenarioQAFixture(scenario, fixture).passed);
}
