import Link from 'next/link';
import { computeProgressPct } from '@/lib/services/scoring';
import { ArrowRight, Award, BookOpen, Brain, Clock, Flame, Gauge, Layers, Radar, Sparkles, Zap } from 'lucide-react';
import type { SessionUser } from '@/lib/schemas/domain';
import type { EnrollmentDoc } from '@/lib/schemas/analytics';
import type { TrackDoc } from '@/lib/schemas/curriculum';
import { TRAINING_POLICY } from '@/lib/policy/training-policy';
import { loadRetentionQueueForUser } from '@/lib/services/retention-queue';
import { isTrackVisibleToLearner } from '@/lib/services/track-loader';
import { cn } from '@/lib/utils';
import {
  loadEnrollmentsForUser,
  loadPublishedTracksForCohort,
  loadUser,
} from '@/components/analytics/server-data';
import { EmptyState, KpiStrip, ProgressBar, SectionHeader } from '@/components/analytics/KpiStrip';
import { formatPct } from '@/components/analytics/strength';
import { DivisionPill } from '../DivisionPill';

export async function AgentHome({ user }: { user: SessionUser }) {
  const [profile, rawTracks, enrollments, retention] = await Promise.all([
    loadUser(user.uid),
    loadPublishedTracksForCohort(user.partnerCohortId),
    loadEnrollmentsForUser(user.uid),
    loadRetentionQueueForUser(user),
  ]);
  const tracks = rawTracks.filter((track) => isTrackVisibleToLearner(track, user));
  const enrollmentByTrack = new Map(enrollments.map((e) => [e.trackId, e]));
  const stats = profile?.stats;
  const firstName = user.displayName.split(/\s+/)[0] ?? user.displayName;
  const certifiedCount = enrollments.filter((e) => e.status === 'CERTIFIED').length;

  // In-progress first, then not started, then certified.
  const order = (track: TrackDoc) => {
    const status = enrollmentByTrack.get(track.id)?.status ?? 'NOT_STARTED';
    return status === 'IN_PROGRESS' ? 0 : status === 'NOT_STARTED' ? 1 : 2;
  };
  const sorted = [...tracks].sort((a, b) => order(a) - order(b));

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
        <SectionHeader title="Assigned Tracks" description="Tracks assigned to your Cohort." />
        {sorted.length === 0 ? (
          <EmptyState
            icon={<Layers aria-hidden className="size-6" />}
            title="No Tracks are assigned to your Cohort yet"
            body="When a trainer publishes a Track for your Cohort, it shows here."
          />
        ) : (
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {sorted.map((track) => (
              <li key={track.id}>
                <AgentTrackCard track={track} enrollment={enrollmentByTrack.get(track.id) ?? null} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function AgentTrackCard({ track, enrollment }: { track: TrackDoc; enrollment: EnrollmentDoc | null }) {
  const status = enrollment?.status ?? 'NOT_STARTED';
  // Recomputed from the counts, not the stored progressPct, so older enrollments use the current formula.
  const checkpointsDone = Math.min(enrollment?.completedUnitIds.length ?? 0, track.unitCount);
  const progress = computeProgressPct({
    completedUnitCount: checkpointsDone,
    unitCount: track.unitCount,
    passedScenarioCount: Math.min(enrollment?.passedScenarioIds.length ?? 0, track.simScenarioCount),
    scenarioCount: track.simScenarioCount,
  });
  const cta = status === 'CERTIFIED' ? 'Practice Again' : status === 'IN_PROGRESS' ? 'Continue' : 'Start Track';
  return (
    <Link
      href={`/learn/${encodeURIComponent(track.id)}`}
      className={cn(
        'pulse-card group flex h-full flex-col gap-3 p-4 transition-colors hover:border-pulse-border',
        status === 'CERTIFIED' && 'border-pulse-emerald/30',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <DivisionPill divisionId={track.divisionId} short />
        {status === 'CERTIFIED' ? (
          <span className="pulse-pill pulse-pill-emerald">
            <Award aria-hidden className="size-3.5" />
            Certified
          </span>
        ) : status === 'IN_PROGRESS' ? (
          <span className="pulse-pill pulse-pill-amber pulse-metric">
            {checkpointsDone} of {track.unitCount} Checkpoints
          </span>
        ) : (
          <span className="pulse-pill">Not Started</span>
        )}
      </div>
      <div className="min-w-0">
        <h3 className="line-clamp-2 font-semibold leading-snug">{track.title}</h3>
        {track.campaignCode ? <p className="pulse-metric mt-0.5 text-xs text-pulse-muted">{track.campaignCode}</p> : null}
      </div>
      <div className="flex items-center gap-3 text-xs text-pulse-muted">
        <span className="flex items-center gap-1">
          <BookOpen aria-hidden className="size-3.5" />
          {track.unitCount} Checkpoints
        </span>
        <span className="flex items-center gap-1">
          <Clock aria-hidden className="size-3.5" />~{track.estimatedTotalMinutes} min
        </span>
        {enrollment && enrollment.xpEarned > 0 ? (
          <span className="pulse-metric flex items-center gap-1 text-pulse-indigo-text">
            <Zap aria-hidden className="size-3.5" />
            {enrollment.xpEarned} XP
          </span>
        ) : null}
      </div>
      <div className="mt-auto flex flex-col gap-2">
        <ProgressBar value={progress} tone={status === 'CERTIFIED' ? 'emerald' : 'indigo'} label={`${track.title} progress`} />
        <span className="flex items-center justify-end gap-1 text-sm font-semibold text-pulse-indigo-text group-hover:text-pulse-primary">
          {cta}
          <ArrowRight aria-hidden className="size-4 transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
    </Link>
  );
}
