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

export const DIVISION_PILL_CLASS: Record<DivisionId, string> = {
  TELEHEALTH: 'pulse-pill-telehealth',
  INBOUND: 'pulse-pill-inbound',
  OUTBOUND: 'pulse-pill-outbound',
};
