import { Award, BookOpen, Eye, Headset, Sparkles, Target } from 'lucide-react';
import type { TrackDoc } from '@/lib/schemas/curriculum';
import { DIVISION_LABELS } from '@/lib/schemas/constants';
import { cn } from '@/lib/utils';
import { DIVISION_PILL_CLASS } from '@/components/simulation/labels';
import { SIM_COPY } from '@/lib/policy/training-policy';
import { computeProgressPct } from '@/lib/services/scoring';

export interface TrackHeaderProps {
  track: TrackDoc;
  checkpointsDone: number;
  checkpointCount: number;
  practicePassed: number;
  practiceCount: number;
  xpEarned: number;
  certified: boolean;
  isPreview: boolean;
  versionNumber: number;
}

/**
 * Track header on the Checkpoint map: Division, campaign code, Checkpoints and Practice passed, XP and Playbook size.
 * The bar is the same completion figure as everywhere else (computeProgressPct), worked out from these counts.
 */
export function TrackHeader({
  track,
  checkpointsDone,
  checkpointCount,
  practicePassed,
  practiceCount,
  xpEarned,
  certified,
  isPreview,
  versionNumber,
}: TrackHeaderProps) {
  const pct = computeProgressPct({
    completedUnitCount: checkpointsDone,
    unitCount: checkpointCount,
    passedScenarioCount: practicePassed,
    scenarioCount: practiceCount,
  });
  return (
    <header className="pulse-card overflow-hidden">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 p-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={cn('pulse-pill', DIVISION_PILL_CLASS[track.divisionId])}>{DIVISION_LABELS[track.divisionId]}</span>
            {track.campaignCode ? (
              <span className="pulse-metric text-xs font-semibold text-pulse-secondary">{track.campaignCode}</span>
            ) : null}
            <span className="pulse-metric text-xs text-pulse-muted">v{versionNumber}</span>
            {isPreview ? (
              <span className="pulse-pill pulse-pill-amber">
                <Eye aria-hidden className="size-3.5" />
                Draft preview
              </span>
            ) : null}
            {certified ? (
              <span className="pulse-pill pulse-pill-emerald">
                <Award aria-hidden className="size-3.5" />
                Certified
              </span>
            ) : null}
          </div>
          <h1 className="mt-1.5 text-xl font-bold tracking-tight text-pulse-primary sm:text-2xl">{track.title}</h1>
        </div>

        <dl className="flex gap-5 text-sm">
          <div>
            <dt className="pulse-label flex items-center gap-1">
              <Target aria-hidden className="size-3" /> Checkpoints
            </dt>
            <dd className="pulse-metric mt-0.5 text-lg font-bold text-pulse-primary">
              {checkpointsDone}
              <span className="font-sans text-xs font-normal text-pulse-muted"> / {checkpointCount}</span>
            </dd>
          </div>
          {practiceCount > 0 ? (
            <div>
              <dt className="pulse-label flex items-center gap-1">
                <Headset aria-hidden className="size-3" /> {SIM_COPY.short}
              </dt>
              <dd className="pulse-metric mt-0.5 text-lg font-bold text-pulse-primary">
                {practicePassed}
                <span className="font-sans text-xs font-normal text-pulse-muted"> / {practiceCount}</span>
              </dd>
            </div>
          ) : null}
          <div>
            <dt className="pulse-label flex items-center gap-1">
              <Sparkles aria-hidden className="size-3" /> XP
            </dt>
            <dd className="pulse-metric mt-0.5 text-lg font-bold text-pulse-amber">{xpEarned.toLocaleString('en-US')}</dd>
          </div>
          <div>
            <dt className="pulse-label flex items-center gap-1">
              <BookOpen aria-hidden className="size-3" /> Playbook
            </dt>
            <dd className="pulse-metric mt-0.5 text-lg font-bold text-pulse-primary">
              {track.sourcePageCount}
              <span className="ml-1 font-sans text-xs font-normal text-pulse-muted">pp</span>
            </dd>
          </div>
        </dl>
      </div>
      <div
        role="progressbar"
        aria-label="Track completion"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className="h-1 bg-pulse-surface-2"
      >
        <div className={cn('h-full', certified ? 'bg-pulse-emerald' : 'bg-pulse-indigo')} style={{ width: `${pct}%` }} />
      </div>
    </header>
  );
}
