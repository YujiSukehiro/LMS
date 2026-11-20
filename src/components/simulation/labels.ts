import type { DivisionId } from '@/lib/schemas/domain';
import type { PublicSimScenario } from '@/lib/schemas/curriculum';

export type SimDifficulty = PublicSimScenario['difficulty'];

export const DIFFICULTY_LABELS: Record<SimDifficulty, string> = {
  STANDARD: 'Standard',
  EDGE_CASE: 'Edge Case',
  HIGH_PRESSURE: 'High Pressure',
};

export const DIFFICULTY_PILL_CLASS: Record<SimDifficulty, string> = {
  STANDARD: 'pulse-pill-indigo',
  EDGE_CASE: 'pulse-pill-amber',
  HIGH_PRESSURE: 'pulse-pill-crimson',
};

/** Channel label shown on the Simulation ticket, derived from the Division. */
export const SIM_CHANNEL_LABELS: Record<DivisionId, string> = {
  TELEHEALTH: 'Telehealth Patient Call/Chat Sim',
  INBOUND: 'Inbound Call/Chat Sim',
  OUTBOUND: 'Outbound Call/Chat Sim',
};

export const VERBAL_CHANNEL_LABELS: Record<DivisionId, string> = {
  TELEHEALTH: 'Telehealth Verbal Practice',
  INBOUND: 'Inbound Verbal Practice',
  OUTBOUND: 'Outbound Verbal Practice',
};

export const DIVISION_PILL_CLASS: Record<DivisionId, string> = {
  TELEHEALTH: 'pulse-pill-telehealth',
  INBOUND: 'pulse-pill-inbound',
  OUTBOUND: 'pulse-pill-outbound',
};

/** Intro button label: a saved run (kept across reloads) is resumed by Start, so say so. */
export function simStartLabel(resumeTurnCount: number | null | undefined): string {
  if (resumeTurnCount === null || resumeTurnCount === undefined) return 'Start Live Call Sim';
  return resumeTurnCount > 0 ? `Resume call (${resumeTurnCount} ${resumeTurnCount === 1 ? 'reply' : 'replies'} saved)` : 'Resume call';
}

export function verbalStartLabel(resumeTurnCount: number | null | undefined): string {
  if (resumeTurnCount === null || resumeTurnCount === undefined) return 'Start Verbal Practice';
  return resumeTurnCount > 0
    ? `Resume verbal practice (${resumeTurnCount} ${resumeTurnCount === 1 ? 'reply' : 'replies'} saved)`
    : 'Resume verbal practice';
}

/** Dispositions whose server check needs evidence recorded with the Safe Wrap-Up Controls. */
const WRAP_UP_DISPOSITIONS = ['Callback scheduled', 'Not interested', 'Lost'];

/**
 * Open "Safe Wrap-Up Controls" by default when the checklist needs wrap-up evidence, or when the learner can
 * pick a disposition that is only valid after a wrap-up action (a scheduled callback, an opt-out or
 * suppression, an escalation). Collapsed, the learner could pick it without seeing the required control.
 */
export function wrapUpControlsOpenByDefault(scenario: { dispositionOptions: readonly string[]; evidenceRequirements?: { requiredWrapUpEvidence: readonly string[] } }): boolean {
  if ((scenario.evidenceRequirements?.requiredWrapUpEvidence.length ?? 0) > 0) return true;
  return scenario.dispositionOptions.some((option) => WRAP_UP_DISPOSITIONS.includes(option));
}
