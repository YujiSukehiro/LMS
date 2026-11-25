import Link from 'next/link';
import { ArrowRight, GraduationCap } from 'lucide-react';
import type { SessionUser } from '@/lib/schemas/domain';
import { cn } from '@/lib/utils';
import { loadMyTrainings } from './my-trainings-data';

/**
 * Staff Home strip (Supervisor, Trainer, Admin): the user's own assigned trainings, so compliance Tracks assigned to
 * staff are never hidden behind Track Studio or Team Progress. Agents see the full list on their Home instead.
 */
export async function MyTrainingsCallout({ user }: { user: SessionUser }) {
  const { tracks, openCount, enrollmentByTrack } = await loadMyTrainings(user);
  const next = tracks.find((t) => enrollmentByTrack.get(t.id)?.status !== 'CERTIFIED') ?? null;
  const inProgress = next ? enrollmentByTrack.get(next.id)?.status === 'IN_PROGRESS' : false;

  return (
    <section
      aria-label="My Trainings"
      className={cn(
        'pulse-card flex flex-wrap items-center justify-between gap-3 px-4 py-3',
        openCount > 0 && 'border-pulse-amber/40',
      )}
    >
      <div className="min-w-0 flex-1 space-y-1">
        <p className="pulse-label flex items-center gap-1.5">
          <GraduationCap aria-hidden className="size-3.5 text-pulse-indigo" />
          My Trainings
        </p>
        <h2 className="text-base font-semibold text-pulse-primary">
          {tracks.length === 0 ? (
            'No trainings are assigned to you'
          ) : openCount > 0 ? (
            <>
              <span className="pulse-metric">{openCount}</span> of <span className="pulse-metric">{tracks.length}</span>{' '}
              assigned training{tracks.length === 1 ? '' : 's'} still to finish
            </>
          ) : (
            `All ${tracks.length} assigned training${tracks.length === 1 ? '' : 's'} certified`
          )}
        </h2>
        {next ? <p className="truncate text-sm text-pulse-muted">Next: {next.title}</p> : null}
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        {next ? (
          <Link href={`/learn/${encodeURIComponent(next.id)}`} className="pulse-btn pulse-btn-primary">
            {inProgress ? 'Continue' : 'Start'}
            <ArrowRight aria-hidden className="size-4" />
          </Link>
        ) : null}
        <Link href="/learn" className="pulse-btn">
          Open My Trainings
        </Link>
      </div>
    </section>
  );
}
