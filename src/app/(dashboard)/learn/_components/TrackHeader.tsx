import { Award, BookOpen, Eye, Sparkles, Target } from 'lucide-react';
import type { TrackDoc } from '@/lib/schemas/curriculum';
import { DIVISION_LABELS } from '@/lib/schemas/constants';
import { cn } from '@/lib/utils';
import { DIVISION_PILL_CLASS } from '@/components/simulation/labels';

export interface TrackHeaderProps {
  track: TrackDoc;
  masteryPct: number;
  xpEarned: number;
  certified: boolean;
  isPreview: boolean;
  versionNumber: number;
}

/** Track header on the Checkpoint map: Division, campaign code, mastery, XP and Playbook size. */
export function TrackHeader({ track, masteryPct, xpEarned, certified, isPreview, versionNumber }: TrackHeaderProps) {
  const pct = Math.round(Math.max(0, Math.min(100, masteryPct)));
  return (
    <header className="pulse-card-elevated overflow-hidden">
      <div className="p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn('pulse-pill', DIVISION_PILL_CLASS[track.divisionId])}>{DIVISION_LABELS[track.divisionId]}</span>
          {track.campaignCode ? (
            <span className="pulse-metric rounded-pulse-sm border border-pulse-border bg-pulse-bg px-1.5 py-0.5 text-xs font-semibold">
              {track.campaignCode}
            </span>
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
              Campaign Certified
            </span>
          ) : null}
        </div>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-pulse-primary sm:text-3xl">{track.title}</h1>

        <dl className="mt-5 grid grid-cols-3 gap-3">
          <div className="rounded-pulse-md border border-pulse-border-subtle bg-pulse-surface-1 p-3">
            <dt className="pulse-label flex items-center gap-1.5">
              <Target aria-hidden className="size-3.5" /> Mastery
            </dt>
            <dd className="pulse-metric mt-1 text-xl font-bold text-pulse-primary">{pct}%</dd>
          </div>
          <div className="rounded-pulse-md border border-pulse-border-subtle bg-pulse-surface-1 p-3">
            <dt className="pulse-label flex items-center gap-1.5">
              <Sparkles aria-hidden className="size-3.5" /> XP Earned
            </dt>
            <dd className="pulse-metric mt-1 text-xl font-bold text-pulse-amber">{xpEarned.toLocaleString('en-US')}</dd>
          </div>
          <div className="rounded-pulse-md border border-pulse-border-subtle bg-pulse-surface-1 p-3">
            <dt className="pulse-label flex items-center gap-1.5">
              <BookOpen aria-hidden className="size-3.5" /> Playbook
            </dt>
            <dd className="pulse-metric mt-1 text-xl font-bold text-pulse-primary">
              {track.sourcePageCount}
              <span className="ml-1 text-xs font-normal text-pulse-muted">pages</span>
            </dd>
          </div>
        </dl>
      </div>
      <div
        role="progressbar"
        aria-label="Track mastery"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className="h-1.5 bg-pulse-surface-1"
      >
        <div className={cn('h-full', certified ? 'bg-pulse-emerald' : 'bg-pulse-indigo')} style={{ width: `${pct}%` }} />
      </div>
    </header>
  );
}
