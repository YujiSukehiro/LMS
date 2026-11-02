/** Server-only trainer/internal certification commands. Browser input never supplies status or evidence. */
import { adminDb } from '@/lib/firebase/admin';
import { isInternalOps } from '@/lib/firebase/auth-guard';
import { EnrollmentDocSchema, enrollmentIdFor } from '@/lib/schemas/analytics';
import { UserStatsSchema, type SessionUser } from '@/lib/schemas/domain';
import { CertificationDocSchema, type CertificationDoc } from '@/lib/schemas/learning';
import {
  readCertificationAggregateState,
  stageCertificationAggregateDelta,
  writeCertificationAggregateState,
} from './analytics-rollup';
import {
  evaluateCertificationEligibility,
  expireCertification,
  grantCertification,
  revokeCertification,
} from './certification';
import { ServiceError } from './errors';
import { loadCurrentLearningEvidenceData, selectCurrentCertification } from './learning-evidence';
import { loadTrack, loadVersion } from './track-loader';

function active(certification: CertificationDoc | null, now: number): boolean {
  return certification?.status === 'certified' &&
    certification.certifiedAt !== null &&
    (!certification.expiresAt || Date.parse(certification.expiresAt) > now);
}

function updateCertifiedCount(data: unknown, delta: number): Record<string, unknown> {
  if (delta === 0) return {};
  const parsed = UserStatsSchema.safeParse((data as { stats?: unknown } | undefined)?.stats);
  if (!parsed.success) return {};
  return { 'stats.tracksCertifiedCount': Math.max(0, parsed.data.tracksCertifiedCount + delta) };
}

export async function revokeLearnerCertification(args: {
  actor: SessionUser;
  learnerId: string;
  trackId: string;
  reason: string;
}): Promise<CertificationDoc> {
  if (!isInternalOps(args.actor)) throw new ServiceError(403, 'FORBIDDEN', 'Only Trainers and internal administrators can change certification state.');
  const track = await loadTrack(args.trackId);
  if (!track) throw new ServiceError(404, 'TRACK_NOT_FOUND', 'This Track does not exist.');
  return adminDb.runTransaction(async (tx) => {
    const now = Date.now();
    const query = adminDb.collection('certifications')
      .where('learnerId', '==', args.learnerId)
      .where('trackId', '==', args.trackId);
    const enrollmentRef = adminDb.collection('enrollments').doc(enrollmentIdFor(args.learnerId, args.trackId));
    const userRef = adminDb.collection('users').doc(args.learnerId);
    const [certificationsSnap, enrollmentSnap, userSnap] = await Promise.all([
      tx.get(query),
      tx.get(enrollmentRef),
      tx.get(userRef),
    ]);
    const records = certificationsSnap.docs.map((doc) => CertificationDocSchema.parse({ ...doc.data(), id: doc.id }));
    const existing = selectCurrentCertification(records);
    if (!existing) throw new ServiceError(404, 'CERTIFICATION_NOT_FOUND', 'No certification record exists for this learner and Track.');
    const result = revokeCertification(existing, {
      actorUid: args.actor.uid,
      reason: args.reason,
      now: new Date(now),
    }).certification;
    const delta = Number(active(result, now)) - Number(active(existing, now));
    const aggregates = await readCertificationAggregateState(tx, track, [{ partnerCohortId: existing.partnerCohortId }]);
    stageCertificationAggregateDelta(aggregates, { partnerCohortId: existing.partnerCohortId }, delta);

    if (result !== existing) tx.set(adminDb.collection('certifications').doc(result.id), result);
    if (enrollmentSnap.exists) {
      const enrollment = EnrollmentDocSchema.parse({ ...enrollmentSnap.data(), id: enrollmentSnap.id });
      if (enrollment.certificationProvenance === 'certification_register') {
        tx.set(enrollmentRef, EnrollmentDocSchema.parse({
          ...enrollment,
          certifiedAt: null,
          certificationEvidenceLabel: 'historical_verified',
          status: enrollment.completedUnitIds.length > 0 || enrollment.passedScenarioIds.length > 0 ? 'IN_PROGRESS' : 'NOT_STARTED',
        }));
      }
    }
    const userUpdate = updateCertifiedCount(userSnap.data(), delta);
    if (Object.keys(userUpdate).length > 0) tx.update(userRef, userUpdate);
    writeCertificationAggregateState(tx, aggregates, now);
    return result;
  });
}

export async function reconcileLearnerCertification(args: {
  actor: SessionUser;
  learnerId: string;
  trackId: string;
  reason: string;
}): Promise<{ certification: CertificationDoc | null; blockers: string[] }> {
  const track = await loadTrack(args.trackId);
  if (!track?.publishedVersionId) throw new ServiceError(404, 'TRACK_NOT_FOUND', 'This Track has no current published version.');
  const version = await loadVersion(args.trackId, track.publishedVersionId);
  if (!version) throw new ServiceError(404, 'VERSION_NOT_FOUND', 'The current TrackVersion does not exist.');

  if (!isInternalOps(args.actor)) throw new ServiceError(403, 'FORBIDDEN', 'Only Trainers and internal administrators can change certification state.');
  return adminDb.runTransaction(async (tx) => {
    const now = Date.now();
    const enrollmentRef = adminDb.collection('enrollments').doc(enrollmentIdFor(args.learnerId, args.trackId));
    const userRef = adminDb.collection('users').doc(args.learnerId);
    const [evidence, enrollmentSnap, userSnap] = await Promise.all([
      loadCurrentLearningEvidenceData({ learnerId: args.learnerId, version, tx }),
      tx.get(enrollmentRef),
      tx.get(userRef),
    ]);
    const enrollment = enrollmentSnap.exists
      ? EnrollmentDocSchema.parse({ ...enrollmentSnap.data(), id: enrollmentSnap.id })
      : null;
    const eligibility = evaluateCertificationEligibility({
      learnerId: args.learnerId,
      blueprint: evidence.blueprint,
      enrollment,
      drillAttempts: evidence.drillAttempts,
      scenarioCoverage: evidence.scenarioCoverage,
      simSessions: evidence.simSessions,
      ruleIdsByDrillId: evidence.ruleIdsByDrillId,
    });

    const initial = evidence.certification;
    let certification = initial;
    if (certification?.status === 'certified' && certification.expiresAt && Date.parse(certification.expiresAt) <= now) {
      certification = expireCertification(certification, {
        now: new Date(now),
        actorUid: args.actor.uid,
        reason: args.reason,
      }).certification;
    }
    if (!active(certification, now) && certification?.status !== 'revoked' && eligibility.eligible && enrollment) {
      certification = grantCertification({
        learnerId: args.learnerId,
        partnerCohortId: enrollment.partnerCohortId,
        blueprint: evidence.blueprint,
        eligibility,
        actorUid: args.actor.uid,
        now: new Date(now),
        reason: args.reason,
        existing: certification,
      }).certification;
    }
    const wasCertified = active(initial, now);
    const delta = Number(active(certification, now)) - Number(wasCertified);
    const partnerCohortId = initial?.partnerCohortId ?? enrollment?.partnerCohortId;
    const aggregates = await readCertificationAggregateState(
      tx,
      track,
      partnerCohortId ? [{ partnerCohortId }] : [],
    );
    if (partnerCohortId) stageCertificationAggregateDelta(aggregates, { partnerCohortId }, delta);

    if (certification !== initial && certification) {
      tx.set(adminDb.collection('certifications').doc(certification.id), certification);
    }
    if (enrollment && active(certification, now) && certification?.certifiedAt) {
      tx.set(enrollmentRef, EnrollmentDocSchema.parse({
        ...enrollment,
        certifiedAt: Date.parse(certification.certifiedAt),
        certificationEvidenceLabel: 'current_verified',
        certificationProvenance: 'certification_register',
        status: 'CERTIFIED',
      }));
    } else if (enrollment && certification !== initial && enrollment.certificationProvenance === 'certification_register') {
      tx.set(enrollmentRef, EnrollmentDocSchema.parse({
        ...enrollment,
        certifiedAt: null,
        certificationEvidenceLabel: 'historical_verified',
        status: enrollment.completedUnitIds.length > 0 || enrollment.passedScenarioIds.length > 0 ? 'IN_PROGRESS' : 'NOT_STARTED',
      }));
    }
    const userUpdate = updateCertifiedCount(userSnap.data(), delta);
    if (Object.keys(userUpdate).length > 0) tx.update(userRef, userUpdate);
    writeCertificationAggregateState(tx, aggregates, now);
    return {
      certification,
      blockers: active(certification, now)
        ? []
        : certification?.status === 'revoked'
          ? ['certification_revoked_trainer_reinstatement_required']
          : eligibility.blockers,
    };
  });
}
