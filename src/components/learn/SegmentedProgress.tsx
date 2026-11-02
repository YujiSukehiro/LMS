import { Flame } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * State of one progress segment:
 * - `done`: BriefingCard read or Drill cleared on the first try
 * - `recovered`: Drill cleared in the mistake-recovery queue
 * - `missed`: Drill missed and still waiting in the recovery queue
 * - `current`: the item on screen now
 * - `pending`: not reached yet
 */
export type SegmentState = 'done' | 'recovered' | 'missed' | 'current' | 'pending';

export interface SegmentedProgressProps {
  segments: SegmentState[];
  /** Consecutive correct Drill answers. The combo badge shows from 2 in a row. */
  streak?: number;
  /** Accessible name of the progress bar. */
  label?: string;
  className?: string;
}

const SEGMENT_CLASS: Record<SegmentState, string> = {
  done: 'bg-pulse-emerald',
  recovered: 'bg-pulse-amber',
  missed: 'bg-pulse-crimson/70',
  current: 'bg-pulse-indigo animate-pulse',
  pending: 'bg-pulse-surface-2',
};

/** Top segmented progress bar across BriefingCards + Drills with the combo streak badge. */
export function SegmentedProgress({ segments, streak = 0, label = 'Checkpoint progress', className }: SegmentedProgressProps) {
  const total = segments.length;
  const cleared = segments.filter((s) => s === 'done' || s === 'recovered').length;
  const pct = total === 0 ? 0 : Math.round((cleared / total) * 100);

  return (
    <div className={cn('flex items-center gap-3', className)}>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={cleared}
        aria-valuetext={`${cleared} of ${total} items cleared (${pct}%)`}
        className="flex h-3 min-w-0 flex-1 gap-1"
      >
        {segments.map((state, index) => (
          <span
            key={index}
            className={cn('h-full min-w-1 flex-1 rounded-full transition-colors duration-300', SEGMENT_CLASS[state])}
          />
        ))}
      </div>
      <span className="pulse-metric w-10 shrink-0 text-right text-xs text-pulse-muted">{pct}%</span>
      <span
        aria-live="polite"
        className={cn(
          'pulse-pill shrink-0 transition-opacity',
          streak >= 2 ? 'pulse-pill-amber opacity-100' : 'pointer-events-none opacity-0',
        )}
      >
        <Flame aria-hidden className="size-3.5" />
        <span className="pulse-metric">{streak >= 2 ? `${streak} in a row` : ''}</span>
      </span>
    </div>
  );
}
