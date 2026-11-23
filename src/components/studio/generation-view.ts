import type { GenerationStep } from '@/lib/schemas/curriculum';

/** Steps the upload route writes before any build was started (the generate route moves to BLUEPRINTING). */
const PRE_BUILD_STEPS: readonly GenerationStep[] = ['UPLOADING', 'EXTRACTING_PDF'];

/**
 * What /studio/new?trackId=… shows for a Track that still needs a build: the Content map while
 * the uploaded source has not been built yet, or the live stepper once a build has started
 * (running, failed or resumable).
 */
export function newTrackViewFor(progress: { step: GenerationStep } | null | undefined): 'content-map' | 'stepper' {
  return !progress || PRE_BUILD_STEPS.includes(progress.step) ? 'content-map' : 'stepper';
}

export interface CheckpointProgress {
  /** Checkpoints fully written so far. */
  completed: number;
  /** Checkpoint being written now, or null between Checkpoints. */
  current: number | null;
  total: number;
}

const MAX_CHECKPOINTS = 20;

/**
 * Reads Checkpoint progress from a BUILDING_UNITS message:
 * "Writing Checkpoint N of M…" (N is in progress), "Built/Resumed Checkpoint N of M…" (N is done).
 * Older messages with a bare "N of M" / "N/M" are read as "N in progress".
 */
export function parseCheckpointProgress(message: string): CheckpointProgress | null {
  const explicit = /\b(writing|built|resumed)\s+checkpoint\s+(\d+)\s+of\s+(\d+)/i.exec(message);
  const generic = explicit ? null : /(\d+)\s*(?:of|\/)\s*(\d+)/i.exec(message);
  const match = explicit ?? generic;
  if (!match) return null;
  const verb = explicit ? explicit[1].toLowerCase() : 'writing';
  const n = Number(explicit ? explicit[2] : match[1]);
  const total = Number(explicit ? explicit[3] : match[2]);
  if (!Number.isInteger(n) || !Number.isInteger(total) || total <= 0 || total > MAX_CHECKPOINTS || n < 1 || n > total) return null;
  return verb === 'writing' ? { completed: n - 1, current: n, total } : { completed: n, current: null, total };
}

/** Measured on Gemini 3.8 Flash with a 1024-token thinking cap (2026-11-22): 9 Checkpoints in about 8 minutes. */
export const MINUTES_PER_CHECKPOINT = 1;
export const FIXED_BUILD_MINUTES = 2;

export interface EtaSample {
  at: number;
  percent: number;
}

/**
 * Minutes left in a build. Uses the pace seen on this page once the bar has moved at least 3 points;
 * before that, the planned Checkpoint count. Null when nothing is known yet.
 */
export function estimateMinutesLeft(input: {
  first: EtaSample | null;
  latest: EtaSample;
  checkpointTotal: number | null;
}): number | null {
  const { first, latest, checkpointTotal } = input;
  const remainingShare = Math.max(0, 100 - latest.percent) / 100;
  if (first && latest.percent - first.percent >= 3 && latest.at > first.at) {
    const msPerPoint = (latest.at - first.at) / (latest.percent - first.percent);
    return Math.max(1, Math.ceil((msPerPoint * (100 - latest.percent)) / 60_000));
  }
  if (!checkpointTotal) return null;
  const plannedMinutes = checkpointTotal * MINUTES_PER_CHECKPOINT + FIXED_BUILD_MINUTES;
  return Math.max(1, Math.ceil(plannedMinutes * remainingShare));
}

function formatSpan(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

export function formatMinutesLeft(minutes: number): string {
  if (minutes < 2) return 'about a minute left';
  return `about ${formatSpan(minutes)} left`;
}

/** A Checkpoint finishing (or starting, for the first sample) while this page watched, with no replay in it. */
export interface CheckpointSample {
  at: number;
  /** Checkpoints done at that moment. */
  completed: number;
}

/** Minutes left as a range; `low === high` once the pace is known well enough for one number. */
export interface BuildEstimate {
  low: number;
  high: number;
}

/**
 * Minutes left in a build from the time each Checkpoint takes on this runtime (QA: the overall-percent pace jumped
 * from "7 min" to "17 min" because Checkpoints are most of the work and the percent moves unevenly).
 * - 2+ Checkpoints timed on this page: one number.
 * - 1 timed: a range of -20% / +30% around it.
 * - none yet: a range from the planned count (1 min each on Gemini) up to twice that.
 * Before the Checkpoint count is known (blueprint stage), falls back to the overall-percent pace.
 */
export function estimateBuildTime(input: {
  samples: readonly CheckpointSample[];
  checkpointTotal: number | null;
  completed: number;
  now: number;
  first: EtaSample | null;
  latest: EtaSample;
}): BuildEstimate | null {
  const { samples, checkpointTotal, completed, now } = input;
  if (!checkpointTotal) {
    const minutes = estimateMinutesLeft({ first: input.first, latest: input.latest, checkpointTotal: null });
    return minutes === null ? null : { low: minutes, high: minutes };
  }
  const remaining = Math.max(0, checkpointTotal - completed);
  const firstSample = samples[0];
  const lastSample = samples[samples.length - 1];
  const timed = firstSample && lastSample ? lastSample.completed - firstSample.completed : 0;
  if (timed >= 1 && lastSample.at > firstSample.at) {
    const msPerCheckpoint = (lastSample.at - firstSample.at) / timed;
    const intoCurrent = Math.min(Math.max(0, now - lastSample.at), msPerCheckpoint * 0.9);
    // One more Checkpoint's worth covers the Verbal Practice scenarios and the final save.
    const leftMs = Math.max(0, remaining * msPerCheckpoint - (remaining > 0 ? intoCurrent : 0)) + msPerCheckpoint;
    const minutes = Math.max(1, Math.ceil(leftMs / 60_000));
    if (timed >= 2) return { low: minutes, high: minutes };
    return { low: Math.max(1, Math.round(minutes * 0.8)), high: Math.max(2, Math.ceil(minutes * 1.3)) };
  }
  const planned = remaining * MINUTES_PER_CHECKPOINT + FIXED_BUILD_MINUTES;
  return { low: Math.max(1, planned), high: Math.max(2, planned * 2) };
}

export function formatBuildEstimate(estimate: BuildEstimate): string {
  if (estimate.low >= estimate.high) return formatMinutesLeft(estimate.high);
  if (estimate.high < 60) return `about ${estimate.low} to ${estimate.high} min left`;
  return `about ${formatSpan(estimate.low)} to ${formatSpan(estimate.high)} left`;
}

/** Progress messages sent while a resumed build replays saved Checkpoints ("Resumed Checkpoint 3 of 9: …"). */
export function isReplayMessage(message: string): boolean {
  return /^\s*resumed\b/i.test(message);
}
