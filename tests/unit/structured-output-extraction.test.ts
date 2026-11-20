import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  buildRepairMessage,
  extractJsonCandidate,
  findBalancedJsonEnd,
  parseStructuredOutput,
  runStructuredRepairLoop,
  stripMarkdownFences,
} from '@/lib/ai/pipeline/structured-output';
import { LLMOutputTruncatedError, LLMStructuredOutputError } from '@/lib/ai/types';

const Schema = z.object({ a: z.number() });

describe('extractJsonCandidate', () => {
  const cases: Array<[string, string]> = [
    ['plain JSON', '{"a":1}'],
    ['JSON followed by a line of prose', '{"a":1}\nDone.'],
    ['prose with braces after JSON', '{"a":1}\nNote: {this} is {not} JSON.'],
    ['prose with braces before JSON', 'Here is {the} answer: {"a":1}'],
    ['fenced block followed by prose', '```json\n{"a":1}\n```\nLet me know if you need anything else {ok}.'],
    ['prose then fenced block', 'Sure!\n```\n{"a":1}\n```'],
    ['<think> block before JSON', '<think>I should output {"a":2} maybe? {</think>\n{"a":1}'],
    ['<thinking> block before fenced JSON', '<thinking>plan {x}</thinking>```json\n{"a":1}\n```'],
    ['two JSON objects', '{"a":1}\n{"a":2}'],
    ['braces inside strings', '{"a":1,"s":"} not the end {"}'],
    ['escaped quotes inside strings', '{"a":1,"s":"he said \\"}\\" ok"}'],
  ];
  for (const [label, raw] of cases) {
    it(`parses: ${label}`, () => {
      const result = parseStructuredOutput(raw, Schema.passthrough());
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data.a).toBe(1);
    });
  }

  it('returns top-level arrays', () => {
    expect(JSON.parse(extractJsonCandidate('Result: [1, [2, 3]] done'))).toEqual([1, [2, 3]]);
  });

  it('keeps truncated JSON intact so the parse error is informative', () => {
    expect(extractJsonCandidate('prefix {"a": [1, 2')).toBe('{"a": [1, 2');
    expect(parseStructuredOutput('{"a": [1, 2', Schema)).toMatchObject({ ok: false });
  });

  it('keeps stripMarkdownFences as an alias', () => {
    expect(stripMarkdownFences('```json\n{"a":1}\n```\nDone.')).toBe('{"a":1}');
  });

  it('finds the matching close bracket honouring strings and mismatches', () => {
    expect(findBalancedJsonEnd('{"x":"]}"} tail', 0)).toBe(9);
    expect(findBalancedJsonEnd('{"x":[1}', 0)).toBe(-1);
  });
});

describe('buildRepairMessage', () => {
  it('quotes only a short tail of long rejected output', () => {
    const raw = `{"a":"${'x'.repeat(10_000)}END"`;
    const message = buildRepairMessage('Big', 'problem here', raw);
    expect(message).toContain('problem here');
    expect(message).toContain('END');
    expect(message.length).toBeLessThan(1_000);
  });
});

describe('runStructuredRepairLoop', () => {
  const base = { model: 'm', schema: Schema, schemaName: 'S', baseMessages: [{ role: 'user' as const, content: 'go' }] };

  it('retries truncation once with a doubled budget without schema repair', async () => {
    const budgets: number[] = [];
    const result = await runStructuredRepairLoop({
      ...base,
      call: async (messages, maxTokens) => {
        budgets.push(maxTokens);
        expect(messages).toHaveLength(1);
        return budgets.length === 1 ? { raw: '{"a":', truncated: true } : { raw: '{"a":1}', truncated: false };
      },
    });
    expect(result).toEqual({ a: 1 });
    expect(budgets).toEqual([8192, 16384]);
  });

  it('throws LLMOutputTruncatedError when the retry is truncated too, capped at 16384', async () => {
    const budgets: number[] = [];
    const error = await runStructuredRepairLoop({
      ...base,
      maxOutputTokens: 12_000,
      call: async (_messages, maxTokens) => {
        budgets.push(maxTokens);
        return { raw: '{"a":', truncated: true };
      },
    }).catch((caught: unknown) => caught);
    expect(budgets).toEqual([12_000, 16_384]);
    expect(error).toBeInstanceOf(LLMOutputTruncatedError);
    expect(error).toMatchObject({ name: 'LLMOutputTruncatedError', maxOutputTokens: 16_384, rawLength: 5 });
    expect((error as Error).message).toMatch(/16384-token output limit/);
    expect((error as Error).message).toMatch(/MLX_MAX_TOKENS|maxOutputTokens/);
  });

  it('keeps repair context bounded and stops after 3 attempts', async () => {
    const sizes: number[] = [];
    const big = `{"b":"${'y'.repeat(9_000)}"}`;
    const error = await runStructuredRepairLoop({
      ...base,
      call: async (messages) => {
        sizes.push(messages.reduce((sum, turn) => sum + turn.content.length, 0));
        return { raw: big, truncated: false };
      },
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(LLMStructuredOutputError);
    expect(sizes).toHaveLength(3);
    expect(Math.max(...sizes)).toBeLessThan(2_000);
  });

  it('stops between attempts when the signal aborts', async () => {
    const controller = new AbortController();
    let calls = 0;
    await expect(
      runStructuredRepairLoop({
        ...base,
        signal: controller.signal,
        call: async () => {
          calls += 1;
          controller.abort();
          return { raw: 'nope', truncated: false };
        },
      }),
    ).rejects.toThrow(/cancelled/);
    expect(calls).toBe(1);
  });
});

describe('extractJsonCandidate with prose brackets before the answer', () => {
  it('returns the real object, not a "PAGE [3]" citation that parses first', () => {
    const raw = 'Based on PAGE [3] and PAGE [4], here is the result:\n{"title":"Unit","pages":[3,4]}';
    expect(JSON.parse(extractJsonCandidate(raw))).toEqual({ title: 'Unit', pages: [3, 4] });
  });

  it('prefers the schema root type on a tie and keeps a lone array answer', () => {
    // The schema's root type wins; among spans of the same type the longest wins.
    expect(extractJsonCandidate('[1,2,3,4,5,6] {"a":1}', 'object')).toBe('{"a":1}');
    expect(extractJsonCandidate('{"a":1,"b":2} [1,2]', 'array')).toBe('[1,2]');
    expect(extractJsonCandidate('[1] [1,2,3]', 'array')).toBe('[1,2,3]');
    expect(extractJsonCandidate('[1] {"a":1}')).toBe('{"a":1}');
    expect(extractJsonCandidate('Here: [{"id":"x"}]')).toBe('[{"id":"x"}]');
  });

  it('parseStructuredOutput uses the schema root type', () => {
    const parsed = parseStructuredOutput('see [7] then {"n":1}', z.object({ n: z.number() }));
    expect(parsed.ok).toBe(true);
  });
});

describe('extractJsonCandidate never prefers an inner array over a parseable outer object', () => {
  const cards = '{"briefingCards":[{"headline":"A","doList":["x","y","z","a long inner string list"],"dontList":["no"]},{"headline":"B","doList":["p"]}]}';

  it('returns the whole object (inner doList arrays are never candidates)', () => {
    expect(extractJsonCandidate(`Here are the cards:\n${cards}\nDone.`, 'object')).toBe(cards);
    expect(extractJsonCandidate(cards)).toBe(cards);
  });

  it('with a malformed outer object, an object span still beats a longer inner string array', () => {
    const broken = '{"briefingCards":[{"headline":"A" "doList":["a very long string","another long string","and a third long string"]}, {"headline":"B"}';
    expect(extractJsonCandidate(broken, 'object')).toBe('{"headline":"B"}');
  });

  it('keeps the unclosed-judge case: only an array is parseable, so the array is returned', () => {
    const judge = '{"criterionResults":[{"criterionId":"c1","score":100},{"summaryFeedback":"s"}]';
    expect(extractJsonCandidate(judge, 'object')).toBe('[{"criterionId":"c1","score":100},{"summaryFeedback":"s"}]');
  });
});
