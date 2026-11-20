import { describe, expect, it } from 'vitest';
import {
  buildUnitDrillBatchSchema,
  dropRepeatedDrills,
  finalizeDrill,
  type UnitBuildContext,
} from '@/lib/ai/prompts/unit-builder';
import { SourcePageEvidenceSchema } from '@/lib/schemas/source-truth';
import type { DrillItem } from '@/lib/schemas/curriculum';

const pageText = 'Stop on opt-out. Acknowledge, end the call, flag for permanent suppression. Safe phrasing: if approved your medication ships.';
const page = SourcePageEvidenceSchema.parse({
  id: 'doc-p11', documentId: 'doc', revisionId: 'doc-rev', pageNumber: 11, rawText: pageText, normalizedText: pageText,
  contentHash: `sha256:${'c'.repeat(64)}`, characterCount: pageText.length, extractionFlags: [], transcription: null, approvedExcerpts: [],
});
const ctx: UnitBuildContext = {
  pillarIds: ['pillar_compliance_boundaries'],
  allowedPages: [11],
  requireEvidence: true,
  evidenceSource: { pages: [page], conflicts: [] },
};
const base = {
  competencyPillarId: 'pillar_compliance_boundaries',
  prompt: 'What does the agent do?',
  explanation: 'The Playbook says so.',
  sourcePages: [11],
  evidence: [{ claim: 'Stop on opt-out.', excerpts: [{ pageNumber: 11, exactText: 'Stop on opt-out.' }] }],
};
const pairs = [
  { leftPrompt: 'Lead says stop calling', rightMatch: 'End the call and flag suppression' },
  { leftPrompt: 'Lead asks if approved', rightMatch: 'Use the safe phrasing' },
  { leftPrompt: 'Lead asks for a discount', rightMatch: 'Pass it to the care team' },
];

function problems(drill: Record<string, unknown>): string[] {
  const result = buildUnitDrillBatchSchema(ctx, [drill.kind as DrillItem['kind']]).safeParse({ drills: [drill] });
  return result.success ? [] : result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
}

describe('model-facing Drill shape checks (7B quality)', () => {
  it('rejects a raw {{BLANK}} token outside a FILL_BLANK_CHOICE template', () => {
    const bad = { ...base, kind: 'MATCH_PAIRS', pairs: [{ ...pairs[0], leftPrompt: "The lead says, '{{BLANK}}'" }, pairs[1], pairs[2]] };
    expect(problems(bad).join(' ')).toMatch(/pairs\.0\.leftPrompt: Remove \{\{BLANK\}\}/);
    expect(problems({ ...base, kind: 'MATCH_PAIRS', pairs })).toEqual([]);
  });

  it('rejects a TRUE_FALSE_SPOT statement written as a question', () => {
    const question = { ...base, kind: 'TRUE_FALSE_SPOT', statement: "Is it compliant to say 'Your prescription is ready'?", isCompliant: false };
    expect(problems(question).join(' ')).toMatch(/statement: .*not a question/);
    expect(problems({ ...question, statement: "Your prescription is ready to ship." })).toEqual([]);
  });

  it('rejects a word bank whose distractor also contains the correct word', () => {
    const fill = {
      ...base,
      kind: 'FILL_BLANK_CHOICE',
      sentenceTemplate: 'Safe phrasing: if {{BLANK}} your medication ships.',
      wordBank: ['approved', 'ready', 'shipping', 'approved, your medication ships.'],
      correctWord: 'approved',
    };
    expect(problems(fill).join(' ')).toMatch(/wordBank: A wrong word/);
    expect(problems({ ...fill, wordBank: ['approved', 'ready', 'shipping', 'reviewed'] })).toEqual([]);
    const phrases = { ...fill, wordBank: ['state the 3-month plan is the most popular', 'ready', 'shipping', 'approved'] };
    expect(problems(phrases).join(' ')).toMatch(/at most 4 words/);
    // Containment counts on word boundaries only: "15 minutes" does not contain the answer "5 minutes".
    expect(problems({ ...fill, sentenceTemplate: 'Call back within {{BLANK}}.', wordBank: ['5 minutes', '15 minutes', '1 hour', '2 days'], correctWord: '5 minutes' })).toEqual([]);
  });
});

describe('dropRepeatedDrills', () => {
  const steps = (id: string, texts: string[]) =>
    finalizeDrill({ ...base, evidence: undefined, kind: 'SEQUENCE_ORDER', orderedSteps: texts.map((text) => ({ text })) } as never, id, { ...ctx, requireEvidence: false });
  it('drops a later batch Drill that repeats an earlier one (ignoring case and punctuation)', () => {
    const first = steps('u8-d1', ["Acknowledge the lead's request", 'End the call', 'Flag the lead for permanent suppression']);
    const repeat = steps('u8-d4', ["Acknowledge the lead's request.", 'End the call.', 'Flag the lead for permanent suppression.']);
    const other = steps('u8-d5', ['Self-identify', 'Disclose recording', 'Confirm local time']);
    expect(dropRepeatedDrills([first], [repeat, other]).map((drill) => drill.id)).toEqual(['u8-d5']);
    expect(dropRepeatedDrills([], [first, repeat]).map((drill) => drill.id)).toEqual(['u8-d1']);
  });
});
