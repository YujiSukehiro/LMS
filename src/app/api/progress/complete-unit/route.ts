import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase/admin';
import { jsonError, requireAuth } from '@/lib/firebase/auth-guard';
import { CompleteUnitRequestSchema, type CompleteUnitResponse, type DrillResult } from '@/lib/schemas/api';
import { DrillAttemptDocSchema, type DrillAttemptDoc } from '@/lib/schemas/learning';
import { recordUnitCompletion } from '@/lib/services/analytics-rollup';
import { ServiceError } from '@/lib/services/errors';
import { errorResponse, parseJsonBody } from '@/lib/services/route-helpers';
import { loadLearnerTrackContext } from '@/lib/services/track-loader';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function unitResultsFromEvidence(unitDrills: Array<{ id: string; competencyPillarId: string }>, attempts: DrillAttemptDoc[]): DrillResult[] {
  return unitDrills.map((drill) => {
    const evidence = attempts
      .filter((attempt) => attempt.drillId === drill.id && attempt.unitId !== undefined)
      .sort((left, right) => left.attemptNumber - right.attemptNumber || left.submittedAt.localeCompare(right.submittedAt));
    if (evidence.length === 0 || !evidence.some((attempt) => attempt.correct)) {
      throw new ServiceError(409, 'DRILL_EVIDENCE_INCOMPLETE', 'Complete every Drill with a server-recorded correct answer before finishing this Unit.');
    }
    return {
      drillId: drill.id,
      competencyPillarId: drill.competencyPillarId,
      passedFirstTry: evidence[0].correct,
    };
  });
}

/** Unit completion is derived from immutable current-version attempts, never browser-supplied results. */
export async function POST(req: Request): Promise<NextResponse> {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const body = await parseJsonBody(req, CompleteUnitRequestSchema);
  if (!body.ok) return body.response;

  try {
    const { trackId, versionId, unitId, idempotencyKey } = body.data;
    const { user } = auth;
    const { track, version, isDraft } = await loadLearnerTrackContext(user, trackId, versionId);
    if (isDraft) return jsonError(400, 'DRAFT_NOT_RECORDED', 'Draft play is a preview only. Progress is not recorded.');
    const unit = version.units.find((candidate) => candidate.id === unitId);
    if (!unit) return jsonError(404, 'UNIT_NOT_FOUND', 'This Unit does not exist in the Track.');

    const snapshot = await adminDb.collection('drillAttempts')
      .where('learnerId', '==', user.uid)
      .where('trackId', '==', trackId)
      .where('curriculumVersion', '==', version.versionId)
      .get();
    const attempts = snapshot.docs.map((doc) => {
      const parsed = DrillAttemptDocSchema.safeParse({ ...doc.data(), id: doc.id });
      if (!parsed.success) throw new ServiceError(500, 'ATTEMPT_DATA_INVALID', 'A saved Drill attempt is not valid. Contact a Trainer.');
      return parsed.data;
    }).filter((attempt) => attempt.unitId === unitId && attempt.provenance === 'live');
    const drillResults = unitResultsFromEvidence(unit.drills, attempts);

    const { xpAwarded, enrollment } = await recordUnitCompletion({
      user,
      track,
      version,
      unitId,
      drillResults,
      idempotencyKey,
    });
    const response: CompleteUnitResponse = { xpAwarded, enrollment };
    return NextResponse.json(response);
  } catch (error) {
    return errorResponse(error, 'progress/complete-unit');
  }
}
