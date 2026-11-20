import type { ExtractedPage } from '@/lib/ai/pdf-extractor';
import { labelSourcePages } from '@/lib/ai/prompts/evidence';
import type { SourceDocumentRef, SourcePageEvidence } from '@/lib/schemas/source-truth';

/**
 * Legacy `sourcePages` for a whole source bundle. Pages are ordered like `loadSourceReview`
 * (document inheritanceOrder, then page number) and numbered with the pipeline's PAGE labels:
 * a single-document bundle keeps its own page numbers, a multi-document bundle uses 1..N.
 */
export function bundleLegacyPages(
  documents: readonly Pick<SourceDocumentRef, 'id' | 'inheritanceOrder'>[],
  pages: readonly SourcePageEvidence[],
): ExtractedPage[] {
  const order = new Map(documents.map((document) => [document.id, document.inheritanceOrder] as const));
  const sorted = [...pages].sort(
    (left, right) =>
      (order.get(left.documentId) ?? Number.MAX_SAFE_INTEGER) - (order.get(right.documentId) ?? Number.MAX_SAFE_INTEGER) ||
      left.documentId.localeCompare(right.documentId) ||
      left.pageNumber - right.pageNumber,
  );
  return labelSourcePages(sorted).map(({ label, page }) => ({ pageNumber: label, text: page.normalizedText }));
}
