/**
 * Extra Cohort memberships (users/{uid}.cohortIds). They are not in the session claims, so a membership change takes
 * effect at once without signing the person out. SERVER ONLY.
 */
import { cache } from 'react';
import { adminDb } from '@/lib/firebase/admin';

/** The extra Cohorts of one user (deduplicated per request). Empty when none or unreadable. */
export const loadExtraCohortIds = cache(async (uid: string): Promise<string[]> => {
  try {
    const snap = await adminDb.collection('users').doc(uid).get();
    const raw = snap.get('cohortIds');
    return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
});

/** The user with their extra Cohort memberships attached, for Track assignment checks. */
export async function withCohortMemberships<T extends { uid: string }>(user: T): Promise<T & { cohortIds: string[] }> {
  return { ...user, cohortIds: await loadExtraCohortIds(user.uid) };
}

/** Normalize a membership list: trimmed, unique, without the home Cohort. */
export function normalizeExtraCohorts(cohortIds: readonly string[], homeCohortId: string): string[] {
  return [...new Set(cohortIds.map((id) => id.trim()).filter((id) => id && id !== homeCohortId))];
}
