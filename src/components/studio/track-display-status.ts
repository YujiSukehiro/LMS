import type { TrackDoc, TrackStatus } from '@/lib/schemas/curriculum';

/**
 * What a Trainer should see for a Track. A failed first build keeps `status: 'GENERATING'` (so the
 * stepper can resume and Retry), but nothing is running: show it as a failed build, not a spinner.
 * Tracks with a published or draft version keep their status; `buildFailed` flags a failed revision build.
 */
export type TrackDisplayStatus = TrackStatus | 'BUILD_FAILED';

export function trackDisplayStatus(track: Pick<TrackDoc, 'status' | 'generationProgress'>): TrackDisplayStatus {
  if (track.status === 'GENERATING' && track.generationProgress.step === 'FAILED') return 'BUILD_FAILED';
  return track.status;
}

/** True when the latest build of this Track failed and is waiting for a Trainer to press Retry. */
export function trackBuildFailed(track: Pick<TrackDoc, 'generationProgress'>): boolean {
  return track.generationProgress.step === 'FAILED';
}

/** Trainer home KPI counts; failed builds are counted on their own, never as "Generating". */
export function trackStatusCounts(tracks: ReadonlyArray<Pick<TrackDoc, 'status' | 'generationProgress'>>) {
  const counts = { GENERATING: 0, BUILD_FAILED: 0, DRAFT: 0, PUBLISHED: 0, ARCHIVED: 0 };
  for (const track of tracks) counts[trackDisplayStatus(track)] += 1;
  return counts;
}
