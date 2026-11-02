import { NextResponse } from 'next/server';
import { jsonError, requireAuth } from '@/lib/firebase/auth-guard';
import { CompleteUnitRequestSchema, type CompleteUnitResponse } from '@/lib/schemas/api';
import { recordUnitCompletion } from '@/lib/services/analytics-rollup';
import { errorResponse, parseJsonBody } from '@/lib/services/route-helpers';
import { loadLearnerTrackContext } from '@/lib/services/track-loader';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/progress/complete-unit
 * Records a completed Unit on the published TrackVersion (server-authoritative).
 */
export async function POST(req: Request): Promise<NextResponse> {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const body = await parseJsonBody(req, CompleteUnitRequestSchema);
  if (!body.ok) return body.response;
  const { trackId, versionId, unitId, drillResults } = body.data;

  try {
    const { track, version, isDraft } = await loadLearnerTrackContext(user, trackId, versionId);
    if (isDraft) {
      return jsonError(400, 'DRAFT_NOT_RECORDED', 'Draft play is a preview only. Progress is not recorded.');
    }

    const unit = version.units.find((u) => u.id === unitId);
    if (!unit) return jsonError(404, 'UNIT_NOT_FOUND', 'This Unit does not exist in the Track.');

    // The results must cover exactly the Unit's Drills, once each, with the correct CompetencyPillar.
    const drillsById = new Map(unit.drills.map((d) => [d.id, d]));
    const seen = new Set<string>();
    for (const result of drillResults) {
      const drill = drillsById.get(result.drillId);
      if (!drill) {
        return jsonError(400, 'DRILL_RESULTS_INVALID', 'The results contain a Drill that is not in this Unit.');
      }
      if (seen.has(result.drillId)) {
        return jsonError(400, 'DRILL_RESULTS_INVALID', 'The results contain the same Drill more than once.');
      }
      if (drill.competencyPillarId !== result.competencyPillarId) {
        return jsonError(400, 'DRILL_RESULTS_INVALID', 'A Drill result has the wrong CompetencyPillar.');
      }
      seen.add(result.drillId);
    }
    if (seen.size !== drillsById.size) {
      return jsonError(400, 'DRILL_RESULTS_INVALID', 'Complete every Drill in the Unit before you submit it.');
    }

    const { xpAwarded, enrollment } = await recordUnitCompletion({ user, track, version, unitId, drillResults });
    const response: CompleteUnitResponse = { xpAwarded, enrollment };
    return NextResponse.json(response);
  } catch (error) {
    return errorResponse(error, 'progress/complete-unit');
  }
}
