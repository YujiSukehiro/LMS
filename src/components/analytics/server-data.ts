/**
 * Server-only Firestore readers for the dashboard home, Track Studio and Analytics pages.
 * Every reader uses firebase-admin; callers MUST apply Cohort isolation before they call these functions
 * (PARTNER_SUPERVISOR: own partnerCohortId only; AGENT: own data only).
 * Never import this file from a client component.
 */
import type { z } from 'zod';
import { adminDb } from '@/lib/firebase/admin';
import {
  AnalyticsRollupDocSchema,
  EnrollmentDocSchema,
  SimSessionDocSchema,
  rollupIdForCohort,
  rollupIdForDivision,
  rollupIdForGlobal,
  type AnalyticsRollupDoc,
  type EnrollmentDoc,
  type PillarAggregate,
  type SimSessionDoc,
} from '@/lib/schemas/analytics';
import {
  DRAFT_VERSION_ID,
  EVAL_RUBRICS_DOC_ID,
  EvalRubricsDocSchema,
  TrackDocSchema,
  TrackVersionDocSchema,
  type SecretSimScenarioConfig,
  type TrackDoc,
  type TrackVersionDoc,
} from '@/lib/schemas/curriculum';
import { CohortDocSchema, DivisionIdSchema, UserDocSchema, type DivisionId } from '@/lib/schemas/domain';
import { ALL_COHORTS_ID, DEFAULT_COHORTS } from '@/lib/schemas/constants';

/** The subset of `users/{uid}` that dashboards read (timestamps and preferences are not needed). */
export const UserSummarySchema = UserDocSchema.pick({
  uid: true,
  email: true,
  lcNumber: true,
  displayName: true,
  role: true,
  partnerCohortId: true,
  divisionIds: true,
  active: true,
  stats: true,
  skillScoresByPillar: true,
});
export type UserSummary = z.infer<typeof UserSummarySchema>;

function parseDocs<T>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  docs: Array<{ id: string; data: () => unknown }>,
  idField?: string,
): T[] {
  const out: T[] = [];
  for (const doc of docs) {
    const raw = doc.data();
    const withId =
      idField && raw && typeof raw === 'object' && !(idField in raw) ? { ...raw, [idField]: doc.id } : raw;
    const parsed = schema.safeParse(withId);
    if (parsed.success) out.push(parsed.data);
    else console.warn(`[pulse] Skipped document ${doc.id}: it does not match the schema.`);
  }
  return out;
}

function parseOne<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, id: string, raw: unknown): T | null {
  if (raw === undefined) return null;
  const parsed = schema.safeParse(raw);
  if (parsed.success) return parsed.data;
  console.warn(`[pulse] Document ${id} does not match the schema.`);
  return null;
}

// ---------------- Rollups ----------------

export async function loadRollup(rollupId: string): Promise<AnalyticsRollupDoc | null> {
  const snap = await adminDb.collection('analyticsRollups').doc(rollupId).get();
  return parseOne(AnalyticsRollupDocSchema, rollupId, snap.exists ? snap.data() : undefined);
}

export async function loadRollups(rollupIds: string[]): Promise<Map<string, AnalyticsRollupDoc>> {
  const out = new Map<string, AnalyticsRollupDoc>();
  if (rollupIds.length === 0) return out;
  const refs = rollupIds.map((id) => adminDb.collection('analyticsRollups').doc(id));
  const snaps = await adminDb.getAll(...refs);
  for (const snap of snaps) {
    if (!snap.exists) continue;
    const parsed = parseOne(AnalyticsRollupDocSchema, snap.id, snap.data());
    if (parsed) out.set(snap.id, parsed);
  }
  return out;
}

export async function loadGlobalAndDivisionRollups(): Promise<{
  global: AnalyticsRollupDoc | null;
  divisions: Record<DivisionId, AnalyticsRollupDoc | null>;
}> {
  const divisionIds = DivisionIdSchema.options;
  const map = await loadRollups([rollupIdForGlobal(), ...divisionIds.map((d) => rollupIdForDivision(d))]);
  const divisions = Object.fromEntries(
    divisionIds.map((d) => [d, map.get(rollupIdForDivision(d)) ?? null]),
  ) as Record<DivisionId, AnalyticsRollupDoc | null>;
  return { global: map.get(rollupIdForGlobal()) ?? null, divisions };
}

/** All COHORT_* rollups (internal ops only). */
export async function loadAllCohortRollups(): Promise<AnalyticsRollupDoc[]> {
  const snap = await adminDb.collection('analyticsRollups').where('scopeType', '==', 'COHORT').get();
  return parseDocs(AnalyticsRollupDocSchema, snap.docs).filter((r) => r.partnerCohortId);
}

export async function loadCohortRollup(cohortId: string): Promise<AnalyticsRollupDoc | null> {
  return loadRollup(rollupIdForCohort(cohortId));
}

export function pillarAverage(agg: PillarAggregate | undefined): number | null {
  if (!agg || agg.sampleCount <= 0) return null;
  return agg.scoreSum / agg.sampleCount;
}

/** Readiness of a rollup = mean of pillar averages with data (null when no data). */
export function rollupReadiness(rollup: AnalyticsRollupDoc | null): number | null {
  if (!rollup) return null;
  const values = Object.values(rollup.pillarAggregates)
    .map((agg) => pillarAverage(agg))
    .filter((v): v is number => v !== null);
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function simPassRate(rollup: AnalyticsRollupDoc | null): number | null {
  if (!rollup || rollup.totalSimAttempts === 0) return null;
  return (rollup.totalSimPasses / rollup.totalSimAttempts) * 100;
}

export interface MissedItemRow {
  key: string;
  trackId: string;
  itemId: string;
  itemLabel: string;
  missCount: number;
}

export function rankMissedItems(rollups: Array<AnalyticsRollupDoc | null>, limit: number): MissedItemRow[] {
  const merged = new Map<string, MissedItemRow>();
  for (const rollup of rollups) {
    if (!rollup) continue;
    for (const [key, entry] of Object.entries(rollup.missedItemCounts)) {
      const prev = merged.get(key);
      if (prev) prev.missCount += entry.missCount;
      else merged.set(key, { key, ...entry });
    }
  }
  return [...merged.values()]
    .filter((row) => row.missCount > 0)
    .sort((a, b) => b.missCount - a.missCount)
    .slice(0, limit);
}

// ---------------- Tracks ----------------

export async function loadAllTracks(): Promise<TrackDoc[]> {
  const snap = await adminDb.collection('tracks').get();
  return parseDocs(TrackDocSchema, snap.docs, 'id').sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function loadPublishedTracks(): Promise<TrackDoc[]> {
  const snap = await adminDb.collection('tracks').where('status', '==', 'PUBLISHED').get();
  return parseDocs(TrackDocSchema, snap.docs, 'id').sort((a, b) => b.updatedAt - a.updatedAt);
}

export function isTrackAssignedToCohort(track: TrackDoc, cohortId: string): boolean {
  return track.assignedCohortIds.includes(ALL_COHORTS_ID) || track.assignedCohortIds.includes(cohortId);
}

/** Published Tracks that a Cohort's learners can see. */
export async function loadPublishedTracksForCohort(cohortId: string): Promise<TrackDoc[]> {
  return (await loadPublishedTracks()).filter((t) => t.publishedVersionId && isTrackAssignedToCohort(t, cohortId));
}

export async function loadTrack(trackId: string): Promise<TrackDoc | null> {
  const snap = await adminDb.collection('tracks').doc(trackId).get();
  if (!snap.exists) return null;
  const raw = snap.data();
  const withId = raw && !('id' in raw) ? { ...raw, id: snap.id } : raw;
  return parseOne(TrackDocSchema, trackId, withId);
}

/** Draft TrackVersion + its secret Simulation configs. Internal ops only. */
export async function loadDraftWithSecrets(
  trackId: string,
): Promise<{ draft: TrackVersionDoc | null; secrets: SecretSimScenarioConfig[] }> {
  const draftRef = adminDb.collection('tracks').doc(trackId).collection('versions').doc(DRAFT_VERSION_ID);
  const [draftSnap, secretsSnap] = await Promise.all([
    draftRef.get(),
    draftRef.collection('secrets').doc(EVAL_RUBRICS_DOC_ID).get(),
  ]);
  const draft = parseOne(
    TrackVersionDocSchema,
    `${trackId}/draft`,
    draftSnap.exists ? draftSnap.data() : undefined,
  );
  const secretsDoc = parseOne(
    EvalRubricsDocSchema,
    `${trackId}/draft/secrets`,
    secretsSnap.exists ? secretsSnap.data() : undefined,
  );
  return { draft, secrets: secretsDoc?.scenarios ?? [] };
}

/** Learner-safe TrackVersion (no secrets). */
export async function loadTrackVersion(trackId: string, versionId: string): Promise<TrackVersionDoc | null> {
  const snap = await adminDb.collection('tracks').doc(trackId).collection('versions').doc(versionId).get();
  return parseOne(TrackVersionDocSchema, `${trackId}/${versionId}`, snap.exists ? snap.data() : undefined);
}

// ---------------- Users ----------------

export async function loadUser(uid: string): Promise<UserSummary | null> {
  const snap = await adminDb.collection('users').doc(uid).get();
  if (!snap.exists) return null;
  const raw = snap.data();
  const withUid = raw && !('uid' in raw) ? { ...raw, uid: snap.id } : raw;
  return parseOne(UserSummarySchema, uid, withUid);
}

export async function loadUsersInCohort(cohortId: string): Promise<UserSummary[]> {
  const snap = await adminDb.collection('users').where('partnerCohortId', '==', cohortId).get();
  return parseDocs(UserSummarySchema, snap.docs, 'uid');
}

/** Learners (role AGENT) across all Cohorts. Internal ops only. */
export async function loadAllAgents(limit = 1000): Promise<UserSummary[]> {
  const snap = await adminDb.collection('users').where('role', '==', 'AGENT').limit(limit).get();
  return parseDocs(UserSummarySchema, snap.docs, 'uid');
}

// ---------------- Enrollments & Simulation sessions ----------------

export async function loadEnrollmentsForUser(uid: string): Promise<EnrollmentDoc[]> {
  const snap = await adminDb.collection('enrollments').where('userId', '==', uid).get();
  return parseDocs(EnrollmentDocSchema, snap.docs, 'id');
}

export async function loadEnrollmentsForCohort(cohortId: string): Promise<EnrollmentDoc[]> {
  const snap = await adminDb.collection('enrollments').where('partnerCohortId', '==', cohortId).get();
  return parseDocs(EnrollmentDocSchema, snap.docs, 'id');
}

/** Every enrollment. Internal ops only. */
export async function loadAllEnrollments(limit = 10000): Promise<EnrollmentDoc[]> {
  const snap = await adminDb.collection('enrollments').limit(limit).get();
  return parseDocs(EnrollmentDocSchema, snap.docs, 'id');
}

export async function loadEvaluatedSimSessionsForUser(uid: string, limit = 30): Promise<SimSessionDoc[]> {
  const snap = await adminDb.collection('simSessions').where('userId', '==', uid).get();
  return parseDocs(SimSessionDocSchema, snap.docs, 'id')
    .filter((s) => s.status === 'EVALUATED' && s.evaluation)
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, limit);
}

// ---------------- Cohorts ----------------

export interface CohortOption {
  id: string;
  name: string;
}

/** Cohort ids + names from `cohorts`, merged with the 8 seeded defaults. */
export async function loadCohortOptions(): Promise<CohortOption[]> {
  const snap = await adminDb.collection('cohorts').get();
  const fromDb = parseDocs(CohortDocSchema, snap.docs, 'id');
  const map = new Map<string, string>();
  for (const c of DEFAULT_COHORTS) map.set(c.id, c.name);
  for (const c of fromDb) map.set(c.id, c.name);
  return [...map.entries()].map(([id, name]) => ({ id, name }));
}

/**
 * True while a Track still needs its draft build: new Tracks (status GENERATING) and revised Playbook uploads
 * (status stays PUBLISHED, generationProgress.step is not READY). FAILED builds also return true so the
 * stepper can start the build again.
 */
export function trackNeedsBuild(track: TrackDoc): boolean {
  return track.status === 'GENERATING' || track.generationProgress.step !== 'READY';
}
