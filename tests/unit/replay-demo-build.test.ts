import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normalizeReplayDispositions } from '@/lib/ai/replay-provider';
import { simShortfallNotes } from '@/lib/ai/pipeline/generate-track';
import { CanonicalDispositionSchema } from '@/lib/schemas/source-truth';
import { PublicSimScenarioSchema } from '@/lib/schemas/curriculum';
import { generatedScenarioRuntime } from '@/lib/ai/prompts/sim-builder';
import { runScenarioQAFixture } from '@/lib/services/scenario-state';
import { demoQAFixtures } from '../../scripts/demo-qa-fixtures';

describe('demo replay Sims', () => {
  const demo = JSON.parse(readFileSync(new URL('../../demo-replay/demo.json', import.meta.url), 'utf8')) as { SimScenarios: unknown };

  it('maps the recorded demo disposition codes onto the canonical list', () => {
    const normalized = normalizeReplayDispositions(demo.SimScenarios) as {
      scenarios: Array<{ publicScenario: { dispositionOptions: string[] }; secretConfig: { expectedDisposition: string } }>;
    };
    expect(normalized.scenarios.length).toBeGreaterThanOrEqual(2);
    for (const scenario of normalized.scenarios) {
      expect(CanonicalDispositionSchema.safeParse(scenario.secretConfig.expectedDisposition).success).toBe(true);
      for (const option of scenario.publicScenario.dispositionOptions) expect(CanonicalDispositionSchema.safeParse(option).success).toBe(true);
      expect(new Set(scenario.publicScenario.dispositionOptions).size).toBe(scenario.publicScenario.dispositionOptions.length);
    }
    // The replay file itself is not modified.
    expect(JSON.stringify(demo.SimScenarios)).toContain('Link Sent - Checkout');
  });

  it('leaves canonical and unknown values alone', () => {
    const raw = { scenarios: [{ publicScenario: { dispositionOptions: ['Recovered', 'Something else'] }, secretConfig: { expectedDisposition: 'Lost' } }] };
    expect(normalizeReplayDispositions(raw)).toEqual(raw);
  });
});

describe('Sim shortfall note', () => {
  it('flags a per-scenario (local) build that wrote fewer Sims than planned', () => {
    expect(simShortfallNotes(1, 2, true)).toHaveLength(1);
    expect(simShortfallNotes(2, 2, true)).toEqual([]);
  });

  it('accepts 2 of up to 3 Sims from a batch (hosted or replay) build, but not 1', () => {
    expect(simShortfallNotes(2, 3, false)).toEqual([]);
    expect(simShortfallNotes(3, 3, false)).toEqual([]);
    expect(simShortfallNotes(1, 3, false)[0]).toMatch(/1 written, 2 planned/);
  });
});

describe('demo recording QA fixtures', () => {
  const scenarioFor = (divisionId: 'OUTBOUND' | 'INBOUND' | 'TELEHEALTH', expectedDisposition: 'Recovered' | 'Callback scheduled' | 'Not interested') => {
    const runtime = generatedScenarioRuntime({ expectedDisposition, defaults: { divisionId, product: 'NeuroCalmRx', sourceRevision: 'rev-1' } });
    return PublicSimScenarioSchema.parse({
      id: 's1', title: 'Synthetic', difficulty: 'STANDARD', counterpartyRoleLabel: 'Lead', contextTicketSummary: 'Synthetic ticket',
      openingMessage: 'Hello?', dispositionOptions: ['Recovered', 'Callback scheduled', 'Not interested'], maxTurns: 8, passScoreThreshold: 80,
      ...runtime,
    });
  };

  it.each([
    ['OUTBOUND', 'Recovered'],
    ['OUTBOUND', 'Callback scheduled'],
    ['INBOUND', 'Not interested'],
  ] as const)('scripts a passing and a critical-fail path for a generated %s scenario expecting %s', (divisionId, disposition) => {
    const scenario = scenarioFor(divisionId, disposition);
    const fixtures = demoQAFixtures(scenario, disposition);
    expect(fixtures.map((fixture) => fixture.kind)).toContain('golden_pass');
    for (const fixture of fixtures) expect(runScenarioQAFixture(scenario, fixture).passed).toBe(true);
    if (scenario.context!.direction !== 'inbound') expect(fixtures.map((fixture) => fixture.kind)).toContain('golden_critical_fail');
  });
});
