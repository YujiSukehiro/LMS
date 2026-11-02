import { Gauge } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DIFFICULTY_LABELS, DIFFICULTY_PILL_CLASS, type SimDifficulty } from './labels';

export function DifficultyBadge({ difficulty, className }: { difficulty: SimDifficulty; className?: string }) {
  return (
    <span className={cn('pulse-pill', DIFFICULTY_PILL_CLASS[difficulty], className)}>
      <Gauge aria-hidden className="size-3.5" />
      {DIFFICULTY_LABELS[difficulty]}
    </span>
  );
}
