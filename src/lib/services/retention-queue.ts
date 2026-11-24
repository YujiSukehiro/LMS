import { adminDb } from '@/lib/firebase/admin';
import { loadPublishedTracks, loadTrackVersion } from '@/components/analytics/server-data';
import { withCohortMemberships } from './memberships';
import type { SessionUser } from '@/lib/schemas/domain';
import { ReviewScheduleDocSchema, type ReviewScheduleDoc } from '@/lib/schemas/learning';
import type { TrackDoc, TrackVersionDoc } from '@/lib/schemas/curriculum';
import { isTrackVisibleToLearner } from './track-loader';
import { buildRetentionQueue, type RetentionQueueResult } from './retention-queue-core';

export * from './retention-queue-core';

/**
 * Load a learner's Knowledge Retention queue across all visible published Tracks.
 * Queries Firestore via `adminDb` and strips all answer keys/rationales before returning.
 */
export async function loadRetentionQueueForUser(
  user: SessionUser,
  options?: { trackId?: string; nowMs?: number },
): Promise<RetentionQueueResult> {
  const nowMs = options?.nowMs ?? Date.now();
  const [published, scope] = await Promise.all([loadPublishedTracks(), withCohortMemberships(user)]);
  const visibleTracks = published.filter((track) => track.publishedVersionId && isTrackVisibleToLearner(track, scope));

  const [versions, schedulesSnap] = await Promise.all([
    Promise.all(
      visibleTracks.map((track) =>
        track.publishedVersionId ? loadTrackVersion(track.id, track.publishedVersionId) : Promise.resolve(null),
      ),
    ),
    adminDb.collection('reviewSchedules').where('learnerId', '==', user.uid).get(),
  ]);

  const tracksWithVersions: Array<{ track: TrackDoc; version: TrackVersionDoc }> = [];
  visibleTracks.forEach((track, index) => {
    const version = versions[index];
    if (version) tracksWithVersions.push({ track, version });
  });

  const schedules: ReviewScheduleDoc[] = [];
  for (const doc of schedulesSnap.docs) {
    const parsed = ReviewScheduleDocSchema.safeParse({ ...doc.data(), id: doc.id });
    if (parsed.success) schedules.push(parsed.data);
  }

  return buildRetentionQueue({
    tracks: tracksWithVersions,
    schedules,
    nowMs,
    filterTrackId: options?.trackId,
  });
}
