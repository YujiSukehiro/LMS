import { SimSessionDocSchema, type SimSessionDoc } from '@/lib/schemas/analytics';
import { simSessionsCollection } from './simulation-engine';

/**
 * A run the learner can pick up again on this exact TrackVersion: an ACTIVE call, or a READY_FOR_EVAL
 * call that is not waiting for a Trainer's manual score. Legacy sessions without scenario state are not resumable.
 */
export function isResumableSession(session: SimSessionDoc, uid: string, versionId: string): boolean {
  return (
    session.userId === uid &&
    session.versionId === versionId &&
    Boolean(session.scenarioState && session.simulationEvents) &&
    (session.status === 'ACTIVE' || (session.status === 'READY_FOR_EVAL' && !session.judgeReview))
  );
}

/** Newest resumable run of this scenario (equality filters only, so no composite index is needed). */
export async function findResumableSession(
  uid: string,
  trackId: string,
  versionId: string,
  scenarioId: string,
): Promise<SimSessionDoc | null> {
  const snap = await simSessionsCollection()
    .where('userId', '==', uid)
    .where('trackId', '==', trackId)
    .where('scenarioId', '==', scenarioId)
    .get();
  const candidates = snap.docs
    .map((doc) => SimSessionDocSchema.safeParse({ ...doc.data(), id: doc.id }))
    .flatMap((parsed) => (parsed.success ? [parsed.data] : []))
    .filter((session) => isResumableSession(session, uid, versionId))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  return candidates[0] ?? null;
}

/** One start lock per learner, Track version and scenario (document id; ids are Firestore-safe). */
export function simStartLockId(uid: string, trackId: string, versionId: string, scenarioId: string): string {
  return [uid, trackId, versionId, scenarioId].map((part) => part.replace(/[^\w-]/g, '_')).join('__');
}
