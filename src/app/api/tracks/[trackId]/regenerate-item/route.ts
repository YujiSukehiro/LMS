/**
 * POST /api/tracks/[trackId]/regenerate-item — regenerate ONE BriefingCard, Drill, or Simulation scenario
 * in the draft TrackVersion (heavy tier, grounded in the SOURCE PAGES). Returns `{ item }`.
 */
import { NextResponse } from 'next/server';
import { jsonError, requireAuth } from '@/lib/firebase/auth-guard';
import { INTERNAL_OPS_ROLES } from '@/lib/schemas/constants';
import { RegenerateItemRequestSchema } from '@/lib/schemas/api';
import { describeGenerationError } from '@/lib/ai/pipeline/generate-track';
import { RegenerateItemError, regenerateDraftItem } from '@/lib/ai/pipeline/regenerate-item';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ trackId: string }> }): Promise<NextResponse> {
  const auth = await requireAuth(req, INTERNAL_OPS_ROLES);
  if (!auth.ok) return auth.response;
  const { trackId } = await params;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return jsonError(400, 'VALIDATION_FAILED', 'The request body must be JSON.');
  }
  const parsed = RegenerateItemRequestSchema.safeParse(json);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return jsonError(400, 'VALIDATION_FAILED', `Check "${first?.path.join('.') || 'body'}": ${first?.message ?? 'invalid value'}.`);
  }

  try {
    const item = await regenerateDraftItem(trackId, parsed.data);
    return NextResponse.json({ item });
  } catch (error) {
    if (error instanceof RegenerateItemError) return jsonError(error.status, error.code, error.message);
    return jsonError(502, 'AI_GENERATION_FAILED', describeGenerationError(error));
  }
}
