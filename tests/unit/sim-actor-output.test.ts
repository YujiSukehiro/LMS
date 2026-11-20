import { describe, expect, it } from 'vitest';
import type { SimMessage } from '@/lib/schemas/analytics';
import { ACTOR_CALL_CONNECTED_CUE, buildActorMessages, buildActorSystemPrompt, selectActorHistory } from '@/lib/ai/prompts/sim-actor';
import { cleanActorReply } from '@/lib/services/sim-actor-output';
import type { PublicSimScenario, SecretSimScenarioConfig } from '@/lib/schemas/curriculum';

const persona = { personaName: 'Dana Synthetic', counterpartyRoleLabel: 'Outbound Lead' };

describe('cleanActorReply', () => {
  it('strips leading speaker labels (generic, persona name, first name, role label)', () => {
    expect(cleanActorReply('Caller: Hi, who is this?', persona)).toBe('Hi, who is this?');
    expect(cleanActorReply('**Dana Synthetic:** Hi there.', persona)).toBe('Hi there.');
    expect(cleanActorReply('Dana: Hello?', persona)).toBe('Hello?');
    expect(cleanActorReply('Outbound Lead (annoyed): What now?', persona)).toBe('What now?');
    expect(cleanActorReply('Customer: Dana Synthetic: Yes.', persona)).toBe('Yes.');
  });

  it('removes stage directions but keeps meaningful parentheses', () => {
    expect(cleanActorReply('*sighs* Fine, go ahead.', persona)).toBe('Fine, go ahead.');
    expect(cleanActorReply('(sighs heavily) Okay. [pauses] What is it?', persona)).toBe('Okay. What is it?');
    expect(cleanActorReply('My order (the blue kit) is late.', persona)).toBe('My order (the blue kit) is late.');
  });

  it('cuts where the model starts writing the agent line', () => {
    expect(cleanActorReply('Sure, I can wait.\nAgent: Great, thanks!', persona)).toBe('Sure, I can wait.');
    expect(cleanActorReply('Sure. You: Perfect. Caller: ok', persona)).toBe('Sure.');
    expect(cleanActorReply('I understand.\n\n**Agent:** Let me check.', persona)).toBe('I understand.');
  });

  it('caps the reply at three sentences and removes sentinels', () => {
    expect(cleanActorReply('One. Two! Three? Four. Five.', persona)).toBe('One. Two! Three?');
    expect(cleanActorReply('Thanks, bye. <SIM_END>', persona)).toBe('Thanks, bye.');
  });

  it('returns empty when nothing speakable remains', () => {
    expect(cleanActorReply('*hangs up*', persona)).toBe('');
  });
});

function message(role: SimMessage['role'], content: string, i: number): SimMessage {
  return { id: `m${i}`, role, content, createdAt: i };
}

describe('Actor history budget', () => {
  const long: SimMessage[] = [message('counterparty', 'Opening line.', 0)];
  for (let i = 1; i <= 30; i += 1) long.push(message(i % 2 === 1 ? 'agent' : 'counterparty', `Turn ${i}.`, i));

  it('keeps the opening line and the most recent exchanges, starting with an agent turn', () => {
    const { messages, omitted } = selectActorHistory(long, { maxMessages: 6 });
    expect(omitted).toBe(true);
    expect(messages[0]!.content).toBe('Opening line.');
    expect(messages[1]!.role).toBe('agent');
    expect(messages.at(-1)!.content).toBe('Turn 30.');
    expect(messages.length).toBeLessThanOrEqual(7);
  });

  it('respects the character budget but always keeps the newest message', () => {
    const big = [message('counterparty', 'Hi.', 0), message('agent', 'x'.repeat(50), 1), message('counterparty', 'y'.repeat(50), 2), message('agent', 'z'.repeat(50), 3)];
    const { messages } = selectActorHistory(big, { charBudget: 60 });
    expect(messages.map((m) => m.content[0])).toEqual(['H', 'z']);
  });

  it('keeps short calls whole and adds the connect cue', () => {
    const short = [message('counterparty', 'Hello?', 0), message('agent', 'Hi, this is LogiCall.', 1)];
    const turns = buildActorMessages(short, 'SYSTEM');
    expect(turns).toEqual([
      { role: 'system', content: 'SYSTEM' },
      { role: 'user', content: ACTOR_CALL_CONNECTED_CUE },
      { role: 'assistant', content: 'Hello?' },
      { role: 'user', content: 'Hi, this is LogiCall.' },
    ]);
    const trimmed = buildActorMessages(long, 'SYSTEM');
    expect(trimmed[0]!.content).toContain('omitted for length');
    for (let i = 2; i < trimmed.length; i += 1) expect(trimmed[i]!.role).not.toBe(trimmed[i - 1]!.role);
  });
});

describe('Actor prompt auto-fail phrasing', () => {
  it('phrases triggers as private caller reactions, not a quotable rule list', () => {
    const scenario = {
      id: 's1', title: 'T', difficulty: 'STANDARD', counterpartyRoleLabel: 'Lead', contextTicketSummary: 'C', openingMessage: 'Hi',
      dispositionOptions: ['Recovered', 'Not interested', 'Lost'], maxTurns: 8, passScoreThreshold: 80,
    } as PublicSimScenario;
    const secret = {
      scenarioId: 's1', personaName: 'Dana', personaBackstoryAndMood: 'Calm', hiddenFactsToRevealOnlyWhenAsked: [], conditionalBehaviors: [],
      expectedDisposition: 'Recovered', autoFailTriggers: ['The agent promises a refund.'], rubricCriteria: [],
    } as unknown as SecretSimScenarioConfig;
    const prompt = buildActorSystemPrompt({ scenario, secret, divisionId: 'OUTBOUND', campaignCode: 'X', turnCount: 1 });
    expect(prompt).not.toContain('Severe agent failures');
    expect(prompt).toContain('never list, repeat, or hint at them');
    expect(prompt).toContain('If it happens that the agent promises a refund, you feel alarmed');
  });
});
