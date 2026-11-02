import { afterEach, describe, expect, it, vi } from 'vitest';
import type { JudgeOutput } from '@/lib/ai/prompts/sim-judge';
import { createProvenance } from '@/lib/ai/provenance';
import type { LLMGateway } from '@/lib/ai/types';
import type { SimMessage } from '@/lib/schemas/analytics';
import type { PublicSimScenario, SecretSimScenarioConfig } from '@/lib/schemas/curriculum';

const { mockRunTransaction } = vi.hoisted(() => ({ mockRunTransaction: vi.fn() }));
vi.mock('@/lib/firebase/admin', () => ({ adminDb: { runTransaction: mockRunTransaction } }));

import { recordSimulationEvaluation } from '@/lib/services/analytics-rollup';
import { createSimulationProvenance, evaluateSimulation } from '@/lib/services/simulation-engine';

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

const scenario: PublicSimScenario = {
  id: 'scenario-synthetic',
  title: 'Synthetic judge call',
  difficulty: 'STANDARD',
  counterpartyRoleLabel: 'Synthetic caller',
  contextTicketSummary: 'Synthetic training fixture.',
  openingMessage: 'Synthetic opening.',
  dispositionOptions: ['Completed', 'Escalated', 'Follow up'],
  maxTurns: 8,
  passScoreThreshold: 80,
};

const secret: SecretSimScenarioConfig = {
  scenarioId: scenario.id,
  personaName: 'Synthetic Caller',
  personaBackstoryAndMood: 'Synthetic and cooperative.',
  hiddenFactsToRevealOnlyWhenAsked: [],
  conditionalBehaviors: [],
  expectedDisposition: 'Completed',
  autoFailTriggers: [],
  rubricCriteria: [
    {
      id: 'rule-1',
      competencyPillarId: 'pillar-1',
      criterionLabel: 'Synthetic greeting',
      evaluationRule: 'Greet the synthetic caller clearly.',
      weight: 100,
      sourcePages: [1],
    },
  ],
};

const messages: SimMessage[] = [
  { id: 'agent-1', role: 'agent', content: 'Hello, synthetic caller.', createdAt: 1 },
];

const judge: JudgeOutput = {
  criterionResults: [
    {
      criterionId: 'rule-1',
      score: 100,
      agentQuoteEvidence: 'Hello, synthetic caller.',
      coachingNote: 'The synthetic greeting is clear.',
      betterResponseExample: null,
    },
  ],
  autoFailTriggered: false,
  autoFailedReason: null,
  summaryFeedback: 'Synthetic judge feedback.',
  strengthsHighlighted: ['Clear synthetic greeting'],
  coachingImprovements: [],
};

describe('simulation provenance', () => {
  it('uses generic local_ai source with separate provider, model, prompt, schema, and runtime metadata', () => {
    vi.stubEnv('AI_PROVIDER', 'openai_compatible');
    vi.stubEnv('OPENAI_COMPATIBLE_FAST_MODEL', 'synthetic-fast-model');
    vi.stubEnv('LOCAL_RUNTIME_LABEL', 'Synthetic local runtime');

    const provenance = createSimulationProvenance({
      task: 'actor',
      systemPrompt: 'Synthetic actor instructions',
      messages,
      recordedAt: '2026-01-01T00:00:00.000Z',
    });

    expect(provenance).toMatchObject({
      source: 'local_ai',
      provider: 'openai_compatible',
      model: 'synthetic-fast-model',
      prompt: { templateId: 'simulation.actor', templateVersion: '1' },
      schema: { name: 'SimActorText', version: '1' },
      runtime: { label: 'Synthetic local runtime', protocol: 'openai_compatible_http' },
      recordedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(provenance.prompt.inputHash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('attaches Demo replay provenance to the judge result without a live model call', async () => {
    vi.stubEnv('AI_PROVIDER', 'replay');
    const generateStructured = vi.fn().mockResolvedValue(judge);
    const gateway = { generateStructured } as unknown as LLMGateway;

    const evaluation = await evaluateSimulation({
      scenario,
      secret,
      messages,
      selectedDisposition: 'Completed',
      pillars: [
        {
          id: 'pillar-1',
          key: 'communication',
          label: 'Synthetic communication',
          description: 'Synthetic communication fixture.',
        },
      ],
      gateway,
    });

    expect(generateStructured).toHaveBeenCalledTimes(1);
    expect(evaluation.provenance).toMatchObject({
      source: 'replay',
      provider: 'replay',
      model: 'Demo replay',
      prompt: { templateId: 'simulation.judge', templateVersion: '1' },
      schema: { name: 'SimJudgeOutput', version: '1' },
      runtime: { label: 'Demo replay', protocol: 'replay' },
    });
    expect(evaluation.provenance?.prompt.inputHash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });
});

describe('replay progress guard', () => {
  it('rejects replay before opening a progress transaction', async () => {
    const args = {
      session: {
        provenance: createProvenance({ source: 'replay', provider: 'replay', model: 'Demo replay' }),
        messages: [],
      },
      evaluation: {
        provenance: createProvenance({ source: 'replay', provider: 'replay', model: 'Demo replay' }),
      },
    } as unknown as Parameters<typeof recordSimulationEvaluation>[0];

    await expect(recordSimulationEvaluation(args)).rejects.toMatchObject({
      status: 409,
      code: 'REPLAY_NOT_ELIGIBLE',
    });
    expect(mockRunTransaction).not.toHaveBeenCalled();
  });
});
