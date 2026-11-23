import type { Metadata } from 'next';
import { adminDb } from '@/lib/firebase/admin';
import { isInternalOps, requirePageUser } from '@/lib/firebase/auth-guard';
import { ANALYTICS_ROLES, DIVISION_LABELS } from '@/lib/schemas/constants';
import { EnrollmentDocSchema, type EnrollmentDoc } from '@/lib/schemas/analytics';
import { DivisionIdSchema, type DivisionId } from '@/lib/schemas/domain';
import { describeIdle } from '@/lib/services/team-progress';
import { buildProgressCells, loadCurrentCertifications, loadProgressTracks } from '@/components/analytics/progress-cells';
import {
  isTrackAssignedToCohort,
  loadAllAgents,
  loadAwaitingJudgeSessions,
  loadCohortOptions,
  loadEnrollmentsForCohort,
  loadPublishedTracks,
  loadUsersInCohort,
} from '@/components/analytics/server-data';
import { AnalyticsFilterBar } from '@/components/analytics/AnalyticsFilterBar';
import { TeamProgressBoard, type BoardAgent, type BoardTrack } from '@/components/progress/TeamProgressBoard';
import { cohortLabel } from '@/components/layout/labels';
import { AwaitingJudgeQueue } from '@/components/analytics/AwaitingJudgeQueue';
import { awaitingJudgeRows } from '@/lib/services/judge-queue';

export const metadata: Metadata = { title: 'Team Progress' };
export const dynamic = 'force-dynamic';

const MAX_AGENTS = 400;
const MAX_TRACKS = 8;

/** Firestore allows at most 30 values in one `in` filter. */
const FIRESTORE_IN_LIMIT = 30;

/** Enrollments for only the Tracks on the board (internal ops, no Cohort selected), chunked for the `in` limit. */
async function loadEnrollmentsForTracks(trackIds: string[]): Promise<EnrollmentDoc[]> {
  const chunks: string[][] = [];
  for (let i = 0; i < trackIds.length; i += FIRESTORE_IN_LIMIT) chunks.push(trackIds.slice(i, i + FIRESTORE_IN_LIMIT));
  const snaps = await Promise.all(
    chunks.map((ids) => adminDb.collection('enrollments').where('trackId', 'in', ids).get()),
  );
  return snaps
    .flatMap((snap) => snap.docs)
    .map((doc) => EnrollmentDocSchema.safeParse({ ...doc.data(), id: doc.id }))
    .flatMap((parsed) => (parsed.success ? [parsed.data] : []));
}

function firstString(value: string | string[] | undefined): string | null {
  const v = Array.isArray(value) ? value[0] : value;
  return v && v.trim() ? v.trim() : null;
}

export default async function TeamProgressPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePageUser(ANALYTICS_ROLES);
  const internal = isInternalOps(user);
  const sp = await searchParams;
  const divisionParse = DivisionIdSchema.safeParse(firstString(sp.division));
  const division: DivisionId | null = divisionParse.success ? divisionParse.data : null;
  // Strict Cohort isolation: a PARTNER_SUPERVISOR only ever sees their own Cohort.
  const cohort: string | null = internal ? firstString(sp.cohort) : user.partnerCohortId;

  const [publishedTracks, cohortOptions, awaitingJudge] = await Promise.all([
    loadPublishedTracks(),
    loadCohortOptions(),
    // Internal ops only: the manual judge package contains secret rubric content.
    internal ? loadAwaitingJudgeSessions().then(awaitingJudgeRows).catch(() => []) : Promise.resolve([]),
  ]);
  const visibleTracks = (internal ? publishedTracks : publishedTracks.filter((t) => isTrackAssignedToCohort(t, user.partnerCohortId)))
    .filter((t) => t.publishedVersionId);
  const requestedTrack = firstString(sp.track);
  const selectedTrack = visibleTracks.find((t) => t.id === requestedTrack && (!division || t.divisionId === division)) ?? null;
  const tracks = visibleTracks
    .filter((t) => (!division || t.divisionId === division) && (!selectedTrack || t.id === selectedTrack.id))
    .slice(0, MAX_TRACKS);

  const progressTracks = await loadProgressTracks(tracks);

  const [rawAgents, rawEnrollments] = await Promise.all([
    cohort ? loadUsersInCohort(cohort) : loadAllAgents(),
    cohort ? loadEnrollmentsForCohort(cohort) : loadEnrollmentsForTracks(tracks.map((t) => t.id)),
  ]);
  const agents = rawAgents
    .filter((a) => a.role === 'AGENT')
    .filter((a) => internal || a.partnerCohortId === user.partnerCohortId)
    .filter((a) => !division || a.divisionIds.includes(division))
    .slice(0, MAX_AGENTS);
  const enrollments = rawEnrollments.filter((e) => internal || e.partnerCohortId === user.partnerCohortId);
  const certifications = await loadCurrentCertifications(
    tracks.map((t) => t.id),
    new Set(agents.map((a) => a.uid)),
    internal ? null : user.partnerCohortId,
  );
  const now = Date.now();
  const cellsByAgent = buildProgressCells({ tracks: progressTracks, agents, enrollments, certifications, now });
  const boardTracks: BoardTrack[] = progressTracks.map(({ track: t, shape }) => ({
    id: t.id,
    title: t.title,
    campaignCode: t.campaignCode,
    versionLabel: t.publishedVersionId ?? '',
    unitCount: shape.units.length,
    simCount: shape.scenarios.length,
  }));
  const boardAgents: BoardAgent[] = agents.map((agent) => {
    const cells = cellsByAgent.get(agent.uid) ?? {};
    const lastActivity = Math.max(0, ...Object.values(cells).map((c) => c.lastActivityAt ?? 0)) || null;
    return {
      uid: agent.uid,
      displayName: agent.displayName,
      lcNumber: agent.lcNumber,
      cohortLabel: cohortLabel(agent.partnerCohortId),
      active: agent.active,
      activityLabel: agent.active ? describeIdle(lastActivity, now) : 'deactivated',
      cells,
    };
  });

  const scopeLabel = cohort ? `${cohortLabel(cohort)} Cohort` : division ? DIVISION_LABELS[division] : 'All Cohorts';
  const lockedCohortOptions = internal ? cohortOptions : [{ id: user.partnerCohortId, name: cohortLabel(user.partnerCohortId) }];

  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="pulse-label">Team Progress · {scopeLabel}</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">Who is ready to take calls?</h1>
        <p className="mt-1 max-w-3xl text-sm text-pulse-muted">
          One card per agent. Agents who are stuck, failing or expiring show first.
        </p>
      </div>
      {internal ? <AwaitingJudgeQueue rows={awaitingJudge} now={Date.now()} /> : null}
      <AnalyticsFilterBar
        value={{ division, cohort, track: selectedTrack?.id ?? null }}
        cohorts={lockedCohortOptions}
        tracks={visibleTracks.map((t) => ({ id: t.id, title: t.title, divisionId: t.divisionId }))}
        cohortLocked={!internal}
      />
      <TeamProgressBoard tracks={boardTracks} agents={boardAgents} />
    </div>
  );
}
