import { z } from 'zod';
import { ApiErrorBodySchema } from '@/lib/schemas/api';
import {
  OperationalAssetSchema,
  SharedRulePackSchema,
  SourceBundleSchema,
  SourceConflictSchema,
  SourcePageEvidenceSchema,
} from '@/lib/schemas/source-truth';

export const SourceReviewDataSchema = z.object({
  bundle: SourceBundleSchema.nullable(),
  pages: z.array(SourcePageEvidenceSchema),
  rulePacks: z.array(SharedRulePackSchema),
  assets: z.array(OperationalAssetSchema),
  conflicts: z.array(SourceConflictSchema),
});
export type SourceReviewData = z.infer<typeof SourceReviewDataSchema>;

export type SourceReviewAction = 'transcription' | 'excerpt' | 'bundle' | 'asset' | 'rule' | 'conflict';

function endpoint(trackId: string): string {
  return `/api/tracks/${encodeURIComponent(trackId)}/source-review`;
}

async function throwResponseError(response: Response, fallback: string): Promise<never> {
  let message = `${fallback} (HTTP ${response.status}).`;
  try {
    const body = ApiErrorBodySchema.safeParse(await response.json());
    if (body.success) message = body.data.message ?? body.data.error.replaceAll('_', ' ').toLowerCase();
  } catch {
    // Keep the status-bearing fallback when the server did not return JSON.
  }
  throw new Error(message);
}

export async function fetchSourceReview(trackId: string, bundleId: string): Promise<SourceReviewData> {
  const url = `${endpoint(trackId)}?bundleId=${encodeURIComponent(bundleId)}`;
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) await throwResponseError(response, 'Source Review did not load');
  const body: unknown = await response.json();
  const candidate = body && typeof body === 'object' && 'review' in body
    ? (body as { review: unknown }).review
    : body;
  const parsed = SourceReviewDataSchema.safeParse(candidate);
  if (!parsed.success) throw new Error('The server sent an unexpected Source Review response.');
  return parsed.data;
}

/** Map the review controls to the single trainer command endpoint; the server recomputes all approval metadata. */
export async function postSourceReview(
  trackId: string,
  action: SourceReviewAction,
  body: Record<string, unknown>,
): Promise<void> {
  const command: Record<string, unknown> = { ...body };
  let commandAction: string;
  switch (action) {
    case 'transcription':
      commandAction = 'approve_transcription';
      delete command.approve;
      break;
    case 'excerpt':
      commandAction = 'approve_excerpt';
      delete command.claimId;
      delete command.approvalStatus;
      break;
    case 'bundle':
      commandAction = 'approve_bundle';
      delete command.status;
      break;
    case 'asset':
      commandAction = 'approve_asset';
      delete command.status;
      break;
    case 'rule':
      commandAction = 'approve_rule_pack';
      command.rulePackId = command.packId;
      delete command.packId;
      delete command.ruleId;
      delete command.status;
      break;
    case 'conflict':
      commandAction = 'record_conflict_decision';
      delete command.downstreamInvalidationStatus;
      break;
  }
  const response = await fetch(endpoint(trackId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...command, action: commandAction }),
  });
  if (!response.ok) await throwResponseError(response, 'The Source Review change did not save');
}
