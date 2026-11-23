/**
 * Firestore access helpers for the Track build pipeline (server only: uses firebase-admin).
 */
import type { DocumentReference, Transaction } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import {
  DRAFT_VERSION_ID,
  EVAL_RUBRICS_DOC_ID,
  EvalRubricsDocSchema,
  SOURCE_PAGES_PER_BATCH,
  SourcePageBatchDocSchema,
  TrackDocSchema,
  TrackVersionDocSchema,
  type EvalRubricsDoc,
  type GenerationStep,
  type SourcePageBatchDoc,
  type TrackDoc,
  type TrackUnit,
  type TrackVersionDoc,
} from '@/lib/schemas/curriculum';
import type { ExtractedPage } from '@/lib/ai/pdf-extractor';

/** Generation steps during which a build is running. */
export const RUNNING_GENERATION_STEPS: readonly GenerationStep[] = ['BLUEPRINTING', 'BUILDING_UNITS', 'BUILDING_SIMS'];
/** A running build that has not written a heartbeat for this long is treated as stopped. */
export const GENERATION_STALE_MS = 3 * 60 * 1000;
/** The running build writes `updatedAt` this often as a heartbeat. */
export const GENERATION_HEARTBEAT_MS = 60 * 1000;
/** Estimated minutes for one Live Call Simulation. */
export const SIM_ESTIMATED_MINUTES = 6;

export function tracksCollection() {
  return adminDb.collection('tracks');
}

export function trackRef(trackId: string): DocumentReference {
  return tracksCollection().doc(trackId);
}

export function versionRef(trackId: string, versionId: string): DocumentReference {
  return trackRef(trackId).collection('versions').doc(versionId);
}

export function draftRef(trackId: string): DocumentReference {
  return versionRef(trackId, DRAFT_VERSION_ID);
}

export function secretsRef(trackId: string, versionId: string): DocumentReference {
  return versionRef(trackId, versionId).collection('secrets').doc(EVAL_RUBRICS_DOC_ID);
}

export function sourcePagesCollection(trackId: string) {
  return trackRef(trackId).collection('sourcePages');
}

export function isGenerationRunning(track: Pick<TrackDoc, 'generationProgress' | 'updatedAt'>, now = Date.now()): boolean {
  return RUNNING_GENERATION_STEPS.includes(track.generationProgress.step) && now - track.updatedAt < GENERATION_STALE_MS;
}

/**
 * A step that runs the build without a live heartbeat for this long is treated as gone, so the next step may
 * take over. Shorter than GENERATION_STALE_MS: the heartbeat runs every minute.
 */
export const BUILD_STEP_STALE_MS = 90 * 1000;

/**
 * True when a new build step may take this Track: no build yet, a failed or stopped build, a step that paused at
 * its time budget, or a step that stopped writing its heartbeat. A READY Track is the caller's concern.
 */
export function canTakeBuildStep(
  track: Pick<TrackDoc, 'generationProgress' | 'updatedAt' | 'generationPausedAt'>,
  now = Date.now(),
): boolean {
  if (!RUNNING_GENERATION_STEPS.includes(track.generationProgress.step)) return true;
  if (track.generationPausedAt) return true;
  return now - track.updatedAt >= BUILD_STEP_STALE_MS;
}

export function parseTrack(data: unknown): TrackDoc {
  return TrackDocSchema.parse(data);
}

export async function loadTrack(trackId: string, tx?: Transaction): Promise<TrackDoc | null> {
  const ref = trackRef(trackId);
  const snap = tx ? await tx.get(ref) : await ref.get();
  return snap.exists ? parseTrack(snap.data()) : null;
}

export async function loadVersion(trackId: string, versionId: string, tx?: Transaction): Promise<TrackVersionDoc | null> {
  const ref = versionRef(trackId, versionId);
  const snap = tx ? await tx.get(ref) : await ref.get();
  return snap.exists ? TrackVersionDocSchema.parse(snap.data()) : null;
}

export async function loadSecrets(trackId: string, versionId: string, tx?: Transaction): Promise<EvalRubricsDoc | null> {
  const ref = secretsRef(trackId, versionId);
  const snap = tx ? await tx.get(ref) : await ref.get();
  return snap.exists ? EvalRubricsDocSchema.parse(snap.data()) : null;
}

/** All extracted Playbook pages of a Track, in page order. */
export async function loadSourcePages(trackId: string): Promise<ExtractedPage[]> {
  const snap = await sourcePagesCollection(trackId).get();
  const pages: ExtractedPage[] = [];
  for (const doc of snap.docs) {
    const parsed = SourcePageBatchDocSchema.safeParse(doc.data());
    if (!parsed.success) continue;
    for (const page of parsed.data.pages) pages.push({ pageNumber: page.pageNumber, text: page.text });
  }
  pages.sort((a, b) => a.pageNumber - b.pageNumber);
  return pages;
}

/** Split pages into `batch-001`.. documents of SOURCE_PAGES_PER_BATCH pages. */
export function buildSourcePageBatches(trackId: string, pages: ExtractedPage[], createdAt: number): SourcePageBatchDoc[] {
  const batches: SourcePageBatchDoc[] = [];
  for (let start = 0; start < pages.length; start += SOURCE_PAGES_PER_BATCH) {
    const slice = pages.slice(start, start + SOURCE_PAGES_PER_BATCH);
    const index = batches.length + 1;
    batches.push(
      SourcePageBatchDocSchema.parse({
        id: `batch-${String(index).padStart(3, '0')}`,
        trackId,
        startPage: slice[0].pageNumber,
        endPage: slice[slice.length - 1].pageNumber,
        pages: slice.map((page) => ({ pageNumber: page.pageNumber, text: page.text })),
        createdAt,
      }),
    );
  }
  return batches;
}

/** "v3" -> 3; null or unknown -> 0. */
export function versionNumberFromId(versionId: string | null): number {
  if (!versionId) return 0;
  const match = /^v(\d+)$/.exec(versionId);
  return match ? Number(match[1]) : 0;
}

/** Version number for the next draft: last published number + 1. */
export function nextDraftVersionNumber(track: Pick<TrackDoc, 'publishedVersionId'>): number {
  return versionNumberFromId(track.publishedVersionId) + 1;
}

export function estimateTrackMinutes(units: Pick<TrackUnit, 'estimatedMinutes'>[], simScenarioCount: number): number {
  return units.reduce((sum, unit) => sum + unit.estimatedMinutes, 0) + simScenarioCount * SIM_ESTIMATED_MINUTES;
}

/** Unique sorted page numbers that a Unit's BriefingCards and Drills cite. */
export function unitCitedPages(unit: TrackUnit): number[] {
  const pages = new Set<number>();
  for (const card of unit.briefingCards) card.sourcePages.forEach((page) => pages.add(page));
  for (const drill of unit.drills) drill.sourcePages.forEach((page) => pages.add(page));
  return [...pages].sort((a, b) => a - b);
}
