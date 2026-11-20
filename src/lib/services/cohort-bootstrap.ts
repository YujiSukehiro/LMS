import { adminDb } from '@/lib/firebase/admin';
import { DEFAULT_COHORTS } from '@/lib/schemas/constants';
import { CohortDocSchema } from '@/lib/schemas/domain';
import { generateUniqueJoinCode } from '@/lib/services/cohort-join-code';

/**
 * Idempotently ensure the 8 default LogiCall Cohorts exist in Cloud Firestore.
 * Safe in production: never overwrites existing Cohorts or activeAgentCount and never creates fake users.
 */
export async function ensureDefaultCohortsSeeded(): Promise<{ createdIds: string[]; existingIds: string[] }> {
  const cohortsCol = adminDb.collection('cohorts');
  if (typeof cohortsCol.get !== 'function') {
    return { createdIds: [], existingIds: [] };
  }

  const existingSnaps = await cohortsCol.get();
  const existingIdsSet = new Set(existingSnaps.docs.map((doc) => doc.id));
  const usedCodes = new Set(
    existingSnaps.docs
      .map((doc) => doc.get('joinCode'))
      .filter((code): code is string => typeof code === 'string' && code.length > 0),
  );

  const now = Date.now();
  const createdIds: string[] = [];
  const existingIds: string[] = [];

  for (const seed of DEFAULT_COHORTS) {
    if (existingIdsSet.has(seed.id)) {
      existingIds.push(seed.id);
      continue;
    }

    const joinCode = seed.isInternal ? null : generateUniqueJoinCode(seed.id, usedCodes);
    if (joinCode) usedCodes.add(joinCode);

    const cohortDoc = CohortDocSchema.parse({
      id: seed.id,
      name: seed.name,
      isInternal: seed.isInternal,
      defaultDivisionIds: [...seed.defaultDivisionIds],
      activeAgentCount: 0,
      joinCode,
      joinCodeEnabled: !seed.isInternal,
      createdAt: now,
      updatedAt: now,
    });

    await cohortsCol.doc(cohortDoc.id).create(cohortDoc);
    createdIds.push(cohortDoc.id);
  }

  return { createdIds, existingIds };
}
