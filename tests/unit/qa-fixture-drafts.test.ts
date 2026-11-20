import { describe, expect, it } from 'vitest';
import { PublicSimScenarioSchema } from '@/lib/schemas/curriculum';
import { ScenarioQAFixtureSchema, type ScenarioQAFixture } from '@/lib/schemas/simulation-state';
import { runScenarioQAFixture } from '@/lib/services/scenario-state';
import { draftExpectedGateResults, draftQAFixtureSteps } from '@/components/studio/editor/qa-fixture-drafts';

// The Live Call Sim the local 7B model generated for the NeuroCalmRx E2E Track (no required gates, local_time inspection).
const generated = PublicSimScenarioSchema.parse({"id": "s2", "title": "Price Objection in Checkout Abandon", "difficulty": "STANDARD", "counterpartyRoleLabel": "Outbound Lead", "contextTicketSummary": "Queue: Recovery, Campaign: NEUROCALMRX, Channel: Outbound, Reason: Checkout Abandon", "openingMessage": "Hi, this is [Agent Name] from Standard Meds. You recently completed your neuropathy health assessment and reached the checkout page but didn't finish. Is this a good time for a quick call?", "dispositionOptions": ["Recovered", "Callback scheduled", "Didn't reply", "Not interested", "Organic", "Lost"], "maxTurns": 8, "passScoreThreshold": 80, "context": {"direction": "outbound", "queue": "recovery", "product": "NeuroCalmRx", "stage": "checkout", "contactState": "lead", "pricingPosture": "active", "caseBranch": "generated_callback_scheduled", "syntheticTimezone": "America/Chicago", "syntheticNow": "2026-01-15T17:00:00.000Z", "sourceRevision": "sha256:c5cf279c8d15c56b40b550921b2fb9e63fb51b94f93b61ea6b01afb4173f78c4", "curriculumVersion": "draft"}, "evidenceRequirements": {"minimumLearnerTurns": 2, "requiredInspections": ["local_time"], "requiredWorkflowActions": [], "requiredWrapUpEvidence": [], "requiredGateIds": [], "requiredCustomerConcerns": [], "expectedDurationMinutes": null, "gateSourceRefs": {}, "maximumCriticalFailures": 0, "maximumMajorFailures": 0}});

function fixture(kind: ScenarioQAFixture['kind'], scenario = generated, disposition: ScenarioQAFixture['expectedDisposition'] = 'Callback scheduled'): ScenarioQAFixture {
  return ScenarioQAFixtureSchema.parse({
    id: `draft-${kind}`,
    title: 'Draft',
    kind,
    steps: draftQAFixtureSteps(kind, scenario, disposition),
    expectedDisposition: disposition,
    expectedGateResults: draftExpectedGateResults(kind, scenario),
  });
}

describe('Studio draft QA fixtures for a generated Live Call Sim', () => {
  it('the golden pass draft is reachable and assessment-eligible', () => {
    const run = runScenarioQAFixture(generated, fixture('golden_pass'));
    expect(run.errors).toEqual([]);
    expect(run.eligibility.reasons).toEqual([]);
    expect(run.passed).toBe(true);
  });

  it('the critical-fail draft fails local_time and is ineligible', () => {
    const run = runScenarioQAFixture(generated, fixture('golden_critical_fail'));
    expect(run.gates.find((gate) => gate.ruleId === 'local_time')?.status).toBe('fail');
    expect(run.passed).toBe(true);
  });

  it('covers required workflow actions, wrap-up evidence and a Recovered disposition', () => {
    const scenario = PublicSimScenarioSchema.parse({
      ...generated,
      evidenceRequirements: { ...generated.evidenceRequirements, minimumLearnerTurns: 3, requiredWorkflowActions: ['link_sent'], requiredWrapUpEvidence: ['note'] },
    });
    const run = runScenarioQAFixture(scenario, fixture('golden_pass', scenario, 'Recovered'));
    expect(run.eligibility.reasons).toEqual([]);
    expect(run.passed).toBe(true);
  });
});
