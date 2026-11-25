import Link from 'next/link';
import { ArrowRight, Award, BookOpen, Clock, Zap } from 'lucide-react';
import type { EnrollmentDoc } from '@/lib/schemas/analytics';
import type { TrackDoc } from '@/lib/schemas/curriculum';
import { computeProgressPct } from '@/lib/services/scoring';
import { cn } from '@/lib/utils';
import { ProgressBar } from '@/components/analytics/KpiStrip';
import { DivisionPill } from '@/components/layout/DivisionPill';

/** One assigned Track with the learner's own status and progress. Used on Agent Home and My Trainings. */
export function AssignedTrackCard({ track, enrollment }: { track: TrackDoc; enrollment: EnrollmentDoc | null }) {
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
