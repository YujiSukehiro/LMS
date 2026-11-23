/**
 * Runs the AI sizing review once per uploaded source and stores it on the Track, so the Content map can show it and
 * the build can use the trainer's (or the AI's) minutes as its time budget.
 */
import { createHash } from 'node:crypto';
import { getLLMGateway } from '@/lib/ai/gateway';
import type { LLMGateway } from '@/lib/ai/types';
import { trackRef } from '@/lib/ai/pipeline/track-store';
import {
  SIZING_REVIEW_MAX_OUTPUT_TOKENS,
  SIZING_REVIEW_SCHEMA_NAME,
  SizingReviewOutputSchema,
  buildSizingSystemPrompt,
  buildSizingUserPrompt,
} from '@/lib/ai/prompts/sizing-review';

export interface SizingReview {
  sourceKey: string;
  checkpoints: number;
  learnerMinutes: number;
  reason: string;
  reviewedAt: number;
}

/** Changes whenever the uploaded page text changes (a revised Playbook gets a fresh review). */
export function sizingSourceKey(pages: ReadonlyArray<{ pageNumber: number; text: string }>): string {
  return createHash('sha256').update(JSON.stringify(pages.map((page) => [page.pageNumber, page.text]))).digest('hex').slice(0, 32);
}

/**
 * The stored review for these pages, or a new one (one planning-model call, a few cents). Returns null when the
 * model is unavailable: the Content map then falls back to the measured recommendation.
 */
export async function getSizingReview(
  trackId: string,
  stored: SizingReview | null | undefined,
  pages: ReadonlyArray<{ pageNumber: number; text: string }>,
  gateway: LLMGateway = getLLMGateway(),
): Promise<SizingReview | null> {
  const sourceKey = sizingSourceKey(pages);
  if (stored?.sourceKey === sourceKey) return stored;
  try {
    const output = await gateway.generateStructured({
      tier: 'heavy',
      purpose: 'planning',
      systemPrompt: buildSizingSystemPrompt(),
      userPrompt: buildSizingUserPrompt(pages),
      schema: SizingReviewOutputSchema,
      schemaName: SIZING_REVIEW_SCHEMA_NAME,
      temperature: 0.2,
      maxOutputTokens: SIZING_REVIEW_MAX_OUTPUT_TOKENS,
    });
    const review: SizingReview = { sourceKey, ...output, reviewedAt: Date.now() };
    await trackRef(trackId).update({ sizingReview: review, updatedAt: Date.now() });
    return review;
  } catch (error) {
    console.warn('[sizing-review] AI sizing review failed; using the measured recommendation', {
      trackId,
      message: error instanceof Error ? error.message.slice(0, 200) : String(error),
    });
    return null;
  }
}
