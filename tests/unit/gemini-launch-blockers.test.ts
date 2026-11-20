/**
 * Regression tests for the cloud Gemini + verbal_only launch path:
 *  - Bug A: hosted_ai provenance was relabelled imported_legacy, so Gemini sessions never certified or counted in QA.
 *  - Bug B: generated verbal Tracks had no QA fixtures, and INBOUND fixtures acted in-call before answering (dial).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createProvenance } from '@/lib/ai/provenance';
import { TRAINING_POLICY } from '@/lib/policy/training-policy';
import type { PublicSimScenario, SecretSimScenarioConfig } from '@/lib/schemas/curriculum';
import { DivisionIdSchema } from '@/lib/schemas/domain';
import { ScenarioAttemptEvidenceSchema } from '@/lib/schemas/learning';
import { ScenarioContextSchema } from '@/lib/schemas/simulation-state';
import type { SimSessionDoc } from '@/lib/schemas/analytics';
import { evaluateScenarioSessionEvidence } from '@/lib/services/certification';
import { scenarioAttemptEvidence, scenarioEvidenceProvenance } from '@/lib/services/scenario-coverage';
import { runScenarioQAFixture } from '@/lib/services/scenario-state';
import { evaluatePublicationGates } from '@/lib/services/source-evidence';
import { buildTrainerQaQueue } from '@/lib/services/trainer-qa';
import {
  ensureVerbalScenarioDefaults,
  ensureVerbalSecretDefaults,
  normalizeVerbalScenarioPairs,
} from '@/lib/services/verbal-defaults';
import { learningBlueprint, learningVersion, NOW, scenarioSession } from './helpers/learning-service-fixtures';

const ORIGINAL_HOSTED = TRAINING_POLICY.allowHostedAiForCertification;
afterEach(() => {
  TRAINING_POLICY.allowHostedAiForCertification = ORIGINAL_HOSTED;
});

function hostedSession(overrides: Partial<SimSessionDoc> = {}): SimSessionDoc {
  const session = scenarioSession({ provenance: createProvenance({ source: 'hosted_ai', provider: 'gemini', model: 'actor' }), ...overrides });
  session.evaluation!.provenance = createProvenance({ source: 'hosted_ai', provider: 'gemini', model: 'judge' });
  return session;
}

function assess(session: SimSessionDoc, evidence = scenarioAttemptEvidence(session)) {
  return evaluateScenarioSessionEvidence({
    learnerId: session.userId,
    blueprint: learningBlueprint(),
    session,
    evidence,
    expectedScenarioId: session.scenarioId,
  });
}

describe('Bug A: hosted_ai provenance', () => {
  it('ships with GATE-04 approved', () => {
    expect(ORIGINAL_HOSTED).toBe(true);
  });

  it('accepts hosted_ai in stored scenario attempt evidence and never relabels it as legacy', () => {
    expect(ScenarioAttemptEvidenceSchema.shape.provenance.options).toContain('hosted_ai');
    expect(scenarioEvidenceProvenance('hosted_ai')).toBe('hosted_ai');
    expect(scenarioEvidenceProvenance('local_ai')).toBe('local_ai');
    expect(scenarioEvidenceProvenance('manual_chat')).toBe('manual_chat');
    expect(scenarioEvidenceProvenance('replay')).toBe('imported_legacy');
    expect(scenarioEvidenceProvenance(undefined)).toBe('imported_legacy');
    expect(scenarioAttemptEvidence(hostedSession()).provenance).toBe('hosted_ai');
  });

  it('certifies a passing hosted_ai session when the policy allows it', () => {
    TRAINING_POLICY.allowHostedAiForCertification = true;
    const baseline = assess(scenarioSession());
    expect(baseline.certificationPass).toBe(true);

    const result = assess(hostedSession());
    expect(result.reasons).not.toContain('legacy_unverified');
    expect(result.reasons).not.toContain('session_provenance_unverified');
    expect(result.evidenceEligible).toBe(true);
    expect(result.certificationPass).toBe(true);
  });

  it('blocks hosted_ai for an explicit policy reason when the policy is off', () => {
    TRAINING_POLICY.allowHostedAiForCertification = false;
    const result = assess(hostedSession());
    expect(result.certificationPass).toBe(false);
    expect(result.reasons).toContain('hosted_ai_certification_disabled');
    expect(result.reasons).not.toContain('legacy_unverified');
    expect(result.reasons).not.toContain('session_provenance_unverified');
    expect(result.reasons).not.toContain('evaluation_provenance_unverified');
  });

  it('still fails genuine unverified legacy evidence with legacy_unverified', () => {
    for (const allowed of [true, false]) {
      TRAINING_POLICY.allowHostedAiForCertification = allowed;
      const session = scenarioSession();
      const result = assess(session, { ...scenarioAttemptEvidence(session), provenance: 'imported_legacy' });
      expect(result.certificationPass).toBe(false);
      expect(result.reasons).toContain('legacy_unverified');
      expect(result.reasons).not.toContain('hosted_ai_certification_disabled');
    }
  });

  it('counts hosted_ai sessions in Trainer QA failure metrics only when the policy allows them', () => {
    const sessions = Array.from({ length: 5 }, (_, index) => {
      const session = hostedSession({ id: `hosted-${index + 1}` });
      if (index < 2) session.evaluation!.passed = false;
      return session;
    });
    const input = {
      trackId: 'track-1',
      draft: learningVersion({ versionId: 'draft', publishedAt: null }),
      learningVersion: learningVersion(),
      blueprint: learningBlueprint(),
      source: { bundle: null, pages: [], rulePacks: [], assets: [], conflicts: [] },
      secrets: [],
      drillAttempts: [],
      simSessions: sessions,
      now: Date.parse(NOW),
    };

    TRAINING_POLICY.allowHostedAiForCertification = true;
    const counted = buildTrainerQaQueue(input).items.find((item) => item.id === 'high_learner_failure:scenario:s-easy');
    expect(counted?.metric).toMatchObject({ sampleSize: 5, failures: 2 });

    TRAINING_POLICY.allowHostedAiForCertification = false;
    const excluded = buildTrainerQaQueue(input).items.find((item) => item.id === 'high_learner_failure:scenario:s-easy');
    expect(excluded).toBeUndefined();
  });
});

/** A scenario/secret pair exactly as the AI pipeline emits it: no context, evidence requirements or QA fixtures. */
function generatedPair(id: string): { scenario: PublicSimScenario; secret: SecretSimScenarioConfig } {
  return {
    scenario: {
      id,
      title: 'Generated scenario',
      difficulty: 'STANDARD',
      counterpartyRoleLabel: 'Member',
      contextTicketSummary: 'Synthetic generated ticket.',
      openingMessage: 'Hi, I have a question about my order.',
      dispositionOptions: ['Recovered', 'Callback scheduled', 'Not interested'],
      maxTurns: 8,
      passScoreThreshold: 80,
    },
    secret: {
      scenarioId: id,
      personaName: 'Pat',
      personaBackstoryAndMood: 'Calm.',
      hiddenFactsToRevealOnlyWhenAsked: [],
      conditionalBehaviors: [],
      expectedDisposition: 'Recovered',
      autoFailTriggers: [],
      rubricCriteria: [1, 2, 3].map((n) => ({
        id: `c${n}`,
        competencyPillarId: 'p1',
        criterionLabel: `Criterion ${n}`,
        evaluationRule: 'Follow the Playbook.',
        weight: n === 3 ? 34 : 33,
        sourcePages: [1],
      })),
    },
  };
}

const REVISION = 'sha256:generated-test-revision';

function scenarioGateCodes(scenarios: PublicSimScenario[], secrets: SecretSimScenarioConfig[]): string[] {
  const report = evaluatePublicationGates({
    draft: learningVersion({ versionId: 'draft', publishedAt: null, simScenarios: scenarios, sourceRevision: REVISION }),
    bundle: null,
    pages: [],
    rulePacks: [],
    assets: [],
    conflicts: [],
    secrets,
    runScenarioQAFixture,
  });
  // Source-bundle issues are out of scope here (no bundle in this unit test); every scenario-level gate is checked.
  return report.issues
    .filter((issue) => issue.code.startsWith('SCENARIO_'))
    .map((issue) => `${issue.code}: ${issue.message}`);
}

describe('Bug B: verbal_only QA fixtures', () => {
  const base = generatedPair('s1');
  const queues = ScenarioContextSchema.shape.queue.options;
  const contacts = ScenarioContextSchema.shape.contactState.options;

  for (const divisionId of DivisionIdSchema.options) {
    it(`builds golden pass and critical-fail fixtures that run cleanly for ${divisionId} in every queue and contact state`, () => {
      const defaults = ensureVerbalScenarioDefaults(base.scenario, { divisionId });
      expect(defaults.context?.direction).toBe(divisionId === 'INBOUND' ? 'inbound' : 'outbound');
      for (const queue of queues) {
        for (const contactState of contacts) {
          const scenario = ensureVerbalScenarioDefaults({ ...base.scenario, context: { ...defaults.context!, queue, contactState } }, { divisionId });
          const secret = ensureVerbalSecretDefaults(scenario, base.secret);
          const fixtures = secret.qaFixtures ?? [];
          expect(fixtures.map((fixture) => fixture.kind).sort()).toEqual(['golden_critical_fail', 'golden_pass']);
          for (const fixture of fixtures) {
            const result = runScenarioQAFixture(scenario, fixture);
            const label = `${divisionId}/${queue}/${contactState}/${fixture.kind}`;
            expect(result.errors, label).toEqual([]);
            expect(result.passed, `${label}: ${result.eligibility.reasons.join(' ')}`).toBe(true);
            if (fixture.kind === 'golden_critical_fail') expect(result.eligibility.deterministicCriticalFailure, label).toBe(true);
          }
        }
      }
    });
  }

  it('answers an inbound call (dial) before any in-call step in both fixtures', () => {
    const scenario = ensureVerbalScenarioDefaults(base.scenario, { divisionId: 'INBOUND' });
    const fixtures = ensureVerbalSecretDefaults(scenario, base.secret).qaFixtures ?? [];
    for (const fixture of fixtures) {
      const dialIndex = fixture.steps.findIndex((step) => step.action?.type === 'dial');
      const firstInCall = fixture.steps.findIndex((step) => step.learnerUtterance || step.action?.type === 'set_opt_out');
      expect(dialIndex, fixture.kind).toBeGreaterThanOrEqual(0);
      expect(dialIndex, fixture.kind).toBeLessThan(firstInCall);
    }
  });

  for (const divisionId of DivisionIdSchema.options) {
    it(`makes a freshly generated ${divisionId} Track pass the scenario publication gates without a PATCH`, () => {
      // finalizeScenario gives generated scenarios a context and evidence checklist but no QA fixtures.
      const pairs = [generatedPair('s1'), generatedPair('s2')].map((pair) => ({
        scenario: ensureVerbalScenarioDefaults(pair.scenario, { divisionId, sourceRevision: REVISION }),
        secret: pair.secret,
      }));
      const raw = scenarioGateCodes(pairs.map((pair) => pair.scenario), pairs.map((pair) => pair.secret));
      expect(raw.some((code) => code.startsWith('SCENARIO_GOLDEN_PASS_REQUIRED'))).toBe(true);

      // Same call commitDraft (generate-track) makes before persisting the draft.
      const normalized = normalizeVerbalScenarioPairs({
        scenarios: pairs.map((pair) => pair.scenario),
        secrets: pairs.map((pair) => pair.secret),
        defaults: { divisionId, product: 'Generated Track', sourceRevision: REVISION, curriculumVersion: 'draft' },
      });
      expect(normalized.changed).toBe(true);
      expect(scenarioGateCodes(normalized.scenarios, normalized.secrets)).toEqual([]);
    });
  }

  it('publish backfill only rewrites incomplete scenarios and leaves trainer-saved ones untouched', () => {
    const saved = (() => {
      const pair = generatedPair('saved');
      const scenario = ensureVerbalScenarioDefaults(pair.scenario, { divisionId: 'INBOUND', sourceRevision: REVISION });
      return { scenario, secret: ensureVerbalSecretDefaults(scenario, pair.secret) };
    })();
    const legacy = generatedPair('legacy');

    const backfill = normalizeVerbalScenarioPairs({
      scenarios: [saved.scenario, legacy.scenario],
      secrets: [saved.secret, legacy.secret],
      defaults: { divisionId: 'INBOUND', product: 'Track', sourceRevision: REVISION, curriculumVersion: 'draft' },
      onlyIncomplete: true,
    });
    expect(backfill.changed).toBe(true);
    expect(backfill.scenarios[0]).toBe(saved.scenario);
    expect(backfill.secrets[0]).toBe(saved.secret);
    expect(backfill.secrets[1].qaFixtures?.length).toBe(2);
    expect(scenarioGateCodes(backfill.scenarios, backfill.secrets)).toEqual([]);

    const nothingToDo = normalizeVerbalScenarioPairs({
      scenarios: [saved.scenario],
      secrets: [saved.secret],
      defaults: { divisionId: 'INBOUND' },
      onlyIncomplete: true,
    });
    expect(nothingToDo.changed).toBe(false);
  });
});
