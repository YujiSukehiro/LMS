import Link from 'next/link';
import { Award, ChartColumn, CircleCheck, Gauge, Headset, Users } from 'lucide-react';
import type { SessionUser } from '@/lib/schemas/domain';
import { TRAINING_POLICY } from '@/lib/policy/training-policy';
import {
  loadCohortRollup,
  loadEnrollmentsForCohort,
  loadPublishedTracksForCohort,
  loadUsersInCohort,
  rollupReadiness,
  simPassRate,
} from '@/components/analytics/server-data';
import { EmptyState, KpiStrip, ProgressBar, SectionHeader } from '@/components/analytics/KpiStrip';
import { BAND_TEXT_CLASS, bandFor, formatPct } from '@/components/analytics/strength';
import { cn } from '@/lib/utils';
import { cohortLabel, relativeTime } from '../labels';

/** PARTNER_SUPERVISOR home: own Cohort only. Every query is scoped to user.partnerCohortId. */
export async function SupervisorHome({ user }: { user: SessionUser }) {
  const cohortId = user.partnerCohortId;
  const [rollup, members, enrollments, tracks] = await Promise.all([
    loadCohortRollup(cohortId),
    loadUsersInCohort(cohortId),
    loadEnrollmentsForCohort(cohortId),
    loadPublishedTracksForCohort(cohortId),
  ]);
  const agents = members
    .filter((m) => m.role === 'AGENT' && m.partnerCohortId === cohortId)
    .sort((a, b) => b.stats.overallReadinessScore - a.stats.overallReadinessScore);
  const publishedIds = new Set(tracks.map((t) => t.id));
  const readiness = rollupReadiness(rollup);
  const passRate = simPassRate(rollup);
  const now = Date.now();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="pulse-label">Cohort Readiness</p>
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
          { label: 'Active Agents', value: String(agents.filter((a) => a.active).length), icon: <Users aria-hidden className="size-3.5" /> },
          {
            label: 'Certifications',
            value: String(rollup?.totalCertifications ?? 0),
            icon: <Award aria-hidden className="size-3.5" />,
            tone: 'emerald',
          },
          {
            label: 'Sim Pass Rate',
            value: formatPct(passRate),
            hint: `${rollup?.totalSimPasses ?? 0} of ${rollup?.totalSimAttempts ?? 0} ${TRAINING_POLICY.simulationInteractionMode === 'verbal_only' ? 'Verbal Practice' : 'Live Call Sims'}`,
            icon: <Headset aria-hidden className="size-3.5" />,
          },
          {
            label: 'Cohort Readiness',
            value: formatPct(readiness),
            hint: `${rollup?.totalUnitCompletions ?? 0} Checkpoint completions`,
            icon: <Gauge aria-hidden className="size-3.5" />,
            tone: readiness === null ? 'default' : bandFor(readiness) === 'strong' ? 'emerald' : bandFor(readiness) === 'borderline' ? 'amber' : 'crimson',
          },
        ]}
      />

      <section className="pulse-card flex flex-col gap-4 p-4 md:p-5">
        <SectionHeader title="Agents" description="Sorted by readiness score. Select an agent to open the Readiness Passport." />
        {agents.length === 0 ? (
          <EmptyState icon={<Users aria-hidden className="size-6" />} title="No agents in this Cohort yet" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-pulse-border-subtle text-left">
                  <th scope="col" className="pulse-label py-2 pr-3">Agent</th>
                  <th scope="col" className="pulse-label py-2 pr-3 text-right">Readiness</th>
                  <th scope="col" className="pulse-label py-2 pr-3">Certified</th>
                  <th scope="col" className="pulse-label w-48 py-2 pr-3">Average progress</th>
                  <th scope="col" className="pulse-label py-2 text-right">Last activity</th>
                </tr>
              </thead>
              <tbody>
                {agents.map((agent) => {
                  const mine = enrollments.filter((e) => e.userId === agent.uid && publishedIds.has(e.trackId));
                  const certified = mine.filter((e) => e.status === 'CERTIFIED').length;
                  const avgProgress =
                    tracks.length === 0 ? 0 : mine.reduce((sum, e) => sum + e.progressPct, 0) / tracks.length;
                  const lastActivity = mine.reduce((max, e) => Math.max(max, e.lastActivityAt), 0);
                  const band = bandFor(agent.stats.overallReadinessScore > 0 ? agent.stats.overallReadinessScore : null);
                  return (
                    <tr key={agent.uid} className={cn('border-b border-pulse-border-subtle/60 last:border-0', !agent.active && 'opacity-50')}>
                      <th scope="row" className="py-2.5 pr-3 text-left font-medium">
                        <Link href={`/analytics/agents/${encodeURIComponent(agent.uid)}`} className="hover:text-pulse-indigo hover:underline">
                          {agent.displayName}
                        </Link>
                        <span className="block text-xs font-normal text-pulse-muted">
                          {agent.lcNumber ?? agent.email}
                          {agent.active ? '' : ' · Inactive'}
                        </span>
                      </th>
                      <td className={cn('pulse-metric py-2.5 pr-3 text-right font-semibold', BAND_TEXT_CLASS[band])}>
                        {band === 'none' ? '—' : formatPct(agent.stats.overallReadinessScore)}
                      </td>
                      <td className="py-2.5 pr-3">
                        <span className={cn('pulse-metric inline-flex items-center gap-1', certified > 0 ? 'text-pulse-emerald' : 'text-pulse-muted')}>
                          <CircleCheck aria-hidden className="size-3.5" />
                          {certified} / {tracks.length}
                        </span>
                      </td>
                      <td className="py-2.5 pr-3">
                        <div className="flex items-center gap-2">
                          <ProgressBar value={avgProgress} label={`${agent.displayName} average progress`} />
                          <span className="pulse-metric w-10 text-right text-xs text-pulse-muted">{Math.round(avgProgress)}%</span>
                        </div>
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
