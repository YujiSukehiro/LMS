/**
 * Runs the PDF self-contradiction check once per source bundle revision and stores what it finds as open
 * SourceConflicts (origin "contradiction_check"). Open conflicts already block bundle approval, so the trainer
 * sees each one and records a one-click decision before the build; the decision then reaches the Unit prompts.
 * Only items whose two quotes match the page text exactly are kept: the model never invents a conflict.
 */
import { createHash } from 'node:crypto';
import { adminDb } from '@/lib/firebase/admin';
import { getLLMGateway } from '@/lib/ai/gateway';
import type { LLMGateway } from '@/lib/ai/types';
import { pageLabelMap } from '@/lib/ai/prompts/evidence';
import {
  CONTRADICTION_CHECK_MAX_OUTPUT_TOKENS,
  CONTRADICTION_CHECK_SCHEMA_NAME,
  ContradictionCheckOutputSchema,
  buildContradictionSystemPrompt,
  buildContradictionUserPrompt,
  type ContradictionCheckOutput,
} from '@/lib/ai/prompts/contradiction-check';
import { SourceConflictSchema, type SourceConflict, type SourcePageEvidence } from '@/lib/schemas/source-truth';
import { verifySourceExcerpt } from '@/lib/services/source-evidence';
import { loadSourceReview, sourceConflictRef } from '@/lib/services/source-store';

export interface ContradictionCheckResult {
  /** True when this call ran the model; false when the revision was already checked. */
  ran: boolean;
  revisionHash: string;
  conflicts: SourceConflict[];
  /** Model items dropped because a quote did not match its page exactly. */
  dropped: number;
}

function checkMarkerRef(trackId: string, bundleId: string) {
  return adminDb.collection('tracks').doc(trackId).collection('sourceChecks').doc(bundleId);
}

/** Pure: turn model output into verified SourceConflicts (exact quotes only). Exported for tests. */
export function groundContradictions(
  output: ContradictionCheckOutput,
  pages: SourcePageEvidence[],
  trackId: string,
): { conflicts: SourceConflict[]; dropped: number } {
  const byLabel = pageLabelMap(pages);
  const conflicts: SourceConflict[] = [];
  let dropped = 0;
  for (const item of output.contradictions) {
    const refs = [item.rule, item.conflicting].map((quote) => {
      const page = byLabel.get(quote.page);
      if (!page) return null;
      const ref = { documentId: page.documentId, revisionId: page.revisionId, pageNumber: page.pageNumber, exactText: quote.quote.trim(), fromApprovedTranscription: false };
      return verifySourceExcerpt(ref, pages).matched ? ref : null;
    });
    const [rule, conflicting] = refs;
    if (!rule || !conflicting || rule.exactText === conflicting.exactText) {
      dropped += 1;
      continue;
    }
    const id = `pdf-check-${createHash('sha256').update(`${rule.pageNumber}|${rule.exactText}|${conflicting.pageNumber}|${conflicting.exactText}`).digest('hex').slice(0, 10)}`;
    if (conflicts.some((existing) => existing.id === id)) continue;
    conflicts.push(
      SourceConflictSchema.parse({
        id,
        trackId,
        sourceRefs: [rule, conflicting],
        affectedProducts: [],
        affectedContexts: [],
        affectedStages: [],
        detectedValues: [`Rule (page ${item.rule.page})`, `Conflicting passage (page ${item.conflicting.page})`],
        severity: item.severity,
        status: 'open',
        summary: item.summary,
        origin: 'contradiction_check',
      }),
    );
  }
  return { conflicts, dropped };
}

/**
 * Check the bundle's current revision once. Later calls for the same revision return the stored result.
 * Conflicts the trainer already decided are never overwritten.
 */
export async function runContradictionCheck(
  trackId: string,
  bundleId: string,
  gateway: LLMGateway = getLLMGateway(),
): Promise<ContradictionCheckResult> {
  const review = await loadSourceReview(trackId, bundleId);
  const revisionHash = review.bundle.revisionHash;
  const existing = review.conflicts.filter((conflict) => conflict.origin === 'contradiction_check');
  const marker = await checkMarkerRef(trackId, bundleId).get();
  if (marker.exists && marker.get('revisionHash') === revisionHash) {
    return { ran: false, revisionHash, conflicts: existing, dropped: Number(marker.get('dropped') ?? 0) };
  }
  const output = await gateway.generateStructured({
    tier: 'heavy',
    systemPrompt: buildContradictionSystemPrompt(),
    userPrompt: buildContradictionUserPrompt(review.pages),
    schema: ContradictionCheckOutputSchema,
    schemaName: CONTRADICTION_CHECK_SCHEMA_NAME,
    temperature: 0.1,
    maxOutputTokens: CONTRADICTION_CHECK_MAX_OUTPUT_TOKENS,
  });
  const { conflicts, dropped } = groundContradictions(output, review.pages, trackId);
  const batch = adminDb.batch();
  const decided = new Set(existing.filter((conflict) => conflict.status !== 'open').map((conflict) => conflict.id));
  for (const conflict of conflicts) {
    if (!decided.has(conflict.id)) batch.set(sourceConflictRef(trackId, bundleId, conflict.id), conflict);
  }
  batch.set(checkMarkerRef(trackId, bundleId), { revisionHash, checkedAt: Date.now(), found: conflicts.length, dropped });
  await batch.commit();
  const merged = [...existing.filter((conflict) => !conflicts.some((fresh) => fresh.id === conflict.id)), ...conflicts.map((fresh) => existing.find((old) => old.id === fresh.id && old.status !== 'open') ?? fresh)];
  return { ran: true, revisionHash, conflicts: merged, dropped };
}
