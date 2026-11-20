import { describe, expect, it } from 'vitest';
import type { ClaimEvidence, SourcePageEvidence } from '@/lib/schemas/source-truth';
import { rematchClaimEvidence } from '@/lib/services/evidence-rematch';

const PAGE_12 = 'Rule 1 — The link is the transaction. Your single goal on every call is a verbal "yes, send me the\nlink." Once you have it, send and end. Don\'t keep selling.';
const PAGE_11 = 'Stop on opt-out. "Stop calling," "not interested," "don\'t contact me again" — acknowledge, end the\ncall, flag for permanent suppression.';

function page(pageNumber: number, text: string): SourcePageEvidence {
  return {
    id: `p${pageNumber}`,
    documentId: 'doc',
    revisionId: 'rev',
    pageNumber,
    rawText: text,
    normalizedText: text,
    contentHash: `sha256:${'a'.repeat(64)}`,
    characterCount: text.length,
    extractionFlags: [],
    transcription: null,
    approvedExcerpts: [],
  };
}

function evidence(pageNumber: number, exactText: string): ClaimEvidence {
  return {
    id: 'u6-c1-e1',
    claim: 'Get a verbal yes to the link, then send and end.',
    ruleIds: [],
    excerpts: [{ documentId: 'doc', revisionId: 'rev', pageNumber, exactText, fromApprovedTranscription: false }],
    support: 'unsupported',
    approvalStatus: 'draft',
    critical: false,
    requiresInterfaceDetails: false,
    reviewerUid: null,
    reviewedAt: null,
  };
}

const pages = [page(11, PAGE_11), page(12, PAGE_12)];

describe('rematchClaimEvidence', () => {
  it('swaps a single-quoted model copy for the exact double-quoted source passage, unapproved', () => {
    const result = rematchClaimEvidence(
      evidence(12, "Your single goal on every call is a verbal 'yes, send me the link.' Once you have it, send and end."),
      pages,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.evidence.excerpts[0].exactText).toBe('Your single goal on every call is a verbal "yes, send me the\nlink." Once you have it, send and end.');
    expect(result.evidence).toMatchObject({ support: 'supported', approvalStatus: 'draft', reviewerUid: null });
  });

  it('finds the passage on another page when the model cited the wrong one', () => {
    const result = rematchClaimEvidence(evidence(12, "Stop on opt-out. 'Stop calling,' 'not interested,'"), pages);
    expect(result.ok && result.evidence.excerpts[0].pageNumber).toBe(11);
  });

  it('refuses paraphrases and evidence that already verifies', () => {
    expect(rematchClaimEvidence(evidence(12, 'Only leads who finish the quiz can be called.'), pages)).toEqual({ ok: false, reason: 'not_found' });
    expect(rematchClaimEvidence(evidence(12, "Don't keep selling."), pages)).toEqual({ ok: false, reason: 'already_supported' });
  });
});

describe('trainer excerpt picker', () => {
  it('accepts only a verbatim sentence of the page and keeps the claim unapproved', async () => {
    const { pickedExcerptEvidence, pageSentenceChoices } = await import('@/lib/services/evidence-rematch');
    const claim = evidence(12, 'paraphrased text that is not in the source at all');
    const choices = pageSentenceChoices('verbal yes send the link', pages[1]);
    expect(choices[0]).toContain('Your single goal on every call');
    const picked = pickedExcerptEvidence({ ...claim, approvalStatus: 'approved', reviewerUid: 't', reviewedAt: 1 }, pages[1], choices[0], pages);
    expect(picked).toMatchObject({ support: 'supported', approvalStatus: 'draft', reviewerUid: null });
    expect(picked?.excerpts).toHaveLength(1);
    expect(pickedExcerptEvidence(claim, pages[1], 'Not on the page.', pages)).toBeNull();
  });
});
