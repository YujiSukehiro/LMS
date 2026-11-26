/** Pure Staff page rules (no I/O) so unit tests can import them. */
import { LC_ID_EMAIL_DOMAIN } from '@/lib/schemas/constants';
import type { ProgressStage } from './team-progress';

/** Started a training but no activity for this many days: shown under the "Stuck" filter. */
export const STUCK_AFTER_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

export type StaffFilter = 'all' | 'limit' | 'stuck' | 'not_started';

export const STAFF_FILTERS: ReadonlyArray<{ id: StaffFilter; label: string }> = [
  { id: 'all', label: 'Everyone' },
  { id: 'limit', label: 'Hit practice limit today' },
  { id: 'stuck', label: `Stuck (no progress in ${STUCK_AFTER_DAYS} days)` },
  { id: 'not_started', label: 'Not started' },
];

export function parseStaffFilter(value: string | null | undefined): StaffFilter {
  return STAFF_FILTERS.some((f) => f.id === value) ? (value as StaffFilter) : 'all';
}

export interface StaffTrainingSummary {
  stage: ProgressStage;
  lastActivityAt: number | null;
}

export interface StaffFlags {
  atLimit: boolean;
  stuck: boolean;
  notStarted: boolean;
}

/**
 * Flags for one person. Only assigned trainings count. Stuck: a started, not yet certified training with no activity
 * for STUCK_AFTER_DAYS. Not started: has assigned trainings and has opened none of them.
 */
export function staffFlags(input: {
  active: boolean;
  trainings: readonly StaffTrainingSummary[];
  practiceCounted: number;
  practiceLimit: number;
  now: number;
}): StaffFlags {
  if (!input.active) return { atLimit: false, stuck: false, notStarted: false };
  const assigned = input.trainings.filter((t) => t.stage !== 'not_assigned' && t.stage !== 'archived');
  const stuck = assigned.some(
    (t) =>
      (t.stage === 'learning' || t.stage === 'checkpoints_done') &&
      t.lastActivityAt !== null &&
      input.now - t.lastActivityAt >= STUCK_AFTER_DAYS * DAY_MS,
  );
  const notStarted = assigned.length > 0 && assigned.every((t) => t.stage === 'not_started');
  return { atLimit: input.practiceCounted >= input.practiceLimit, stuck, notStarted };
}

export function matchesStaffFilter(flags: StaffFlags, filter: StaffFilter): boolean {
  if (filter === 'limit') return flags.atLimit;
  if (filter === 'stuck') return flags.stuck;
  if (filter === 'not_started') return flags.notStarted;
  return true;
}

export function matchesStaffSearch(
  person: { displayName: string; email: string | null; lcNumber: string | null; cohortLabel: string },
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [person.displayName, person.email ?? '', person.lcNumber ?? '', person.cohortLabel].some((field) => field.toLowerCase().includes(q));
}

/** Synthetic sign-in emails for LC-number accounts are not real addresses; show the LC number instead. */
export function visibleEmail(email: string | null): string | null {
  return email && !email.endsWith(`@${LC_ID_EMAIL_DOMAIN}`) ? email : null;
}
