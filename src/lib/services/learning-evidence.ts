/**
 * Server-only current-version learning evidence loaders.
 *
 * Raw evidence is available to trusted services through loadCurrentLearningEvidenceData. The
 * page-facing loader returns analytics and display records only; it never exposes Drill answers,
 * correct answers, rationales, transcripts, or Simulation secrets.
 */
import { z } from 'zod';
import type { Transaction } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import { canAccessCohort, isInternalOps } from '@/lib/firebase/auth-guard';
import {
  EnrollmentDocSchema,
  SimSessionDocSchema,
  enrollmentIdFor,
  type SimSessionDoc,
} from '@/lib/schemas/analytics';
import type { TrackVersionDoc } from '@/lib/schemas/curriculum';
import type { SessionUser } from '@/lib/schemas/domain';
import {
  AssessmentBlueprintDocSchema,
  CertificationDocSchema,
  DrillAttemptDocSchema,
  ReviewScheduleDocSchema,
  ScenarioCoverageDocSchema,
  type AssessmentBlueprintDoc,
  type CertificationDoc,
  type DrillAttemptDoc,
  type ReviewScheduleDoc,
  type ScenarioCoverageDoc,
} from '@/lib/schemas/learning';
import { buildLearningAnalytics, type CurrentLearningAnalytics } from './learning-analytics';
import { drillRuleIds } from './drill-grader';
import { ServiceError } from './errors';
import { scenarioCoverageDocId } from './scenario-coverage';
import { isTrackAssignedToUser, isTrackVisibleToLearner, loadTrack, loadVersion } from './track-loader';

export interface CurrentLearningEvidenceData {
  blueprint: AssessmentBlueprintDoc;
  drillAttempts: DrillAttemptDoc[];
  reviewSchedules: ReviewScheduleDoc[];
  scenarioCoverage: ScenarioCoverageDoc[];
  simSessions: SimSessionDoc[];
  certifications: CertificationDoc[];
  certification: CertificationDoc | null;
  ruleIdsByDrillId: Record<string, string[]>;
}

export interface LearningEvidenceView {
  analytics: CurrentLearningAnalytics;
  certification: CertificationDoc | null;
  scenarioCoverage: ScenarioCoverageDoc[];
  scenarioLabels: Record<string, string>;
}

export function assessmentBlueprintRef(trackId: string, versionId: string) {
  return adminDb.collection('assessmentBlueprints').doc(`assessment_${trackId}_${versionId}`);
}

export function certificationsCollection() {
  return adminDb.collection('certifications');
}

export function scenarioCoverageRef(learnerId: string, trackId: string, versionId: string, scenarioId: string) {
  return adminDb.collection('scenarioCoverage').doc(scenarioCoverageDocId(learnerId, trackId, versionId, scenarioId));
}

/** Authoritative Drill-to-rule mapping from the frozen TrackVersion, not from attempt feedback. */
export function buildRuleIdsByDrillId(version: TrackVersionDoc): Record<string, string[]> {
  const mapping: Record<string, string[]> = {};
  for (const unit of version.units) {
    for (const drill of unit.drills) mapping[drill.id] = drillRuleIds(drill);
  }
  return mapping;
}

function invalidData(code: string, message: string): ServiceError {
  return new ServiceError(500, code, message);
}

function parseBlueprint(data: unknown): AssessmentBlueprintDoc {
  const parsed = AssessmentBlueprintDocSchema.safeParse(data);
  if (!parsed.success) throw invalidData('ASSESSMENT_BLUEPRINT_INVALID', 'The current assessment requirements are not valid. Contact a Trainer.');
  return parsed.data;
}

function parseCertification(data: unknown, id: string): CertificationDoc {
  const parsed = CertificationDocSchema.safeParse({ ...data as object, id });
  if (!parsed.success) throw invalidData('CERTIFICATION_DATA_INVALID', 'A certification record is not valid. Contact a Trainer.');
  return parsed.data;
}

/**
 * Select the current record, ignoring preserved certified snapshots. Recertification creates a new
 * document with a later createdAt; the older certified document remains immutable history.
 */
export function selectCurrentCertification(records: readonly CertificationDoc[]): CertificationDoc | null {
  return records.reduce<CertificationDoc | null>((current, candidate) => {
    if (!current) return candidate;
    const created = Date.parse(candidate.createdAt) - Date.parse(current.createdAt);
    if (created > 0) return candidate;
    if (created < 0) return current;
    return Date.parse(candidate.updatedAt) > Date.parse(current.updatedAt) ? candidate : current;
  }, null);
}

/**
 * Load all evidence needed by certification and learning analytics. When tx is supplied this
 * function performs reads only, so callers can complete every read before their first write.
 */
export async function loadCurrentLearningEvidenceData(args: {
  learnerId: string;
  version: TrackVersionDoc;
  tx?: Transaction;
}): Promise<CurrentLearningEvidenceData> {
  const { learnerId, version, tx } = args;
  const trackId = version.trackId;
  const versionId = version.versionId;
  const blueprintDocument = assessmentBlueprintRef(trackId, versionId);
  const attemptsQuery = adminDb.collection('drillAttempts')
    .where('learnerId', '==', learnerId)
    .where('trackId', '==', trackId)
    .where('curriculumVersion', '==', versionId);
  // The existing learnerId+dueAt index supports this query; current track/version filtering is local.
  const schedulesQuery = adminDb.collection('reviewSchedules').where('learnerId', '==', learnerId);
  const coverageQuery = adminDb.collection('scenarioCoverage')
    .where('learnerId', '==', learnerId)
    .where('trackId', '==', trackId)
    .where('curriculumVersion', '==', versionId);
  const certificationsQuery = certificationsCollection()
    .where('learnerId', '==', learnerId)
    .where('trackId', '==', trackId);

  const blueprintSnap = tx ? await tx.get(blueprintDocument) : await blueprintDocument.get();
  if (!blueprintSnap.exists) {
    throw new ServiceError(409, 'ASSESSMENT_BLUEPRINT_MISSING', 'The current assessment requirements are not available. Contact a Trainer.');
  }
  const blueprint = parseBlueprint(blueprintSnap.data());
  if (blueprint.trackId !== trackId || blueprint.curriculumVersion !== versionId) {
    throw invalidData('ASSESSMENT_BLUEPRINT_MISMATCH', 'The current assessment requirements do not match this TrackVersion.');
  }

  const attemptsSnap = tx ? await tx.get(attemptsQuery) : await attemptsQuery.get();
  const schedulesSnap = tx ? await tx.get(schedulesQuery) : await schedulesQuery.get();
  const coverageSnap = tx ? await tx.get(coverageQuery) : await coverageQuery.get();
  const certificationsSnap = tx ? await tx.get(certificationsQuery) : await certificationsQuery.get();

  const drillAttempts = attemptsSnap.docs.map((doc) => {
    const parsed = DrillAttemptDocSchema.safeParse({ ...doc.data(), id: doc.id });
    if (!parsed.success) throw invalidData('ATTEMPT_DATA_INVALID', 'A saved Drill attempt is not valid. Contact a Trainer.');
    return parsed.data;
  });
  const scheduleByKey = new Map<string, ReviewScheduleDoc>();
  for (const doc of schedulesSnap.docs) {
    const parsed = ReviewScheduleDocSchema.safeParse({ ...doc.data(), id: doc.id });
    if (!parsed.success) throw invalidData('REVIEW_SCHEDULE_INVALID', 'A saved review schedule is not valid. Contact a Trainer.');
    if (parsed.data.trackId !== trackId || parsed.data.curriculumVersion !== versionId) continue;
    const key = `${parsed.data.trackId}:${parsed.data.curriculumVersion}:${parsed.data.drillId}`;
    const prev = scheduleByKey.get(key);
    if (!prev || Date.parse(parsed.data.updatedAt) >= Date.parse(prev.updatedAt)) {
      scheduleByKey.set(key, parsed.data);
    }
  }
  const reviewSchedules = [...scheduleByKey.values()];
  const scenarioCoverage = coverageSnap.docs.map((doc) => {
    const parsed = ScenarioCoverageDocSchema.safeParse({ ...doc.data(), id: doc.id });
    if (!parsed.success) throw invalidData('SCENARIO_COVERAGE_INVALID', 'Saved Simulation coverage is not valid. Contact a Trainer.');
    return parsed.data;
  });
  const certifications = certificationsSnap.docs.map((doc) => parseCertification(doc.data(), doc.id));

  const sessionIds = [...new Set(scenarioCoverage.flatMap((coverage) => coverage.attemptHistory.map((attempt) => attempt.sessionId)))];
  const sessionSnaps = sessionIds.length > 0
    ? tx
      ? await tx.getAll(...sessionIds.map((sessionId) => adminDb.collection('simSessions').doc(sessionId)))
      : await adminDb.getAll(...sessionIds.map((sessionId) => adminDb.collection('simSessions').doc(sessionId)))
    : [];
  const simSessions = sessionSnaps.flatMap((snap) => {
    if (!snap.exists) return [];
    const parsed = SimSessionDocSchema.safeParse({ ...snap.data(), id: snap.id });
    if (!parsed.success) throw invalidData('SESSION_DATA_INVALID', 'A saved Simulation session is not valid. Contact a Trainer.');
    return [parsed.data];
  });

  return {
    blueprint,
    drillAttempts,
    reviewSchedules,
    scenarioCoverage,
    simSessions,
    certifications,
    certification: selectCurrentCertification(certifications),
    ruleIdsByDrillId: buildRuleIdsByDrillId(version),
  };
}

const TargetLearnerSchema = z.object({ partnerCohortId: z.string().min(1) });

/** Ownership, same-Cohort supervision, or internal-ops access is enforced before returning SSR data. */
export async function loadLearningEvidenceForUser(args: {
  user: SessionUser;
  trackId: string;
  learnerId?: string;
  now?: string | Date;
}): Promise<LearningEvidenceView> {
  const learnerId = args.learnerId ?? args.user.uid;
  const [track, targetSnap] = await Promise.all([
    loadTrack(args.trackId),
    adminDb.collection('users').doc(learnerId).get(),
  ]);
  if (!track || !track.publishedVersionId) throw new ServiceError(404, 'TRACK_NOT_FOUND', 'This Track is not available.');
  if (!targetSnap.exists) throw new ServiceError(404, 'LEARNER_NOT_FOUND', 'This learner does not exist.');
  const target = TargetLearnerSchema.parse(targetSnap.data());

  const ownRecord = learnerId === args.user.uid;
  const cohortSupervisor = args.user.role === 'PARTNER_SUPERVISOR' && canAccessCohort(args.user, target.partnerCohortId);
  if (!ownRecord && !cohortSupervisor && !isInternalOps(args.user)) {
    throw new ServiceError(403, 'FORBIDDEN', 'You do not have access to this learner evidence.');
  }
  // A learner sees only Tracks assigned to them (Cohort + Division). A supervisor viewing a passport checks the Cohort
  // only, so training done before a Division change stays visible as history.
  const targetCohorts = Array.isArray(targetSnap.get('cohortIds')) ? (targetSnap.get('cohortIds') as unknown[]).filter((id): id is string => typeof id === 'string') : [];
  const visible = ownRecord
    ? isTrackVisibleToLearner(track, { ...args.user, cohortIds: targetCohorts })
    : track.status === 'PUBLISHED' && isTrackAssignedToUser(track, { partnerCohortId: target.partnerCohortId, uid: learnerId, cohortIds: targetCohorts });
  if (!isInternalOps(args.user) && !visible) {
    throw new ServiceError(404, 'TRACK_NOT_FOUND', 'This Track is not available.');
  }

  const version = await loadVersion(args.trackId, track.publishedVersionId);
  if (!version) throw new ServiceError(404, 'VERSION_NOT_FOUND', 'The current TrackVersion does not exist.');
  const [evidence, enrollmentSnap] = await Promise.all([
    loadCurrentLearningEvidenceData({ learnerId, version }),
    adminDb.collection('enrollments').doc(enrollmentIdFor(learnerId, args.trackId)).get(),
  ]);
  const enrollment = enrollmentSnap.exists
    ? EnrollmentDocSchema.parse({ ...enrollmentSnap.data(), id: enrollmentSnap.id })
    : null;
  const now = args.now ?? new Date();
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  const certification = evidence.certification?.status === 'certified' &&
      evidence.certification.expiresAt && Date.parse(evidence.certification.expiresAt) <= nowMs
    ? { ...evidence.certification, status: 'expired' as const }
    : evidence.certification;
  const analytics = buildLearningAnalytics({
    learnerId,
    blueprint: evidence.blueprint,
    enrollment,
    drillAttempts: evidence.drillAttempts,
    scenarioCoverage: evidence.scenarioCoverage,
    simSessions: evidence.simSessions,
    reviewSchedules: evidence.reviewSchedules,
    ruleIdsByDrillId: evidence.ruleIdsByDrillId,
    certificationStatus: certification?.status ?? 'not_started',
    now,
  });

  return {
    analytics,
    certification,
    scenarioCoverage: evidence.scenarioCoverage,
    scenarioLabels: Object.fromEntries(version.simScenarios.map((scenario) => [scenario.id, scenario.title])),
  };
}
