import { NextResponse } from 'next/server';
import { z } from 'zod';
import { jsonError, requireAuth } from '@/lib/firebase/auth-guard';
import { INTERNAL_OPS_ROLES } from '@/lib/schemas/constants';
import { loadTrainerQaQueue, TrainerQaDataError } from '@/lib/services/trainer-qa';
import { errorResponse } from '@/lib/services/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TrackIdSchema = z.string().min(1).max(200).refine((value) => !value.includes('/'));

type RouteContext = { params: Promise<{ trackId: string }> };

/** Read-only, internal-ops bulk QA. Filters are applied in the UI only after this server-derived queue is returned. */
export async function GET(req: Request, { params }: RouteContext): Promise<NextResponse> {
  const auth = await requireAuth(req, INTERNAL_OPS_ROLES);
  if (!auth.ok) return auth.response;
  const trackId = TrackIdSchema.safeParse((await params).trackId);
  if (!trackId.success) return jsonError(404, 'NOT_FOUND', 'The requested resource is not available.');

  try {
    const queue = await loadTrainerQaQueue(trackId.data);
    if (!queue) return jsonError(404, 'NOT_FOUND', 'The requested resource is not available.');
    return NextResponse.json(queue, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof TrainerQaDataError) {
      return jsonError(500, 'QA_DATA_INVALID', 'Saved QA evidence is not valid. Review the Track records before retrying.');
    }
    return errorResponse(error, 'studio/trainer-qa');
  }
}
