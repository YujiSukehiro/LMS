import type { Metadata } from 'next';
import Link from 'next/link';
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
} from '@/lib/schemas/analytics';
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
import { CertificationMatrix, type CertificationMatrixAgent } from '@/components/analytics/CertificationMatrix';
import { buildProgressCells, loadCurrentCertifications, loadProgressTracks } from '@/components/analytics/progress-cells';
import { MissedRulesTable } from '@/components/analytics/MissedRulesTable';
import { EmptyState, KpiStrip, SectionHeader } from '@/components/analytics/KpiStrip';
import { formatPct } from '@/components/analytics/strength';
import { cohortLabel } from '@/components/layout/labels';
import { SIM_COPY } from '@/lib/policy/training-policy';

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
  const offboardedCount = agents.filter((a) => !a.active).length;
  const showOffboarded = firstString(sp.offboarded) === '1';
  const listedAgents = showOffboarded ? agents : agents.filter((a) => a.active);

  // ---------- Widget 1: heatmap ----------
  const heatmapRows: HeatmapRow[] = heatmapCohortRollups.map(({ cohortId, rollup }) => cohortRow(rollup, cohortId));
  if (cohort) heatmapRows.push(...listedAgents.map(agentRow));

  // ---------- Widget 2: status by agent (same ladder as Team Progress) ----------
  const matrixAgentList = listedAgents.slice(0, MAX_MATRIX_AGENTS);
  const progressTracks = await loadProgressTracks(matrixTracks.filter((t) => t.publishedVersionId));
  const certifications = await loadCurrentCertifications(
    progressTracks.map((t) => t.track.id),
    new Set(matrixAgentList.map((a) => a.uid)),
    internal ? null : user.partnerCohortId,
  );
  const cellsByAgent = buildProgressCells({ tracks: progressTracks, agents: matrixAgentList, enrollments, certifications });
  const matrixAgents: CertificationMatrixAgent[] = matrixAgentList.map((agent) => ({
    uid: agent.uid,
    displayName: agent.displayName,
    lcNumber: agent.lcNumber,
    cohortLabel: cohortLabel(agent.partnerCohortId),
    cells: cellsByAgent.get(agent.uid) ?? {},
  }));
  const offboardedHref = (() => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(sp)) {
      const v = firstString(value);
      if (v && key !== 'offboarded') params.set(key, v);
    }
    if (!showOffboarded) params.set('offboarded', '1');
    const query = params.toString();
    return query ? `/analytics?${query}` : '/analytics';
  })();

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
            label: `${SIM_COPY.short} attempts`,
            value: String(kpiRollup?.totalSimAttempts ?? 0),
            icon: <Headset aria-hidden className="size-3.5" />,
          },
          {
            label: `${SIM_COPY.short} pass rate`,
            value: formatPct(passRate),
            hint: `${kpiRollup?.totalSimPasses ?? 0} passed`,
            icon: <Target aria-hidden className="size-3.5" />,
            tone: passRate === null ? 'default' : passRate >= 85 ? 'emerald' : passRate >= 70 ? 'amber' : 'crimson',
          },
        ]}
      />

      <section className="pulse-card flex flex-col gap-4 p-4 md:p-5">
        <SectionHeader
          title="Skill strength by Cohort"
          description={
            cohort
              ? 'Cohort average first, then each agent in the Cohort. Hover a cell for the sample count.'
              : `Average first-try Drill and ${SIM_COPY.singular} scores per skill. Select a Cohort to see its agents.`
          }
        />
        {heatmapRows.length === 0 ? (
          <EmptyState title="No strength data yet" body={`Scores appear after agents complete Checkpoints and ${SIM_COPY.plural}.`} />
        ) : (
          <CohortStrengthHeatmap rows={heatmapRows} caption="Skill strength by Cohort" />
        )}
      </section>

      <section className="pulse-card flex flex-col gap-4 p-4 md:p-5">
        <SectionHeader
          title="Status by agent"
          description="The same status as Team Progress, on the current Track version. Live-call sign-off is a separate decision."
          actions={
            offboardedCount > 0 ? (
              <Link href={offboardedHref} className="pulse-btn text-xs" scroll={false}>
                {showOffboarded ? 'Hide offboarded' : `Show offboarded (${offboardedCount})`}
              </Link>
            ) : null
          }
        />
        <CertificationMatrix
          agents={matrixAgents}
          tracks={progressTracks.map(({ track: t }) => ({ id: t.id, title: t.title, campaignCode: t.campaignCode }))}
          fileLabel={(cohort ?? division ?? 'all').toLowerCase()}
        />
        {listedAgents.length > MAX_MATRIX_AGENTS ? (
          <p className="text-xs text-pulse-muted">
            Showing the first {MAX_MATRIX_AGENTS} of {listedAgents.length} agents. Filter by Cohort to see the rest.
          </p>
        ) : null}
      </section>

      <section className="pulse-card flex flex-col gap-4 p-4 md:p-5">
        <SectionHeader
          title="Most-missed Drills"
          description="First-try misses. A high count often means the Playbook rule is unclear."
        />
        <MissedRulesTable rows={missed} trackTitles={trackTitles} linkToStudio={internal} />
      </section>
    </div>
  );
}
