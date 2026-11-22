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

export function formatMinutesLeft(minutes: number): string {
  if (minutes < 2) return 'about a minute left';
  if (minutes < 60) return `about ${minutes} min left`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `about ${hours} h ${rest} min left`;
}

/** Progress messages sent while a resumed build replays saved Checkpoints ("Resumed Checkpoint 3 of 9: …"). */
export function isReplayMessage(message: string): boolean {
  return /^\s*resumed\b/i.test(message);
}
