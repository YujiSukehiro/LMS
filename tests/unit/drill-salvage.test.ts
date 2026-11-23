import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  buildUnitDrillBatchSchema,
  coerceDrillShape,
  salvageCards,
  salvageDrillBatch,
  type UnitBuildContext,
} from '@/lib/ai/prompts/unit-builder';
import { thinUnitProblems } from '@/lib/ai/pipeline/content-depth';
import { LLMStructuredOutputError, type LLMGateway } from '@/lib/ai/types';
import { TrackUnitSchema } from '@/lib/schemas/curriculum';
import { SourcePageEvidenceSchema } from '@/lib/schemas/source-truth';

vi.mock('@/lib/firebase/admin', () => ({ adminDb: {} }));
vi.mock('@/lib/services/source-store', () => ({ loadSourceReview: vi.fn() }));
vi.mock('@/lib/ai/gateway', () => ({ getActiveAiRuntime: vi.fn(), getLLMGateway: vi.fn() }));

const { generateOrSalvage, shortfallNotes, topUpDrillKinds } = await import('@/lib/ai/pipeline/generate-track');

const pageText = 'Agents must honor opt-out requests immediately. Never promise a cure or a fixed result.';
const page = SourcePageEvidenceSchema.parse({
  id: 'doc-p3', documentId: 'doc', revisionId: 'doc-rev', pageNumber: 3, rawText: pageText, normalizedText: pageText,
  contentHash: `sha256:${'c'.repeat(64)}`, characterCount: pageText.length, extractionFlags: [], transcription: null, approvedExcerpts: [],
});
const ctx: UnitBuildContext = {
  pillarIds: ['pillar_compliance_boundaries'],
  allowedPages: [3],
  requireEvidence: true,
  evidenceSource: { pages: [page], conflicts: [] },
};
const evidence = [{ claim: 'Honor opt-out immediately.', excerpts: [{ pageNumber: 3, exactText: 'Agents must honor opt‑out requests immediately.' }] }];
const base = { competencyPillarId: 'pillar_compliance_boundaries', prompt: 'What does the agent do?', sourcePages: [3], evidence };

const validMc = {
  ...base, kind: 'MULTIPLE_CHOICE', explanation: 'The Playbook requires immediate opt-out handling.',
  options: [{ id: 'a', text: 'Stop calling now.' }, { id: 'b', text: 'Call again tomorrow.' }, { id: 'c', text: 'Ask a manager first.' }, { id: 'd', text: 'Ignore it.' }],
  correctOptionId: 'a',
};
const shortPairs = { ...base, kind: 'MATCH_PAIRS', explanation: 'x', pairs: [{ leftPrompt: 'Opt out', rightMatch: 'Stop' }, { leftPrompt: 'Cure', rightMatch: 'Never promise' }] };
const noExplanationTf = { ...base, kind: 'true_false_spot', statement: 'The agent keeps calling after an opt-out.', isCompliant: 'false' };

describe('drill batch salvage', () => {
  it('coerces near-miss shapes without changing meaning', () => {
    const coerced = coerceDrillShape({
      kind: 'multiple choice', options: ['Stop', 'Continue', 'Wait', 'Ignore'], correctOptionId: 'Stop', isCompliant: 'yes', explanation: '  ', sourcePages: '3',
    }) as Record<string, unknown>;
    expect(coerced.kind).toBe('MULTIPLE_CHOICE');
    expect(coerced.options).toEqual([{ id: 'a', text: 'Stop' }, { id: 'b', text: 'Continue' }, { id: 'c', text: 'Wait' }, { id: 'd', text: 'Ignore' }]);
    expect(coerced.correctOptionId).toBe('a');
    expect(coerced.isCompliant).toBe(true);
    expect(coerced).not.toHaveProperty('explanation');
    expect(coerced.sourcePages).toEqual([3]);
  });

  it('accepts a Drill with no explanation in the model schema', () => {
    const schema = buildUnitDrillBatchSchema({ ...ctx, strictEvidence: false }, ['TRUE_FALSE_SPOT']);
    expect(schema.safeParse({ drills: [noExplanationTf] }).success).toBe(true);
  });

  it('keeps the valid Drills of a batch, drops the malformed one, and fills a missing explanation from evidence', () => {
    const raw = `Here you go:\n${JSON.stringify({ drills: [validMc, shortPairs, noExplanationTf] })}`;
    const result = salvageDrillBatch(raw, ctx, ['MULTIPLE_CHOICE', 'MATCH_PAIRS', 'TRUE_FALSE_SPOT'], (index) => `u2-d${index + 1}`);
    expect(result.items.map((drill) => drill.kind)).toEqual(['MULTIPLE_CHOICE', 'TRUE_FALSE_SPOT']);
    expect(result.items.map((drill) => drill.id)).toEqual(['u2-d1', 'u2-d2']);
    expect(result.dropped.join(' ')).toMatch(/drills\.1\.pairs/);
    const tf = result.items[1];
    expect(tf.explanation).toContain('The Playbook (page 3) says:');
    expect(tf.explanation).toContain('Agents must honor opt-out requests immediately.');
    // Evidence is resolved server-side to the exact source substring and document identity.
    expect(tf.evidence?.[0]).toMatchObject({ support: 'supported', approvalStatus: 'draft', excerpts: [{ documentId: 'doc', revisionId: 'doc-rev', pageNumber: 3 }] });
  });

  it('salvages valid cards and drops a card that misses required fields', () => {
    const card = {
      headline: 'Honor opt-out', bodyMarkdown: 'Stop calling when asked.', keyTakeaway: 'Opt-out is immediate.',
      doList: 'Stop calling.', dontList: ['Do not argue.'], sourcePages: [3], evidence,
    };
    const result = salvageCards(JSON.stringify({ briefingCards: [card, { ...card, headline: undefined }] }), ctx, (index) => `u2-c${index + 1}`);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ id: 'u2-c1', doList: ['Stop calling.'] });
    expect(result.dropped[0]).toMatch(/briefingCards\.1\.headline/);
  });

  it('salvages after a failed repair loop and rethrows when nothing is usable and the batch may not be empty', async () => {
    const failing = (raw: string): LLMGateway => ({
      providerName: 'openai_compatible',
      generateStructured: async () => { throw new LLMStructuredOutputError('Model failed. - drills.1.pairs: too few', 'TrackUnitDrills', 3, raw); },
      streamChat: async function* () { yield ''; },
      healthCheck: async () => ({ ok: true, provider: 'x', models: [] }),
    });
    const kinds = ['MULTIPLE_CHOICE', 'MATCH_PAIRS'] as const;
    const opts = { tier: 'heavy' as const, systemPrompt: 's', userPrompt: 'u', schema: buildUnitDrillBatchSchema(ctx, kinds), schemaName: 'TrackUnitDrills', maxOutputTokens: 100 };
    const salvage = (raw: string) => salvageDrillBatch(raw, ctx, kinds, (index) => `u1-d${index + 1}`);
    const options = { lenient: null, finalize: () => [], salvage, allowEmpty: true, log: { trackId: 't', stage: 's' } };
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const kept = await generateOrSalvage(failing(JSON.stringify({ drills: [validMc, shortPairs] })), opts, options);
    expect(kept.items).toHaveLength(1);

    const empty = await generateOrSalvage(failing('not json'), opts, options);
    expect(empty.items).toHaveLength(0);
    await expect(generateOrSalvage(failing('not json'), opts, { ...options, allowEmpty: false })).rejects.toBeInstanceOf(LLMStructuredOutputError);
  });

  it('plans top-up kinds the Unit lacks and records trainer-visible shortfall notes', () => {
    expect(topUpDrillKinds([{ kind: 'MULTIPLE_CHOICE' }, { kind: 'TRUE_FALSE_SPOT' }], 2, 0)).not.toContain('MULTIPLE_CHOICE');
    expect(shortfallNotes(3, 2, 2, 4)).toEqual(['Needs more Drills: 2 written, 4 planned at minimum.']);
    expect(shortfallNotes(3, 2, 4, 4)).toEqual([]);
  });

  it('lets a draft Unit hold fewer Drills but blocks publishing below the curriculum minimums', () => {
    const drill = salvageDrillBatch(JSON.stringify({ drills: [validMc] }), ctx, ['MULTIPLE_CHOICE'], () => 'u1-d1').items[0];
    const card = salvageCards(JSON.stringify({ briefingCards: [{
      headline: 'h', bodyMarkdown: 'b', keyTakeaway: 'k', doList: [], dontList: [], sourcePages: [3], evidence,
    }] }), ctx, () => 'u1-c1').items[0];
    const unit = TrackUnitSchema.parse({
      id: 'u1', orderIndex: 0, title: 'Opt-out', summary: 'Opt-out rules.', estimatedMinutes: 2,
      briefingCards: [card, { ...card, id: 'u1-c2' }], drills: [drill], reviewNotes: shortfallNotes(2, 2, 1, 4),
    });
    expect(unit.reviewNotes).toHaveLength(1);
    expect(thinUnitProblems([unit])).toEqual(['Checkpoint 1 (Opt-out) has only 1 of 4 Drills.']);
    expect(thinUnitProblems([{ ...unit, drills: [drill, drill, drill, drill] }])).toEqual([]);
    expect(z.array(z.string()).safeParse(unit.reviewNotes).success).toBe(true);
  });
});

describe('Drill kind mix (review 2026-11-23)', () => {
  it('plans mostly scenario questions with at most one ordering and one matching Drill per Unit', async () => {
    const { planDrillKinds } = await import('@/lib/ai/prompts/unit-builder');
    for (const count of [4, 6, 8, 10]) {
      const kinds = planDrillKinds(count, 3);
      expect(kinds.filter((kind) => kind === 'SEQUENCE_ORDER').length).toBeLessThanOrEqual(1);
      expect(kinds.filter((kind) => kind === 'MATCH_PAIRS').length).toBeLessThanOrEqual(1);
      expect(new Set(kinds).size).toBeGreaterThanOrEqual(3);
    }
    expect(planDrillKinds(4)).not.toContain('SEQUENCE_ORDER');
  });

  it('lets a scenario question fill an ordering slot when the pages have no fixed order', () => {
    const schema = buildUnitDrillBatchSchema({ ...ctx, strictEvidence: false }, ['MULTIPLE_CHOICE', 'SEQUENCE_ORDER']);
    expect(schema.safeParse({ drills: [validMc, { ...validMc, prompt: 'A member asks to stop calls. What next?' }] }).success).toBe(true);
    // A planned MULTIPLE_CHOICE slot is still required.
    const strict = buildUnitDrillBatchSchema({ ...ctx, strictEvidence: false }, ['MULTIPLE_CHOICE', 'TRUE_FALSE_SPOT']);
    expect(strict.safeParse({ drills: [validMc, { ...validMc, prompt: 'Another' }] }).success).toBe(false);
  });
});
