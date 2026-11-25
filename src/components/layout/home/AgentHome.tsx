import Link from 'next/link';
import { ArrowRight, Award, Brain, Flame, Gauge, Layers, Radar, Sparkles, Zap } from 'lucide-react';
import type { SessionUser } from '@/lib/schemas/domain';
import { TRAINING_POLICY } from '@/lib/policy/training-policy';
import { loadRetentionQueueForUser } from '@/lib/services/retention-queue';
import { cn } from '@/lib/utils';
import { loadUser } from '@/components/analytics/server-data';
import { EmptyState, KpiStrip, SectionHeader } from '@/components/analytics/KpiStrip';
import { formatPct } from '@/components/analytics/strength';
import { AssignedTrackCard } from '@/components/learn/AssignedTrackCard';
import { loadMyTrainings } from '@/components/learn/my-trainings-data';

export async function AgentHome({ user }: { user: SessionUser }) {
  const [profile, mine, retention] = await Promise.all([
    loadUser(user.uid),
    loadMyTrainings(user),
    loadRetentionQueueForUser(user),
  ]);
  const { tracks, enrollmentByTrack, certifiedCount } = mine;
  const stats = profile?.stats;
  const firstName = user.displayName.split(/\s+/)[0] ?? user.displayName;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Welcome back, {firstName}</h1>
          <p className="mt-0.5 text-sm text-pulse-muted">
            {TRAINING_POLICY.simulationInteractionMode === 'verbal_only'
              ? 'Finish your Checkpoints, pass Verbal Practice, and keep rules fresh with short reviews.'
              : 'Finish each Checkpoint, then pass a Live Call Sim to get certified.'}
          </p>
        </div>
        <Link href={`/analytics/agents/${encodeURIComponent(user.uid)}`} className="pulse-btn text-sm">
          <Radar aria-hidden className="size-4" />
          My Readiness Passport
        </Link>
      </div>

      <KpiStrip
        items={[
          {
            label: 'Total XP',
            value: (stats?.totalXp ?? 0).toLocaleString('en-US'),
            icon: <Zap aria-hidden className="size-3.5" />,
            tone: 'indigo',
          },
          {
            label: 'Streak',
            value: `${stats?.currentStreakDays ?? 0} day${stats?.currentStreakDays === 1 ? '' : 's'}`,
            icon: <Flame aria-hidden className="size-3.5 text-pulse-amber" />,
            tone: (stats?.currentStreakDays ?? 0) > 0 ? 'amber' : 'default',
          },
          {
            label: 'Readiness',
            value: formatPct(stats?.overallReadinessScore ?? null),
            icon: <Gauge aria-hidden className="size-3.5" />,
          },
          {
            label: 'Certified Tracks',
            value: `${certifiedCount} / ${tracks.length}`,
            icon: <Award aria-hidden className="size-3.5" />,
            tone: certifiedCount > 0 ? 'emerald' : 'default',
          },
        ]}
      />

      <section
        aria-label="Knowledge Retention"
        className={cn(
          'pulse-card flex flex-wrap items-center justify-between gap-3 px-4 py-3',
          retention.summary.dueCount > 0 && 'border-pulse-amber/40',
        )}
      >
        <div className="min-w-0 flex-1 space-y-1">
          <p className="pulse-label flex items-center gap-1.5">
            <Brain aria-hidden className="size-3.5 text-pulse-indigo" />
            Knowledge Retention
          </p>
          <h2 className="text-base font-semibold text-pulse-primary">
            {retention.summary.dueCount > 0 ? (
              <>
                <span className="pulse-metric">{retention.summary.dueCount}</span> spaced review drill
                {retention.summary.dueCount === 1 ? '' : 's'} due now
              </>
            ) : retention.summary.scheduledCount > 0 ? (
              'All scheduled rules are up to date'
            ) : (
              'Keep Playbook rules sharp'
            )}
          </h2>
          <p className="text-sm text-pulse-muted">
            {retention.summary.scheduledCount > 0 ? (
              <>
                <span className="pulse-metric">{retention.summary.scheduledCount}</span> active schedule
                {retention.summary.scheduledCount === 1 ? '' : 's'} ·{' '}
                <span className="pulse-metric">{retention.summary.masteredCount}</span> fully retained (1, 3 and 7 day reviews).
              </>
            ) : (
              'Finish a Checkpoint to start short review drills.'
            )}
          </p>
        </div>
        <Link
          href="/learn/review"
          className={cn('pulse-btn shrink-0', retention.summary.dueCount > 0 ? 'pulse-btn-primary' : '')}
        >
          <Sparkles aria-hidden className="size-4" />
          {retention.summary.dueCount > 0 ? `Start Keep-Sharp Review (${retention.summary.dueCount})` : 'Open Retention Hub'}
          <ArrowRight aria-hidden className="size-4" />
        </Link>
      </section>

      <section className="flex flex-col gap-3">
        <SectionHeader title="Assigned Tracks" description="Tracks assigned to your Cohort or to you." />
        {tracks.length === 0 ? (
          <EmptyState
            icon={<Layers aria-hidden className="size-6" />}
            title="No Tracks are assigned to your Cohort yet"
            body="When a trainer publishes a Track for your Cohort, it shows here."
          />
        ) : (
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {tracks.map((track) => (
              <li key={track.id}>
                <AssignedTrackCard track={track} enrollment={enrollmentByTrack.get(track.id) ?? null} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
