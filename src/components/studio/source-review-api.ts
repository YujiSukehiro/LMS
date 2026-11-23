import { z } from 'zod';
import { ApiErrorBodySchema } from '@/lib/schemas/api';
import {
  ClaimEvidenceSchema,
  OperationalAssetSchema,
  SharedRulePackSchema,
  SourceBundleSchema,
  SourceConflictSchema,
  SourcePageEvidenceSchema,
  type ClaimEvidence,
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

/** A Source Review API error with the HTTP status and machine code, so callers can branch on them. */
export class SourceReviewApiError extends Error {
  constructor(message: string, readonly status: number, readonly code: string | null) {
    super(message);
    this.name = 'SourceReviewApiError';
  }
}

async function throwResponseError(response: Response, fallback: string): Promise<never> {
  let message = `${fallback} (HTTP ${response.status}).`;
  let code: string | null = null;
  try {
    const body = ApiErrorBodySchema.safeParse(await response.json());
    if (body.success) {
      message = body.data.message ?? body.data.error.replaceAll('_', ' ').toLowerCase();
      code = body.data.error;
    }
  } catch {
    // Keep the status-bearing fallback when the server did not return JSON.
  }
  throw new SourceReviewApiError(message, response.status, code);
}

/** True for the 404 a legacy or bundle-less Track returns: it has no source to approve, so building may start. */
export function isNoActiveSourceBundle(error: unknown): boolean {
  return error instanceof SourceReviewApiError && error.status === 404 && error.code === 'NO_ACTIVE_SOURCE_BUNDLE';
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
): Promise<unknown> {
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
  return response.json().catch(() => null);
}

/** The server-verified evidence an `excerpt` approval returns, so the Studio can show it without a reload. */
export function approvedEvidenceFrom(body: unknown): ClaimEvidence | null {
  const parsed = z.object({ evidence: ClaimEvidenceSchema }).safeParse(body);
  return parsed.success ? parsed.data.evidence : null;
}

export interface RebindProblem {
  ownerType: string;
  ownerId: string;
  evidenceId: string | null;
  pageNumber: number;
  documentId: string;
  exactText: string;
  reason: string;
}

export class RebindDraftError extends Error {
  constructor(message: string, readonly code: string, readonly mismatches: RebindProblem[]) {
    super(message);
    this.name = 'RebindDraftError';
  }
}

const RebindProblemSchema = z.object({
  ownerType: z.string(),
  ownerId: z.string(),
  evidenceId: z.string().nullable(),
  pageNumber: z.number(),
  documentId: z.string(),
  exactText: z.string(),
  reason: z.string(),
});

/**
 * Rebind the draft to the bundle's current approved revision. The server re-verifies every approved
 * excerpt first; on a mismatch it throws RebindDraftError listing the excerpts that no longer match.
 */
export async function rebindDraftToSource(
  trackId: string,
  bundleId: string,
  expectedRevisionHash?: string,
): Promise<{ sourceRevision: string; warnings: RebindProblem[] }> {
  const response = await fetch(endpoint(trackId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'rebind_draft', bundleId, ...(expectedRevisionHash ? { expectedRevisionHash } : {}) }),
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = ApiErrorBodySchema.safeParse(body);
    const details = parsed.success ? parsed.data.details : undefined;
    const mismatches = z.object({ mismatches: z.array(RebindProblemSchema) }).safeParse(details);
    throw new RebindDraftError(
      parsed.success ? parsed.data.message ?? parsed.data.error.replaceAll('_', ' ').toLowerCase() : `The draft was not rebound (HTTP ${response.status}).`,
      parsed.success ? parsed.data.error : 'REBIND_FAILED',
      mismatches.success ? mismatches.data.mismatches : [],
    );
  }
  const ok = z.object({ sourceRevision: z.string(), warnings: z.array(RebindProblemSchema).default([]) }).safeParse(body);
  if (!ok.success) throw new Error('The server sent an unexpected rebind response.');
  return ok.data;
}

/**
 * Ask the server to re-find the exact source passage for unsupported evidence. Returns the updated (still
 * unapproved) evidence; throws with the server's reason when the passage is not in the source.
 */
export async function rematchEvidence(
  trackId: string,
  bundleId: string,
  evidenceId: string,
  expectedRevisionHash?: string,
): Promise<ClaimEvidence> {
  const response = await fetch(endpoint(trackId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'rematch_evidence', bundleId, evidenceId, ...(expectedRevisionHash ? { expectedRevisionHash } : {}) }),
  });
  if (!response.ok) await throwResponseError(response, 'The exact source passage was not found');
  const evidence = approvedEvidenceFrom(await response.json().catch(() => null));
  if (!evidence) throw new Error('The server sent an unexpected re-match response.');
  return evidence;
}

/** Use a verbatim sentence of a source page as the claim's excerpt. The server re-verifies it; it stays unapproved. */
export async function pickExcerpt(
  trackId: string,
  input: { bundleId: string; evidenceId: string; pageId: string; exactText: string; expectedRevisionHash?: string },
): Promise<ClaimEvidence> {
  const response = await fetch(endpoint(trackId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'pick_excerpt', ...input }),
  });
  if (!response.ok) await throwResponseError(response, 'The excerpt was not saved');
  const evidence = approvedEvidenceFrom(await response.json().catch(() => null));
  if (!evidence) throw new Error('The server sent an unexpected excerpt response.');
  return evidence;
}

/** Run (or reuse) the PDF self-contradiction check for a bundle. Found items appear as source conflicts. */
export async function runSourceContradictionCheck(trackId: string, bundleId: string): Promise<unknown> {
  const response = await fetch(`/api/tracks/${encodeURIComponent(trackId)}/source-contradictions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bundleId }),
  });
  if (!response.ok) await throwResponseError(response, 'The contradiction check did not finish. You can still approve the source');
  return response.json().catch(() => null);
}
