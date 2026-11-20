/**
 * Trainer tool for generated evidence that did not verify: find the exact source passage a model excerpt copies
 * (with typographic drift such as '...' for "...", case or line breaks) and swap in the persisted page text.
 * The result is still unapproved: the trainer reads the found excerpt and approves it like any other.
 */
import { capExcerpt, findExactSourceSpan } from '@/lib/ai/prompts/evidence';
import type { ClaimEvidence, SourceConflict, SourceExcerptRef, SourcePageEvidence } from '@/lib/schemas/source-truth';
import { verifyClaimEvidence, verifySourceExcerpt } from '@/lib/services/source-evidence';

function verifiable(page: SourcePageEvidence): { text: string; fromApprovedTranscription: boolean } {
  return page.transcription
    ? { text: page.transcription.text, fromApprovedTranscription: true }
    : { text: page.normalizedText, fromApprovedTranscription: false };
}

function samePage(page: SourcePageEvidence, ref: SourceExcerptRef): boolean {
  return page.documentId === ref.documentId && page.revisionId === ref.revisionId && page.pageNumber === ref.pageNumber;
}

/** The exact excerpt on the cited page (then any other page of the bundle), or null when it is not in the source. */
export function rematchExcerpt(ref: SourceExcerptRef, pages: SourcePageEvidence[]): SourceExcerptRef | null {
  const cited = pages.filter((page) => samePage(page, ref) || (page.pageNumber === ref.pageNumber && page.documentId === ref.documentId));
  const ordered = [...cited, ...pages.filter((page) => !cited.includes(page))];
  for (const page of ordered) {
    const { text, fromApprovedTranscription } = verifiable(page);
    const span = findExactSourceSpan(text, ref.exactText);
    if (!span) continue;
    return {
      documentId: page.documentId,
      revisionId: page.revisionId,
      pageNumber: page.pageNumber,
      exactText: capExcerpt(span),
      fromApprovedTranscription,
    };
  }
  return null;
}

export type RematchResult =
  | { ok: true; evidence: ClaimEvidence; replaced: number }
  | { ok: false; reason: 'already_supported' | 'not_found' };

/**
 * Re-match every excerpt of `evidence` that does not verify. Succeeds only when the claim then verifies as
 * supported; approval is always reset, because the trainer has not seen the new excerpt yet.
 */
export function rematchClaimEvidence(
  evidence: ClaimEvidence,
  pages: SourcePageEvidence[],
  conflicts: SourceConflict[] = [],
): RematchResult {
  if (verifyClaimEvidence(evidence, pages, conflicts).support === 'supported') return { ok: false, reason: 'already_supported' };
  let replaced = 0;
  const excerpts = evidence.excerpts.map((ref) => {
    const check = verifySourceExcerpt(ref, pages, { critical: evidence.critical, requiresInterfaceDetails: evidence.requiresInterfaceDetails });
    if (check.matched) return ref;
    const found = rematchExcerpt(ref, pages);
    if (!found) return ref;
    replaced++;
    return found;
  });
  const next = verifyClaimEvidence(
    { ...evidence, excerpts, approvalStatus: 'draft', reviewerUid: null, reviewedAt: null },
    pages,
    conflicts,
  );
  if (replaced === 0 || next.support !== 'supported') return { ok: false, reason: 'not_found' };
  return { ok: true, evidence: next, replaced };
}

/**
 * The trainer picked `exactText` from `page` as this claim's only excerpt. Accepted only when the text is
 * verbatim on that page; the claim is reset to an unapproved draft so the trainer still approves it.
 */
export function pickedExcerptEvidence(
  evidence: ClaimEvidence,
  page: SourcePageEvidence,
  exactText: string,
  pages: SourcePageEvidence[],
  conflicts: SourceConflict[] = [],
): ClaimEvidence | null {
  const { fromApprovedTranscription } = verifiable(page);
  const excerpt: SourceExcerptRef = {
    documentId: page.documentId,
    revisionId: page.revisionId,
    pageNumber: page.pageNumber,
    exactText: exactText.trim(),
    fromApprovedTranscription,
  };
  if (!excerpt.exactText || !verifySourceExcerpt(excerpt, [page], { critical: evidence.critical, requiresInterfaceDetails: evidence.requiresInterfaceDetails }).matched) return null;
  return verifyClaimEvidence(
    { ...evidence, excerpts: [excerpt], approvalStatus: 'draft', reviewerUid: null, reviewedAt: null },
    pages,
    conflicts,
  );
}

/** Sentences of a page a trainer can pick as an excerpt, best matches for the claim first. */
export function pageSentenceChoices(claim: string, page: SourcePageEvidence, limit = 6): string[] {
  const { text } = verifiable(page);
  const sentences = [...new Set(text.split(/(?<=[.!?])\s+|\n+/).map((part) => part.trim()).filter((part) => part.length >= 20))]
    .map((sentence) => capExcerpt(sentence));
  const words = (value: string) => new Set(value.toLowerCase().split(/[^a-z0-9$%]+/).filter((word) => word.length > 3));
  const wanted = words(claim);
  return sentences
    .map((sentence, index) => ({ sentence, index, score: [...words(sentence)].filter((word) => wanted.has(word)).length }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, limit)
    .map((item) => item.sentence);
}
