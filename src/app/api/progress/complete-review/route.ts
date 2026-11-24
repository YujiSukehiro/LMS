import { NextResponse } from 'next/server';
import { jsonError, requireAuth } from '@/lib/firebase/auth-guard';
import { CompleteReviewRequestSchema, CompleteReviewResponseSchema } from '@/lib/schemas/api';
import type { TrackDoc, TrackVersionDoc } from '@/lib/schemas/curriculum';
import { recordRetentionReviewCompletion } from '@/lib/services/analytics-rollup';
import { ServiceError } from '@/lib/services/errors';
import { errorResponse, parseJsonBody } from '@/lib/services/route-helpers';
import { isTrackVisibleToLearner, loadTrack, loadVersion } from '@/lib/services/track-loader';
import { withCohortMemberships } from '@/lib/services/memberships';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Complete a Keep-Sharp retention review batch, award XP/streak, and reconcile Certifications. */
export async function POST(req: Request): Promise<NextResponse> {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const body = await parseJsonBody(req, CompleteReviewRequestSchema);
  if (!body.ok) return body.response;

  try {
    const { user } = auth;
    const { trackIds, reviewedCount, idempotencyKey } = body.data;
    const uniqueTrackIds = [...new Set(trackIds)];
    if (uniqueTrackIds.length === 0) {
      return jsonError(400, 'VALIDATION_FAILED', 'Select at least one Track for retention review.');
    }

    const scope = await withCohortMemberships(user);
    const loaded = await Promise.all(
      uniqueTrackIds.map(async (trackId) => {
        const track = await loadTrack(trackId);
        if (!track || !isTrackVisibleToLearner(track, scope) || !track.publishedVersionId) {
          throw new ServiceError(404, 'TRACK_NOT_AVAILABLE', 'One of the reviewed Tracks is not currently available.');
        }
        const version = await loadVersion(track.id, track.publishedVersionId);
        if (!version) {
          throw new ServiceError(404, 'VERSION_NOT_FOUND', 'The published version of a reviewed Track is missing.');
        }
        return { track, version };
      }),
    );

    const tracks: Array<{ track: TrackDoc; version: TrackVersionDoc }> = loaded;
    const result = await recordRetentionReviewCompletion({
      user,
      tracks,
      reviewedCount,
      idempotencyKey,
    });

    return NextResponse.json(CompleteReviewResponseSchema.parse(result), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return errorResponse(error, 'progress/complete-review');
  }
}
