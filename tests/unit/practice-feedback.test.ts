/** QA M6: Verbal Practice feedback never echoes the agent, and strengths point at real agent words. */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/firebase/admin', () => ({ adminDb: {} }));

import { JudgeOutputSchema } from '@/lib/ai/prompts/sim-judge';
import type { SimMessage } from '@/lib/schemas/analytics';
import type { PublicSimScenario, SecretSimScenarioConfig } from '@/lib/schemas/curriculum';
import { isEchoOf, quotedFragments } from '@/lib/services/feedback-text';
import { assembleSimEvaluation, groundedStrengths } from '@/lib/services/simulation-engine';

const scenario = {
  id: 's1',
  title: 'Synthetic call',
  difficulty: 'STANDARD',
  counterpartyRoleLabel: 'Synthetic member',
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
    { id: 'r1', competencyPillarId: 'p1', criterionLabel: 'Verify identity', evaluationRule: 'Verify name, DOB and ZIP.', weight: 50, sourcePages: [1] },
    { id: 'r2', competencyPillarId: 'p2', criterionLabel: 'Offer the ladder', evaluationRule: 'Offer 50% off first.', weight: 50, sourcePages: [2] },
  ],
};

const messages: SimMessage[] = [
  { id: 'm0', role: 'counterparty', content: 'I want to cancel.', createdAt: 0 },
  { id: 'm1', role: 'agent', content: 'Can I get your full name and date of birth please?', createdAt: 1 },
  { id: 'm2', role: 'agent', content: 'I can offer you a discount on your plan.', createdAt: 2 },
];

describe('isEchoOf', () => {
  it('spots a suggestion that repeats the agent quote', () => {
    expect(isEchoOf('I can offer you a discount on your plan.', 'i can offer you a discount on your plan')).toBe(true);
    expect(isEchoOf('"I can offer you a discount on your plan"', 'I can offer you a discount on your plan.')).toBe(true);
    expect(isEchoOf('I can offer you 50% off for the next two billing cycles.', 'I can offer you a discount on your plan.')).toBe(false);
    expect(isEchoOf('Anything', '')).toBe(false);
    // The real QA case (Gemini re-grade check, Nov 23): the suggestion was the tail of the agent's own reply.
    expect(
      isEchoOf(
        "Your pause starts today and billing restarts in 60 days. I've noted the pause in your account and you'll get an email confirmation. Is there anything else I can help with?",
        "Absolutely, I can pause it for you. Your pause starts today and billing restarts in 60 days. I've noted the pause in your account and you'll get an email confirmation. Is there anything else I can help with?",
      ),
    ).toBe(true);
    expect(isEchoOf('Thank you', 'Thank you so much for calling today, Dana.')).toBe(false);
  });

  it('reads quoted fragments of three words or more', () => {
    expect(quotedFragments('Verified identity: "Can I get your full name"')).toEqual(['Can I get your full name']);
    expect(quotedFragments('Said "ok" once')).toEqual([]);
  });
});

describe('assembleSimEvaluation feedback', () => {
  const judge = JudgeOutputSchema.parse({
    criterionResults: [
      { criterionId: 'r1', score: 100, agentQuoteEvidence: 'Can I get your full name and date of birth please?', coachingNote: 'Good.', betterResponseExample: null },
      {
        criterionId: 'r2',
        score: 50,
        agentQuoteEvidence: 'I can offer you a discount on your plan.',
        coachingNote: 'Name the exact offer.',
        betterResponseExample: 'I can offer you a discount on your plan.',
      },
    ],
    autoFailTriggered: false,
    autoFailedReason: null,
    summaryFeedback: 'Ok.',
    strengthsHighlighted: ['Noted the pause in Atlas', 'Verified identity first: "Can I get your full name and date of birth"'],
    coachingImprovements: ['Name the exact offer.'],
  });
  const evaluation = assembleSimEvaluation({ judge, scenario, secret, messages, selectedDisposition: 'Recovered', evaluatedAt: 1 });

  it('replaces an echoed "Try saying" with the Playbook rule', () => {
    expect(evaluation.criterionResults[1]!.betterResponseExample).toBe('Follow this Playbook rule on the call: Offer 50% off first.');
  });

  it('drops a strength that quotes nothing the agent said', () => {
    expect(evaluation.strengthsHighlighted).toEqual(['Verified identity first: "Can I get your full name and date of birth"']);
  });

  it('keeps each criterion in its rubric skill area', () => {
    expect(evaluation.criterionResults.map((c) => c.competencyPillarId)).toEqual(['p1', 'p2']);
  });
});

describe('groundedStrengths', () => {
  const agent = messages.filter((m) => m.role === 'agent');
  it('falls back to met criteria with verified quotes when no strength is grounded', () => {
    expect(
      groundedStrengths(['Great rapport'], agent, [
        { score: 100, criterionLabel: 'Verify identity', agentQuoteEvidence: 'Can I get your full name' },
        { score: 50, criterionLabel: 'Offer the ladder', agentQuoteEvidence: 'I can offer you a discount' },
      ]),
    ).toEqual(['Verify identity: "Can I get your full name"']);
  });

  it('never repeats sensitive numbers a learner typed', () => {
    expect(groundedStrengths([], agent, [{ score: 100, criterionLabel: 'Card', agentQuoteEvidence: 'card 4111 1111 1111 1111' }])).toEqual([]);
  });
});
