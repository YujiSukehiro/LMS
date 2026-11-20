import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/firebase/admin', () => ({ adminDb: {} }));
vi.mock('@/lib/services/source-store', () => ({ loadSourceReview: vi.fn() }));
vi.mock('@/lib/ai/gateway', () => ({ getActiveAiRuntime: vi.fn(), getLLMGateway: vi.fn() }));

const { withFreshAttempt, generateOrSalvage, FRESH_ATTEMPT_TEMPERATURE } = await import('@/lib/ai/pipeline/generate-track');
const { cardsTopUpPlan, buildUnitCardsUserPrompt, spelledNumbers, inventedNumbers } = await import('@/lib/ai/prompts/unit-builder');
const { SourcePageEvidenceSchema } = await import('@/lib/schemas/source-truth');

const structuredError = (raw: string) => Object.assign(new Error('bad JSON'), { name: 'LLMStructuredOutputError', lastRawOutput: raw });

describe('one fresh attempt after a failed repair loop', () => {
  it('retries once at a lower temperature, and only for output errors', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const calls: Array<number | undefined> = [];
    const result = await withFreshAttempt(async (temperature) => {
      calls.push(temperature);
      if (calls.length === 1) throw structuredError('{');
      return 'ok';
    }, { trackId: 't', stage: 's' });
    expect(result).toBe('ok');
    expect(calls).toEqual([undefined, FRESH_ATTEMPT_TEMPERATURE]);

    let count = 0;
    await expect(withFreshAttempt(async () => { count++; throw structuredError('{'); }, { trackId: 't', stage: 's' })).rejects.toThrow('bad JSON');
    expect(count).toBe(2);

    count = 0;
    await expect(withFreshAttempt(async () => { count++; throw new Error('network'); }, { trackId: 't', stage: 's' })).rejects.toThrow('network');
    expect(count).toBe(1);
  });

  it('generateOrSalvage makes a clean second call when the first answer cannot be salvaged', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const temperatures: Array<number | undefined> = [];
    const gateway = {
      generateStructured: vi.fn(async (opts: { temperature?: number }) => {
        temperatures.push(opts.temperature);
        if (temperatures.length === 1) throw structuredError('not json at all');
        return { items: ['a'] };
      }),
    };
    const result = await generateOrSalvage(gateway as never, { tier: 'heavy', systemPrompt: 's', userPrompt: 'u', schema: {} as never, schemaName: 'X', maxOutputTokens: 10 }, {
      lenient: null,
      finalize: (output: { items: string[] }) => output.items,
      salvage: () => ({ items: [], dropped: ['unreadable'] }),
      allowEmpty: false,
      log: { trackId: 't', stage: 'unit:u2:cards' },
    } as never);
    expect(result.items).toEqual(['a']);
    expect(temperatures).toEqual([undefined, FRESH_ATTEMPT_TEMPERATURE]);
  });
});

describe('cards top-up', () => {
  it('asks for exactly the missing cards and lists the cards already written', () => {
    const plan = cardsTopUpPlan({ cards: { min: 3, target: 4, max: 5 }, drills: { min: 5, target: 6, max: 7 }, ruleSignals: 6 }, 2);
    expect(plan.cards).toEqual({ min: 2, target: 2, max: 2 });
    const prompt = buildUnitCardsUserPrompt({
      trackTitle: 'T', campaignCode: 'C', divisionId: 'OUTBOUND', globalSummary: '', pillars: [{ id: 'p', key: 'k', label: 'P', description: 'd' }],
      outline: { id: 'u7', orderIndex: 6, title: 'U', summary: 's', focus: 'f', sourcePages: [12], pillarIds: ['p'], contentPlan: plan },
      pages: [{ pageNumber: 12, text: 'Rule text.' }], otherUnitTitles: [], existingHeadlines: ['Get the verbal yes'],
    } as never);
    expect(prompt).toContain('already written for this Unit (teach OTHER rules): Get the verbal yes');
    expect(prompt).toContain('Write exactly 2 more BriefingCards');
  });
});

describe('spelled-out numbers on the source page', () => {
  it('reads number words, so "40%" matching "forty-percent" is not called invented', () => {
    expect(spelledNumbers('roughly a forty-percent saving, about ninety-nine dollars, two hundred leads')).toEqual(['40', '99', '200']);
    const text = 'The three-month is $297, about ninety-nine dollars a month, roughly a forty-percent saving per month.';
    const page = SourcePageEvidenceSchema.parse({
      id: 'p10', documentId: 'doc', revisionId: 'rev', pageNumber: 10, rawText: text, normalizedText: text,
      contentHash: `sha256:${'e'.repeat(64)}`, characterCount: text.length, extractionFlags: [], transcription: null, approvedExcerpts: [],
    });
    const drill = { sourcePages: [10], evidence: [], kind: 'FILL_BLANK_CHOICE', wordBank: ['40%', '20%'], correctWord: '40%' };
    expect(inventedNumbers('The bundle saves 40% per month.', drill as never, { pages: [page], conflicts: [] })).toEqual([]);
    expect(inventedNumbers('The bundle saves 55% per month.', drill as never, { pages: [page], conflicts: [] })).toEqual(['55%']);
  });
});

describe('fresh attempt after a truncated answer', () => {
  it('raises the output limit only when the first answer hit it', async () => {
    const { freshAttemptOptions, TRUNCATION_RETRY_TOKEN_FACTOR } = await import('@/lib/ai/pipeline/generate-track');
    const truncated = Object.assign(new Error('cut'), { name: 'LLMOutputTruncatedError' });
    expect(freshAttemptOptions({ maxOutputTokens: 1760 }, 0.1, truncated)).toEqual({ maxOutputTokens: Math.ceil(1760 * TRUNCATION_RETRY_TOKEN_FACTOR), temperature: 0.1 });
    expect(freshAttemptOptions({ maxOutputTokens: 1760 }, 0.1, structuredError('{'))).toEqual({ maxOutputTokens: 1760, temperature: 0.1 });
  });
});
