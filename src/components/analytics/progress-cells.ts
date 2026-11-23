/**
 * Server-only: one readiness status per agent per Track, from the same rule on every screen
 * (Team Progress, supervisor home, Analytics). Wraps `deriveProgressCell` with the Firestore reads it needs.
 * Callers MUST apply Cohort isolation to `agents` and `enrollments` before calling.
 */
import { adminDb } from '@/lib/firebase/admin';
import type { EnrollmentDoc } from '@/lib/schemas/analytics';
import type { TrackDoc } from '@/lib/schemas/curriculum';
import { CertificationDocSchema, type CertificationDoc } from '@/lib/schemas/learning';
import { selectCurrentCertification } from '@/lib/services/learning-evidence';
import { loadVersion } from '@/lib/services/track-loader';
import { deriveProgressCell, type ProgressCell, type ProgressTrackShape } from '@/lib/services/team-progress';
import { isTrackAssignedToCohort, type UserSummary } from './server-data';

export interface ProgressTrack {
  track: TrackDoc;
  shape: ProgressTrackShape;
  /** When the published version went live, or null when unknown. */
  publishedAt: number | null;
}

/** Load the published version of each Track (Checkpoints and scenarios only). Tracks that fail to load get an empty shape. */
export async function loadProgressTracks(tracks: readonly TrackDoc[]): Promise<ProgressTrack[]> {
  const versions = await Promise.all(
    tracks.map((track) => (track.publishedVersionId ? loadVersion(track.id, track.publishedVersionId).catch(() => null) : Promise.resolve(null))),
  );
  return tracks.map((track, index) => {
    const version = versions[index];
    return {
      track,
      publishedAt: version?.publishedAt ?? null,
      shape: {
        units: [...(version?.units ?? [])].sort((a, b) => a.orderIndex - b.orderIndex).map((unit) => ({ id: unit.id, title: unit.title })),
        scenarios: (version?.simScenarios ?? []).map((scenario) => ({
          id: scenario.id,
          title: scenario.title,
          passScoreThreshold: scenario.passScoreThreshold,
        })),
      },
    };
  });
}

/**
 * Current certification per `${learnerId}::${trackId}` for the given agents. `cohortScope` limits the result to one
 * Cohort (partner supervisors); null means internal ops.
 */
export async function loadCurrentCertifications(
  trackIds: readonly string[],
  agentIds: ReadonlySet<string>,
  cohortScope: string | null,
): Promise<Map<string, CertificationDoc | null>> {
  const snaps = await Promise.all(trackIds.map((trackId) => adminDb.collection('certifications').where('trackId', '==', trackId).get()));
  const byKey = new Map<string, CertificationDoc[]>();
  for (const doc of snaps.flatMap((snap) => snap.docs)) {
    const parsed = CertificationDocSchema.safeParse({ ...doc.data(), id: doc.id });
    if (!parsed.success) continue;
    const certification = parsed.data;
    if (!agentIds.has(certification.learnerId) || (cohortScope !== null && certification.partnerCohortId !== cohortScope)) continue;
    const key = `${certification.learnerId}::${certification.trackId}`;
    byKey.set(key, [...(byKey.get(key) ?? []), certification]);
  }
  return new Map([...byKey].map(([key, list]) => [key, selectCurrentCertification(list)]));
}

function epochMs(value: unknown): number | null {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object' && 'seconds' in value && typeof (value as { seconds: unknown }).seconds === 'number') {
    return (value as { seconds: number }).seconds * 1000;
  }
  return null;
}

/** Status cells keyed by agent uid, then Track id. */
export function buildProgressCells(args: {
  tracks: readonly ProgressTrack[];
  agents: readonly UserSummary[];
  enrollments: readonly EnrollmentDoc[];
  certifications: ReadonlyMap<string, CertificationDoc | null>;
  now?: number;
}): Map<string, Record<string, ProgressCell>> {
  const now = args.now ?? Date.now();
  const enrollmentByKey = new Map(args.enrollments.map((enrollment) => [`${enrollment.userId}::${enrollment.trackId}`, enrollment]));
  return new Map(
    args.agents.map((agent) => {
      const joinedAt = epochMs(agent.createdAt);
      const cells = Object.fromEntries(
        args.tracks.map(({ track, shape, publishedAt }) => {
          const key = `${agent.uid}::${track.id}`;
          const assignedAt = publishedAt === null && joinedAt === null ? null : Math.max(publishedAt ?? 0, joinedAt ?? 0);
          return [
            track.id,
            deriveProgressCell({
              track: shape,
              enrollment: enrollmentByKey.get(key),
              certification: args.certifications.get(key) ?? null,
              assigned: isTrackAssignedToCohort(track, agent.partnerCohortId),
              agentActive: agent.active,
              assignedAt,
              now,
            }),
          ];
        }),
      );
      return [agent.uid, cells];
    }),
  );
}
