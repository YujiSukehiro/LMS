/** Compatibility adapters for the Studio Source Review action endpoints. */
import { NextResponse } from 'next/server';
import { jsonError } from '@/lib/firebase/auth-guard';
import { POST as reviewPOST } from '../route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ trackId: string; action: string }> };

function command(action: string, body: Record<string, unknown>): Record<string, unknown> | null {
  const base = { bundleId: body.bundleId, expectedRevisionHash: body.expectedRevisionHash };
  switch (action) {
    case 'excerpt':
      return { ...base, action: 'approve_excerpt', evidence: body.evidence, evidenceId: body.evidenceId, claimId: body.claimId, approvalStatus: body.approvalStatus };
    case 'transcription':
      return {
        ...base,
        action: 'approve_transcription',
        pageId: body.pageId,
        documentId: body.documentId,
        revisionId: body.revisionId,
        pageNumber: body.pageNumber,
        text: body.text,
      };
    case 'asset':
      return { ...base, action: 'approve_asset', assetId: body.assetId };
    case 'rule':
      return { ...base, action: 'approve_rule_pack', rulePackId: body.packId ?? body.rulePackId, ruleId: body.ruleId };
    case 'bundle':
      return body.status === 'approved' ? { ...base, action: 'approve_bundle' } : null;
    case 'conflict':
      if (body.status === 'sme_review') return { ...base, action: 'assign_conflict', conflictId: body.conflictId };
      if (body.status === 'resolved' || body.status === 'accepted_context_difference') {
        return {
          ...base,
          action: 'record_conflict_decision',
          conflictId: body.conflictId,
          status: body.status,
          decision: body.decision,
          effectiveFrom: body.effectiveFrom,
          effectiveTo: body.effectiveTo,
        };
      }
      return null;
    default:
      return null;
  }
}

export async function POST(req: Request, { params }: RouteContext): Promise<NextResponse> {
  const { trackId, action } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, 'VALIDATION_FAILED', 'The request body must be JSON.');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return jsonError(400, 'VALIDATION_FAILED', 'The request body must be an object.');
  const mapped = command(action, body as Record<string, unknown>);
  if (!mapped) return jsonError(400, 'VALIDATION_FAILED', 'This Source Review action or status is not supported.');
  const headers = new Headers(req.headers);
  headers.delete('content-length');
  headers.set('content-type', 'application/json');
  const forwarded = new Request(new URL(`/api/tracks/${encodeURIComponent(trackId)}/source-review`, req.url), {
    method: 'POST',
    headers,
    body: JSON.stringify(mapped),
  });
  return reviewPOST(forwarded, { params: Promise.resolve({ trackId }) });
}
