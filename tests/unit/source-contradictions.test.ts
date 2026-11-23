/** PDF self-contradiction check: only verbatim quotes survive, ids are stable, and decisions reach the Unit prompt. */
import { describe, expect, it, vi } from 'vitest';
import { SourcePageEvidenceSchema, SourceConflictSchema } from '@/lib/schemas/source-truth';

vi.mock('@/lib/firebase/admin', () => ({ adminDb: {} }));
vi.mock('@/lib/services/source-store', () => ({ loadSourceReview: vi.fn(), sourceConflictRef: vi.fn() }));
vi.mock('@/lib/ai/gateway', () => ({ getLLMGateway: vi.fn(), getBuildGateway: vi.fn() }));

const { groundContradictions } = await import('@/lib/services/source-contradictions');
const { buildContradictionUserPrompt, formatConflictDecisions, ContradictionCheckOutputSchema, CONTRADICTION_TEXT_MAX, MAX_CONTRADICTIONS, trimToLimit } = await import('@/lib/ai/prompts/contradiction-check');

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

// Real passages from the 13-page NeuroCalmRx Playbook. In the Nov 23 QA run the model quoted both in full
// (over 300 characters each), the old schema rejected them, and the whole check failed with 502.
const neuroPages = [
  page(
    10,
    '"How long before I feel something?" "Most patients notice something in sleep first — fewer wake-\nups, easier to fall back asleep. That usually happens in the first 1 to 2 weeks. Pain reduction tends to\nfollow, and it builds over months rather than happening all at once. The full effect takes time because\nyour nervous system is literally rebuilding — that\'s a good thing, it means real change." Page 10 of 13',
  ),
  page(
    11,
    'Never make medical claims. No "this will cure your neuropathy." Never diagnose. If pressed on a\nmedical question, defer: "your physician can answer that during the assessment review."\nNever create false urgency. No "limited spots," "offer expires today," "last chance." If you need\nurgency, use the medical reality: "the cellular renewal cycle interrupts between bottles." Page 11 of 13',
  ),
];
const longRule =
  'Never make medical claims. No "this will cure your neuropathy." Never diagnose. If pressed on a medical question, defer: "your physician can answer that during the assessment review." Never create false urgency. No "limited spots," "offer expires today," "last chance." If you need urgency, use the medical reality: "the cellular renewal cycle interrupts between bottles."';
const longScript =
  "Most patients notice something in sleep first — fewer wake-\nups, easier to fall back asleep. That usually happens in the first 1 to 2 weeks. Pain reduction tends to follow, and it builds over months rather than happening all at once. The full effect takes time because your nervous system is literally rebuilding — that's a good thing, it means real change.";
const medicalClaim = {
  rule: { page: 11, quote: longRule },
  conflicting: { page: 10, quote: longScript },
  summary: 'The rule bans medical claims, but the objection script tells callers their nervous system is literally rebuilding.',
  severity: 'critical',
};

describe('contradiction check output parsing', () => {
  it('trims long quotes to a verbatim prefix instead of rejecting the answer', () => {
    expect(longRule.length).toBeGreaterThan(CONTRADICTION_TEXT_MAX);
    expect(longScript.length).toBeGreaterThan(CONTRADICTION_TEXT_MAX);
    const parsed = ContradictionCheckOutputSchema.parse({ contradictions: [medicalClaim] });
    const [item] = parsed.contradictions;
    expect(item.rule.quote.length).toBeLessThanOrEqual(CONTRADICTION_TEXT_MAX);
    expect(item.conflicting.quote.length).toBeLessThanOrEqual(CONTRADICTION_TEXT_MAX);
    expect(item.rule.quote.startsWith('Never make medical claims.')).toBe(true);

    const { conflicts, dropped } = groundContradictions(parsed, neuroPages, 't1');
    expect(dropped).toBe(0);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].sourceRefs.map((ref) => ref.pageNumber)).toEqual([11, 10]);
  });

  it("finds a quote whose quote marks or line-break hyphens differ, and stores the page's own words", () => {
    // What the local 7B model actually returned in the QA run: ' for ", "wake-ups" for "wake-\nups", the question's quotes dropped.
    const loose = {
      ...medicalClaim,
      rule: { page: 11, quote: "Never make medical claims. No 'this will cure your neuropathy.' Never diagnose." },
      conflicting: { page: 10, quote: "How long before I feel something? 'Most patients notice something in sleep first — fewer wake-ups, easier to fall back asleep." },
    };
    const { conflicts, dropped } = groundContradictions(ContradictionCheckOutputSchema.parse({ contradictions: [loose] }), neuroPages, 't1');
    expect(dropped).toBe(0);
    const [rule, script] = conflicts[0].sourceRefs;
    expect(rule.exactText).toBe('Never make medical claims. No "this will cure your neuropathy." Never diagnose.');
    expect(script.exactText).toBe('How long before I feel something?" "Most patients notice something in sleep first — fewer wake- ups, easier to fall back asleep.');
  });

  it('still drops a reworded quote', () => {
    const reworded = { ...medicalClaim, conflicting: { page: 10, quote: 'Most patients notice better sleep first, within one or two weeks.' } };
    expect(groundContradictions(ContradictionCheckOutputSchema.parse({ contradictions: [reworded] }), neuroPages, 't1').dropped).toBe(1);
  });

  it('trims a long summary with an ellipsis', () => {
    const parsed = ContradictionCheckOutputSchema.parse({ contradictions: [{ ...medicalClaim, summary: `${'The script breaks the rule. '.repeat(20)}` }] });
    const summary = parsed.contradictions[0].summary;
    expect(summary.length).toBeLessThanOrEqual(CONTRADICTION_TEXT_MAX + 1);
    expect(summary.endsWith('…')).toBe(true);
  });

  it('drops one malformed item and keeps the rest', () => {
    const malformed = { ...voicemail, severity: 'urgent' };
    const missingQuote = { rule: { page: 11 }, conflicting: voicemail.conflicting, summary: voicemail.summary, severity: 'major' };
    const parsed = ContradictionCheckOutputSchema.parse({ contradictions: [malformed, medicalClaim, missingQuote, voicemail] });
    expect(parsed.contradictions).toHaveLength(2);
    expect(parsed.contradictions.map((item) => item.rule.page)).toEqual([11, 11]);
  });

  it('keeps at most the item limit', () => {
    const parsed = ContradictionCheckOutputSchema.parse({ contradictions: Array.from({ length: MAX_CONTRADICTIONS + 3 }, () => voicemail) });
    expect(parsed.contradictions).toHaveLength(MAX_CONTRADICTIONS);
  });

  it('trimToLimit returns a prefix cut at a word', () => {
    const trimmed = trimToLimit(longScript);
    expect(longScript.replace(/\s+/g, ' ').startsWith(trimmed)).toBe(true);
    expect(trimmed.endsWith(' ')).toBe(false);
    expect(trimToLimit('  short quote  ')).toBe('short quote');
  });
});
