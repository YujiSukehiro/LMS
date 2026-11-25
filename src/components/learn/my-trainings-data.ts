/**
 * Server-only loader for the signed-in user's own assigned trainings ("My Trainings"), for every role.
 * Never import from a client component.
 */
import type { SessionUser } from '@/lib/schemas/domain';
import type { EnrollmentDoc } from '@/lib/schemas/analytics';
import type { TrackDoc } from '@/lib/schemas/curriculum';
import { isTrackOnMyTrainings } from '@/lib/services/track-loader';
import { withCohortMemberships } from '@/lib/services/memberships';
import { loadEnrollmentsForUser, loadPublishedTracks } from '@/components/analytics/server-data';

export interface MyTrainings {
  /** In progress first, then not started, then certified. */
  tracks: TrackDoc[];
  enrollmentByTrack: Map<string, EnrollmentDoc>;
  /** Assigned Tracks the user has not certified yet. */
  openCount: number;
  certifiedCount: number;
}

export function sortMyTrainings(tracks: readonly TrackDoc[], enrollmentByTrack: ReadonlyMap<string, EnrollmentDoc>): TrackDoc[] {
  const order = (track: TrackDoc) => {
    const status = enrollmentByTrack.get(track.id)?.status ?? 'NOT_STARTED';
    return status === 'IN_PROGRESS' ? 0 : status === 'NOT_STARTED' ? 1 : 2;
  };
  return [...tracks].sort((a, b) => order(a) - order(b));
}

export async function loadMyTrainings(user: SessionUser): Promise<MyTrainings> {
  const [rawTracks, enrollments, scope] = await Promise.all([
    // Every published Track: Every Cohort, extra Cohorts and one-by-one assignments decide what is on the list.
    loadPublishedTracks(),
    loadEnrollmentsForUser(user.uid),
    withCohortMemberships(user),
  ]);
  const assigned = rawTracks.filter((track) => isTrackOnMyTrainings(track, scope));
  const assignedIds = new Set(assigned.map((t) => t.id));
  const enrollmentByTrack = new Map(
    enrollments.filter((e) => assignedIds.has(e.trackId)).map((e) => [e.trackId, e] as const),
  );
  const certifiedCount = assigned.filter((t) => enrollmentByTrack.get(t.id)?.status === 'CERTIFIED').length;
  return {
    tracks: sortMyTrainings(assigned, enrollmentByTrack),
    enrollmentByTrack,
    openCount: assigned.length - certifiedCount,
    certifiedCount,
  };
}
