import type { Metadata } from 'next';
import { Award, BookOpen, Headset, Target } from 'lucide-react';
import { isInternalOps, requirePageUser } from '@/lib/firebase/auth-guard';
import { ANALYTICS_ROLES, CANONICAL_PILLARS, DIVISION_LABELS } from '@/lib/schemas/constants';
import { DivisionIdSchema, type DivisionId } from '@/lib/schemas/domain';
import {
  rollupIdForCohort,
  rollupIdForDivision,
  rollupIdForGlobal,
  rollupIdForTrack,
  type AnalyticsRollupDoc,
  type EnrollmentDoc,
} from '@/lib/schemas/analytics';
import type { TrackDoc } from '@/lib/schemas/curriculum';
import {
  isTrackAssignedToCohort,
  loadAllAgents,
  loadAllCohortRollups,
  loadAllEnrollments,
  loadCohortOptions,
  loadEnrollmentsForCohort,
  loadPublishedTracks,
  loadRollup,
  loadUsersInCohort,
  pillarAverage,
  rankMissedItems,
  simPassRate,
  type UserSummary,
} from '@/components/analytics/server-data';
import { AnalyticsFilterBar } from '@/components/analytics/AnalyticsFilterBar';
import { CohortStrengthHeatmap, type HeatmapRow } from '@/components/analytics/CohortStrengthHeatmap';
import {
  CertificationMatrix,
  type CertificationCell,
  type CertificationMatrixAgent,
} from '@/components/analytics/CertificationMatrix';
import { MissedRulesTable } from '@/components/analytics/MissedRulesTable';
import { EmptyState, KpiStrip, SectionHeader } from '@/components/analytics/KpiStrip';
import { formatPct } from '@/components/analytics/strength';
import { cohortLabel } from '@/components/layout/labels';

export const metadata: Metadata = { title: 'Analytics' };
export const dynamic = 'force-dynamic';

const MAX_MATRIX_AGENTS = 400;

function firstString(value: string | string[] | undefined): string | null {
  const v = Array.isArray(value) ? value[0] : value;
  return v && v.trim() ? v.trim() : null;
}

function cohortRow(rollup: AnalyticsRollupDoc | null, cohortId: string): HeatmapRow {
  return {
    id: cohortId,
    label: cohortLabel(cohortId),
    kind: 'cohort',
    href: `/analytics?cohort=${encodeURIComponent(cohortId)}`,
    cells: Object.fromEntries(
      CANONICAL_PILLARS.map((p) => {
        const agg = rollup?.pillarAggregates[p.key];
        return [p.key, { average: pillarAverage(agg), sampleCount: agg?.sampleCount ?? 0 }];
      }),
    ),
  };
}

function agentRow(agent: UserSummary): HeatmapRow {
  return {
    id: agent.uid,
    label: agent.displayName,
    sublabel: agent.lcNumber ?? undefined,
    kind: 'agent',
    href: `/analytics/agents/${encodeURIComponent(agent.uid)}`,
    cells: Object.fromEntries(
      CANONICAL_PILLARS.map((p) => {
        const stat = agent.skillScoresByPillar[p.key];
        return [p.key, { average: stat && stat.attempts > 0 ? stat.averageScore : null, sampleCount: stat?.attempts ?? 0 }];
      }),
    ),
  };
}

function certificationCell(track: TrackDoc, agent: UserSummary, enrollment: EnrollmentDoc | undefined): CertificationCell {
  if (enrollment) {
    if (enrollment.status === 'CERTIFIED') return { status: 'CERTIFIED', pct: enrollment.bestSimScorePct };
    if (enrollment.status === 'IN_PROGRESS') return { status: 'IN_PROGRESS', pct: enrollment.progressPct };
    return { status: 'NOT_STARTED', pct: null };
  }
  return isTrackAssignedToCohort(track, agent.partnerCohortId)
    ? { status: 'NOT_STARTED', pct: null }
    : { status: 'NOT_ASSIGNED', pct: null };
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePageUser(ANALYTICS_ROLES);
  const internal = isInternalOps(user);
  const sp = await searchParams;

  const divisionParse = DivisionIdSchema.safeParse(firstString(sp.division));
  const division: DivisionId | null = divisionParse.success ? divisionParse.data : null;
  // Strict Cohort isolation: a PARTNER_SUPERVISOR always sees only their own Cohort.
  const cohort: string | null = internal ? firstString(sp.cohort) : user.partnerCohortId;

  const [publishedTracks, cohortOptions] = await Promise.all([loadPublishedTracks(), loadCohortOptions()]);
  const visibleTracks = internal ? publishedTracks : publishedTracks.filter((t) => isTrackAssignedToCohort(t, user.partnerCohortId));
  const requestedTrack = firstString(sp.track);
  const selectedTrack = visibleTracks.find((t) => t.id === requestedTrack && (!division || t.divisionId === division)) ?? null;
  const matrixTracks = visibleTracks.filter(
    (t) => (!division || t.divisionId === division) && (!selectedTrack || t.id === selectedTrack.id),
  );
  const trackById = new Map(visibleTracks.map((t) => [t.id, t]));

  // ---------- Rollups (scope chosen by the most specific filter) ----------
  let kpiRollup: AnalyticsRollupDoc | null;
  let scopeLabel: string;
  let heatmapCohortRollups: Array<{ cohortId: string; rollup: AnalyticsRollupDoc | null }>;
  if (!internal) {
    kpiRollup = await loadRollup(rollupIdForCohort(user.partnerCohortId));
    scopeLabel = `${cohortLabel(user.partnerCohortId)} Cohort`;
    heatmapCohortRollups = [{ cohortId: user.partnerCohortId, rollup: kpiRollup }];
  } else if (cohort) {
    kpiRollup = await loadRollup(rollupIdForCohort(cohort));
    scopeLabel = `${cohortLabel(cohort)} Cohort`;
    heatmapCohortRollups = [{ cohortId: cohort, rollup: kpiRollup }];
  } else {
    const [allCohortRollups, scoped] = await Promise.all([
      loadAllCohortRollups(),
      loadRollup(
        selectedTrack
          ? rollupIdForTrack(selectedTrack.id)
          : division
            ? rollupIdForDivision(division)
            : rollupIdForGlobal(),
      ),
    ]);
    kpiRollup = scoped;
    scopeLabel = selectedTrack ? `Track: ${selectedTrack.title}` : division ? `${DIVISION_LABELS[division]}` : 'All Cohorts';
    heatmapCohortRollups = allCohortRollups
      .map((r) => ({ cohortId: r.partnerCohortId ?? r.id.replace(/^COHORT_/, ''), rollup: r }))
      .sort((a, b) => cohortLabel(a.cohortId).localeCompare(cohortLabel(b.cohortId)));
  }

  // ---------- Agents + enrollments (Cohort-scoped whenever a Cohort is set) ----------
  const [rawAgents, rawEnrollments] = await Promise.all([
    cohort ? loadUsersInCohort(cohort) : loadAllAgents(),
    cohort ? loadEnrollmentsForCohort(cohort) : loadAllEnrollments(),
  ]);
  const agents = rawAgents
    .filter((a) => a.role === 'AGENT')
    .filter((a) => internal || a.partnerCohortId === user.partnerCohortId)
    .filter((a) => !division || a.divisionIds.includes(division))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
  const enrollments = rawEnrollments.filter((e) => internal || e.partnerCohortId === user.partnerCohortId);
  const enrollmentByKey = new Map(enrollments.map((e) => [`${e.userId}::${e.trackId}`, e]));

  // ---------- Widget 1: heatmap ----------
  const heatmapRows: HeatmapRow[] = heatmapCohortRollups.map(({ cohortId, rollup }) => cohortRow(rollup, cohortId));
  if (cohort) heatmapRows.push(...agents.map(agentRow));

  // ---------- Widget 2: certification matrix ----------
  const matrixAgents: CertificationMatrixAgent[] = agents.slice(0, MAX_MATRIX_AGENTS).map((agent) => ({
    uid: agent.uid,
    displayName: agent.displayName,
    lcNumber: agent.lcNumber,
    cohortLabel: cohortLabel(agent.partnerCohortId),
    cells: Object.fromEntries(
      matrixTracks.map((track) => [track.id, certificationCell(track, agent, enrollmentByKey.get(`${agent.uid}::${track.id}`))]),
    ),
  }));

  // ---------- Widget 3: Playbook Gap Detector ----------
  const missed = rankMissedItems([kpiRollup], 200)
    .filter((row) => internal || trackById.has(row.trackId))
    .filter((row) => !selectedTrack || row.trackId === selectedTrack.id)
    .filter((row) => {
      if (!division) return true;
      const track = trackById.get(row.trackId);
      return track ? track.divisionId === division : false;
    })
    .slice(0, 15);
  const trackTitles = Object.fromEntries(publishedTracks.map((t) => [t.id, t.title]));

  const passRate = simPassRate(kpiRollup);
  const lockedCohortOptions = internal
    ? cohortOptions
    : [{ id: user.partnerCohortId, name: cohortLabel(user.partnerCohortId) }];

  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="pulse-label">Strengths &amp; Blind Spots</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">Readiness Analytics</h1>
        <p className="mt-1 text-sm text-pulse-muted">
          Scope: <span className="text-pulse-secondary">{scopeLabel}</span>
          {internal && cohort && (division || selectedTrack) ? ' · KPIs show the whole Cohort; the tables use every filter.' : ''}
        </p>
      </div>

      <AnalyticsFilterBar
        value={{ division, cohort, track: selectedTrack?.id ?? null }}
        cohorts={lockedCohortOptions}
        tracks={visibleTracks.map((t) => ({ id: t.id, title: t.title, divisionId: t.divisionId }))}
        cohortLocked={!internal}
      />

      <KpiStrip
        items={[
          {
            label: 'Certifications',
            value: String(kpiRollup?.totalCertifications ?? 0),
            icon: <Award aria-hidden className="size-3.5" />,
            tone: 'emerald',
          },
          {
            label: 'Checkpoint Completions',
            value: String(kpiRollup?.totalUnitCompletions ?? 0),
            icon: <BookOpen aria-hidden className="size-3.5" />,
          },
          {
            label: 'Sim Attempts',
            value: String(kpiRollup?.totalSimAttempts ?? 0),
            icon: <Headset aria-hidden className="size-3.5" />,
          },
          {
            label: 'Sim Pass Rate',
            value: formatPct(passRate),
            hint: `${kpiRollup?.totalSimPasses ?? 0} passed`,
            icon: <Target aria-hidden className="size-3.5" />,
            tone: passRate === null ? 'default' : passRate >= 85 ? 'emerald' : passRate >= 70 ? 'amber' : 'crimson',
          },
        ]}
      />

      <section className="pulse-card flex flex-col gap-4 p-4 md:p-5">
        <SectionHeader
          title="Cohort × CompetencyPillar Strength Heatmap"
          description={
            cohort
              ? 'Cohort average first, then each agent in the Cohort. Hover a cell for the sample count.'
              : 'Mean first-try Drill and Live Call Sim criterion scores. Select a Cohort row to see its agents.'
          }
        />
        {heatmapRows.length === 0 ? (
          <EmptyState title="No strength data yet" body="Scores appear after agents complete Checkpoints and Live Call Sims." />
        ) : (
          <CohortStrengthHeatmap rows={heatmapRows} caption="Strength by Cohort and CompetencyPillar" />
        )}
      </section>

      <section className="pulse-card flex flex-col gap-4 p-4 md:p-5">
        <SectionHeader
          title="Campaign Certification Matrix"
          description="Who is verified to take live calls on which campaign."
        />
        <CertificationMatrix
          agents={matrixAgents}
          tracks={matrixTracks.map((t) => ({ id: t.id, title: t.title, campaignCode: t.campaignCode }))}
          fileLabel={(cohort ?? division ?? 'all').toLowerCase()}
        />
        {agents.length > MAX_MATRIX_AGENTS ? (
          <p className="text-xs text-pulse-muted">
            Showing the first {MAX_MATRIX_AGENTS} of {agents.length} agents. Filter by Cohort to see the rest.
          </p>
        ) : null}
      </section>

      <section className="pulse-card flex flex-col gap-4 p-4 md:p-5">
        <SectionHeader
          title="Playbook Gap Detector"
          description="The Drills that agents miss most on the first try. Many misses can mean the Playbook rule is not clear."
        />
        <MissedRulesTable rows={missed} trackTitles={trackTitles} linkToStudio={internal} />
      </section>
    </div>
  );
}
