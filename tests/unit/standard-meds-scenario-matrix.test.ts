import { describe, expect, it } from 'vitest';
import {
  STANDARD_MEDS_SCENARIO_IDS,
  buildStandardMedsScenario,
  standardMedsQAFixtures,
} from '@/lib/content/standard-meds-scenarios';
import { runScenarioQAFixture } from '@/lib/services/scenario-state';

describe('document-06 Standard Meds scenario matrix', () => {
  it('contains every required scenario exactly once with explicit context and evidence', () => {
    expect(STANDARD_MEDS_SCENARIO_IDS).toHaveLength(60);
    expect(new Set(STANDARD_MEDS_SCENARIO_IDS).size).toBe(60);
    for (const id of STANDARD_MEDS_SCENARIO_IDS) {
      const scenario = buildStandardMedsScenario(id);
      expect(scenario.context).toMatchObject({
        direction: expect.any(String),
        queue: expect.any(String),
        product: expect.any(String),
        stage: expect.any(String),
        contactState: expect.any(String),
        pricingPosture: expect.any(String),
        caseBranch: expect.any(String),
      });
      expect(scenario.evidenceRequirements?.requiredInspections.length).toBeGreaterThan(0);
      expect(scenario.evidenceRequirements?.requiredGateIds.length).toBeGreaterThan(0);
    }
  });

  for (const id of STANDARD_MEDS_SCENARIO_IDS) {
    it(`${id} has a passing golden path and applicable critical-fail path`, () => {
      const scenario = buildStandardMedsScenario(id);
      const fixtures = standardMedsQAFixtures(id);
      expect(fixtures.slice(0, 2).map((fixture) => fixture.kind)).toEqual(['golden_pass', 'golden_critical_fail']);
      expect(fixtures).toHaveLength(/OPT-OUT-VOICEMAIL|THIRD-PARTY-VOICEMAIL/.test(id) ? 4 : 2);
      for (const fixture of fixtures) {
        const result = runScenarioQAFixture(scenario, fixture);
        expect({
          fixture: fixture.id,
          passed: result.passed,
          errors: result.errors,
          eligibility: result.eligibility,
          gates: result.gates.map((gate) => ({ id: gate.ruleId, status: gate.status })),
        }).toMatchObject({ passed: true, errors: [] });
      }
    });
  }
});
