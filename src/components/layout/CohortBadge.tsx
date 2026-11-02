import { Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { cohortLabel } from './labels';

export function CohortBadge({ cohortId, className }: { cohortId: string; className?: string }) {
  return (
    <span className={cn('pulse-pill', className)} title={`Cohort: ${cohortLabel(cohortId)}`}>
      <Users aria-hidden className="size-3.5" />
      <span className="sr-only">Cohort:</span>
      {cohortLabel(cohortId)}
    </span>
  );
}
