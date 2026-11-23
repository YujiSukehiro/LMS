import { describe, expect, it } from 'vitest';
import {
  estimateBuildTime,
  estimateMinutesLeft,
  formatBuildEstimate,
  formatMinutesLeft,
  isReplayMessage,
  newTrackViewFor,
  parseCheckpointProgress,
} from '@/components/studio/generation-view';
import { bundleLegacyPages } from '@/app/api/tracks/upload/legacy-pages';
import { SourcePageEvidenceSchema, type SourcePageEvidence } from '@/lib/schemas/source-truth';

describe('newTrackViewFor', () => {
  it('shows the Content map until a build has started', () => {
    expect(newTrackViewFor(null)).toBe('content-map');
    expect(newTrackViewFor({ step: 'UPLOADING' })).toBe('content-map');
    expect(newTrackViewFor({ step: 'EXTRACTING_PDF' })).toBe('content-map');
  });

  it('shows the stepper once the generate route has taken the build', () => {
    for (const step of ['BLUEPRINTING', 'BUILDING_UNITS', 'BUILDING_SIMS', 'FAILED', 'READY'] as const) {
      expect(newTrackViewFor({ step })).toBe('stepper');
    }
  });
});

describe('parseCheckpointProgress', () => {
  it('marks the Checkpoint being written as active and earlier ones as done', () => {
    expect(parseCheckpointProgress('Mapped 5 Checkpoints. Writing Checkpoint 1 of 5...')).toEqual({ completed: 0, current: 1, total: 5 });
    expect(parseCheckpointProgress('Writing Checkpoint 3 of 5: Drills (batch 2 of 3) for Opening')).toEqual({ completed: 2, current: 3, total: 5 });
  });

  it('marks built and resumed Checkpoints as done', () => {
    expect(parseCheckpointProgress('Built Checkpoint 2 of 5: Opening (1 item need evidence review)')).toEqual({ completed: 2, current: null, total: 5 });
    expect(parseCheckpointProgress('Resumed Checkpoint 4 of 4: Closing')).toEqual({ completed: 4, current: null, total: 4 });
  });

  it('keeps reading older bare counters and rejects nonsense', () => {
    expect(parseCheckpointProgress('Checkpoint 2/6')).toEqual({ completed: 1, current: 2, total: 6 });
    expect(parseCheckpointProgress('Creating Live Call Simulation personas')).toBeNull();
    expect(parseCheckpointProgress('Writing Checkpoint 6 of 5')).toBeNull();
    expect(parseCheckpointProgress('Writing Checkpoint 1 of 40')).toBeNull();
  });
});

function page(documentId: string, pageNumber: number): SourcePageEvidence {
  const text = `${documentId} page ${pageNumber}`;
  return SourcePageEvidenceSchema.parse({
    id: `${documentId}-${pageNumber}`,
    documentId,
    revisionId: `${documentId}-rev`,
    pageNumber,
    rawText: text,
    normalizedText: text,
    contentHash: `sha256:${'a'.repeat(64)}`,
    characterCount: text.length,
    extractionFlags: [],
    transcription: null,
    approvedExcerpts: [],
  });
}

describe('bundleLegacyPages', () => {
  it('keeps a single document’s own page numbers', () => {
    expect(bundleLegacyPages([{ id: 'a', inheritanceOrder: 0 }], [page('a', 3), page('a', 1)])).toEqual([
      { pageNumber: 1, text: 'a page 1' },
      { pageNumber: 3, text: 'a page 3' },
    ]);
  });

  it('numbers every document’s pages 1..N in inheritance order', () => {
    const documents = [
      { id: 'product', inheritanceOrder: 1 },
      { id: 'shared', inheritanceOrder: 0 },
    ];
    const pages = [page('product', 1), page('shared', 2), page('product', 2), page('shared', 1)];
    expect(bundleLegacyPages(documents, pages)).toEqual([
      { pageNumber: 1, text: 'shared page 1' },
      { pageNumber: 2, text: 'shared page 2' },
      { pageNumber: 3, text: 'product page 1' },
      { pageNumber: 4, text: 'product page 2' },
    ]);
  });
});

describe('estimateMinutesLeft', () => {
  it('uses the planned Checkpoint count before the bar has moved', () => {
    // 9 Checkpoints x 1 min + 2 min = 11 min planned; 70% of it is left at 30%.
    expect(estimateMinutesLeft({ first: null, latest: { at: 0, percent: 30 }, checkpointTotal: 9 })).toBe(8);
  });

  it('switches to the pace seen on the page once the bar moves 3 points', () => {
    const first = { at: 0, percent: 30 };
    const latest = { at: 4 * 60_000, percent: 40 }; // 10 points in 4 min -> 60 points left = 24 min
    expect(estimateMinutesLeft({ first, latest, checkpointTotal: 9 })).toBe(24);
  });

  it('returns null with no pace and no plan, and never less than a minute', () => {
    expect(estimateMinutesLeft({ first: null, latest: { at: 0, percent: 10 }, checkpointTotal: null })).toBeNull();
    expect(estimateMinutesLeft({ first: null, latest: { at: 0, percent: 99 }, checkpointTotal: 2 })).toBe(1);
  });

  it('formats minutes in plain words', () => {
    expect(formatMinutesLeft(1)).toBe('about a minute left');
    expect(formatMinutesLeft(24)).toBe('about 24 min left');
    expect(formatMinutesLeft(75)).toBe('about 1 h 15 min left');
  });
});

describe('estimateBuildTime (QA: the estimate jumped from 7 to 17 min)', () => {
  const MIN = 60_000;
  const latest = { at: 0, percent: 38 };

  it('gives a planned range before any Checkpoint is timed', () => {
    // 9 left x 1 min + 2 min = 11 planned, up to twice that.
    expect(estimateBuildTime({ samples: [], checkpointTotal: 9, completed: 0, now: 0, first: null, latest })).toEqual({ low: 11, high: 22 });
  });

  it('gives a range around the pace after one Checkpoint, then one number after two', () => {
    const one = [{ at: 0, completed: 1 }, { at: 10 * MIN, completed: 2 }];
    // 6 left x 10 min + 10 min tail = 70 min -> 56 to 91.
    expect(estimateBuildTime({ samples: one, checkpointTotal: 8, completed: 2, now: 10 * MIN, first: null, latest })).toEqual({ low: 56, high: 91 });
    const two = [...one, { at: 20 * MIN, completed: 3 }];
    // 5 left x 10 min + 10 min tail = 60 min.
    expect(estimateBuildTime({ samples: two, checkpointTotal: 8, completed: 3, now: 20 * MIN, first: null, latest })).toEqual({ low: 60, high: 60 });
  });

  it('counts time already spent on the current Checkpoint, so the number goes down while it works', () => {
    const two = [{ at: 0, completed: 1 }, { at: 10 * MIN, completed: 2 }, { at: 20 * MIN, completed: 3 }];
    const later = estimateBuildTime({ samples: two, checkpointTotal: 8, completed: 3, now: 25 * MIN, first: null, latest });
    expect(later).toEqual({ low: 55, high: 55 });
  });

  it('falls back to the overall pace before the Checkpoint count is known', () => {
    const first = { at: 0, percent: 10 };
    expect(estimateBuildTime({ samples: [], checkpointTotal: null, completed: 0, now: 0, first, latest: { at: 2 * MIN, percent: 15 } })).toEqual({ low: 34, high: 34 });
    expect(estimateBuildTime({ samples: [], checkpointTotal: null, completed: 0, now: 0, first: null, latest })).toBeNull();
  });

  it('formats a range in plain words', () => {
    expect(formatBuildEstimate({ low: 15, high: 20 })).toBe('about 15 to 20 min left');
    expect(formatBuildEstimate({ low: 24, high: 24 })).toBe('about 24 min left');
    expect(formatBuildEstimate({ low: 56, high: 91 })).toBe('about 56 min to 1 h 31 min left');
  });
});

describe('isReplayMessage', () => {
  it('spots resumed Checkpoints only', () => {
    expect(isReplayMessage('Resumed Checkpoint 3 of 9: Pricing')).toBe(true);
    expect(isReplayMessage('Writing Checkpoint 3 of 9: Drills (batch 1 of 2) for Pricing')).toBe(false);
    expect(isReplayMessage('Built Checkpoint 3 of 9: Pricing')).toBe(false);
  });
});
