import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/firebase/admin', () => ({ adminDb: {} }));

import {
  JudgeOutputSchema,
  buildJudgeOutputSchema,
  buildJudgeUserPrompt,
  snapJudgeScore,
  type JudgeOutput,
} from '@/lib/ai/prompts/sim-judge';
import type { SimMessage } from '@/lib/schemas/analytics';
import type { PublicSimScenario, SecretSimScenarioConfig } from '@/lib/schemas/curriculum';
import type { SimulationEvent } from '@/lib/schemas/simulation-state';
import { LLMStructuredOutputError, type LLMGateway } from '@/lib/ai/types';
import {
  JUDGE_MAX_OUTPUT_TOKENS,
  assembleSimEvaluation,
  evaluateSimulation,
  matchJudgeResults,
} from '@/lib/services/simulation-engine';

const scenario = {
  id: 's1',
  title: 'Synthetic call',
  difficulty: 'STANDARD',
  counterpartyRoleLabel: 'Synthetic lead',
  contextTicketSummary: 'SYNTHETIC TRAINING',
  openingMessage: 'Hello?',
  dispositionOptions: ['Recovered', 'Not interested', 'Lost'],
  maxTurns: 8,
  passScoreThreshold: 80,
} as PublicSimScenario;

const secret: SecretSimScenarioConfig = {
  scenarioId: 's1',
  personaName: 'Dana Synthetic',
  personaBackstoryAndMood: 'Calm.',
  hiddenFactsToRevealOnlyWhenAsked: [],
  conditionalBehaviors: [],
  expectedDisposition: 'Recovered',
  autoFailTriggers: [],
  rubricCriteria: [
    { id: 's1-r1', competencyPillarId: 'p1', criterionLabel: 'Greeting', evaluationRule: 'Greet the lead.', weight: 50, sourcePages: [1] },
    { id: 's1-r2', competencyPillarId: 'p1', criterionLabel: 'Recording disclosure', evaluationRule: 'Disclose recording.', weight: 30, sourcePages: [1] },
    { id: 's1-r3', competencyPillarId: 'p1', criterionLabel: 'Close', evaluationRule: 'Close politely.', weight: 20, sourcePages: [1] },
  ],
};

const messages: SimMessage[] = [
  { id: 'm0', role: 'counterparty', content: 'Hello?', createdAt: 0 },
  { id: 'm1', role: 'agent', content: 'Hi, this is LogiCall. This call is recorded.', createdAt: 1 },
];

function criterion(criterionId: string, score: 0 | 50 | 100) {
  return { criterionId, score, agentQuoteEvidence: '', coachingNote: `note ${criterionId}`, betterResponseExample: score === 100 ? null : 'Say it.' };
}

function judge(results: ReturnType<typeof criterion>[]): JudgeOutput {
  return JudgeOutputSchema.parse({
    criterionResults: results,
    autoFailTriggered: false,
    autoFailedReason: null,
    summaryFeedback: 'Good.',
    strengthsHighlighted: [],
    coachingImprovements: [],
  });
}

function assemble(output: JudgeOutput, selectedDisposition = 'Recovered') {
  return assembleSimEvaluation({ judge: output, scenario, secret, messages, selectedDisposition, evaluatedAt: 1 });
}

describe('Judge output schema leniency', () => {
  it('snaps numeric scores and numeric strings to 0/50/100', () => {
    expect([0, 10, 30, 50, 60, 80, 100, '50', '75%', 0.9, 'abc'].map(snapJudgeScore)).toEqual([0, 0, 50, 50, 50, 100, 100, 50, 100, 100, 'abc']);
  });

  it('accepts a sparse small-model answer and fills defaults', () => {
    const parsed = JudgeOutputSchema.parse({
      criterionResults: [{ criterionId: 's1-r1', score: '85' }, { criterionId: 's1-r2', score: 40, coachingNote: null, betterResponseExample: null }],
      autoFailTriggered: 'false',
      summaryFeedback: null,
      strengthsHighlighted: 'Friendly tone',
    });
    expect(parsed.criterionResults[0]).toMatchObject({ score: 100, agentQuoteEvidence: '', coachingNote: '', betterResponseExample: null });
    expect(parsed.criterionResults[1]!.score).toBe(50);
    expect(parsed).toMatchObject({ autoFailTriggered: false, autoFailedReason: null, summaryFeedback: '', strengthsHighlighted: ['Friendly tone'], coachingImprovements: [] });
  });

  it('per-scenario schema rejects unknown, duplicate and missing criterion ids with repairable messages', () => {
    const strict = buildJudgeOutputSchema(secret.rubricCriteria);
    const base = { autoFailTriggered: false, summaryFeedback: 'x', strengthsHighlighted: [], coachingImprovements: [] };
    const bad = strict.safeParse({ ...base, criterionResults: [criterion('s1-r1', 100), criterion('s1-r1', 50), criterion('s1-rX', 0)] });
    expect(bad.success).toBe(false);
    const text = bad.success ? '' : bad.error.issues.map((issue) => issue.message).join('\n');
    expect(text).toContain('Unknown criterionId "s1-rX". Use exactly one of: s1-r1, s1-r2, s1-r3.');
    expect(text).toContain('appears more than once');
    expect(text).toContain('Missing criterionId(s): s1-r2, s1-r3');
    expect(strict.safeParse({ ...base, criterionResults: [criterion('s1-r1', 100), criterion('s1-r2', 50), criterion('s1-r3', 0)] }).success).toBe(true);
  });
});

describe('assembleSimEvaluation', () => {
  it('scores a truly missing criterion 0 with fallback coaching', () => {
    const evaluation = assemble(judge([criterion('s1-r1', 100), criterion('s1-r2', 100)]));
    expect(evaluation.criterionResults.map((c) => [c.criterionId, c.score])).toEqual([['s1-r1', 100], ['s1-r2', 100], ['s1-r3', 0]]);
    expect(evaluation.criterionResults[2]!.betterResponseExample).toContain('Close politely.');
    expect(evaluation.overallScorePct).toBe(80);
  });

  it('keeps the first of duplicate ids and never lets a duplicate fill another criterion', () => {
    const evaluation = assemble(judge([criterion('s1-r1', 100), criterion('s1-r1', 0), criterion('s1-r3', 100)]));
    expect(evaluation.criterionResults.map((c) => c.score)).toEqual([100, 0, 100]);
    expect(evaluation.criterionResults[1]!.coachingNote).toContain('No evidence');
  });

  it('matches typo / label / positional ids before scoring 0', () => {
    const evaluation = assemble(judge([criterion('S1_R1', 100), criterion('Recording disclosure', 50), criterion('criterion_3', 100)]));
    expect(evaluation.criterionResults.map((c) => [c.criterionId, c.score])).toEqual([['s1-r1', 100], ['s1-r2', 50], ['s1-r3', 100]]);
    expect(matchJudgeResults([criterion('x', 100)], secret.rubricCriteria)).toEqual([undefined, undefined, undefined]);
  });

  it('applies the disposition penalty and coaching note for a wrong disposition', () => {
    const output = judge([criterion('s1-r1', 100), criterion('s1-r2', 100), criterion('s1-r3', 100)]);
    expect(assemble(output).overallScorePct).toBe(100);
    const wrong = assemble(output, 'Lost');
    expect(wrong.dispositionCorrect).toBe(false);
    expect(wrong.overallScorePct).toBe(90);
    expect(wrong.coachingImprovements[0]).toContain('Log the disposition "Recovered"');
  });

  it('fills empty coaching and summary text', () => {
    const output = JudgeOutputSchema.parse({ criterionResults: [{ criterionId: 's1-r1', score: 0 }], autoFailTriggered: false });
    const evaluation = assemble(output);
    expect(evaluation.criterionResults[0]!.coachingNote).toContain('Greeting');
    expect(evaluation.summaryFeedback.length).toBeGreaterThan(0);
  });
});

function utterance(id: string, actor: 'learner' | 'customer', content: string, sequence: number): SimulationEvent {
  return {
    id, sessionId: 'x', sequence, actor, type: 'utterance', payload: { content, synthetic: true },
    stateHash: `sha256:${'0'.repeat(64)}`, occurredAt: '2026-01-15T17:00:00.000Z', provenance: actor === 'learner' ? 'learner' : 'local_ai',
  };
}

describe('Judge prompt', () => {
  it('includes the transcript once (utterance content removed from the event catalogue)', () => {
    const events = [utterance('e0', 'customer', 'Hello?', 1), utterance('e1', 'learner', 'Hi, this is LogiCall. This call is recorded.', 2)];
    const prompt = buildJudgeUserPrompt({ scenario, secret, messages, selectedDisposition: 'Recovered', pillars: [], events });
    expect(prompt.split('This call is recorded.').length - 1).toBe(1);
    expect(prompt).toContain('"id":"e1"');
    expect(prompt).toContain('"transcriptTurn":2');
  });
});

describe('evaluateSimulation', () => {
  it('passes the per-scenario schema, explicit max tokens and the abort signal to the gateway', async () => {
    const generateStructured = vi.fn().mockResolvedValue(judge([criterion('s1-r1', 100), criterion('s1-r2', 100), criterion('s1-r3', 100)]));
    const gateway = { providerName: 'replay', generateStructured } as unknown as LLMGateway;
    const controller = new AbortController();
    const evaluation = await evaluateSimulation({ scenario, secret, messages, selectedDisposition: 'Recovered', pillars: [], gateway, signal: controller.signal });
    expect(evaluation.overallScorePct).toBe(100);
    expect(generateStructured).toHaveBeenCalledWith(expect.objectContaining({ maxOutputTokens: JUDGE_MAX_OUTPUT_TOKENS, signal: controller.signal, tier: 'heavy' }));
    const schema = generateStructured.mock.calls[0]![0].schema;
    expect(schema.safeParse({ criterionResults: [criterion('bad', 0)], autoFailTriggered: false }).success).toBe(false);
  });

  it('keeps a structurally valid last output when only the strict id check failed', async () => {
    const raw = JSON.stringify({ criterionResults: [criterion('Greeting', 100), criterion('s1-r2', 50), criterion('s1-r3', 100)], autoFailTriggered: false, summaryFeedback: 'ok', strengthsHighlighted: [], coachingImprovements: [] });
    const generateStructured = vi.fn().mockRejectedValue(new LLMStructuredOutputError('ids', 'SimJudgeOutput', 3, raw));
    const gateway = { providerName: 'replay', generateStructured } as unknown as LLMGateway;
    const evaluation = await evaluateSimulation({ scenario, secret, messages, selectedDisposition: 'Recovered', pillars: [], gateway });
    expect(evaluation.criterionResults.map((c) => c.score)).toEqual([100, 50, 100]);
  });

  it('rethrows when the last output is unusable', async () => {
    const generateStructured = vi.fn().mockRejectedValue(new LLMStructuredOutputError('bad', 'SimJudgeOutput', 3, 'not json'));
    const gateway = { providerName: 'replay', generateStructured } as unknown as LLMGateway;
    await expect(evaluateSimulation({ scenario, secret, messages, selectedDisposition: 'Recovered', pillars: [], gateway })).rejects.toBeInstanceOf(LLMStructuredOutputError);
  });
});
