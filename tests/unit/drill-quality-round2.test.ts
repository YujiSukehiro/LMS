import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/firebase/admin', () => ({ adminDb: {} }));
vi.mock('@/lib/services/source-store', () => ({ loadSourceReview: vi.fn() }));
vi.mock('@/lib/ai/gateway', () => ({ getActiveAiRuntime: vi.fn(), getLLMGateway: vi.fn() }));
import {
  buildDrillGenerationSchema,
  buildRegenerateDrillUserPrompt,
  buildUnitDrillBatchSchema,
  dropRepeatedDrills,
  explanationProblems,
  finalizeDrill,
  inventedNumbers,
  isNearDuplicateDrill,
  type UnitBuildContext,
  type UnitPromptInput,
} from '@/lib/ai/prompts/unit-builder';
import { bestSupportingSentence, evidenceProblems, finalizeEvidenceProposals, rankSupportingSentences, STRICT_GROUNDING } from '@/lib/ai/prompts/evidence';
import { SourcePageEvidenceSchema } from '@/lib/schemas/source-truth';
import type { DrillItem } from '@/lib/schemas/curriculum';

const pageText = [
  'Wasn\'t sure which plan to pick → Anchor the recommended bundle proactively.',
  'The 3-month bundle is $297, about $99 a month, and it lines up with the clinical window.',
  'Critical: name / email / phone are only collected on the final step of the quiz.',
  'Leads who drop earlier are unreachable.',
].join('\n');
const page = SourcePageEvidenceSchema.parse({
  id: 'doc-p4', documentId: 'doc', revisionId: 'doc-rev', pageNumber: 4, rawText: pageText, normalizedText: pageText,
  contentHash: `sha256:${'d'.repeat(64)}`, characterCount: pageText.length, extractionFlags: [], transcription: null, approvedExcerpts: [],
});
const source = { pages: [page], conflicts: [] };
const ctx: UnitBuildContext = { pillarIds: ['p'], allowedPages: [4], requireEvidence: true, evidenceSource: source };
const exact = [{ claim: 'The bundle costs $297.', excerpts: [{ pageNumber: 4, exactText: 'The 3-month bundle is $297, about $99 a month, and it lines up with the clinical window.' }] }];
const base = { competencyPillarId: 'p', prompt: 'Which is right?', sourcePages: [4], evidence: exact };

const issues = (drill: Record<string, unknown>, context: UnitBuildContext = ctx) => {
  const result = buildUnitDrillBatchSchema(context, [drill.kind as DrillItem['kind']]).safeParse({ drills: [drill] });
  return result.success ? [] : result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
};

describe('paraphrased evidence', () => {
  const paraphrase = [{ claim: 'Only leads who complete the quiz are contactable.', excerpts: [{ pageNumber: 4, exactText: 'Only leads who complete the quiz are contactable.' }] }];

  it('the repair message offers the real source sentences that best match the claim', () => {
    const [problem] = evidenceProblems(paraphrase, source, [4]);
    expect(problem.message).toContain('Pick ONE of these exact source sentences');
    expect(problem.message).toContain('"Critical: name / email / phone are only collected on the final step of the quiz."');
    expect(rankSupportingSentences('leads quiz contactable final step', [4], source)[0].sentence).toMatch(/final step|drop earlier/);
  });

  it('server-side grounding replaces a paraphrase only above the strict threshold', () => {
    const strong = [{ claim: 'Bundle price', excerpts: [{ pageNumber: 4, exactText: 'The 3-month bundle costs $297 or about $99 a month, matching the clinical window.' }] }];
    const [grounded] = finalizeEvidenceProposals(strong, 'u1-d1', { source, allowedLabels: [4] })!;
    expect(grounded.support).toBe('supported');
    expect(grounded.excerpts[0].exactText).toBe('The 3-month bundle is $297, about $99 a month, and it lines up with the clinical window.');
    expect(grounded.approvalStatus).toBe('draft');
    const [weak] = finalizeEvidenceProposals(paraphrase, 'u7-d5', { source, allowedLabels: [4] })!;
    expect(weak.support).not.toBe('supported');
    expect(bestSupportingSentence('Only leads who complete the quiz are contactable.', [4], source, STRICT_GROUNDING)).toBeNull();
  });
});

describe('explanations that contradict the answer key', () => {
  const steps = [{ text: 'Mention the 3-month bundle' }, { text: 'Discuss the 1-month plan' }, { text: 'Mention that offers may vary' }];
  it('rejects a SEQUENCE explanation that lists a different order', () => {
    const drill = { ...base, kind: 'SEQUENCE_ORDER', orderedSteps: steps, explanation: 'The correct order is 1, 3, 2.' };
    expect(issues(drill).join(' ')).toMatch(/lists the order "1, 3, 2"/);
    const reversed = { ...drill, explanation: 'First discuss the 1-month plan, then mention the 3-month bundle.' };
    expect(explanationProblems(reversed as never).join(' ')).toMatch(/different order/);
    expect(issues({ ...drill, explanation: 'Anchor first, then compare, then set expectations.' })).toEqual([]);
  });

  it('rejects an MCQ explanation that supports a wrong option', () => {
    const drill = {
      ...base,
      kind: 'MULTIPLE_CHOICE',
      options: [{ id: 'a', text: 'Offer a ten percent discount' }, { id: 'b', text: 'Anchor the recommended bundle proactively' }, { id: 'c', text: 'End the call' }, { id: 'd', text: 'Send a coupon' }],
      correctOptionId: 'b',
      explanation: 'You should offer a ten percent discount to close the sale.',
    };
    expect(issues(drill).join(' ')).toMatch(/supports option "a"/);
    expect(issues({ ...drill, explanation: 'The Playbook says to anchor the recommended bundle proactively.' })).toEqual([]);
  });

  it('flags invented numbers in an explanation', () => {
    const drill = { ...base, kind: 'TRUE_FALSE_SPOT', statement: 'The agent anchors the bundle.', isCompliant: true, explanation: 'The bundle saves 40% versus $297 monthly.' };
    expect(inventedNumbers(drill.explanation, drill as never, source)).toEqual(['40%']);
    expect(issues(drill).join(' ')).toMatch(/"40%"/);
    expect(issues({ ...drill, explanation: 'At $297, about $99 a month, it fits the clinical window.' })).toEqual([]);
  });
});

describe('duplicates across Checkpoints', () => {
  const tf = (id: string, statement: string) =>
    finalizeDrill({ ...base, evidence: undefined, kind: 'TRUE_FALSE_SPOT', statement, isCompliant: false, explanation: 'x' } as never, id, { ...ctx, requireEvidence: false, evidenceSource: undefined });
  it('treats near-identical Drills as duplicates and drops them across Units', () => {
    const earlier = tf('u5-d3', "Your prescription is ready to ship after the physician review.");
    const later = tf('u8-d3', "Is your prescription ready to ship after physician review");
    const different = tf('u8-d5', 'The agent self-identifies at the start of every call.');
    expect(isNearDuplicateDrill(earlier, later)).toBe(true);
    expect(dropRepeatedDrills([earlier], [later, different]).map((drill) => drill.id)).toEqual(['u8-d5']);
  });

  it('sends a repeat of an earlier Drill back for repair', () => {
    const earlier = tf('u5-d3', 'Your prescription is ready to ship after the physician review.');
    const drill = { ...base, kind: 'TRUE_FALSE_SPOT', statement: 'Your prescription is ready to ship after the physician review.', isCompliant: false, explanation: 'Never say it.' };
    expect(issues(drill, { ...ctx, avoidDrills: [earlier] }).join(' ')).toMatch(/repeats an existing Drill/);
  });
});

describe('MATCH_PAIRS sides', () => {
  const long = 'The lead says the 3-month plan is the most popular at $297 which is $99 per month and asks which plan';
  const pairs = [{ leftPrompt: long, rightMatch: 'Anchor the bundle' }, { leftPrompt: 'Price question', rightMatch: 'Per-month math' }, { leftPrompt: 'Quiz drop-off', rightMatch: 'Unreachable lead' }];
  it('repairs an over-long side instead of truncating it, and drops it if it still comes back', () => {
    expect(issues({ ...base, kind: 'MATCH_PAIRS', pairs, explanation: 'x' }).join(' ')).toMatch(/pairs\.0\.leftPrompt: Shorten/);
    expect(() => finalizeDrill({ ...base, kind: 'MATCH_PAIRS', pairs, explanation: 'x' } as never, 'u2-d5', ctx)).toThrow(/longer than 100/);
  });
});

describe('regenerate with a trainer hint', () => {
  const input = {
    trackTitle: 'T', campaignCode: 'C', divisionId: 'OUTBOUND', globalSummary: '', pillars: [{ id: 'p', name: 'P', description: 'd' }],
    outline: { id: 'u2', orderIndex: 1, title: 'U', summary: 's', focus: 'f', sourcePages: [4], pillarIds: ['p'] },
    pages: [{ pageNumber: 4, text: pageText }], otherUnitTitles: [],
  } as unknown as UnitPromptInput;
  const current = finalizeDrill(
    { ...base, kind: 'FILL_BLANK_CHOICE', sentenceTemplate: 'The bundle is {{BLANK}}.', wordBank: ['$297', '$169', '$99', '$49'], correctWord: '$297', explanation: 'It is $297.' } as never,
    'u2-d1',
    ctx,
  );
  it('puts the hint first as a hard requirement and does not paste the whole current Drill', () => {
    const prompt = buildRegenerateDrillUserPrompt({ ...input, current, siblingPrompts: [], trainerHint: 'Blank the per-month price.' });
    expect(prompt.startsWith('TRAINER REQUIREMENT (must follow')).toBe(true);
    expect(prompt).not.toContain('"wordBank"');
  });
  it('rejects the current Drill returned unchanged', () => {
    const schema = buildDrillGenerationSchema('FILL_BLANK_CHOICE', { ...ctx, replacing: current });
    const same = { ...base, kind: 'FILL_BLANK_CHOICE', sentenceTemplate: 'The bundle is {{BLANK}}.', wordBank: ['$297', '$169', '$99', '$49'], correctWord: '$297', explanation: 'It is $297.' };
    const result = schema.safeParse(same);
    expect(result.success).toBe(false);
    expect(schema.safeParse({ ...same, sentenceTemplate: 'The 3-month bundle is about {{BLANK}} a month.', correctWord: '$99', explanation: 'About $99 a month.' }).success).toBe(true);
  });
});

describe('cross-Checkpoint repeats never fail a build', () => {
  it('restores only as many repeats as the Checkpoint needs to reach its minimum', async () => {
    const { restoreRepeatsToMinimum } = await import('@/lib/ai/pipeline/generate-track');
    expect(restoreRepeatsToMinimum(['a', 'b'], ['r1', 'r2', 'r3'], 4)).toEqual(['r1', 'r2']);
    expect(restoreRepeatsToMinimum(['a', 'b', 'c', 'd'], ['r1'], 4)).toEqual([]);
    expect(restoreRepeatsToMinimum([], ['r1'], 4)).toEqual(['r1']);
  });

  it('MCQs with the same generic stem but different right answers are not duplicates', () => {
    const mc = (correct: string) => ({ kind: 'MULTIPLE_CHOICE' as const, prompt: 'Which of the following is the correct way to handle this objection?', options: [{ id: 'a', text: correct }, { id: 'b', text: 'Hang up' }], correctOptionId: 'a' });
    expect(isNearDuplicateDrill(mc('Use the per-month math and the 90-day guarantee'), mc('Pass the request to the care team'))).toBe(false);
    expect(isNearDuplicateDrill(mc('Use the per-month math'), mc('Use the per-month math'))).toBe(true);
  });
});

describe('Drill kind coercion', () => {
  it('maps 7B kind aliases and infers a missing kind from unambiguous fields', async () => {
    const { coerceDrillShape } = await import('@/lib/ai/prompts/unit-builder');
    expect((coerceDrillShape({ kind: 'true/false', statement: 's', isCompliant: true }) as { kind: string }).kind).toBe('TRUE_FALSE_SPOT');
    expect((coerceDrillShape({ kind: 'Fill in the blank' }) as { kind: string }).kind).toBe('FILL_BLANK_CHOICE');
    expect((coerceDrillShape({ kind: 'drill', pairs: [] }) as { kind: string }).kind).toBe('MATCH_PAIRS');
    expect((coerceDrillShape({ kind: 'drill', pairs: [], orderedSteps: [] }) as { kind: string }).kind).toBe('DRILL');
  });
});

describe('hosted-provider pipeline notes', () => {
  it('serializes only local runtimes, labels hosted provenance as hosted, and skips content blocks', async () => {
    const { limiterFor, unlimitedLimiter, runtimeProfileId, isSkippableItemError } = await import('@/lib/ai/pipeline/generate-track');
    expect(limiterFor('gemini')).toBe(unlimitedLimiter);
    expect(limiterFor('openai_compatible')).not.toBe(unlimitedLimiter);
    expect(runtimeProfileId('openai_compatible')).toBe('openai_compatible-local');
    expect(runtimeProfileId('replay')).toBe('replay-local');
    expect(runtimeProfileId('gemini')).toBe('gemini-hosted');
    const blocked = Object.assign(new Error('SAFETY'), { name: 'LLMContentBlockedError' });
    expect(isSkippableItemError(blocked)).toBe(true);
    expect(isSkippableItemError(new Error('network'))).toBe(false);
    await expect(Promise.all([unlimitedLimiter.run(async () => 1), unlimitedLimiter.run(async () => 2)])).resolves.toEqual([1, 2]);
  });
});

describe('false positives found by the R2 build', () => {
  it('allows an explanation to name the wrong number the Drill itself shows', () => {
    const drill = { ...base, kind: 'TRUE_FALSE_SPOT', statement: 'The 3-month plan costs $199 per month.', isCompliant: false, explanation: 'Not compliant: it is $297, not $199.' };
    expect(inventedNumbers(drill.explanation, drill as never, source)).toEqual([]);
  });

  it('does not treat a verbatim Playbook quote containing a distractor as endorsement', () => {
    const drill = {
      ...base,
      kind: 'MULTIPLE_CHOICE',
      options: [{ id: 'a', text: '$297 for three months' }, { id: 'b', text: 'about $99 a month' }, { id: 'c', text: '$169' }, { id: 'd', text: '$49' }],
      correctOptionId: 'a',
      explanation: 'The Playbook says: “The 3-month bundle is $297, about $99 a month, and it lines up with the clinical window.”',
    };
    expect(explanationProblems(drill as never)).toEqual([]);
  });
});

describe('blueprint repeats', () => {
  it('merges repeated Unit outlines into the first one, keeping their pages', async () => {
    const { mergeRepeatedUnits } = await import('@/lib/ai/prompts/blueprint');
    const unit = (title: string, pages: number[]) => ({ title, summary: 's', focus: 'f', sourcePages: pages, pillarKeys: ['k'] });
    const merged = mergeRepeatedUnits([unit('Product', [3]), unit('Dosage Abandon Call Flow', [6]), unit('Checkout', [8]), unit('Dosage abandon call-flow', [6, 7])]);
    expect(merged.map((item) => item.title)).toEqual(['Product', 'Dosage Abandon Call Flow', 'Checkout']);
    expect(merged[1].sourcePages).toEqual([6, 7]);
    expect(mergeRepeatedUnits([unit('Same', [1]), unit('Same', [2])])).toHaveLength(2);
  });
});

describe('blueprint pillar keys', () => {
  it('accepts a Unit without a chosen pillar key (finalize falls back) but not a blueprint with none', async () => {
    const { buildBlueprintSchema, finalizeBlueprint } = await import('@/lib/ai/prompts/blueprint');
    const schema = buildBlueprintSchema(4, { min: 2, max: 4 });
    const unit = (title: string, pillarKeys: string[]) => ({ title, summary: 'Summary text', focus: 'Focus on the rules', sourcePages: [1], pillarKeys });
    const blueprint = {
      campaignCode: 'TEST',
      globalSummary: 'x'.repeat(100),
      competencyPillars: ['compliance_boundaries', 'workflow_execution', 'retention_objection', 'empathy_communication'].map((key) => ({ key, label: `Pillar ${key}`, description: 'What the agent must do well.' })),
    };
    const parsed = schema.safeParse({ ...blueprint, units: [unit('Unit A', ['compliance_boundaries']), unit('Unit B', ['closing_next_steps'])] });
    expect(parsed.success ? [] : parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`)).toEqual([]);
    if (parsed.success) expect(finalizeBlueprint(parsed.data, 4).units[1].pillarIds).toHaveLength(1);
    expect(schema.safeParse({ ...blueprint, units: [unit('Unit A', ['closing_next_steps']), unit('Unit B', ['closing_next_steps'])] }).success).toBe(false);
  });
});

describe('Sim rubric evidence without a claim', () => {
  it('fills the missing claim from the criterion evaluation rule', async () => {
    const { fillRubricEvidenceClaims } = await import('@/lib/ai/prompts/sim-builder');
    const filled = fillRubricEvidenceClaims({
      criterionLabel: 'Anchor',
      evaluationRule: 'The agent anchors on the 3-month bundle.',
      evidence: [{ excerpts: [{ pageNumber: 3, exactText: 'Anchor on the 3-month bundle' }] }, { claim: 'Kept', excerpts: [] }],
    }) as { evidence: Array<{ claim: string }> };
    expect(filled.evidence.map((item) => item.claim)).toEqual(['The agent anchors on the 3-month bundle.', 'Kept']);
  });
});

describe('salvage with a broken wrapper', () => {
  it('recovers every parseable card when the {"briefingCards": [...]} wrapper does not parse', async () => {
    const { parseableItemObjects, salvageCards } = await import('@/lib/ai/prompts/unit-builder');
    const card = (headline: string) => JSON.stringify({ headline, bodyMarkdown: 'Body with a } brace and "quotes".', keyTakeaway: 'k', doList: ['a', 'b'], dontList: ['c', 'd'], sourcePages: [4], evidence: exact });
    const raw = `{\n  "briefingCards": [\n    ${card('First rule')},\n    ${card('Second rule')},\n    {"headline": "Broken", "bodyMarkdown": "unterminated\n  ]`;
    expect(parseableItemObjects(raw, 'headline').map((item) => item.headline)).toEqual(['First rule', 'Second rule']);
    const salvaged = salvageCards(raw, ctx, (index) => `u2-c${index + 1}`);
    expect(salvaged.items.map((item) => item.headline)).toEqual(['First rule', 'Second rule']);
  });
});
