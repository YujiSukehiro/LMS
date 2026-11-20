import { Archive, CircleAlert, CircleCheck, LoaderCircle, Pencil } from 'lucide-react';
import type { TrackStatus } from '@/lib/schemas/curriculum';
import { cn } from '@/lib/utils';
import type { TrackDisplayStatus } from './track-display-status';

const CONFIG: Record<TrackDisplayStatus, { label: string; className: string }> = {
  GENERATING: { label: 'Generating', className: 'pulse-pill-indigo' },
  BUILD_FAILED: { label: 'Build failed', className: 'pulse-pill-crimson' },
  DRAFT: { label: 'Draft', className: 'pulse-pill-amber' },
  PUBLISHED: { label: 'Published', className: 'pulse-pill-emerald' },
  ARCHIVED: { label: 'Archived', className: '' },
};

export function TrackStatusPill({ status, className }: { status: TrackStatus | TrackDisplayStatus; className?: string }) {
  const config = CONFIG[status];
  const Icon =
    status === 'GENERATING'
      ? LoaderCircle
      : status === 'BUILD_FAILED'
        ? CircleAlert
        : status === 'PUBLISHED'
          ? CircleCheck
          : status === 'DRAFT'
            ? Pencil
            : Archive;
  return (
    <span className={cn('pulse-pill', config.className, className)}>
      <Icon aria-hidden className={cn('size-3.5', status === 'GENERATING' && 'animate-spin')} />
      {config.label}
    </span>
  );
}
