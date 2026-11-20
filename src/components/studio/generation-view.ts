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
