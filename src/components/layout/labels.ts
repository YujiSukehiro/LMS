import { ALL_COHORTS_ID, CANONICAL_PILLARS, DEFAULT_COHORTS } from '@/lib/schemas/constants';
import type { DivisionId } from '@/lib/schemas/domain';

/** Plain-English Cohort name for a Cohort id (falls back to the id itself). */
export function cohortLabel(cohortId: string): string {
  if (cohortId === ALL_COHORTS_ID) return 'All Active Cohorts';
  return DEFAULT_COHORTS.find((c) => c.id === cohortId)?.name ?? cohortId;
}

/** Short Cohort code for dense tables (e.g. "THS", "Call Core"). */
export function cohortShortLabel(cohortId: string): string {
  if (cohortId === ALL_COHORTS_ID) return 'All';
  if (cohortId === 'INTERNAL') return 'Internal';
  if (cohortId === 'CALL_CORE') return 'Call Core';
  if (cohortId === 'LATAM_DIRECT') return 'LATAM Direct';
  return cohortId;
}

export const DIVISION_PILL_CLASS: Record<DivisionId, string> = {
  TELEHEALTH: 'pulse-pill-telehealth',
  INBOUND: 'pulse-pill-inbound',
  OUTBOUND: 'pulse-pill-outbound',
};

export const DIVISION_SHORT_LABELS: Record<DivisionId, string> = {
  TELEHEALTH: 'Telehealth',
  INBOUND: 'Inbound',
  OUTBOUND: 'Outbound',
};

/** Display label for a canonical CompetencyPillar key. */
export function pillarShortLabel(key: string): string {
  return CANONICAL_PILLARS.find((p) => p.key === key)?.shortLabel ?? key;
}

export function pillarLabel(key: string): string {
  return CANONICAL_PILLARS.find((p) => p.key === key)?.label ?? key;
}

/** Compact relative time, e.g. "3h ago", rendered on the server. */
export function relativeTime(epochMs: number, nowMs: number = Date.now()): string {
  const diff = Math.max(0, nowMs - epochMs);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return 'just now';
  if (diff < hour) return `${Math.floor(diff / minute)}m ago`;
  if (diff < day) return `${Math.floor(diff / hour)}h ago`;
  if (diff < 30 * day) return `${Math.floor(diff / day)}d ago`;
  return new Date(epochMs).toISOString().slice(0, 10);
}

export function formatDate(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}
