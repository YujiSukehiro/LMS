import type { DivisionId } from '@/lib/schemas/domain';
import { DIVISION_LABELS } from '@/lib/schemas/constants';
import { cn } from '@/lib/utils';
import { DIVISION_PILL_CLASS, DIVISION_SHORT_LABELS } from './labels';

export function DivisionPill({
  divisionId,
  short = false,
  className,
}: {
  divisionId: DivisionId;
  short?: boolean;
  className?: string;
}) {
  return (
    <span className={cn('pulse-pill', DIVISION_PILL_CLASS[divisionId], className)}>
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {short ? DIVISION_SHORT_LABELS[divisionId] : DIVISION_LABELS[divisionId]}
    </span>
  );
}
