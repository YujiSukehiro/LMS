/**
 * Who must take a Track: Cohorts and individual people (Connor 2026-11-24). Shared by Publish and the
 * assignment endpoints so both validate the same way. SERVER ONLY.
 */
import { adminDb } from '@/lib/firebase/admin';
import { ALL_COHORTS_ID } from '@/lib/schemas/constants';
import { ServiceError } from './errors';

export interface TrackAssignment {
  assignedCohortIds: string[];
  assignedUserIds: string[];
}

const unique = (ids: readonly string[]) => [...new Set(ids.map((id) => id.trim()).filter(Boolean))];

/** Normalize and check an assignment: Cohorts and users must exist. 'ALL' replaces any other Cohort. */
export async function resolveTrackAssignment(input: { cohortIds: readonly string[]; userIds: readonly string[] }): Promise<TrackAssignment> {
  const cohortIds = unique(input.cohortIds);
  const userIds = unique(input.userIds);
  let assignedCohortIds: string[] = [];
  if (cohortIds.includes(ALL_COHORTS_ID)) {
    assignedCohortIds = [ALL_COHORTS_ID];
  } else if (cohortIds.length > 0) {
    const snaps = await adminDb.getAll(...cohortIds.map((id) => adminDb.collection('cohorts').doc(id)));
    const missing = snaps.filter((snap) => !snap.exists).map((snap) => snap.id);
    if (missing.length > 0) throw new ServiceError(400, 'VALIDATION_FAILED', `These Cohorts do not exist: ${missing.join(', ')}.`);
    assignedCohortIds = cohortIds;
  }
  if (userIds.length > 0) {
    const snaps = await adminDb.getAll(...userIds.map((uid) => adminDb.collection('users').doc(uid)));
    const missing = snaps.filter((snap) => !snap.exists).map((snap) => snap.id);
    if (missing.length > 0) throw new ServiceError(400, 'VALIDATION_FAILED', `${missing.length} selected ${missing.length === 1 ? 'person does' : 'people do'} not exist.`);
  }
  if (assignedCohortIds.length === 0 && userIds.length === 0) {
    throw new ServiceError(400, 'VALIDATION_FAILED', 'Pick at least one Cohort or person.');
  }
  return { assignedCohortIds, assignedUserIds: userIds };
}
