'use client';

import { useTransition } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { LoaderCircle, Lock, SlidersHorizontal, X } from 'lucide-react';
import type { DivisionId } from '@/lib/schemas/domain';
import { DIVISION_LABELS } from '@/lib/schemas/constants';

export interface FilterValue {
  division: DivisionId | null;
  cohort: string | null;
  track: string | null;
}

/** Division / Cohort / Track filters stored in the URL search params. */
export function AnalyticsFilterBar({
  value,
  cohorts,
  tracks,
  cohortLocked,
}: {
  value: FilterValue;
  cohorts: Array<{ id: string; name: string }>;
  tracks: Array<{ id: string; title: string; divisionId: DivisionId }>;
  /** PARTNER_SUPERVISOR: the Cohort is fixed to their own Cohort. */
  cohortLocked: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  function apply(next: FilterValue) {
    const params = new URLSearchParams();
    if (next.division) params.set('division', next.division);
    if (next.cohort && !cohortLocked) params.set('cohort', next.cohort);
    if (next.track) params.set('track', next.track);
    const query = params.toString();
    startTransition(() => {
      router.push(query ? `${pathname}?${query}` : pathname);
    });
  }

  const trackOptions = value.division ? tracks.filter((t) => t.divisionId === value.division) : tracks;
  const hasFilters = Boolean(value.division || value.track || (value.cohort && !cohortLocked));

  return (
    <div className="pulse-card flex flex-wrap items-end gap-3 p-3">
      <span className="pulse-label flex items-center gap-1.5 self-center pr-1">
        <SlidersHorizontal aria-hidden className="size-3.5" />
        Filters
      </span>
      <label className="flex min-w-40 flex-1 flex-col gap-1 sm:flex-none">
        <span className="text-[0.7rem] font-semibold text-pulse-muted">Division</span>
        <select
          className="pulse-select py-1.5"
          value={value.division ?? ''}
          onChange={(e) => {
            const division = (e.target.value || null) as DivisionId | null;
            const trackStillValid = !division || tracks.some((t) => t.id === value.track && t.divisionId === division);
            apply({ ...value, division, track: trackStillValid ? value.track : null });
          }}
        >
          <option value="">All Divisions</option>
          {(Object.keys(DIVISION_LABELS) as DivisionId[]).map((id) => (
            <option key={id} value={id}>
              {DIVISION_LABELS[id]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex min-w-40 flex-1 flex-col gap-1 sm:flex-none">
        <span className="flex items-center gap-1 text-[0.7rem] font-semibold text-pulse-muted">
          Cohort {cohortLocked ? <Lock aria-label="Locked to your Cohort" className="size-3" /> : null}
        </span>
        <select
          className="pulse-select py-1.5"
          value={value.cohort ?? ''}
          disabled={cohortLocked}
          onChange={(e) => apply({ ...value, cohort: e.target.value || null })}
        >
          {cohortLocked ? null : <option value="">All Cohorts</option>}
          {cohorts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex min-w-56 flex-1 flex-col gap-1">
        <span className="text-[0.7rem] font-semibold text-pulse-muted">Track</span>
        <select
          className="pulse-select py-1.5"
          value={value.track ?? ''}
          onChange={(e) => apply({ ...value, track: e.target.value || null })}
        >
          <option value="">All published Tracks</option>
          {trackOptions.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
        </select>
      </label>
      <div className="flex items-center gap-2 self-end">
        {hasFilters ? (
          <button
            type="button"
            className="pulse-btn pulse-btn-ghost px-2.5 py-1.5 text-xs"
            onClick={() => apply({ division: null, cohort: cohortLocked ? value.cohort : null, track: null })}
          >
            <X aria-hidden className="size-3.5" />
            Clear
          </button>
        ) : null}
        {pending ? <LoaderCircle aria-label="Updating" className="size-4 animate-spin text-pulse-muted" /> : null}
      </div>
    </div>
  );
}
