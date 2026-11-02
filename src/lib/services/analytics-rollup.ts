/**
 * Server-only progress recording (firebase-admin).
 *
 * Every write that changes progress updates `users/{uid}`, `enrollments/{uid}_{trackId}` and the
 * `analyticsRollups` documents (GLOBAL, DIVISION_*, COHORT_*, TRACK_*) inside ONE Firestore transaction,
 * so dashboards read 1-4 pre-aggregated documents (docs/02 §5).
 *
 * Replay rule for Units: the FIRST completion of a Unit awards XP and adds the rollup Unit completion,
 * pillar samples and missed Drill counts (cohort analytics show true first comprehension).
 * A replay awards 0 XP and does not change rollups, but it updates the Unit score
 * (latest firstTryAccuracyPct, attemptsCount + 1), the user's personal skill scores, and the streak.
 *
 * Simulation rule: every evaluated published Simulation adds one rollup attempt (and a pass when passed),
 * pillar samples and missed criteria. XP and `simulationsPassedCount` are given only on the first pass of a scenario.
 */
import { FieldValue, type DocumentSnapshot, type Transaction } from 'firebase-admin/firestore';
import { z } from 'zod';
import { adminDb } from '@/lib/firebase/admin';
import {
  EnrollmentDocSchema,
  enrollmentIdFor,
  rollupIdForCohort,
  rollupIdForDivision,
  rollupIdForGlobal,
  rollupIdForTrack,
  type AnalyticsRollupDoc,
  type EnrollmentDoc,
  type RollupScopeType,
  type SimEvaluation,
  type SimSessionDoc,
} from '@/lib/schemas/analytics';
import type { DrillResult } from '@/lib/schemas/api';
import { CANONICAL_PILLARS, XP_RULES } from '@/lib/schemas/constants';
import type {
  CompetencyPillar,
  PublicSimScenario,
  TrackDoc,
  TrackVersionDoc,
} from '@/lib/schemas/curriculum';
import {
  PillarStatSchema,
  UserStatsSchema,
  type DivisionId,
  type PillarStat,
  type SessionUser,
  type UserStats,
} from '@/lib/schemas/domain';
import { ServiceError } from './errors';
import {
  computeFirstTryAccuracyPct,
  computeOverallReadiness,
  computeProgressPct,
  computeUnitXp,
  mergePillarStat,
  nextStreak,
} from './scoring';

const MISSED_ITEM_LABEL_MAX = 140;

// ---------------------------------------------------------------------------
// Document references
// ---------------------------------------------------------------------------

function userRef(uid: string) {
  return adminDb.collection('users').doc(uid);
}
function enrollmentRef(uid: string, trackId: string) {
  return adminDb.collection('enrollments').doc(enrollmentIdFor(uid, trackId));
}
function rollupRef(rollupId: string) {
  return adminDb.collection('analyticsRollups').doc(rollupId);
}
function simSessionRef(sessionId: string) {
  return adminDb.collection('simSessions').doc(sessionId);
}

// ---------------------------------------------------------------------------
// CompetencyPillar lookup (pillar ID -> canonical key + label)
// ---------------------------------------------------------------------------

interface PillarInfo {
  key: string;
  label: string;
}

const CANONICAL_LABELS = new Map<string, string>(CANONICAL_PILLARS.map((p) => [p.key, p.label]));

/** Map each CompetencyPillar ID to its canonical key. The label is the canonical label when the key is canonical. */
export function buildPillarIndex(...pillarLists: CompetencyPillar[][]): Map<string, PillarInfo> {
  const index = new Map<string, PillarInfo>();
  for (const list of pillarLists) {
    for (const pillar of list) {
      if (index.has(pillar.id)) continue;
      const key = pillar.key.trim() || pillar.id;
      index.set(pillar.id, { key, label: CANONICAL_LABELS.get(key) ?? pillar.label });
    }
  }
  return index;
}

/** Group 0..100 samples by canonical pillar key. Samples with an unknown pillar ID are skipped. */
function groupSamplesByPillar(
  samples: Array<{ competencyPillarId: string; score: number }>,
  pillarIndex: Map<string, PillarInfo>,
): Map<string, { label: string; scores: number[] }> {
  const grouped = new Map<string, { label: string; scores: number[] }>();
  for (const sample of samples) {
    const info = pillarIndex.get(sample.competencyPillarId);
    if (!info) continue;
    const entry = grouped.get(info.key) ?? { label: info.label, scores: [] };
    entry.scores.push(sample.score);
    grouped.set(info.key, entry);
  }
  return grouped;
}

// ---------------------------------------------------------------------------
// User document helpers
// ---------------------------------------------------------------------------

const SkillScoresSchema = z.record(z.string(), PillarStatSchema);

const EMPTY_STATS: UserStats = {
  totalXp: 0,
  currentStreakDays: 0,
  lastActiveDateUtc: null,
  tracksCertifiedCount: 0,
  simulationsPassedCount: 0,
  overallReadinessScore: 0,
};

interface UserProgressState {
  stats: UserStats;
  skillScoresByPillar: Record<string, PillarStat>;
}

function readUserProgress(snap: DocumentSnapshot): UserProgressState {
  if (!snap.exists) {
    throw new ServiceError(404, 'USER_NOT_FOUND', 'Your user profile does not exist. Sign out and sign in again.');
  }
  const data = snap.data() ?? {};
  const stats = UserStatsSchema.safeParse(data.stats);
  const skills = SkillScoresSchema.safeParse(data.skillScoresByPillar ?? {});
  return {
    stats: stats.success ? stats.data : { ...EMPTY_STATS },
    skillScoresByPillar: skills.success ? skills.data : {},
  };
}

function mergeSkillScores(
  current: Record<string, PillarStat>,
  grouped: Map<string, { label: string; scores: number[] }>,
): Record<string, PillarStat> {
  const next: Record<string, PillarStat> = { ...current };
  for (const [key, { label, scores }] of grouped) {
    if (scores.length === 0) continue;
    next[key] = mergePillarStat(current[key], key, label, scores);
  }
  return next;
}

// ---------------------------------------------------------------------------
// Enrollment helpers
// ---------------------------------------------------------------------------

function blankEnrollment(user: SessionUser, track: TrackDoc, version: TrackVersionDoc, now: number): EnrollmentDoc {
  return {
    id: enrollmentIdFor(user.uid, track.id),
    userId: user.uid,
    userDisplayName: user.displayName,
    partnerCohortId: user.partnerCohortId,
    divisionId: track.divisionId,
    trackId: track.id,
    trackTitle: track.title,
    versionId: version.versionId,
    status: 'NOT_STARTED',
    completedUnitIds: [],
    passedScenarioIds: [],
    unitScores: {},
    bestSimScorePct: null,
    xpEarned: 0,
    progressPct: 0,
    certifiedAt: null,
    lastActivityAt: now,
  };
}

function readEnrollment(
  snap: DocumentSnapshot,
  user: SessionUser,
  track: TrackDoc,
  version: TrackVersionDoc,
  now: number,
): { enrollment: EnrollmentDoc; existed: boolean } {
  if (!snap.exists) return { enrollment: blankEnrollment(user, track, version, now), existed: false };
  const parsed = EnrollmentDocSchema.safeParse({ ...snap.data(), id: snap.id });
  if (!parsed.success) {
    console.error(`[analytics-rollup] Enrollment ${snap.id} has an invalid shape`, parsed.error.flatten());
    throw new ServiceError(500, 'ENROLLMENT_DATA_INVALID', 'Your progress record is not valid. Contact a Trainer.');
  }
  return { enrollment: parsed.data, existed: true };
}

function enrollmentStatus(e: Pick<EnrollmentDoc, 'certifiedAt' | 'completedUnitIds' | 'passedScenarioIds'>) {
  if (e.certifiedAt !== null) return 'CERTIFIED' as const;
  if (e.completedUnitIds.length > 0 || e.passedScenarioIds.length > 0) return 'IN_PROGRESS' as const;
  return 'NOT_STARTED' as const;
}

function allUnitsComplete(enrollment: EnrollmentDoc, version: TrackVersionDoc): boolean {
  if (version.units.length === 0) return false;
  const done = new Set(enrollment.completedUnitIds);
  return version.units.every((u) => done.has(u.id));
}

/**
 * Align an enrollment with the current TrackVersion: keep only Unit / scenario IDs that exist in it,
 * refresh denormalized fields, recompute progressPct and status. A certification is never removed.
 */
function reconcileEnrollment(
  enrollment: EnrollmentDoc,
  user: SessionUser,
  track: TrackDoc,
  version: TrackVersionDoc,
): EnrollmentDoc {
  const unitOrder = [...version.units].sort((a, b) => a.orderIndex - b.orderIndex).map((u) => u.id);
  const done = new Set(enrollment.completedUnitIds);
  const completedUnitIds = unitOrder.filter((id) => done.has(id));
  const scenarioIds = new Set(version.simScenarios.map((s) => s.id));
  const passedScenarioIds = enrollment.passedScenarioIds.filter((id, i, arr) => scenarioIds.has(id) && arr.indexOf(id) === i);

  const next: EnrollmentDoc = {
    ...enrollment,
    userDisplayName: user.displayName || enrollment.userDisplayName,
    partnerCohortId: user.partnerCohortId,
    divisionId: track.divisionId,
    trackTitle: track.title,
    versionId: version.versionId,
    completedUnitIds,
    passedScenarioIds,
  };
  next.progressPct = computeProgressPct({
    completedUnitCount: completedUnitIds.length,
    unitCount: version.units.length,
    passedScenarioCount: passedScenarioIds.length,
  });
  next.status = enrollmentStatus(next);
  return next;
}

// ---------------------------------------------------------------------------
// Rollup helpers
// ---------------------------------------------------------------------------

interface RollupScope {
  id: string;
  scopeType: RollupScopeType;
  divisionId: DivisionId | null;
  partnerCohortId: string | null;
  trackId: string | null;
}

function rollupScopesFor(user: SessionUser, track: TrackDoc): RollupScope[] {
  return [
    { id: rollupIdForGlobal(), scopeType: 'GLOBAL', divisionId: null, partnerCohortId: null, trackId: null },
    {
      id: rollupIdForDivision(track.divisionId),
      scopeType: 'DIVISION',
      divisionId: track.divisionId,
      partnerCohortId: null,
      trackId: null,
    },
    {
      id: rollupIdForCohort(user.partnerCohortId),
      scopeType: 'COHORT',
      divisionId: null,
      partnerCohortId: user.partnerCohortId,
      trackId: null,
    },
    {
      id: rollupIdForTrack(track.id),
      scopeType: 'TRACK',
      divisionId: track.divisionId,
      partnerCohortId: null,
      trackId: track.id,
    },
  ];
}

interface RollupDelta {
  unitCompletions: number;
  simAttempts: number;
  simPasses: number;
  certifications: number;
  pillarSamples: Map<string, { label: string; scores: number[] }>;
  /** Keyed by `${trackId}__${itemId}`. */
  missedItems: Map<string, { trackId: string; itemId: string; itemLabel: string; count: number }>;
}

function emptyDelta(): RollupDelta {
  return {
    unitCompletions: 0,
    simAttempts: 0,
    simPasses: 0,
    certifications: 0,
    pillarSamples: new Map(),
    missedItems: new Map(),
  };
}

function isDeltaEmpty(delta: RollupDelta): boolean {
  return (
    delta.unitCompletions === 0 &&
    delta.simAttempts === 0 &&
    delta.simPasses === 0 &&
    delta.certifications === 0 &&
    delta.pillarSamples.size === 0 &&
    delta.missedItems.size === 0
  );
}

function addMissedItem(delta: RollupDelta, trackId: string, itemId: string, label: string) {
  const key = `${trackId}__${itemId}`;
  const itemLabel = label.length > MISSED_ITEM_LABEL_MAX ? `${label.slice(0, MISSED_ITEM_LABEL_MAX - 1)}…` : label;
  const entry = delta.missedItems.get(key);
  if (entry) entry.count += 1;
  else delta.missedItems.set(key, { trackId, itemId, itemLabel, count: 1 });
}

/** Read the rollup documents for the scopes. Must run before any transaction write. */
async function readRollups(tx: Transaction, scopes: RollupScope[]): Promise<DocumentSnapshot[]> {
  return tx.getAll(...scopes.map((s) => rollupRef(s.id)));
}

/**
 * Apply a delta to every rollup. A missing rollup is created with the full AnalyticsRollupDocSchema shape;
 * an existing rollup is updated with set(merge) + FieldValue.increment (no empty maps are merged).
 */
function writeRollups(
  tx: Transaction,
  scopes: RollupScope[],
  snaps: DocumentSnapshot[],
  delta: RollupDelta,
  now: number,
) {
  if (isDeltaEmpty(delta)) return;

  scopes.forEach((scope, i) => {
    const ref = rollupRef(scope.id);
    const exists = snaps[i]?.exists ?? false;

    if (!exists) {
      const pillarAggregates: AnalyticsRollupDoc['pillarAggregates'] = {};
      for (const [key, { label, scores }] of delta.pillarSamples) {
        pillarAggregates[key] = {
          pillarLabel: label,
          sampleCount: scores.length,
          scoreSum: scores.reduce((sum, s) => sum + s, 0),
        };
      }
      const missedItemCounts: AnalyticsRollupDoc['missedItemCounts'] = {};
      for (const [key, item] of delta.missedItems) {
        missedItemCounts[key] = {
          trackId: item.trackId,
          itemId: item.itemId,
          itemLabel: item.itemLabel,
          missCount: item.count,
        };
      }
      const doc: AnalyticsRollupDoc = {
        id: scope.id,
        scopeType: scope.scopeType,
        divisionId: scope.divisionId,
        partnerCohortId: scope.partnerCohortId,
        trackId: scope.trackId,
        totalCertifications: delta.certifications,
        totalUnitCompletions: delta.unitCompletions,
        totalSimAttempts: delta.simAttempts,
        totalSimPasses: delta.simPasses,
        pillarAggregates,
        missedItemCounts,
        updatedAt: now,
      };
      tx.set(ref, doc);
      return;
    }

    const update: Record<string, unknown> = {
      id: scope.id,
      scopeType: scope.scopeType,
      divisionId: scope.divisionId,
      partnerCohortId: scope.partnerCohortId,
      trackId: scope.trackId,
      updatedAt: now,
    };
    if (delta.certifications) update.totalCertifications = FieldValue.increment(delta.certifications);
    if (delta.unitCompletions) update.totalUnitCompletions = FieldValue.increment(delta.unitCompletions);
    if (delta.simAttempts) update.totalSimAttempts = FieldValue.increment(delta.simAttempts);
    if (delta.simPasses) update.totalSimPasses = FieldValue.increment(delta.simPasses);

    if (delta.pillarSamples.size > 0) {
      const pillarAggregates: Record<string, unknown> = {};
      for (const [key, { label, scores }] of delta.pillarSamples) {
        pillarAggregates[key] = {
          pillarLabel: label,
          sampleCount: FieldValue.increment(scores.length),
          scoreSum: FieldValue.increment(scores.reduce((sum, s) => sum + s, 0)),
        };
      }
      update.pillarAggregates = pillarAggregates;
    }
    if (delta.missedItems.size > 0) {
      const missedItemCounts: Record<string, unknown> = {};
      for (const [key, item] of delta.missedItems) {
        missedItemCounts[key] = {
          trackId: item.trackId,
          itemId: item.itemId,
          itemLabel: item.itemLabel,
          missCount: FieldValue.increment(item.count),
        };
      }
      update.missedItemCounts = missedItemCounts;
    }
    tx.set(ref, update, { merge: true });
  });
}

function writeUserProgress(
  tx: Transaction,
  uid: string,
  stats: UserStats,
  skillScoresByPillar: Record<string, PillarStat>,
  now: number,
) {
  tx.update(userRef(uid), {
    'stats.totalXp': stats.totalXp,
    'stats.currentStreakDays': stats.currentStreakDays,
    'stats.lastActiveDateUtc': stats.lastActiveDateUtc,
    'stats.tracksCertifiedCount': stats.tracksCertifiedCount,
    'stats.simulationsPassedCount': stats.simulationsPassedCount,
    'stats.overallReadinessScore': stats.overallReadinessScore,
    skillScoresByPillar,
    updatedAt: now,
  });
}

// ---------------------------------------------------------------------------
// Public service functions
// ---------------------------------------------------------------------------

/**
 * Get (or lazily create) the user's enrollment for a Track and align it with the given TrackVersion.
 * Use only for published TrackVersions; draft activity never creates enrollments.
 */
export async function ensureEnrollment(args: {
  user: SessionUser;
  track: TrackDoc;
  version: TrackVersionDoc;
}): Promise<EnrollmentDoc> {
  const { user, track, version } = args;
  const ref = enrollmentRef(user.uid, track.id);
  return adminDb.runTransaction(async (tx) => {
    const now = Date.now();
    const snap = await tx.get(ref);
    const { enrollment, existed } = readEnrollment(snap, user, track, version, now);
    const reconciled = reconcileEnrollment(enrollment, user, track, version);
    const changed = !existed || JSON.stringify(reconciled) !== JSON.stringify(enrollment);
    if (changed) {
      const toWrite = EnrollmentDocSchema.parse({ ...reconciled, lastActivityAt: existed ? reconciled.lastActivityAt : now });
      tx.set(ref, toWrite);
      return toWrite;
    }
    return reconciled;
  });
}

/**
 * Record a completed Unit on a published TrackVersion (one transaction).
 * Enforces sequential unlock: all Units before this one (by orderIndex) must be complete.
 */
export async function recordUnitCompletion(args: {
  user: SessionUser;
  track: TrackDoc;
  version: TrackVersionDoc;
  unitId: string;
  drillResults: DrillResult[];
}): Promise<{ xpAwarded: number; enrollment: EnrollmentDoc }> {
  const { user, track, version, unitId, drillResults } = args;
  const orderedUnits = [...version.units].sort((a, b) => a.orderIndex - b.orderIndex);
  const unitIndex = orderedUnits.findIndex((u) => u.id === unitId);
  if (unitIndex === -1) throw new ServiceError(404, 'UNIT_NOT_FOUND', 'This Unit does not exist in the Track.');
  const unit = orderedUnits[unitIndex];

  const pillarIndex = buildPillarIndex(version.competencyPillars, track.competencyPillars);
  const scopes = rollupScopesFor(user, track);
  const uRef = userRef(user.uid);
  const eRef = enrollmentRef(user.uid, track.id);

  return adminDb.runTransaction(async (tx) => {
    const now = Date.now();
    const [userSnap, enrollmentSnap] = await tx.getAll(uRef, eRef);
    const userState = readUserProgress(userSnap);
    const { enrollment: stored } = readEnrollment(enrollmentSnap, user, track, version, now);
    const enrollment = reconcileEnrollment(stored, user, track, version);

    const completed = new Set(enrollment.completedUnitIds);
    const locked = orderedUnits.slice(0, unitIndex).some((u) => !completed.has(u.id));
    if (locked) {
      throw new ServiceError(409, 'UNIT_LOCKED', 'Complete the previous Units first. Units unlock in sequence.');
    }

    const isFirstCompletion = !completed.has(unitId);
    const xpAwarded = isFirstCompletion ? computeUnitXp(drillResults) : 0;
    const accuracy = computeFirstTryAccuracyPct(drillResults);
    const prevScore = enrollment.unitScores[unitId];

    // Enrollment
    completed.add(unitId);
    let next: EnrollmentDoc = {
      ...enrollment,
      completedUnitIds: orderedUnits.filter((u) => completed.has(u.id)).map((u) => u.id),
      unitScores: {
        ...enrollment.unitScores,
        [unitId]: {
          firstTryAccuracyPct: accuracy,
          attemptsCount: (prevScore?.attemptsCount ?? 0) + 1,
          completedAt: now,
        },
      },
      xpEarned: enrollment.xpEarned + xpAwarded,
      lastActivityAt: now,
    };
    let newlyCertified = false;
    if (next.certifiedAt === null && allUnitsComplete(next, version) && next.passedScenarioIds.length > 0) {
      next.certifiedAt = now;
      newlyCertified = true;
    }
    next = reconcileEnrollment(next, user, track, version);
    const enrollmentToWrite = EnrollmentDocSchema.parse(next);

    // User
    const samples = drillResults.map((r) => ({
      competencyPillarId: r.competencyPillarId,
      score: r.passedFirstTry ? 100 : 0,
    }));
    const grouped = groupSamplesByPillar(samples, pillarIndex);
    const skillScoresByPillar = mergeSkillScores(userState.skillScoresByPillar, grouped);
    const streak = nextStreak(userState.stats, now);
    const stats: UserStats = {
      ...userState.stats,
      totalXp: userState.stats.totalXp + xpAwarded,
      currentStreakDays: streak.currentStreakDays,
      lastActiveDateUtc: streak.lastActiveDateUtc,
      tracksCertifiedCount: userState.stats.tracksCertifiedCount + (newlyCertified ? 1 : 0),
      overallReadinessScore: computeOverallReadiness(skillScoresByPillar),
    };

    // Rollups (first completion only, plus a certification if it happens now)
    const delta = emptyDelta();
    if (isFirstCompletion) {
      delta.unitCompletions = 1;
      delta.pillarSamples = grouped;
      const drillsById = new Map(unit.drills.map((d) => [d.id, d]));
      for (const result of drillResults) {
        if (result.passedFirstTry) continue;
        const drill = drillsById.get(result.drillId);
        addMissedItem(delta, track.id, result.drillId, drill?.prompt ?? result.drillId);
      }
    }
    if (newlyCertified) delta.certifications = 1;

    const rollupSnaps = isDeltaEmpty(delta) ? [] : await readRollups(tx, scopes);

    // Writes (after all reads)
    tx.set(eRef, enrollmentToWrite);
    writeUserProgress(tx, user.uid, stats, skillScoresByPillar, now);
    writeRollups(tx, scopes, rollupSnaps, delta, now);

    return { xpAwarded, enrollment: enrollmentToWrite };
  });
}

/**
 * Mark a Simulation session EVALUATED without touching progress (draft TrackVersions).
 * Fails with 409 when the session was already evaluated.
 */
export async function saveSimulationEvaluation(args: {
  sessionId: string;
  evaluation: SimEvaluation;
  selectedDisposition: string;
}): Promise<void> {
  const ref = simSessionRef(args.sessionId);
  await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    assertSessionEvaluable(snap);
    tx.update(ref, {
      status: 'EVALUATED',
      evaluation: args.evaluation,
      selectedDisposition: args.selectedDisposition,
      updatedAt: Date.now(),
    });
  });
}

function assertSessionEvaluable(snap: DocumentSnapshot) {
  if (!snap.exists) throw new ServiceError(404, 'SESSION_NOT_FOUND', 'This Simulation session does not exist.');
  const status = snap.get('status');
  if (status === 'EVALUATED') {
    throw new ServiceError(409, 'ALREADY_EVALUATED', 'This Simulation is already scored. Start a new call to try again.');
  }
  if (status !== 'ACTIVE' && status !== 'READY_FOR_EVAL') {
    throw new ServiceError(409, 'SESSION_NOT_ACTIVE', 'This Simulation session is closed.');
  }
}

/**
 * Save a Simulation evaluation on a published TrackVersion and record progress (one transaction):
 * session -> EVALUATED, enrollment (passed scenarios, best score, certification, XP), user stats + skill scores,
 * and rollups (attempts, passes, certifications, pillar samples, missed criteria).
 *
 * `version` must be the Track's CURRENT published TrackVersion (enrollment progress is measured against it).
 * `scenario` is the scenario that was played (it can come from an earlier TrackVersion).
 */
export async function recordSimulationEvaluation(args: {
  user: SessionUser;
  track: TrackDoc;
  version: TrackVersionDoc;
  session: SimSessionDoc;
  evaluation: SimEvaluation;
  scenario: PublicSimScenario;
  pillars: CompetencyPillar[];
  selectedDisposition: string;
}): Promise<{ certified: boolean; enrollment: EnrollmentDoc }> {
  const { user, track, version, session, evaluation, scenario, pillars, selectedDisposition } = args;
  const pillarIndex = buildPillarIndex(pillars, version.competencyPillars, track.competencyPillars);
  const scopes = rollupScopesFor(user, track);
  const sRef = simSessionRef(session.id);
  const uRef = userRef(user.uid);
  const eRef = enrollmentRef(user.uid, track.id);

  return adminDb.runTransaction(async (tx) => {
    const now = Date.now();
    const [sessionSnap, userSnap, enrollmentSnap] = await tx.getAll(sRef, uRef, eRef);
    assertSessionEvaluable(sessionSnap);
    const userState = readUserProgress(userSnap);
    const { enrollment: stored } = readEnrollment(enrollmentSnap, user, track, version, now);
    const enrollment = reconcileEnrollment(stored, user, track, version);

    const scenarioInVersion = version.simScenarios.some((s) => s.id === scenario.id);
    // A scenario that is not in the current TrackVersion (the Track was published again) gives no XP or pass credit.
    const isFirstPass =
      evaluation.passed && scenarioInVersion && !enrollment.passedScenarioIds.includes(scenario.id);
    const xpAwarded = isFirstPass ? XP_RULES.simulationPass : 0;

    let next: EnrollmentDoc = {
      ...enrollment,
      passedScenarioIds: isFirstPass ? [...enrollment.passedScenarioIds, scenario.id] : enrollment.passedScenarioIds,
      bestSimScorePct: Math.max(enrollment.bestSimScorePct ?? 0, evaluation.overallScorePct),
      xpEarned: enrollment.xpEarned + xpAwarded,
      lastActivityAt: now,
    };
    let newlyCertified = false;
    if (next.certifiedAt === null && allUnitsComplete(next, version) && next.passedScenarioIds.length > 0) {
      next.certifiedAt = now;
      newlyCertified = true;
    }
    next = reconcileEnrollment(next, user, track, version);
    const enrollmentToWrite = EnrollmentDocSchema.parse(next);

    const samples = evaluation.criterionResults.map((c) => ({
      competencyPillarId: c.competencyPillarId,
      score: c.score,
    }));
    const grouped = groupSamplesByPillar(samples, pillarIndex);
    const skillScoresByPillar = mergeSkillScores(userState.skillScoresByPillar, grouped);
    const streak = nextStreak(userState.stats, now);
    const stats: UserStats = {
      ...userState.stats,
      totalXp: userState.stats.totalXp + xpAwarded,
      currentStreakDays: streak.currentStreakDays,
      lastActiveDateUtc: streak.lastActiveDateUtc,
      tracksCertifiedCount: userState.stats.tracksCertifiedCount + (newlyCertified ? 1 : 0),
      simulationsPassedCount: userState.stats.simulationsPassedCount + (isFirstPass ? 1 : 0),
      overallReadinessScore: computeOverallReadiness(skillScoresByPillar),
    };

    const delta = emptyDelta();
    delta.simAttempts = 1;
    delta.simPasses = evaluation.passed ? 1 : 0;
    delta.certifications = newlyCertified ? 1 : 0;
    delta.pillarSamples = grouped;
    for (const criterion of evaluation.criterionResults) {
      if (criterion.score !== 0) continue;
      addMissedItem(delta, track.id, `sim-${scenario.id}-${criterion.criterionId}`, criterion.criterionLabel);
    }
    const rollupSnaps = await readRollups(tx, scopes);

    tx.update(sRef, {
      status: 'EVALUATED',
      evaluation,
      selectedDisposition,
      updatedAt: now,
    });
    tx.set(eRef, enrollmentToWrite);
    writeUserProgress(tx, user.uid, stats, skillScoresByPillar, now);
    writeRollups(tx, scopes, rollupSnaps, delta, now);

    return {
      certified: evaluation.passed && enrollmentToWrite.status === 'CERTIFIED',
      enrollment: enrollmentToWrite,
    };
  });
}

/** True when every Unit of the TrackVersion is in the enrollment's completedUnitIds. */
export function hasCompletedAllUnits(enrollment: EnrollmentDoc, version: TrackVersionDoc): boolean {
  return allUnitsComplete(enrollment, version);
}
