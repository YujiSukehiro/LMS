/** PDF self-contradiction check: only verbatim quotes survive, ids are stable, and decisions reach the Unit prompt. */
import { describe, expect, it, vi } from 'vitest';
import { SourcePageEvidenceSchema, SourceConflictSchema } from '@/lib/schemas/source-truth';

vi.mock('@/lib/firebase/admin', () => ({ adminDb: {} }));
vi.mock('@/lib/services/source-store', () => ({ loadSourceReview: vi.fn(), sourceConflictRef: vi.fn() }));
vi.mock('@/lib/ai/gateway', () => ({ getLLMGateway: vi.fn() }));

const { groundContradictions } = await import('@/lib/services/source-contradictions');
const { buildContradictionUserPrompt, formatConflictDecisions } = await import('@/lib/ai/prompts/contradiction-check');

function page(pageNumber: number, text: string) {
  return SourcePageEvidenceSchema.parse({
    id: `doc-p${pageNumber}`, documentId: 'doc', revisionId: 'doc-rev', pageNumber, rawText: text, normalizedText: text,
    contentHash: `sha256:${'d'.repeat(64)}`, characterCount: text.length, extractionFlags: [], transcription: null, approvedExcerpts: [],
  });
}
const pages = [
  page(7, "VOICEMAIL SCRIPT Hi there. I'll send you a text with your link so you can take a look when it's convenient. Take care!"),
  page(11, 'Never trigger a link send to voicemail. Voicemail = leave the script, do not invoke the "send link" action.'),
];
const voicemail = {
  rule: { page: 11, quote: 'Never trigger a link send to voicemail.' },
  conflicting: { page: 7, quote: "I'll send you a text with your link" },
  summary: 'The rule forbids links to voicemail but the script promises a text.',
  severity: 'critical' as const,
};

describe('groundContradictions', () => {
  it('keeps an item whose two quotes are on their pages, as an open conflict', () => {
    const { conflicts, dropped } = groundContradictions({ contradictions: [voicemail] }, pages, 't1');
    expect(dropped).toBe(0);
    expect(conflicts).toHaveLength(1);
    const [conflict] = conflicts;
    expect(SourceConflictSchema.parse(conflict)).toBeTruthy();
    expect(conflict).toMatchObject({ trackId: 't1', status: 'open', origin: 'contradiction_check', severity: 'critical' });
    expect(conflict.sourceRefs.map((ref) => ref.pageNumber)).toEqual([11, 7]);
    expect(conflict.id).toMatch(/^pdf-check-[a-f0-9]{10}$/);
    // Same input -> same id, so a re-check never duplicates a decided conflict.
    expect(groundContradictions({ contradictions: [voicemail] }, pages, 't1').conflicts[0].id).toBe(conflict.id);
  });

  it('drops paraphrased quotes, wrong pages and self-pairs', () => {
    const paraphrase = { ...voicemail, conflicting: { page: 7, quote: 'I will text you the link' } };
    const wrongPage = { ...voicemail, rule: { page: 7, quote: 'Never trigger a link send to voicemail.' } };
    const missingPage = { ...voicemail, rule: { page: 99, quote: 'Never trigger a link send to voicemail.' } };
    const selfPair = { ...voicemail, conflicting: voicemail.rule };
    const { conflicts, dropped } = groundContradictions({ contradictions: [paraphrase, wrongPage, missingPage, selfPair] }, pages, 't1');
    expect(conflicts).toHaveLength(0);
    expect(dropped).toBe(4);
  });
});

describe('contradiction prompts', () => {
  it('shows every page under its PAGE label', () => {
    const prompt = buildContradictionUserPrompt(pages);
    expect(prompt).toContain('=== PAGE 7 ===');
    expect(prompt).toContain('=== PAGE 11 ===');
  });

  it('lists only decided conflicts for the Unit prompt', () => {
    const [open] = groundContradictions({ contradictions: [voicemail] }, pages, 't1').conflicts;
    expect(formatConflictDecisions([open])).toBe('');
    const decided = { ...open, status: 'resolved' as const, decision: 'Follow the rule on page 11.' };
    expect(formatConflictDecisions([decided])).toContain('Trainer decision: Follow the rule on page 11.');
    expect(formatConflictDecisions(undefined)).toBe('');
  });
});
