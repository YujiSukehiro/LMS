/**
 * POST /api/tracks/[trackId]/source-contradictions — check the active source bundle for places where the PDF
 * contradicts itself (once per revision). Found items are stored as open SourceConflicts that the trainer
 * decides before approving the source. Body (optional): { bundleId }.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { jsonError, requireAuth } from '@/lib/firebase/auth-guard';
import { INTERNAL_OPS_ROLES } from '@/lib/schemas/constants';
import { loadTrack } from '@/lib/ai/pipeline/track-store';
import { SourceBundleNotFoundError } from '@/lib/services/source-store';
import { runContradictionCheck } from '@/lib/services/source-contradictions';
import { AIUnavailableError, LLMOutputTruncatedError, LLMStructuredOutputError } from '@/lib/ai/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BodySchema = z.object({ bundleId: z.string().min(1).optional() }).strict();

export async function POST(req: Request, { params }: { params: Promise<{ trackId: string }> }): Promise<NextResponse> {
  const auth = await requireAuth(req, INTERNAL_OPS_ROLES);
  if (!auth.ok) return auth.response;
  const { trackId } = await params;
  const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError(400, 'VALIDATION_FAILED', 'The request body is not valid.');
  const track = await loadTrack(trackId);
  if (!track) return jsonError(404, 'NOT_FOUND', 'This Track does not exist.');
  const bundleId = parsed.data.bundleId ?? track.activeSourceBundleId;
  if (!bundleId) return jsonError(404, 'NO_ACTIVE_SOURCE_BUNDLE', 'This Track has no active source bundle.');
  try {
    const result = await runContradictionCheck(trackId, bundleId);
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof SourceBundleNotFoundError) return jsonError(404, 'NOT_FOUND', 'This source bundle does not exist.');
    if (error instanceof AIUnavailableError) {
      return jsonError(503, 'AI_UNAVAILABLE', 'The contradiction check could not run because the AI service is unavailable. You can still approve the source.');
    }
    console.error('[source-contradictions]', error);
    if (error instanceof LLMStructuredOutputError || error instanceof LLMOutputTruncatedError) {
      return jsonError(502, 'CHECK_FAILED', "The contradiction check did not finish: the AI's answer couldn't be read. Run it again, or approve the source without it.");
    }
    return jsonError(502, 'CHECK_FAILED', 'The contradiction check did not finish. Run it again, or approve the source without it.');
  }
}
