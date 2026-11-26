/**
 * Server-only data for the Staff page: the people a viewer looks after, each with their assigned trainings, today's
 * practice count and the actions the viewer may take. Scope comes from canSeeOnStaffPage (RBAC matrix).
 */
import { adminDb } from '@/lib/firebase/admin';
import { canManageUser, canSeeOnStaffPage } from '@/lib/auth/rbac';
import { ROLE_LABELS } from '@/lib/schemas/constants';
import type { SessionUser, UserRole } from '@/lib/schemas/domain';
import type { EnrollmentDoc } from '@/lib/schemas/analytics';
import type { CertificationDoc } from '@/lib/schemas/learning';
import {
  UserSummarySchema,
  loadAllEnrollments,
  loadEnrollmentsForCohort,
  loadPublishedTracks,
  loadUsersInCohort,
  type UserSummary,
} from '@/components/analytics/server-data';
import { loadCurrentCertifications, loadProgressTracks, type ProgressTrack } from '@/components/analytics/progress-cells';
import { cohortLabel } from '@/components/layout/labels';
import { deriveProgressCell, type ProgressCell } from './team-progress';
import { isTrackOnMyTrainings } from './track-loader';
import { dailySimUsageForUsers, maxSimSessionsPerDay } from './simulation-engine';
import { staffFlags, type StaffFlags } from './staff-rules';

const MAX_PEOPLE = 2000;

export interface StaffTraining {
  trackId: string;
  title: string;
  cell: ProgressCell;
}

export interface StaffPerson {
  uid: string;
  displayName: string;
  email: string | null;
  lcNumber: string | null;
  role: UserRole;
  roleLabel: string;
  cohortLabel: string;
  active: boolean;
  lastActivityAt: number | null;
  trainings: StaffTraining[];
  practiceCounted: number;
  practiceLimit: number;
  practiceResetToday: boolean;
  flags: StaffFlags;
  canResetPractice: boolean;
  canResetPassword: boolean;
}

function epochMs(value: unknown): number | null {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object' && 'seconds' in value && typeof (value as { seconds: unknown }).seconds === 'number') {
    return (value as { seconds: number }).seconds * 1000;
  }
  return null;
}

async function loadAllUsers(): Promise<UserSummary[]> {
  const snap = await adminDb.collection('users').limit(MAX_PEOPLE).get();
  return snap.docs.flatMap((doc) => {
    const parsed = UserSummarySchema.safeParse({ ...doc.data(), uid: doc.get('uid') ?? doc.id });
    return parsed.success ? [parsed.data] : [];
  });
}

/** One person's training cells, using My Trainings assignment (staff skip the Division gate, learners keep it). */
function trainingsFor(
  person: UserSummary,
  tracks: readonly ProgressTrack[],
  enrollments: ReadonlyMap<string, EnrollmentDoc>,
  certifications: ReadonlyMap<string, CertificationDoc | null>,
  now: number,
): StaffTraining[] {
  const joinedAt = epochMs(person.createdAt);
  return tracks
    .filter(({ track }) => isTrackOnMyTrainings(track, person))
    .map(({ track, shape, publishedAt }) => {
      const key = `${person.uid}::${track.id}`;
      const assignedAt = publishedAt === null && joinedAt === null ? null : Math.max(publishedAt ?? 0, joinedAt ?? 0);
      return {
        trackId: track.id,
        title: track.title,
        cell: deriveProgressCell({
          track: shape,
          enrollment: enrollments.get(key),
          certification: certifications.get(key) ?? null,
          assigned: true,
          agentActive: person.active,
          assignedAt,
          now,
        }),
      };
    });
}

/** Everyone on the viewer's Staff page, or one person when `onlyUid` is set (null when not visible). */
export async function loadStaffPeople(viewer: SessionUser, options: { onlyUid?: string; now?: number } = {}): Promise<StaffPerson[]> {
  const now = options.now ?? Date.now();
  const supervisor = viewer.role === 'PARTNER_SUPERVISOR';
  const cohortScope = supervisor ? viewer.partnerCohortId : null;

  const [rawPeople, publishedTracks] = await Promise.all([
    cohortScope ? loadUsersInCohort(cohortScope) : loadAllUsers(),
    loadPublishedTracks(),
  ]);
  const people = rawPeople
    .filter((person) => canSeeOnStaffPage(viewer, person))
    .filter((person) => !options.onlyUid || person.uid === options.onlyUid);
  if (people.length === 0) return [];

  const uids = people.map((p) => p.uid);
  const tracks = await loadProgressTracks(publishedTracks.filter((t) => t.publishedVersionId));
  const [rawEnrollments, certifications, usage] = await Promise.all([
    cohortScope ? loadEnrollmentsForCohort(cohortScope) : loadAllEnrollments(),
    loadCurrentCertifications(tracks.map((t) => t.track.id), new Set(uids), cohortScope),
    dailySimUsageForUsers(uids, cohortScope, now),
  ]);
  const wanted = new Set(uids);
  const enrollments = new Map(
    rawEnrollments.filter((e) => wanted.has(e.userId)).map((e) => [`${e.userId}::${e.trackId}`, e] as const),
  );
  const limit = maxSimSessionsPerDay();

  return people
    .map((person): StaffPerson => {
      const trainings = trainingsFor(person, tracks, enrollments, certifications, now);
      const practice = usage.get(person.uid);
      const counted = practice?.counted ?? 0;
      const lastActivityAt = Math.max(0, ...trainings.map((t) => t.cell.lastActivityAt ?? 0)) || null;
      return {
        uid: person.uid,
        displayName: person.displayName,
        email: person.email ?? null,
        lcNumber: person.lcNumber ?? null,
        role: person.role,
        roleLabel: ROLE_LABELS[person.role],
        cohortLabel: cohortLabel(person.partnerCohortId),
        active: person.active,
        lastActivityAt,
        trainings,
        practiceCounted: counted,
        practiceLimit: limit,
        practiceResetToday: practice?.resetAt !== null && practice?.resetAt !== undefined,
        flags: staffFlags({
          active: person.active,
          trainings: trainings.map((t) => ({ stage: t.cell.stage, lastActivityAt: t.cell.lastActivityAt })),
          practiceCounted: counted,
          practiceLimit: limit,
          now,
        }),
        canResetPractice: canManageUser(viewer, person, 'sims.resetDailyLimit'),
        canResetPassword: canManageUser(viewer, person, 'users.resetPassword'),
      };
    })
    .sort((a, b) => Number(b.active) - Number(a.active) || a.displayName.localeCompare(b.displayName));
}
