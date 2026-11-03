/**
 * Controlled, local-only Standard Meds draft import.
 *
 *   npx tsx scripts/seed-standard-meds-drafts.ts --dry-run
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npx tsx scripts/seed-standard-meds-drafts.ts --confirm-synthetic-local
 *
 * No production override exists. The script never starts an emulator, uploads source PDFs,
 * approves content, publishes versions, or initializes Firebase during a dry run.
 */
import type { Firestore } from 'firebase-admin/firestore';
import {
  assertStandardMedsDraftImportWriteGate,
  buildStandardMedsDraftImport,
  standardMedsDraftImportWriteAction,
  type StandardMedsDraftImportPlan,
} from '../src/lib/services/standard-meds-draft-import';

const WRITE_CHUNK_SIZE = 200;

function countByKind(plan: StandardMedsDraftImportPlan): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const write of plan.writes) counts[write.kind] = (counts[write.kind] ?? 0) + 1;
  return counts;
}

function printSummary(plan: StandardMedsDraftImportPlan, dryRun: boolean): void {
  console.log(JSON.stringify({
    mode: dryRun ? 'dry-run' : 'confirmed-synthetic-local',
    schemaValidated: true,
    documents: countByKind(plan),
    totalDocuments: plan.writes.length,
    tracks: plan.tracks.map((track) => ({
      sourceCode: track.sourceCode,
      trackId: track.trackId,
      versionId: track.versionId,
      sourceBundleId: track.sourceBundleId,
      units: track.unitCount,
      scenarios: track.scenarioCount,
      pageEvidence: track.pageEvidenceCount,
      publicationEligible: track.publication.eligible,
      approvalStatus: track.publication.approvalStatus,
      openSmeDecisionIds: track.openSmeDecisionIds,
      publicationBlockers: track.publication.blockers,
      importIssues: track.importIssues,
    })),
  }, null, 2));
}

async function writePlan(db: Firestore, plan: StandardMedsDraftImportPlan): Promise<{ written: number; skipped: number }> {
  // Fail the entire run before the first write if any currently protected target would change.
  const refs = plan.writes.map((write) => db.doc(write.path));
  const existing = await db.getAll(...refs);
  existing.forEach((snapshot, index) => {
    standardMedsDraftImportWriteAction(plan.writes[index], snapshot.exists ? snapshot.data() : undefined);
  });

  let written = 0;
  let skipped = 0;
  for (let start = 0; start < plan.writes.length; start += WRITE_CHUNK_SIZE) {
    const chunk = plan.writes.slice(start, start + WRITE_CHUNK_SIZE);
    await db.runTransaction(async (transaction) => {
      const chunkRefs = chunk.map((write) => db.doc(write.path));
      const snapshots = await Promise.all(chunkRefs.map((ref) => transaction.get(ref)));
      // All transaction reads precede all writes.
      snapshots.forEach((snapshot, index) => {
        const write = chunk[index];
        const action = standardMedsDraftImportWriteAction(write, snapshot.exists ? snapshot.data() : undefined);
        if (action === 'skip') {
          skipped += 1;
          return;
        }
        transaction.set(chunkRefs[index], write.data);
        written += 1;
      });
    });
  }
  return { written, skipped };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const allowed = new Set(['--dry-run', '--confirm-synthetic-local']);
  const unknown = args.filter((arg) => !allowed.has(arg));
  if (unknown.length > 0) throw new Error(`Unknown argument(s): ${unknown.join(', ')}. No production override is supported.`);
  if (new Set(args).size !== args.length) throw new Error('Pass each import flag at most once.');

  const dryRun = args.includes('--dry-run');
  const plan = buildStandardMedsDraftImport();
  if (dryRun) {
    printSummary(plan, true);
    console.log(`Dry run only: validated ${plan.writes.length} documents; no Firebase initialization or writes occurred.`);
    return;
  }

  assertStandardMedsDraftImportWriteGate({
    confirmSyntheticLocal: args.includes('--confirm-synthetic-local'),
    firestoreEmulatorHost: process.env.FIRESTORE_EMULATOR_HOST,
  });

  // Credential-less Admin initialization is deliberately delayed until both write gates pass.
  const [{ getApps, initializeApp }, { getFirestore }] = await Promise.all([
    import('firebase-admin/app'),
    import('firebase-admin/firestore'),
  ]);
  const app = getApps()[0] ?? initializeApp({
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || 'demo-standard-meds-drafts',
  });
  const db = getFirestore(app);
  printSummary(plan, false);
  const result = await writePlan(db, plan);
  console.log(`Synthetic emulator import complete: ${result.written} written, ${result.skipped} unchanged; 0 approved and 0 published.`);
}

main().catch((error: unknown) => {
  console.error('Standard Meds draft import failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
