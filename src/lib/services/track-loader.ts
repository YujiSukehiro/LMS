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
import { STAFF_ROLES } from '@/lib/auth/rbac';
import { ServiceError } from './errors';
import { withCohortMemberships } from './memberships';

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

/** Who a Track can be assigned to: the home Cohort, any extra Cohorts, and the person themself. */
export interface AssignmentScope {
  partnerCohortId: string;
  uid?: string;
  /** Extra Cohort memberships (users/{uid}.cohortIds). */
  cohortIds?: readonly string[];
}

/** True when a Track is assigned to the user: every Cohort, one of their Cohorts, or them by name. */
export function isTrackAssignedToUser(
  track: Pick<TrackDoc, 'assignedCohortIds'> & { assignedUserIds?: readonly string[] },
  user: AssignmentScope,
): boolean {
  const cohorts = track.assignedCohortIds;
  if (cohorts.includes(ALL_COHORTS_ID) || cohorts.includes(user.partnerCohortId)) return true;
  if (user.cohortIds?.some((id) => cohorts.includes(id))) return true;
  return Boolean(user.uid && track.assignedUserIds?.includes(user.uid));
}

/**
 * True when the Track is assigned to this learner: their Cohort is assigned and, while GATE-05 is on, their
 * divisionIds include the Track's Division. Ignores publish state (use isTrackVisibleToLearner for access).
 */
export function isTrackAssignedToLearner(
  track: Pick<TrackDoc, 'assignedCohortIds' | 'assignedUserIds' | 'divisionId'>,
  user: AssignmentScope & { divisionIds?: readonly string[] },
): boolean {
  if (!isTrackAssignedToUser(track, user)) return false;
  if (!TRAINING_POLICY.enforceLearnerDivisionVisibility) return true;
  // Fail closed: a learner record without divisionIds sees no division-scoped Track.
  return Array.isArray(user.divisionIds) && user.divisionIds.includes(track.divisionId);
}

/** True when a learner (any role) can see and train on the Track's published version. */
export function isTrackVisibleToLearner(
  track: Pick<TrackDoc, 'status' | 'publishedVersionId' | 'assignedCohortIds' | 'assignedUserIds' | 'divisionId'>,
  user: AssignmentScope & { divisionIds?: readonly string[] },
): boolean {
  return track.status === 'PUBLISHED' && Boolean(track.publishedVersionId) && isTrackAssignedToLearner(track, user);
}

/**
 * True when the published Track belongs on the user's "My Trainings" list (every role takes assigned trainings).
 * Learners (Agents, Partner Supervisors) follow isTrackVisibleToLearner, Division gate included. Internal staff
 * (Trainer, Admin, Super Admin) can open any published Track, so the Division gate is not applied to them: a
 * compliance Track for "Every Cohort", their internal Cohort or them by name is on their list.
 */
export function isTrackOnMyTrainings(
  track: Pick<TrackDoc, 'status' | 'publishedVersionId' | 'assignedCohortIds' | 'assignedUserIds' | 'divisionId'>,
  user: AssignmentScope & { role: SessionUser['role']; divisionIds?: readonly string[] },
): boolean {
  if (track.status !== 'PUBLISHED' || !track.publishedVersionId) return false;
  if (STAFF_ROLES.includes(user.role)) return isTrackAssignedToUser(track, user);
  return isTrackVisibleToLearner(track, user);
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
  user: SessionUser & { cohortIds?: readonly string[] },
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

  // Learners: extra Cohort memberships count too (internal ops skip the lookup).
  const scoped = isInternalOps(user) ? user : await withCohortMemberships(user);
  const resolved = resolveLearnerVersion(scoped, track, requestedVersionId);
  if (!resolved.ok) throw new ServiceError(resolved.status, resolved.error, resolved.message);

  const version = await loadVersion(trackId, resolved.versionId);
  if (!version) throw new ServiceError(404, 'VERSION_NOT_FOUND', 'This version of the Track does not exist.');

  return { track, version, versionId: resolved.versionId, isDraft: resolved.isDraft };
}
