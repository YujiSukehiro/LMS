/**
 * Team Progress: one readiness status per agent per Track.
 *
 * The status ladder is the same for every screen:
 *   Not started -> Learning -> Checkpoints done -> Certified
 * plus "Needs recert" when a certificate expired, was revoked, or the Track changed.
 *
 * Pure functions only. The /progress page loads the documents and calls `deriveProgressCell`.
 */
import type { EnrollmentDoc } from '@/lib/schemas/analytics';
import type { CertificationDoc } from '@/lib/schemas/learning';
import { SIM_COPY } from '@/lib/policy/training-policy';

export const PROGRESS_STAGES = ['not_started', 'learning', 'checkpoints_done', 'certified', 'needs_recert'] as const;
export type LadderStage = (typeof PROGRESS_STAGES)[number];
export type ProgressStage = LadderStage | 'not_assigned' | 'archived';

export const STAGE_LABELS: Record<ProgressStage, string> = {
  not_started: 'Not started',
  learning: 'Learning',
  checkpoints_done: `Ready for ${SIM_COPY.short.toLowerCase()}`,
  certified: 'Certified',
  needs_recert: 'Needs recert',
  not_assigned: 'Not assigned',
  archived: 'Archived',
};

/** Days without activity before an agent who has started counts as stalled. */
export const STALLED_AFTER_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface ProgressTrackShape {
  units: ReadonlyArray<{ id: string; title: string }>;
  scenarios: ReadonlyArray<{ id: string; title: string; passScoreThreshold: number }>;
}

export interface ProgressCell {
  stage: ProgressStage;
  /** One entry per published checkpoint, in order. */
  unitsDone: boolean[];
  unitsDoneCount: number;
  simPassed: boolean;
  bestSimPct: number | null;
  /** Short, plain detail line under the status (for example "Sim 72% (needs 80%)"). */
  detail: string;
  /** What the supervisor should coach next, or null when nothing is left. */
  nextStep: string | null;
  lastActivityAt: number | null;
  /** Whole days since the last activity, when the agent is stalled. */
  stalledDays: number | null;
  expiresAt: string | null;
  /** Mean first-try accuracy across completed checkpoints. */
  firstTryPct: number | null;
  /** 0-based index of the next checkpoint to do, or null when all are done. */
  nextUnitIndex: number | null;
  /** Pass line of the first Live Call Sim (percent). */
  simPassLine: number;
  /** The one problem a supervisor should see on the card, if any. */
  flag: ProgressFlag | null;
}

export interface ProgressFlag {
  /** info = worth knowing, not a problem (for example a Track assigned today that is not opened yet). */
  tone: 'danger' | 'warning' | 'info';
  text: string;
}

/** A Track assigned fewer days ago than this is not flagged when the agent has not opened it yet. */
export const NOT_STARTED_GRACE_DAYS = 3;

/** Certificates expiring within this many days get a warning. */
export const EXPIRY_WARNING_DAYS = 14;

export interface DeriveProgressInput {
  track: ProgressTrackShape;
  enrollment: EnrollmentDoc | undefined;
  certification: CertificationDoc | null;
  assigned: boolean;
  agentActive: boolean;
  /** When the agent could first see this Track version (later of publish and the agent joining), if known. */
  assignedAt?: number | null;
  now?: number;
}

function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** Rank for "least ready first" sorting. Lower = needs attention sooner. */
export function stageRank(cell: Pick<ProgressCell, 'stage' | 'stalledDays'>): number {
  const base: Record<ProgressStage, number> = {
    needs_recert: 0,
    not_started: 1,
    learning: 2,
    checkpoints_done: 3,
    certified: 5,
    not_assigned: 8,
    archived: 9,
  };
  return base[cell.stage] - (cell.stalledDays !== null ? 0.5 : 0);
}

function deriveCore(input: DeriveProgressInput): Omit<ProgressCell, 'firstTryPct' | 'nextUnitIndex' | 'flag' | 'simPassLine'> {
  const now = input.now ?? Date.now();
  const { track, enrollment, certification } = input;
  const completed = new Set(enrollment?.completedUnitIds ?? []);
  const unitsDone = track.units.map((unit) => completed.has(unit.id));
  const unitsDoneCount = unitsDone.filter(Boolean).length;
  const passed = new Set(enrollment?.passedScenarioIds ?? []);
  const simPassed = track.scenarios.some((scenario) => passed.has(scenario.id));
  const bestSimPct = enrollment?.bestSimScorePct ?? null;
  const lastActivityAt = enrollment?.lastActivityAt ?? null;
  const idleDays = lastActivityAt === null ? null : Math.floor((now - lastActivityAt) / DAY_MS);
  const base = { unitsDone, unitsDoneCount, simPassed, bestSimPct, lastActivityAt, expiresAt: certification?.expiresAt ?? null };
  const stalled = (days: number | null) => (days !== null && days >= STALLED_AFTER_DAYS ? days : null);
  const firstOpenUnit = track.units.findIndex((unit) => !completed.has(unit.id));
  const nextUnitStep = firstOpenUnit >= 0 ? `Checkpoint ${firstOpenUnit + 1}: ${track.units[firstOpenUnit].title}` : null;
  const firstScenario = track.scenarios.find((scenario) => !passed.has(scenario.id)) ?? track.scenarios[0];
  const threshold = firstScenario?.passScoreThreshold ?? 80;

  if (!input.agentActive) {
    return { ...base, stage: 'archived', detail: 'Offboarded', nextStep: null, stalledDays: null };
  }

  if (certification) {
    const expired =
      certification.status === 'expired' ||
      (certification.status === 'certified' && certification.expiresAt !== null && Date.parse(certification.expiresAt) <= now);
    if (certification.status === 'certified' && !expired) {
      const pct = bestSimPct !== null ? `${Math.round(bestSimPct)}% sim` : 'Certified';
      const until = certification.expiresAt ? ` · valid to ${formatShortDate(certification.expiresAt)}` : '';
      return { ...base, stage: 'certified', detail: `${pct}${until}`, nextStep: null, stalledDays: null };
    }
    if (expired || certification.status === 'recertification_required' || certification.status === 'revoked') {
      const detail =
        certification.status === 'revoked'
          ? `Revoked${certification.revocationReason ? `: ${certification.revocationReason}` : ''}`
          : expired
            ? 'Certificate expired'
            : 'Track changed since certification';
      return {
        ...base,
        stage: 'needs_recert',
        detail,
        nextStep: nextUnitStep ? `Redo ${nextUnitStep}` : firstScenario ? `Pass sim: ${firstScenario.title}` : 'Recertify',
        stalledDays: null,
      };
    }
    if (certification.status === 'ready_for_trainer_review') {
      return { ...base, stage: 'checkpoints_done', detail: 'Waiting for Trainer review', nextStep: 'Trainer review', stalledDays: null };
    }
  }

  // A certificate is real history and stays visible above. Otherwise an un-assigned Track is "Not assigned", even when
  // an old enrollment exists (for example after the Cohort was unassigned or the agent moved Cohorts).
  if (!input.assigned) return { ...base, stage: 'not_assigned', detail: 'Not assigned to this Cohort', nextStep: null, stalledDays: null };

  if (!enrollment || (unitsDoneCount === 0 && !simPassed && enrollment.status === 'NOT_STARTED')) {
    return {
      ...base,
      stage: 'not_started',
      detail: 'Not started',
      nextStep: track.units[0] ? `Start Checkpoint 1: ${track.units[0].title}` : 'Start the Track',
      stalledDays: null,
    };
  }

  const legacyNote = enrollment.status === 'CERTIFIED' ? ' · earlier certificate not verified' : '';
  if (firstOpenUnit === -1 && track.units.length > 0) {
    const simDetail = simPassed
      ? 'Sim passed · waiting for certification'
      : bestSimPct !== null
        ? `Sim ${Math.round(bestSimPct)}% (needs ${threshold}%)`
        : 'Sim not tried yet';
    return {
      ...base,
      stage: 'checkpoints_done',
      detail: `${simDetail}${legacyNote}`,
      nextStep: simPassed ? 'Trainer review' : firstScenario ? `${bestSimPct !== null ? 'Retry' : 'Start'} sim: ${firstScenario.title}` : null,
      stalledDays: stalled(idleDays),
    };
  }

  return {
    ...base,
    stage: 'learning',
    detail: `${unitsDoneCount} of ${track.units.length} checkpoints${legacyNote}`,
    nextStep: nextUnitStep,
    stalledDays: stalled(idleDays),
  };
}

export function deriveProgressCell(input: DeriveProgressInput): ProgressCell {
  const now = input.now ?? Date.now();
  const core = deriveCore(input);
  const scores = Object.values(input.enrollment?.unitScores ?? {});
  const firstTryPct = scores.length > 0 ? Math.round(scores.reduce((sum, s) => sum + s.firstTryAccuracyPct, 0) / scores.length) : null;
  const nextIndex = core.unitsDone.findIndex((done) => !done);
  const nextUnitIndex = nextIndex >= 0 ? nextIndex : null;
  const simPassLine = input.track.scenarios[0]?.passScoreThreshold ?? 80;
  return { ...core, firstTryPct, nextUnitIndex, simPassLine, flag: progressFlag(core, input, nextUnitIndex, now) };
}

function progressFlag(
  cell: Omit<ProgressCell, 'firstTryPct' | 'nextUnitIndex' | 'flag' | 'simPassLine'>,
  input: DeriveProgressInput,
  nextUnitIndex: number | null,
  now: number,
): ProgressFlag | null {
  switch (cell.stage) {
    case 'needs_recert':
      return { tone: 'danger', text: cell.detail };
    case 'not_started': {
      const assignedAt = input.assignedAt ?? null;
      if (assignedAt === null) return { tone: 'warning', text: 'Not opened yet' };
      const days = Math.floor((now - assignedAt) / DAY_MS);
      return days < NOT_STARTED_GRACE_DAYS
        ? { tone: 'info', text: 'Not opened yet' }
        : { tone: 'warning', text: `Not opened in ${days} days` };
    }
    case 'learning':
      return cell.stalledDays !== null
        ? { tone: 'danger', text: `Stuck ${cell.stalledDays} days on Checkpoint ${(nextUnitIndex ?? 0) + 1}` }
        : null;
    case 'checkpoints_done': {
      const threshold = input.track.scenarios[0]?.passScoreThreshold ?? 80;
      if (cell.stalledDays !== null) return { tone: 'danger', text: `No sim attempt in ${cell.stalledDays} days` };
      if (!cell.simPassed && cell.bestSimPct !== null && cell.bestSimPct < threshold) {
        return { tone: 'warning', text: `Sim ${Math.round(cell.bestSimPct)}%, pass line ${threshold}%` };
      }
      return null;
    }
    case 'certified': {
      if (!cell.expiresAt) return null;
      const days = Math.ceil((Date.parse(cell.expiresAt) - now) / DAY_MS);
      return days <= EXPIRY_WARNING_DAYS ? { tone: 'warning', text: `Expires in ${days} day${days === 1 ? '' : 's'}` } : null;
    }
    default:
      return null;
  }
}

/** Count of agents in each ladder stage (archived and not-assigned agents are left out). */
export function summarizeLadder(cells: ReadonlyArray<ProgressCell>): Record<LadderStage, { count: number; stalled: number }> {
  const summary = Object.fromEntries(PROGRESS_STAGES.map((stage) => [stage, { count: 0, stalled: 0 }])) as Record<
    LadderStage,
    { count: number; stalled: number }
  >;
  for (const cell of cells) {
    if (cell.stage === 'archived' || cell.stage === 'not_assigned') continue;
    summary[cell.stage].count += 1;
    if (cell.stalledDays !== null) summary[cell.stage].stalled += 1;
  }
  return summary;
}

export function describeIdle(lastActivityAt: number | null, now = Date.now()): string {
  if (lastActivityAt === null) return 'no activity yet';
  const days = Math.floor((now - lastActivityAt) / DAY_MS);
  if (days <= 0) return 'active today';
  if (days === 1) return 'active yesterday';
  return `active ${days} days ago`;
}
