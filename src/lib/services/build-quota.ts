/**
 * Daily Track-build limit per trainer (env MAX_TRACK_BUILDS_PER_USER_PER_DAY, default 10).
 *
 * Only a FRESH build counts: one that starts from an uploaded, not-yet-built source. A Retry or a resume of a
 * failed or interrupted build replays saved checkpoints and costs little, so it never counts and is never blocked.
 * Counts live in `trackBuildQuota/{uid}_{YYYY-MM-DD}` (server-only; clients have no rule for it).
 */
import type { DocumentReference, Transaction } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import type { GenerationStep } from '@/lib/schemas/curriculum';

export const DEFAULT_MAX_TRACK_BUILDS_PER_DAY = 10;

/** Steps the upload route leaves on a Track before its first build. */
const FRESH_BUILD_STEPS: readonly GenerationStep[] = ['UPLOADING', 'EXTRACTING_PDF'];

export function maxTrackBuildsPerDay(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number.parseInt(env.MAX_TRACK_BUILDS_PER_USER_PER_DAY ?? '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_TRACK_BUILDS_PER_DAY;
}

/** True when acquiring the build lock from this step starts a new build (not a Retry or resume). */
export function isFreshBuildStart(step: GenerationStep): boolean {
  return FRESH_BUILD_STEPS.includes(step);
}

export function utcDayKey(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

export function buildQuotaRef(uid: string, nowMs: number): DocumentReference {
  return adminDb.collection('trackBuildQuota').doc(`${uid}_${utcDayKey(nowMs)}`);
}

export function buildLimitMessage(limit: number): string {
  return `You started the maximum of ${limit} new Track builds today. Try again tomorrow (UTC), or ask an admin to raise the limit. Retrying a build that already started does not count.`;
}

/**
 * Inside the caller's lock transaction: counts one fresh build for `uid`, or reports the limit.
 * Reads must come before writes in a Firestore transaction, so call this before any tx.update.
 */
export async function claimBuildSlot(
  tx: Transaction,
  uid: string,
  trackId: string,
  nowMs: number,
  limit: number = maxTrackBuildsPerDay(),
): Promise<{ ok: true; used: number } | { ok: false; limit: number }> {
  const ref = buildQuotaRef(uid, nowMs);
  const snap = await tx.get(ref);
  const count = snap.exists ? Number(snap.get('count') ?? 0) : 0;
  if (count >= limit) return { ok: false, limit };
  const trackIds: string[] = snap.exists ? ((snap.get('trackIds') as string[] | undefined) ?? []) : [];
  tx.set(ref, { uid, day: utcDayKey(nowMs), count: count + 1, trackIds: [...trackIds, trackId].slice(-50), updatedAt: nowMs });
  return { ok: true, used: count + 1 };
}
