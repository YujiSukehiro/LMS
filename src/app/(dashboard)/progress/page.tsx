import type { Metadata } from 'next';
import { adminDb } from '@/lib/firebase/admin';
import { isInternalOps, requirePageUser } from '@/lib/firebase/auth-guard';
import { ANALYTICS_ROLES, DIVISION_LABELS } from '@/lib/schemas/constants';
import { EnrollmentDocSchema, type EnrollmentDoc } from '@/lib/schemas/analytics';
import { DivisionIdSchema, type DivisionId } from '@/lib/schemas/domain';
import { CertificationDocSchema, type CertificationDoc } from '@/lib/schemas/learning';
import { selectCurrentCertification } from '@/lib/services/learning-evidence';
import { loadVersion } from '@/lib/services/track-loader';
import { deriveProgressCell, describeIdle, type ProgressTrackShape } from '@/lib/services/team-progress';
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

  const versions = await Promise.all(tracks.map((t) => loadVersion(t.id, t.publishedVersionId as string).catch(() => null)));
  const shapes = new Map<string, ProgressTrackShape>(
    tracks.map((track, index) => {
      const version = versions[index];
      return [
        track.id,
        {
          units: [...(version?.units ?? [])].sort((a, b) => a.orderIndex - b.orderIndex).map((u) => ({ id: u.id, title: u.title })),
          scenarios: (version?.simScenarios ?? []).map((s) => ({ id: s.id, title: s.title, passScoreThreshold: s.passScoreThreshold })),
        },
      ];
    }),
  );

  const [rawAgents, rawEnrollments] = await Promise.all([
    cohort ? loadUsersInCohort(cohort) : loadAllAgents(),
    cohort ? loadEnrollmentsForCohort(cohort) : loadEnrollmentsForTracks(tracks.map((t) => t.id)),
  ]);
  const agents = rawAgents
    .filter((a) => a.role === 'AGENT')
    .filter((a) => internal || a.partnerCohortId === user.partnerCohortId)
    .filter((a) => !division || a.divisionIds.includes(division))
    .slice(0, MAX_AGENTS);
  const enrollmentByKey = new Map(
    rawEnrollments
      .filter((e) => internal || e.partnerCohortId === user.partnerCohortId)
      .map((e) => [`${e.userId}::${e.trackId}`, e]),
  );

  const certificationSnaps = await Promise.all(
    tracks.map((track) => adminDb.collection('certifications').where('trackId', '==', track.id).get()),
  );
  const agentIds = new Set(agents.map((a) => a.uid));
  const certificationsByKey = new Map<string, CertificationDoc[]>();
  for (const doc of certificationSnaps.flatMap((snap) => snap.docs)) {
    const parsed = CertificationDocSchema.safeParse({ ...doc.data(), id: doc.id });
    if (!parsed.success) continue;
    const certification = parsed.data;
    if (!agentIds.has(certification.learnerId) || (!internal && certification.partnerCohortId !== user.partnerCohortId)) continue;
    const key = `${certification.learnerId}::${certification.trackId}`;
    certificationsByKey.set(key, [...(certificationsByKey.get(key) ?? []), certification]);
  }

  const now = Date.now();
  const boardTracks: BoardTrack[] = tracks.map((t) => {
    const shape = shapes.get(t.id)!;
    return {
      id: t.id,
      title: t.title,
      campaignCode: t.campaignCode,
      versionLabel: t.publishedVersionId ?? '',
      unitCount: shape.units.length,
      simCount: shape.scenarios.length,
    };
  });
  const boardAgents: BoardAgent[] = agents.map((agent) => {
    const cells = Object.fromEntries(
      tracks.map((track) => {
        const key = `${agent.uid}::${track.id}`;
        return [
          track.id,
          deriveProgressCell({
            track: shapes.get(track.id)!,
            enrollment: enrollmentByKey.get(key),
            certification: selectCurrentCertification(certificationsByKey.get(key) ?? []),
            assigned: isTrackAssignedToCohort(track, agent.partnerCohortId),
            agentActive: agent.active,
            now,
          }),
        ];
      }),
    );
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
