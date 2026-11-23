import Link from 'next/link';
import { ChartColumn, Headset, ShieldCheck, Users } from 'lucide-react';
import type { SessionUser } from '@/lib/schemas/domain';
import { SIM_COPY } from '@/lib/policy/training-policy';
import {
  loadCohortRollup,
  loadEnrollmentsForCohort,
  loadPublishedTracksForCohort,
  loadUsersInCohort,
  rollupReadiness,
  simPassRate,
} from '@/components/analytics/server-data';
import { buildProgressCells, loadCurrentCertifications, loadProgressTracks } from '@/components/analytics/progress-cells';
import { EmptyState, KpiStrip, SectionHeader } from '@/components/analytics/KpiStrip';
import { ProgressStatusChip, isReadyForCalls } from '@/components/progress/ProgressStatusChip';
import { BAND_TEXT_CLASS, bandFor, formatPct } from '@/components/analytics/strength';
import { cn } from '@/lib/utils';
import { canManageUser } from '@/lib/auth/rbac';
import { ResetPasswordDialog } from '@/app/(dashboard)/roster/_components/ResetPasswordDialog';
import { cohortLabel, relativeTime } from '../labels';

/** PARTNER_SUPERVISOR home: own Cohort only. Every query is scoped to user.partnerCohortId. */
export async function SupervisorHome({ user, showOffboarded = false }: { user: SessionUser; showOffboarded?: boolean }) {
  const cohortId = user.partnerCohortId;
  const [rollup, members, enrollments, tracks] = await Promise.all([
    loadCohortRollup(cohortId),
    loadUsersInCohort(cohortId),
    loadEnrollmentsForCohort(cohortId),
    loadPublishedTracksForCohort(cohortId),
  ]);
  const allAgents = members
    .filter((m) => m.role === 'AGENT' && m.partnerCohortId === cohortId)
    .sort((a, b) => b.stats.overallReadinessScore - a.stats.overallReadinessScore);
  const activeAgents = allAgents.filter((a) => a.active);
  const offboardedCount = allAgents.length - activeAgents.length;
  const agents = showOffboarded ? allAgents : activeAgents;
  const now = Date.now();
  const progressTracks = await loadProgressTracks(tracks.filter((t) => t.publishedVersionId));
  const certifications = await loadCurrentCertifications(
    progressTracks.map((t) => t.track.id),
    new Set(allAgents.map((a) => a.uid)),
    cohortId,
  );
  const cellsByAgent = buildProgressCells({
    tracks: progressTracks,
    agents: allAgents,
    enrollments: enrollments.filter((e) => e.partnerCohortId === cohortId),
    certifications,
    now,
  });
  const readyCount = activeAgents.filter((a) => isReadyForCalls(cellsByAgent.get(a.uid) ?? {})).length;
  const skillAverage = rollupReadiness(rollup);
  const passRate = simPassRate(rollup);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="pulse-label">Your Cohort</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">{cohortLabel(cohortId)}</h1>
          <p className="mt-1 text-sm text-pulse-muted">
            Readiness of the agents in your Cohort across {tracks.length} assigned Track{tracks.length === 1 ? '' : 's'}.
          </p>
        </div>
        <Link href="/analytics" className="pulse-btn pulse-btn-primary">
          <ChartColumn aria-hidden className="size-4" />
          Open Cohort Analytics
        </Link>
      </div>

      <KpiStrip
        items={[
          {
            label: 'Ready for calls',
            value: `${readyCount} of ${activeAgents.length}`,
            hint: 'certified on all their Tracks',
            icon: <ShieldCheck aria-hidden className="size-3.5" />,
            tone: activeAgents.length > 0 && readyCount === activeAgents.length ? 'emerald' : 'default',
          },
          { label: 'Active Agents', value: String(activeAgents.length), icon: <Users aria-hidden className="size-3.5" /> },
          {
            label: `${SIM_COPY.short} pass rate`,
            value: formatPct(passRate),
            hint: `${rollup?.totalSimPasses ?? 0} of ${rollup?.totalSimAttempts ?? 0} ${SIM_COPY.singular} attempts`,
            icon: <Headset aria-hidden className="size-3.5" />,
          },
          {
            label: 'Average skill score',
            value: formatPct(skillAverage),
            hint: 'Drill and practice scores, all skills',
            icon: <ChartColumn aria-hidden className="size-3.5" />,
          },
        ]}
      />

      <section className="pulse-card flex flex-col gap-4 p-4 md:p-5">
        <SectionHeader
          title="Agents"
          description="Status on each assigned Track, the same as Team Progress. Select an agent to open the Readiness Passport."
          actions={
            offboardedCount > 0 ? (
              <Link href={showOffboarded ? '/' : '/?offboarded=1'} className="pulse-btn text-xs" scroll={false}>
                {showOffboarded ? 'Hide offboarded' : `Show offboarded (${offboardedCount})`}
              </Link>
            ) : null
          }
        />
        {agents.length === 0 ? (
          <EmptyState icon={<Users aria-hidden className="size-6" />} title="No agents in this Cohort yet" />
        ) : (
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-pulse-border-subtle text-left">
                  <th scope="col" className="pulse-label py-2 pr-3">Agent</th>
                  <th scope="col" className="pulse-label py-2 pr-3">Status by Track</th>
                  <th scope="col" className="pulse-label py-2 pr-3 text-right">Skill score</th>
                  <th scope="col" className="pulse-label py-2 text-right">Last activity</th>
                </tr>
              </thead>
              <tbody>
                {agents.map((agent) => {
                  const cells = cellsByAgent.get(agent.uid) ?? {};
                  const mine = enrollments.filter((e) => e.userId === agent.uid);
                  const lastActivity = mine.reduce((max, e) => Math.max(max, e.lastActivityAt), 0);
                  const band = bandFor(agent.stats.overallReadinessScore > 0 ? agent.stats.overallReadinessScore : null);
                  return (
                    <tr key={agent.uid} className={cn('border-b border-pulse-border-subtle/60 align-top last:border-0', !agent.active && 'opacity-50')}>
                      <th scope="row" className="py-2.5 pr-3 text-left font-medium">
                        <Link href={`/analytics/agents/${encodeURIComponent(agent.uid)}`} className="hover:text-pulse-indigo hover:underline">
                          {agent.displayName}
                        </Link>
                        <span className="flex items-center gap-1.5 text-xs font-normal text-pulse-muted">
                          {agent.lcNumber ?? agent.email}
                          {agent.active ? '' : ' · Offboarded'}
                          {canManageUser(user, agent, 'users.resetPassword') ? (
                            <ResetPasswordDialog uid={agent.uid} displayName={agent.displayName} loginIdentifier={agent.lcNumber ?? agent.email} />
                          ) : null}
                        </span>
                      </th>
                      <td className="py-2.5 pr-3">
                        {progressTracks.length === 0 ? (
                          <span className="text-xs text-pulse-muted">No published Tracks</span>
                        ) : (
                          <ul className="flex flex-wrap gap-x-3 gap-y-1.5">
                            {progressTracks.map(({ track }) => {
                              const cell = cells[track.id];
                              if (!cell || cell.stage === 'not_assigned') return null;
                              return (
                                <li key={track.id} className="min-w-0" title={track.title}>
                                  <ProgressStatusChip cell={cell} label={track.campaignCode || track.title} />
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </td>
                      <td className={cn('pulse-metric py-2.5 pr-3 text-right font-semibold', BAND_TEXT_CLASS[band])}>
                        {band === 'none' ? '—' : formatPct(agent.stats.overallReadinessScore)}
                      </td>
                      <td className="py-2.5 text-right text-xs text-pulse-muted">
                        {lastActivity > 0 ? relativeTime(lastActivity, now) : 'No activity'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
