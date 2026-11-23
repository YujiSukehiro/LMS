import { Award } from 'lucide-react';
import { STAGE_LABELS, type ProgressCell, type ProgressStage } from '@/lib/services/team-progress';
import { cn } from '@/lib/utils';

const STAGE_PILL: Record<ProgressStage, string> = {
  not_started: '',
  learning: 'pulse-pill-amber',
  checkpoints_done: 'pulse-pill-indigo',
  certified: 'pulse-pill-emerald',
  needs_recert: 'pulse-pill-crimson',
  not_assigned: 'opacity-60',
  archived: 'opacity-60',
};

/**
 * One agent's status on one Track, from the Team Progress ladder. `detail` adds the count that matters at that stage
 * ("2 of 3 Checkpoints") instead of a percent.
 */
export function ProgressStatusChip({ cell, label, showDetail = true }: { cell: ProgressCell; label?: string; showDetail?: boolean }) {
  const detail =
    cell.stage === 'learning'
      ? `${cell.unitsDoneCount} of ${cell.unitsDone.length} Checkpoints`
      : cell.stage === 'needs_recert'
        ? cell.detail
        : null;
  return (
    <span className="inline-flex min-w-0 flex-col items-start gap-0.5">
      <span className={cn('pulse-pill', STAGE_PILL[cell.stage])}>
        {cell.stage === 'certified' ? <Award aria-hidden className="size-3.5" /> : null}
        {label ? <span className="pulse-metric font-semibold">{label}</span> : null}
        {STAGE_LABELS[cell.stage]}
      </span>
      {showDetail && detail ? <span className="pulse-metric text-[0.7rem] text-pulse-muted">{detail}</span> : null}
    </span>
  );
}

/** Plain-text form for CSV exports and screen-reader labels. */
export function progressStatusText(cell: ProgressCell): string {
  if (cell.stage === 'learning') return `${STAGE_LABELS.learning} (${cell.unitsDoneCount} of ${cell.unitsDone.length} Checkpoints)`;
  if (cell.stage === 'needs_recert') return `${STAGE_LABELS.needs_recert} (${cell.detail})`;
  return STAGE_LABELS[cell.stage];
}

/** An agent is ready for calls when they are certified on every Track assigned to them (and have at least one). */
export function isReadyForCalls(cells: Record<string, ProgressCell>): boolean {
  const assigned = Object.values(cells).filter((cell) => cell.stage !== 'not_assigned' && cell.stage !== 'archived');
  return assigned.length > 0 && assigned.every((cell) => cell.stage === 'certified');
}
