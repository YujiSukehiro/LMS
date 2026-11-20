import { Award, BookOpen, Eye, Sparkles, Target } from 'lucide-react';
import type { TrackDoc } from '@/lib/schemas/curriculum';
import { DIVISION_LABELS } from '@/lib/schemas/constants';
import { cn } from '@/lib/utils';
import { DIVISION_PILL_CLASS } from '@/components/simulation/labels';

export interface TrackHeaderProps {
  track: TrackDoc;
  masteryPct: number | null;
  xpEarned: number;
  certified: boolean;
  isPreview: boolean;
  versionNumber: number;
}

/** Track header on the Checkpoint map: Division, campaign code, mastery, XP and Playbook size. */
export function TrackHeader({ track, masteryPct, xpEarned, certified, isPreview, versionNumber }: TrackHeaderProps) {
  const pct = masteryPct === null ? null : Math.round(Math.max(0, Math.min(100, masteryPct)));
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
              <Target aria-hidden className="size-3" /> Mastery
            </dt>
            <dd className="pulse-metric mt-0.5 text-lg font-bold text-pulse-primary">{pct === null ? '—' : `${pct}%`}</dd>
          </div>
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
        aria-label="Track mastery"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct ?? undefined}
        className="h-1 bg-pulse-surface-2"
      >
        <div className={cn('h-full', certified ? 'bg-pulse-emerald' : 'bg-pulse-indigo')} style={{ width: `${pct ?? 0}%` }} />
      </div>
    </header>
  );
}
