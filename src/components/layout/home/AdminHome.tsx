import Link from 'next/link';
import { ArrowRight, Award, BookOpen, ChartColumn, Gauge, Headset, Layers, Trophy, Users } from 'lucide-react';
import type { SessionUser } from '@/lib/schemas/domain';
import { SIM_COPY, TRAINING_POLICY } from '@/lib/policy/training-policy';
import { DivisionIdSchema } from '@/lib/schemas/domain';
import {
  loadAllCohortRollups,
  loadGlobalAndDivisionRollups,
  rollupReadiness,
  simPassRate,
} from '@/components/analytics/server-data';
import { EmptyState, KpiStrip, ProgressBar, SectionHeader } from '@/components/analytics/KpiStrip';
import { BAND_TEXT_CLASS, bandFor, formatPct } from '@/components/analytics/strength';
import { cn } from '@/lib/utils';
import { DivisionPill } from '../DivisionPill';
import { cohortLabel } from '../labels';

export async function AdminHome({ user }: { user: SessionUser }) {
  const [{ global, divisions }, cohortRollups] = await Promise.all([
    loadGlobalAndDivisionRollups(),
    loadAllCohortRollups(),
  ]);
  const globalReadiness = rollupReadiness(global);
  const leaderboard = cohortRollups
    .map((r) => ({
      cohortId: r.partnerCohortId ?? r.id.replace(/^COHORT_/, ''),
      readiness: rollupReadiness(r),
      certifications: r.totalCertifications,
      passRate: simPassRate(r),
    }))
    .sort((a, b) => (b.readiness ?? -1) - (a.readiness ?? -1));
  const firstName = user.displayName.split(/\s+/)[0] ?? user.displayName;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="pulse-label">Operations Readiness</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">Hello, {firstName}</h1>
          <p className="mt-1 text-sm text-pulse-muted">Readiness across every Division and Cohort.</p>
        </div>
        <nav aria-label="Quick links" className="flex flex-wrap gap-2">
          <Link href="/studio" className="pulse-btn">
            <Layers aria-hidden className="size-4" />
            Track Studio
          </Link>
          <Link href="/roster" className="pulse-btn">
            <Users aria-hidden className="size-4" />
            Roster
          </Link>
          <Link href="/analytics" className="pulse-btn pulse-btn-primary">
            <ChartColumn aria-hidden className="size-4" />
            Analytics
          </Link>
        </nav>
      </div>

      <KpiStrip
        items={[
          { label: 'Certifications', value: String(global?.totalCertifications ?? 0), icon: <Award aria-hidden className="size-3.5" />, tone: 'emerald' },
          { label: 'Checkpoint Completions', value: String(global?.totalUnitCompletions ?? 0), icon: <BookOpen aria-hidden className="size-3.5" /> },
          {
            label: 'Sim Pass Rate',
            value: formatPct(simPassRate(global)),
            hint: `${global?.totalSimPasses ?? 0} of ${global?.totalSimAttempts ?? 0} ${TRAINING_POLICY.simulationInteractionMode === 'verbal_only' ? 'Verbal Practice' : 'Live Call Sims'}`,
            icon: <Headset aria-hidden className="size-3.5" />,
          },
          {
            label: 'Global Readiness',
            value: formatPct(globalReadiness),
            icon: <Gauge aria-hidden className="size-3.5" />,
          },
        ]}
      />

      <section className="flex flex-col gap-3">
        <SectionHeader title="Divisions" />
        <div className="grid gap-3 md:grid-cols-3">
          {DivisionIdSchema.options.map((divisionId) => {
            const rollup = divisions[divisionId];
            const readiness = rollupReadiness(rollup);
            const band = bandFor(readiness);
            return (
              <Link
                key={divisionId}
                href={`/analytics?division=${divisionId}`}
                className="pulse-card group flex flex-col gap-3 p-4 transition-colors hover:border-pulse-border"
              >
                <div className="flex items-center justify-between">
                  <DivisionPill divisionId={divisionId} />
                  <ArrowRight aria-hidden className="size-4 text-pulse-muted group-hover:text-pulse-primary" />
                </div>
                <div className="flex items-baseline gap-2">
                  <span className={cn('pulse-metric text-3xl font-semibold', BAND_TEXT_CLASS[band])}>{formatPct(readiness)}</span>
                  <span className="text-xs text-pulse-muted">readiness</span>
                </div>
                <dl className="grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <dt className="text-pulse-muted">Certified</dt>
                    <dd className="pulse-metric text-sm font-semibold">{rollup?.totalCertifications ?? 0}</dd>
                  </div>
                  <div>
                    <dt className="text-pulse-muted">Checkpoints</dt>
                    <dd className="pulse-metric text-sm font-semibold">{rollup?.totalUnitCompletions ?? 0}</dd>
                  </div>
                  <div>
                    <dt className="text-pulse-muted">{SIM_COPY.short} pass</dt>
                    <dd className="pulse-metric text-sm font-semibold">{formatPct(simPassRate(rollup))}</dd>
                  </div>
                </dl>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="pulse-card flex flex-col gap-4 p-4 md:p-5">
        <SectionHeader title="Cohort leaderboard" description="Ranked by average skill score." />
        {leaderboard.length === 0 ? (
          <EmptyState
            icon={<Trophy aria-hidden className="size-6" />}
            title="No Cohort activity yet"
            body="Cohorts appear here after their agents complete a Checkpoint or a Live Call Sim."
          />
        ) : (
          <ol className="flex flex-col gap-2">
            {leaderboard.map((row, index) => {
              const band = bandFor(row.readiness);
              return (
                <li key={row.cohortId}>
                  <Link
                    href={`/analytics?cohort=${encodeURIComponent(row.cohortId)}`}
                    className="grid grid-cols-[2rem_minmax(0,1fr)_minmax(0,2fr)_4rem] items-center gap-3 rounded-pulse-sm px-2 py-2 hover:bg-pulse-surface-2/50 md:grid-cols-[2rem_minmax(0,1fr)_minmax(0,2fr)_4rem_6rem_6rem]"
                  >
                    <span className="pulse-metric text-sm text-pulse-muted">{index + 1}</span>
                    <span className="truncate font-medium">{cohortLabel(row.cohortId)}</span>
                    <ProgressBar
                      value={row.readiness ?? 0}
                      tone={band === 'strong' ? 'emerald' : band === 'borderline' ? 'amber' : 'indigo'}
                      label={`${cohortLabel(row.cohortId)} readiness`}
                    />
                    <span className={cn('pulse-metric text-right font-semibold', BAND_TEXT_CLASS[band])}>{formatPct(row.readiness)}</span>
                    <span className="pulse-metric hidden text-right text-xs text-pulse-muted md:block">{row.certifications} certified</span>
                    <span className="pulse-metric hidden text-right text-xs text-pulse-muted md:block">{formatPct(row.passRate)} {SIM_COPY.short.toLowerCase()} pass</span>
                  </Link>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </div>
  );
}
