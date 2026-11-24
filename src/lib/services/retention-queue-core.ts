import type { CompetencyPillar, DrillItem, TrackDoc, TrackVersionDoc } from '@/lib/schemas/curriculum';
import type { DivisionId } from '@/lib/schemas/domain';
import type { LearnerDrill, ReviewScheduleDoc } from '@/lib/schemas/learning';
import { drillRuleIds, sanitizeDrillForLearner } from './drill-grader';
import { DEFAULT_RETRIEVAL_INTERVALS } from './retrieval-schedule';

/**
 * A rule counts as Mastered once it passed a spaced review and sits on the longest interval of the 1/3/7-day ladder.
 * The ladder's top index is 2, so the old `intervalIndex >= 3` test never matched and Mastered always read 0
 * (guides review 2026-11-24).
 */
const MASTERED_INTERVAL_INDEX = DEFAULT_RETRIEVAL_INTERVALS.spacedReviewDays.length - 1;
function isMastered(item: { intervalIndex: number; lastResult: string | null }): boolean {
  return item.intervalIndex >= MASTERED_INTERVAL_INDEX && item.lastResult === 'correct';
}

export interface RetentionQueueItem {
  scheduleId: string;
  trackId: string;
  trackTitle: string;
  campaignCode: string;
  divisionId: DivisionId;
  versionId: string;
  unitId: string;
  unitTitle: string;
  drill: LearnerDrill;
  dueAt: string;
  intervalIndex: number;
  nextAttemptKind: ReviewScheduleDoc['nextAttemptKind'];
  independent: boolean;
  lastResult: 'correct' | 'incorrect' | null;
  ruleIds: string[];
  pillarLabel: string;
  isOverdue: boolean;
}

export interface RetentionTrackSummary {
  trackId: string;
  trackTitle: string;
  campaignCode: string;
  divisionId: DivisionId;
  versionId: string;
  dueCount: number;
  scheduledCount: number;
  masteredCount: number;
  nextDueAt: string | null;
  /** Reviews not due yet (the "Practice upcoming" pool before the reinforce cap). */
  upcomingCount: number;
  /** Earliest due time still in the future, for "next review in 2 days". */
  nextUpcomingAt: string | null;
}

export interface RetentionSummary {
  dueCount: number;
  overdueCount: number;
  scheduledCount: number;
  masteredCount: number;
  nextDueAt: string | null;
  upcomingCount: number;
  nextUpcomingAt: string | null;
}

export interface RetentionQueueResult {
  dueItems: RetentionQueueItem[];
  reinforceItems: RetentionQueueItem[];
  summary: RetentionSummary;
  trackSummaries: RetentionTrackSummary[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Deduplicate schedules by `(trackId, curriculumVersion, drillId)` keeping the most recently
 * updated document so legacy `review:...` and runtime `review_...` schedules never double-count.
 */
export function deduplicateReviewSchedules(schedules: readonly ReviewScheduleDoc[]): ReviewScheduleDoc[] {
  const byKey = new Map<string, ReviewScheduleDoc>();
  for (const schedule of schedules) {
    const key = `${schedule.trackId}:${schedule.curriculumVersion}:${schedule.drillId}`;
    const prev = byKey.get(key);
    const currentUpdated = Date.parse(schedule.updatedAt);
    const prevUpdated = prev ? Date.parse(prev.updatedAt) : -Infinity;
    if (!prev || currentUpdated > prevUpdated || (currentUpdated === prevUpdated && schedule.id > prev.id)) {
      byKey.set(key, schedule);
    }
  }
  return [...byKey.values()];
}

function pillarLabelMap(pillars: readonly CompetencyPillar[]): Map<string, string> {
  return new Map(pillars.map((pillar) => [pillar.id, pillar.label]));
}

function sortQueueItems(a: RetentionQueueItem, b: RetentionQueueItem): number {
  const dueDiff = Date.parse(a.dueAt) - Date.parse(b.dueAt);
  if (dueDiff !== 0) return dueDiff;
  if (a.intervalIndex !== b.intervalIndex) return a.intervalIndex - b.intervalIndex;
  return a.drill.id.localeCompare(b.drill.id);
}

/**
 * Build learner-safe Due and Upcoming Keep-Sharp retention queues for all visible Tracks.
 * Never returns answer keys or rationales (`sanitizeDrillForLearner` strips secrets).
 */
export function buildRetentionQueue(args: {
  tracks: Array<{ track: TrackDoc; version: TrackVersionDoc }>;
  schedules: readonly ReviewScheduleDoc[];
  nowMs: number;
  filterTrackId?: string;
  maxReinforceItems?: number;
}): RetentionQueueResult {
  const deduped = deduplicateReviewSchedules(args.schedules);
  const trackIndex = new Map(args.tracks.map((entry) => [entry.track.id, entry]));

  // Lookup per-track maps for fast drill & pillar resolution.
  const lookups = new Map<
    string,
    {
      track: TrackDoc;
      version: TrackVersionDoc;
      drillsById: Map<string, { unitId: string; unitTitle: string; drill: DrillItem }>;
      pillarsById: Map<string, string>;
    }
  >();

  for (const { track, version } of args.tracks) {
    const drillsById = new Map<string, { unitId: string; unitTitle: string; drill: DrillItem }>();
    for (const unit of version.units) {
      for (const drill of unit.drills) {
        drillsById.set(drill.id, { unitId: unit.id, unitTitle: unit.title, drill });
      }
    }
    lookups.set(track.id, {
      track,
      version,
      drillsById,
      pillarsById: pillarLabelMap([...version.competencyPillars, ...track.competencyPillars]),
    });
  }

  const allItems: RetentionQueueItem[] = [];
  const trackBuckets = new Map<string, RetentionQueueItem[]>();
  for (const { track } of args.tracks) trackBuckets.set(track.id, []);

  for (const schedule of deduped) {
    const lookup = lookups.get(schedule.trackId);
    if (!lookup) continue;
    if (schedule.curriculumVersion !== lookup.version.versionId) continue;
    const hit = lookup.drillsById.get(schedule.drillId);
    if (!hit) continue;

    const dueMs = Date.parse(schedule.dueAt);
    const ruleIds = schedule.ruleIds.length > 0 ? [...schedule.ruleIds] : drillRuleIds(hit.drill);
    const item: RetentionQueueItem = {
      scheduleId: schedule.id,
      trackId: lookup.track.id,
      trackTitle: lookup.track.title,
      campaignCode: lookup.track.campaignCode,
      divisionId: lookup.track.divisionId,
      versionId: lookup.version.versionId,
      unitId: hit.unitId,
      unitTitle: hit.unitTitle,
      drill: sanitizeDrillForLearner(hit.drill),
      dueAt: schedule.dueAt,
      intervalIndex: schedule.intervalIndex,
      nextAttemptKind: schedule.nextAttemptKind,
      independent: schedule.independent,
      lastResult: schedule.lastResult ?? null,
      ruleIds,
      pillarLabel: lookup.pillarsById.get(hit.drill.competencyPillarId) ?? 'Playbook Rule',
      isOverdue: dueMs <= args.nowMs,
    };

    trackBuckets.get(lookup.track.id)?.push(item);
    if (!args.filterTrackId || args.filterTrackId === lookup.track.id) {
      allItems.push(item);
    }
  }

  const dueItems = allItems
    .filter((item) => Date.parse(item.dueAt) <= args.nowMs)
    .sort(sortQueueItems);
  const reinforceItems = allItems
    .filter((item) => Date.parse(item.dueAt) > args.nowMs)
    .sort(sortQueueItems)
    .slice(0, args.maxReinforceItems ?? 8);

  const trackSummaries: RetentionTrackSummary[] = [];
  for (const [trackId, bucket] of trackBuckets.entries()) {
    if (bucket.length === 0) continue;
    const meta = trackIndex.get(trackId);
    if (!meta) continue;
    const sortedDates = [...bucket].sort(sortQueueItems);
    trackSummaries.push({
      trackId,
      trackTitle: meta.track.title,
      campaignCode: meta.track.campaignCode,
      divisionId: meta.track.divisionId,
      versionId: meta.version.versionId,
      dueCount: bucket.filter((item) => Date.parse(item.dueAt) <= args.nowMs).length,
      scheduledCount: bucket.length,
      masteredCount: bucket.filter((item) => isMastered(item)).length,
      nextDueAt: sortedDates[0]?.dueAt ?? null,
      upcomingCount: bucket.filter((item) => Date.parse(item.dueAt) > args.nowMs).length,
      nextUpcomingAt: firstUpcoming(sortedDates, args.nowMs),
    });
  }
  trackSummaries.sort((a, b) => b.dueCount - a.dueCount || a.trackTitle.localeCompare(b.trackTitle));

  const sortedAll = [...allItems].sort(sortQueueItems);
  const summary: RetentionSummary = {
    dueCount: dueItems.length,
    overdueCount: dueItems.filter((item) => Date.parse(item.dueAt) <= args.nowMs - DAY_MS).length,
    scheduledCount: allItems.length,
    masteredCount: allItems.filter((item) => isMastered(item)).length,
    nextDueAt: sortedAll[0]?.dueAt ?? null,
    upcomingCount: allItems.filter((item) => Date.parse(item.dueAt) > args.nowMs).length,
    nextUpcomingAt: firstUpcoming(sortedAll, args.nowMs),
  };

  return { dueItems, reinforceItems, summary, trackSummaries };
}

/** Earliest due time after `nowMs` in a list sorted by due time, or null. */
function firstUpcoming(sorted: readonly RetentionQueueItem[], nowMs: number): string | null {
  return sorted.find((item) => Date.parse(item.dueAt) > nowMs)?.dueAt ?? null;
}
