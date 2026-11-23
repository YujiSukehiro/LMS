/**
 * Server-only loader for learner pages. Never import from a client component.
 * Applies the same access rules as firestore.rules + the swarm brief:
 * - AGENT / PARTNER_SUPERVISOR: Track must be PUBLISHED and assigned to 'ALL' or their Cohort; always the published TrackVersion.
 * - Internal ops (SUPER_ADMIN / ADMIN / TRAINER): any published Track, or the draft with `?version=draft`.
 */
import { notFound } from 'next/navigation';
import { adminDb } from '@/lib/firebase/admin';
import { isInternalOps, requirePageUser } from '@/lib/firebase/auth-guard';
import { EnrollmentDocSchema, enrollmentIdFor, SimSessionDocSchema, type EnrollmentDoc } from '@/lib/schemas/analytics';
import {
  DRAFT_VERSION_ID,
  TrackDocSchema,
  TrackVersionDocSchema,
  type TrackDoc,
  type TrackVersionDoc,
} from '@/lib/schemas/curriculum';
import { isTrackVisibleToLearner } from '@/lib/services/track-loader';
import type { SessionUser } from '@/lib/schemas/domain';

export interface LearnContext {
  user: SessionUser;
  track: TrackDoc;
  version: TrackVersionDoc;
  versionId: string;
  /** true when an internal ops user is playing the draft: nothing is recorded. */
  isPreview: boolean;
  /** Internal ops may open locked nodes. */
  staffAccess: boolean;
  /** The user's enrollment for this Track (null = not started, or preview). */
  enrollment: EnrollmentDoc | null;
}

type SearchParamValue = string | string[] | undefined;

export function readVersionParam(value: SearchParamValue): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Decides which TrackVersion the user may load, or null when the Track is not visible to them. */
export function resolveVersionAccess(
  user: SessionUser,
  track: TrackDoc,
  requestedVersion: string | undefined,
): { versionId: string; isPreview: boolean } | null {
  const internal = isInternalOps(user);
  if (internal && requestedVersion === DRAFT_VERSION_ID) {
    return { versionId: track.currentDraftVersionId || DRAFT_VERSION_ID, isPreview: true };
  }
  const published = track.status === 'PUBLISHED' && track.publishedVersionId;
  if (internal) {
    if (published && track.publishedVersionId) return { versionId: track.publishedVersionId, isPreview: false };
    if (track.status === 'DRAFT') return { versionId: track.currentDraftVersionId || DRAFT_VERSION_ID, isPreview: true };
    return null;
  }
  if (!published || !track.publishedVersionId) return null;
  // Same rule as every learner API (Cohort + Division), so a direct URL never opens a Track the learner can't see.
  return isTrackVisibleToLearner(track, user) ? { versionId: track.publishedVersionId, isPreview: false } : null;
}

/** Loads everything a learner page needs, or calls `notFound()` when the Track is missing or not visible. */
export async function loadLearnContext(trackId: string, requestedVersion: string | undefined): Promise<LearnContext> {
  const user = await requirePageUser();

  const trackSnap = await adminDb.collection('tracks').doc(trackId).get();
  if (!trackSnap.exists) notFound();
  const trackParsed = TrackDocSchema.safeParse({ ...trackSnap.data(), id: trackSnap.id });
  if (!trackParsed.success) {
    throw new Error(`Track ${trackId} has data that does not match the Track schema.`);
  }
  const track = trackParsed.data;

  const access = resolveVersionAccess(user, track, requestedVersion);
  if (!access) notFound();

  const versionSnap = await adminDb
    .collection('tracks')
    .doc(trackId)
    .collection('versions')
    .doc(access.versionId)
    .get();
  if (!versionSnap.exists) notFound();
  const versionParsed = TrackVersionDocSchema.safeParse(versionSnap.data());
  if (!versionParsed.success) {
    throw new Error(`TrackVersion ${access.versionId} of Track ${trackId} has data that does not match the schema.`);
  }

  let enrollment: EnrollmentDoc | null = null;
  if (!access.isPreview) {
    const enrollmentSnap = await adminDb.collection('enrollments').doc(enrollmentIdFor(user.uid, trackId)).get();
    if (enrollmentSnap.exists) {
      const parsed = EnrollmentDocSchema.safeParse(enrollmentSnap.data());
      if (parsed.success) enrollment = parsed.data;
    }
  }

  return {
    user,
    track,
    version: versionParsed.data,
    versionId: access.versionId,
    isPreview: access.isPreview,
    staffAccess: isInternalOps(user),
    enrollment,
  };
}

/** Best evaluated score per scenario for this user on this Track (published sessions only). */
export async function loadBestScenarioScores(userId: string, trackId: string): Promise<Record<string, number>> {
  const best: Record<string, number> = {};
  try {
    const snap = await adminDb
      .collection('simSessions')
      .where('userId', '==', userId)
      .where('trackId', '==', trackId)
      .where('status', '==', 'EVALUATED')
      .limit(200)
      .get();
    for (const doc of snap.docs) {
      const parsed = SimSessionDocSchema.safeParse(doc.data());
      if (!parsed.success || !parsed.data.evaluation || parsed.data.versionId === DRAFT_VERSION_ID) continue;
      const { scenarioId, evaluation } = parsed.data;
      best[scenarioId] = Math.max(best[scenarioId] ?? 0, evaluation.overallScorePct);
    }
  } catch (error) {
    console.error('[learn] Could not load Simulation scores', error);
  }
  return best;
}
