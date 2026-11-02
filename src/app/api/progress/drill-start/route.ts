import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase/admin';
import { jsonError, requireAuth } from '@/lib/firebase/auth-guard';
import { DrillStartRequestSchema, type DrillStartResponse } from '@/lib/schemas/api';
import { DrillAttemptStartDocSchema } from '@/lib/schemas/learning';
import { errorResponse, parseJsonBody } from '@/lib/services/route-helpers';
import { loadLearnerTrackContext } from '@/lib/services/track-loader';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Create a server-owned timing record. No answer or grading data is sent to the browser. */
export async function POST(req: Request): Promise<NextResponse> {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const body = await parseJsonBody(req, DrillStartRequestSchema);
  if (!body.ok) return body.response;

  try {
    const { trackId, versionId, unitId, drillId } = body.data;
    const { version } = await loadLearnerTrackContext(auth.user, trackId, versionId);
    const unit = version.units.find((candidate) => candidate.id === unitId);
    if (!unit) return jsonError(404, 'UNIT_NOT_FOUND', 'This Unit does not exist in the Track.');
    if (!unit.drills.some((drill) => drill.id === drillId)) {
      return jsonError(404, 'DRILL_NOT_FOUND', 'This Drill does not exist in the Unit.');
    }

    const ref = adminDb.collection('drillAttemptStarts').doc();
    const startedAt = new Date().toISOString();
    const start = DrillAttemptStartDocSchema.parse({
      id: ref.id,
      learnerId: auth.user.uid,
      trackId,
      unitId,
      drillId,
      curriculumVersion: version.versionId,
      startedAt,
      consumedAt: null,
    });
    await ref.set(start);
    const response: DrillStartResponse = { startId: start.id, startedAt };
    return NextResponse.json(response, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return errorResponse(error, 'progress/drill-start');
  }
}
