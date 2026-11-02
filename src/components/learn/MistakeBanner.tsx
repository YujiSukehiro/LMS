import { RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface MistakeBannerProps {
  /** Recovery round number (2 = first recovery pass). */
  round: number;
  /** Missed Drills still to clear, including the one on screen. */
  remaining: number;
  className?: string;
}

/** Amber banner shown while the learner clears the mistake-recovery queue. */
export function MistakeBanner({ round, remaining, className }: MistakeBannerProps) {
  return (
    <div
      role="status"
      className={cn(
        'flex items-center gap-3 rounded-pulse-md border border-pulse-amber/40 bg-pulse-amber/10 px-4 py-3 text-sm text-pulse-amber',
        className,
      )}
    >
      <RotateCcw aria-hidden className="size-4 shrink-0" />
      <p className="font-semibold">
        Round <span className="pulse-metric">{round}</span>: Clear Your Missed Concepts{' '}
        <span className="pulse-metric font-normal">({remaining} left)</span>
      </p>
    </div>
  );
}
