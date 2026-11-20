/**
 * Server-only loaders for Track data (firebase-admin). Every document is validated with zod.
 * Never import this module from a client component.
 */
import { adminDb } from '@/lib/firebase/admin';
import { isInternalOps } from '@/lib/firebase/auth-guard';
import {
  DRAFT_VERSION_ID,
  EVAL_RUBRICS_DOC_ID,
  EvalRubricsDocSchema,
  TrackDocSchema,
  TrackVersionDocSchema,
  type EvalRubricsDoc,
  type SecretSimScenarioConfig,
  type TrackDoc,
  type TrackVersionDoc,
} from '@/lib/schemas/curriculum';
import { ALL_COHORTS_ID } from '@/lib/schemas/constants';
import { TRAINING_POLICY } from '@/lib/policy/training-policy';
import type { SessionUser } from '@/lib/schemas/domain';
import { ServiceError } from './errors';

function trackRef(trackId: string) {
  return adminDb.collection('tracks').doc(trackId);
}

function versionRef(trackId: string, versionId: string) {
  return trackRef(trackId).collection('versions').doc(versionId);
}

function evalRubricsRef(trackId: string, versionId: string) {
  return versionRef(trackId, versionId).collection('secrets').doc(EVAL_RUBRICS_DOC_ID);
}

/** Firestore document IDs cannot contain '/' and cannot be '.' or '..'. */
function isSafeDocId(id: string): boolean {
  return id.length > 0 && id.length <= 1500 && !id.includes('/') && id !== '.' && id !== '..';
}

/** Load `tracks/{trackId}`. Returns null when the Track does not exist. */
export async function loadTrack(trackId: string): Promise<TrackDoc | null> {
  if (!isSafeDocId(trackId)) return null;
  const snap = await trackRef(trackId).get();
  if (!snap.exists) return null;
  const parsed = TrackDocSchema.safeParse({ ...snap.data(), id: snap.id });
  if (!parsed.success) {
    console.error(`[track-loader] Track ${trackId} has an invalid shape`, parsed.error.flatten());
    throw new ServiceError(500, 'TRACK_DATA_INVALID', 'The Track data is not valid. Contact a Trainer.');
  }
  return parsed.data;
}

/** Load `tracks/{trackId}/versions/{versionId}`. Returns null when the TrackVersion does not exist. */
export async function loadVersion(trackId: string, versionId: string): Promise<TrackVersionDoc | null> {
  if (!isSafeDocId(trackId) || !isSafeDocId(versionId)) return null;
  const snap = await versionRef(trackId, versionId).get();
  if (!snap.exists) return null;
  const parsed = TrackVersionDocSchema.safeParse({ versionId: snap.id, trackId, ...snap.data() });
  if (!parsed.success) {
    console.error(`[track-loader] TrackVersion ${trackId}/${versionId} has an invalid shape`, parsed.error.flatten());
    throw new ServiceError(500, 'TRACK_VERSION_DATA_INVALID', 'The TrackVersion data is not valid. Contact a Trainer.');
  }
  return parsed.data;
}

/**
 * Load the secret Simulation configs `tracks/{trackId}/versions/{versionId}/secrets/evalRubrics`.
 * SERVER ONLY. Never serialize the result to a browser for AGENT or PARTNER_SUPERVISOR users.
 */
export async function loadEvalRubrics(trackId: string, versionId: string): Promise<EvalRubricsDoc | null> {
  if (!isSafeDocId(trackId) || !isSafeDocId(versionId)) return null;
  const snap = await evalRubricsRef(trackId, versionId).get();
  if (!snap.exists) return null;
  const parsed = EvalRubricsDocSchema.safeParse({ trackId, versionId, ...snap.data() });
  if (!parsed.success) {
    console.error(`[track-loader] evalRubrics ${trackId}/${versionId} has an invalid shape`, parsed.error.flatten());
    throw new ServiceError(500, 'SIM_SECRETS_INVALID', 'The Simulation configuration is not valid. Contact a Trainer.');
  }
  return parsed.data;
}

/** Load the secret config of one Simulation scenario, or null when it is missing. SERVER ONLY. */
export async function loadSecretScenario(
  trackId: string,
  versionId: string,
  scenarioId: string,
): Promise<SecretSimScenarioConfig | null> {
  const rubrics = await loadEvalRubrics(trackId, versionId);
  return rubrics?.scenarios.find((s) => s.scenarioId === scenarioId) ?? null;
}

/** True when a published Track is assigned to the user's Cohort ('ALL' or the user's partnerCohortId). */
export function isTrackAssignedToUser(
  track: Pick<TrackDoc, 'assignedCohortIds'>,
  user: Pick<SessionUser, 'partnerCohortId'>,
): boolean {
  return (
    track.assignedCohortIds.includes(ALL_COHORTS_ID) || track.assignedCohortIds.includes(user.partnerCohortId)
  );
}

/** True when a learner (any role) can see and train on the Track's published version. */
export function isTrackVisibleToLearner(
  track: Pick<TrackDoc, 'status' | 'publishedVersionId' | 'assignedCohortIds' | 'divisionId'>,
  user: Pick<SessionUser, 'partnerCohortId'> & { divisionIds?: readonly string[] },
): boolean {
  if (track.status !== 'PUBLISHED' || !track.publishedVersionId || !isTrackAssignedToUser(track, user)) {
    return false;
  }
  if (TRAINING_POLICY.enforceLearnerDivisionVisibility && Array.isArray(user.divisionIds)) {
    return user.divisionIds.includes(track.divisionId);
  }
  return true;
}

export type ResolveVersionResult =
  | { ok: true; versionId: string; isDraft: boolean }
  | { ok: false; status: number; error: string; message: string };

/**
 * Select the TrackVersion the user may use.
 * - Internal ops (SUPER_ADMIN, ADMIN, TRAINER) may request 'draft' or any version ID.
 *   Without a request they get the published version, or the draft when nothing is published.
 * - AGENT and PARTNER_SUPERVISOR may only use the published version of a Track assigned to their Cohort.
 *   A request for a different version gets 409 VERSION_OUTDATED (the Track was published again).
 */
export function resolveLearnerVersion(
  user: SessionUser,
  track: TrackDoc,
  requestedVersionId?: string | null,
): ResolveVersionResult {
  const requested = requestedVersionId?.trim() || null;

  if (isInternalOps(user)) {
    if (requested) return { ok: true, versionId: requested, isDraft: requested === DRAFT_VERSION_ID };
    if (track.publishedVersionId) return { ok: true, versionId: track.publishedVersionId, isDraft: false };
    return { ok: true, versionId: DRAFT_VERSION_ID, isDraft: true };
  }

  if (!isTrackVisibleToLearner(track, user) || !track.publishedVersionId) {
    return { ok: false, status: 404, error: 'TRACK_NOT_FOUND', message: 'This Track is not available to you.' };
  }
  if (requested === DRAFT_VERSION_ID) {
    return {
      ok: false,
      status: 403,
      error: 'FORBIDDEN',
      message: 'Only Trainers and Admins can use the draft of a Track.',
    };
  }
  if (requested && requested !== track.publishedVersionId) {
    return {
      ok: false,
      status: 409,
      error: 'VERSION_OUTDATED',
      message: 'This Track has a new version. Reload the page to continue.',
    };
  }
  return { ok: true, versionId: track.publishedVersionId, isDraft: false };
}

export interface LearnerTrackContext {
  track: TrackDoc;
  version: TrackVersionDoc;
  versionId: string;
  isDraft: boolean;
}

/**
 * Load a Track and the TrackVersion the user may use (see resolveLearnerVersion).
 * Throws ServiceError (404/403/409) when the user cannot use it.
 */
export async function loadLearnerTrackContext(
  user: SessionUser,
  trackId: string,
  requestedVersionId?: string | null,
): Promise<LearnerTrackContext> {
  const track = await loadTrack(trackId);
  if (!track) throw new ServiceError(404, 'TRACK_NOT_FOUND', 'This Track does not exist.');

  const resolved = resolveLearnerVersion(user, track, requestedVersionId);
  if (!resolved.ok) throw new ServiceError(resolved.status, resolved.error, resolved.message);

  const version = await loadVersion(trackId, resolved.versionId);
  if (!version) throw new ServiceError(404, 'VERSION_NOT_FOUND', 'This version of the Track does not exist.');

  return { track, version, versionId: resolved.versionId, isDraft: resolved.isDraft };
}
