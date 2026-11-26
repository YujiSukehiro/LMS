'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, Headset, Search } from 'lucide-react';
import type { StaffPerson } from '@/lib/services/staff-directory';
import { STAFF_FILTERS, matchesStaffFilter, matchesStaffSearch, visibleEmail, type StaffFilter } from '@/lib/services/staff-rules';
import { ProgressStatusChip } from '@/components/progress/ProgressStatusChip';
import { relativeTime } from '@/components/layout/labels';
import { cn } from '@/lib/utils';
import { ResetPracticeButton } from './ResetPracticeButton';


export function StaffDirectory({ people: initialPeople, initialFilter, now }: { people: StaffPerson[]; initialFilter: StaffFilter; now: number }) {
  const [people, setPeople] = useState(initialPeople);
  const [filter, setFilter] = useState<StaffFilter>(initialFilter);
  const [query, setQuery] = useState('');

  const counts = useMemo(
    () => Object.fromEntries(STAFF_FILTERS.map((f) => [f.id, people.filter((p) => matchesStaffFilter(p.flags, f.id)).length])) as Record<StaffFilter, number>,
    [people],
  );
  const shown = people.filter((p) => matchesStaffFilter(p.flags, filter) && matchesStaffSearch(p, query));

  function markReset(uid: string): void {
    setPeople((prev) =>
      prev.map((p) => (p.uid === uid ? { ...p, practiceCounted: 0, practiceResetToday: true, flags: { ...p.flags, atLimit: false } } : p)),
    );
  }

  function chooseFilter(next: StaffFilter): void {
    setFilter(next);
    try {
      const url = new URL(window.location.href);
      if (next === 'all') url.searchParams.delete('filter');
      else url.searchParams.set('filter', next);
      window.history.replaceState(null, '', url);
    } catch {
      // URL sync is a convenience only.
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        <label className="relative block max-w-md">
          <span className="sr-only">Search staff</span>
          <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-pulse-muted" />
          <input
            type="search"
            className="pulse-input w-full pl-9"
            placeholder="Search by name, LC number, email or Cohort"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div role="group" aria-label="Filter staff" className="flex flex-wrap gap-2">
          {STAFF_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              onClick={() => chooseFilter(f.id)}
              className={cn('pulse-pill h-8 cursor-pointer px-3', filter === f.id ? 'pulse-pill-indigo' : 'hover:bg-pulse-surface-2', f.id === 'limit' && counts.limit > 0 && filter !== f.id && 'pulse-pill-amber')}
            >
              {f.label}
              <span className="pulse-metric font-semibold">{counts[f.id]}</span>
            </button>
          ))}
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="pulse-card p-6 text-center text-sm text-pulse-muted">
          {people.length === 0 ? 'Nobody to show yet.' : 'Nobody matches this filter.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-2" aria-label="Staff">
          {shown.map((person) => {
            const email = visibleEmail(person.email);
            const atLimit = person.practiceCounted >= person.practiceLimit;
            return (
              <li key={person.uid} className={cn('pulse-card flex flex-col gap-3 p-4 lg:flex-row lg:items-center', !person.active && 'opacity-70')}>
                <div className="min-w-0 lg:w-64 lg:shrink-0">
                  <Link href={`/staff/${encodeURIComponent(person.uid)}`} className="group inline-flex items-center gap-1 font-semibold hover:text-pulse-indigo">
                    {person.displayName}
                    <ChevronRight aria-hidden className="size-4 text-pulse-muted group-hover:text-pulse-indigo" />
                  </Link>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-pulse-muted">
                    <span>{person.roleLabel}</span>
                    <span>· {person.cohortLabel}</span>
                    {person.lcNumber ? <span className="pulse-metric">· {person.lcNumber}</span> : null}
                    {!person.active ? <span className="pulse-pill pulse-pill-crimson">Deactivated</span> : null}
                  </p>
                  {email ? <p className="truncate text-xs text-pulse-muted">{email}</p> : null}
                  <p className="mt-0.5 text-xs text-pulse-muted">
                    {person.lastActivityAt ? `Last active ${relativeTime(person.lastActivityAt, now)}` : 'No training activity yet'}
                  </p>
                </div>

                <div className="flex min-w-0 flex-1 flex-wrap gap-2">
                  {person.trainings.length === 0 ? (
                    <span className="text-xs text-pulse-muted">No trainings assigned</span>
                  ) : (
                    person.trainings.map((t) => (
                      <span key={t.trackId} className="flex min-w-0 max-w-full flex-col gap-0.5 rounded-pulse-md border border-pulse-border px-2.5 py-1.5">
                        <span className="truncate text-xs font-semibold" title={t.title}>{t.title}</span>
                        <ProgressStatusChip cell={t.cell} />
                      </span>
                    ))
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-3 lg:w-56 lg:justify-end">
                  <span className={cn('inline-flex items-center gap-1.5 text-sm', atLimit ? 'font-semibold text-pulse-amber' : 'text-pulse-secondary')}>
                    <Headset aria-hidden className="size-4" />
                    <span>
                      Practice today <span className="pulse-metric">{person.practiceCounted}/{person.practiceLimit}</span>
                    </span>
                  </span>
                  {person.canResetPractice && person.practiceCounted > 0 ? (
                    <ResetPracticeButton uid={person.uid} displayName={person.displayName} compact onReset={() => markReset(person.uid)} />
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
