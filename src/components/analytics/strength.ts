import { strengthBand } from '@/lib/services/scoring';

export type StrengthBand = 'strong' | 'borderline' | 'weak' | 'none';

export function bandFor(score: number | null | undefined): StrengthBand {
  if (score === null || score === undefined || !Number.isFinite(score)) return 'none';
  return strengthBand(score);
}

/** Heatmap cell classes: emerald = mastery, amber = borderline, crimson = breach risk, muted = no data. */
export const BAND_CELL_CLASS: Record<StrengthBand, string> = {
  strong: 'bg-pulse-emerald/20 text-pulse-emerald ring-1 ring-inset ring-pulse-emerald/35',
  borderline: 'bg-pulse-amber/15 text-pulse-amber ring-1 ring-inset ring-pulse-amber/35',
  weak: 'bg-pulse-crimson/15 text-pulse-crimson ring-1 ring-inset ring-pulse-crimson/35',
  none: 'bg-pulse-surface-2/50 text-pulse-muted',
};

export const BAND_TEXT_CLASS: Record<StrengthBand, string> = {
  strong: 'text-pulse-emerald',
  borderline: 'text-pulse-amber',
  weak: 'text-pulse-crimson',
  none: 'text-pulse-muted',
};

export const BAND_LABEL: Record<StrengthBand, string> = {
  strong: 'Strong',
  borderline: 'Borderline',
  weak: 'Needs coaching',
  none: 'No data',
};

export function formatPct(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${Math.round(value)}%`;
}
