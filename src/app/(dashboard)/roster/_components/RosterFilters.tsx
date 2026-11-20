'use client';

import { useTransition } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

export type StatusFilter = 'active' | 'inactive' | 'all';

export function RosterFilters({
  cohorts,
  cohort,
  status,
}: {
  cohorts: Array<{ id: string; name: string }>;
  cohort: string;
  status: StatusFilter;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  function update(key: 'cohort' | 'status', value: string): void {
    const current: Record<'cohort' | 'status', string> = { cohort, status };
    current[key] = value;
    const next = new URLSearchParams();
    if (current.cohort !== 'ALL') next.set('cohort', current.cohort);
    if (current.status !== 'active') next.set('status', current.status);
    const query = next.toString();
    startTransition(() => router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false }));
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {isPending ? <Loader2 className="h-4 w-4 animate-spin text-pulse-muted" aria-label="Loading" /> : null}
      <label className="sr-only" htmlFor="roster-cohort-filter">
        Cohort
      </label>
      <select
        id="roster-cohort-filter"
        className="pulse-select w-auto min-w-36 py-1.5 text-sm"
        value={cohort}
        onChange={(event) => update('cohort', event.target.value)}
      >
        <option value="ALL">All Cohorts</option>
        {cohorts.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {entry.name}
          </option>
        ))}
      </select>
      <label className="sr-only" htmlFor="roster-status-filter">
        Status
      </label>
      <select
        id="roster-status-filter"
        className="pulse-select w-auto min-w-36 py-1.5 text-sm"
        value={status}
        onChange={(event) => update('status', event.target.value)}
      >
        <option value="active">Active</option>
        <option value="inactive">Inactive</option>
        <option value="all">All statuses</option>
      </select>
    </div>
  );
}
