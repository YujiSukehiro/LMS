/**
 * LogiCall Pulse production Cohort bootstrap.
 *
 *   npx tsx scripts/seed-prod.ts --dry-run   (validate 8 default Cohorts without writing)
 *   npm run seed:prod                        (create missing default Cohorts in Firebase; never creates fake users)
 */
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { DEFAULT_COHORTS } from '../src/lib/schemas/constants';
import { CohortDocSchema, type CohortDoc } from '../src/lib/schemas/domain';
import { generateUniqueJoinCode } from '../src/lib/services/cohort-join-code';

const DRY_RUN = process.argv.includes('--dry-run');

function resolveProjectId(): string | undefined {
  return (
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCLOUD_PROJECT ||
    undefined
  );
}

function buildCohortDoc(
  seed: (typeof DEFAULT_COHORTS)[number],
  existingCodes: Set<string>,
  now: number,
): CohortDoc {
  const joinCode = seed.isInternal ? null : generateUniqueJoinCode(seed.id, existingCodes);
  if (joinCode) existingCodes.add(joinCode);
  return CohortDocSchema.parse({
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
}

async function main(): Promise<void> {
  const now = Date.now();
  const usedCodes = new Set<string>();

  if (DRY_RUN) {
    const preview = DEFAULT_COHORTS.map((seed) => {
      const doc = buildCohortDoc(seed, usedCodes, now);
      return {
        cohortId: doc.id,
        name: doc.name,
        internal: doc.isInternal,
        divisions: doc.defaultDivisionIds.join(','),
        joinCode: doc.joinCode ?? '(invite only)',
      };
    });
    console.table(preview);
    console.log(`Dry run: ${preview.length} default Cohorts validated (0 users created).`);
    return;
  }

  const projectId = resolveProjectId();
  const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
  const app =
    getApps()[0] ??
    initializeApp(emulatorHost ? { projectId } : { credential: applicationDefault(), projectId });
  const db = getFirestore(app);
  const collection = db.collection('cohorts');

  const existingSnaps = await collection.get();
  const existingById = new Map(existingSnaps.docs.map((doc) => [doc.id, doc]));
  for (const doc of existingSnaps.docs) {
    const code = doc.get('joinCode');
    if (typeof code === 'string' && code.length > 0) usedCodes.add(code);
  }

  const summary: Array<{ cohortId: string; status: 'created' | 'already-exists'; joinCode: string }> = [];
  for (const seed of DEFAULT_COHORTS) {
    const existing = existingById.get(seed.id);
    if (existing) {
      const existingCode = existing.get('joinCode');
      summary.push({
        cohortId: seed.id,
        status: 'already-exists',
        joinCode: typeof existingCode === 'string' ? existingCode : '(invite only)',
      });
      continue;
    }

    const doc = buildCohortDoc(seed, usedCodes, now);
    await collection.doc(doc.id).create(doc);
    summary.push({
      cohortId: doc.id,
      status: 'created',
      joinCode: doc.joinCode ?? '(invite only)',
    });
  }

  console.table(summary);
  console.log('Production Cohort bootstrap complete (0 fake users created).');
}

main().catch((error) => {
  console.error('[seed:prod] failed:', error);
  process.exit(1);
});
