'use client';

import { useEffect, useRef, useState } from 'react';
import { SIM_COPY } from '@/lib/policy/training-policy';
import { useRouter } from 'next/navigation';
import { Check, CircleAlert, LoaderCircle, RotateCw } from 'lucide-react';
import {
  GenerateCompleteEventSchema,
  GenerateProgressEventSchema,
  SseErrorEventSchema,
  type GenerateProgressEvent,
} from '@/lib/schemas/api';
import type { GenerationStep } from '@/lib/schemas/curriculum';
import { cn } from '@/lib/utils';
import { fetchSourceReview, isNoActiveSourceBundle, postSourceReview, type SourceReviewData } from './source-review-api';
import { parseCheckpointProgress, type CheckpointProgress } from './generation-view';

interface StepperStage {
  id: string;
  label: string;
  steps: GenerationStep[];
}

const STAGES: StepperStage[] = [
  { id: 'extract', label: 'Extract Playbook', steps: ['UPLOADING', 'EXTRACTING_PDF'] },
  { id: 'pillars', label: 'Detect skill areas', steps: ['BLUEPRINTING'] },
  { id: 'units', label: 'Build Checkpoints', steps: ['BUILDING_UNITS'] },
  { id: 'sims', label: `Build ${SIM_COPY.plural}`, steps: ['BUILDING_SIMS'] },
  { id: 'ready', label: 'Ready', steps: ['READY'] },
];

function stageIndexFor(step: GenerationStep): number {
  const index = STAGES.findIndex((s) => s.steps.includes(step));
  return index === -1 ? 0 : index;
}

type StreamState =
  | { kind: 'connecting' }
  | { kind: 'approval' }
  | { kind: 'running' }
  | { kind: 'complete'; versionId: string }
  | { kind: 'error'; message: string };

/**
 * Live build stepper for one Track. Connects to `GET /api/tracks/{trackId}/generate` (SSE) with the native
 * EventSource API and redirects to the Studio when the `complete` event arrives.
 */
export function GenerationStepper({
  trackId,
  trackTitle,
  initialProgress,
  redirectOnComplete = true,
  onComplete,
}: {
  trackId: string;
  trackTitle?: string;
  initialProgress?: GenerateProgressEvent | null;
  redirectOnComplete?: boolean;
  onComplete?: (versionId: string) => void;
}) {
  const router = useRouter();
  const [progress, setProgress] = useState<GenerateProgressEvent>(
    initialProgress ?? { step: 'UPLOADING', percent: 0, message: 'Connecting to the Track generator…' },
  );
  const [state, setState] = useState<StreamState>({ kind: 'connecting' });
  const [sourceReview, setSourceReview] = useState<SourceReviewData | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [unitCounter, setUnitCounter] = useState<CheckpointProgress | null>(() =>
    initialProgress?.step === 'BUILDING_UNITS' ? parseCheckpointProgress(initialProgress.message) : null,
  );
  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    let source: EventSource | undefined;
    let finished = false;
    let cancelled = false;
    let redirectTimer: ReturnType<typeof setTimeout> | undefined;

    async function start() {
      let review: SourceReviewData | null;
      try {
        review = await fetchSourceReview(trackId, '');
      } catch (error) {
        // A legacy or bundle-less Track has nothing to approve: generate-track builds it without a bundle.
        if (isNoActiveSourceBundle(error)) review = null;
        else {
          if (!cancelled) setState({ kind: 'error', message: error instanceof Error ? error.message : 'Source Review did not load.' });
          return;
        }
      }
      if (cancelled) return;
      if (review?.bundle && review.bundle.status !== 'approved' && review.bundle.status !== 'published') {
        setSourceReview(review);
        setProgress({ step: 'EXTRACTING_PDF', percent: 5, message: 'Review and approve the uploaded source before building the Track.' });
        setState({ kind: 'approval' });
        return;
      }

      source = new EventSource(`/api/tracks/${encodeURIComponent(trackId)}/generate`);
      source.addEventListener('open', () => {
        if (!finished) setState({ kind: 'running' });
      });

      source.addEventListener('progress', (event) => {
        const parsed = GenerateProgressEventSchema.safeParse(safeJson((event as MessageEvent<string>).data));
        if (!parsed.success) return;
        const next = parsed.data;
        setState({ kind: 'running' });
        if (next.step === 'FAILED') {
          finished = true;
          source?.close();
          setProgress((prev) => ({ ...prev, message: next.message }));
          setState({ kind: 'error', message: next.message || 'Track generation failed.' });
          return;
        }
        setProgress(next);
        if (next.step === 'BUILDING_UNITS') {
          const counter = parseCheckpointProgress(next.message);
          if (counter) setUnitCounter(counter);
        }
      });

      source.addEventListener('complete', (event) => {
        const parsed = GenerateCompleteEventSchema.safeParse(safeJson((event as MessageEvent<string>).data));
        finished = true;
        source?.close();
        const versionId = parsed.success ? parsed.data.versionId : 'draft';
        setProgress({ step: 'READY', percent: 100, message: 'Your Track is ready for review.' });
        setUnitCounter((prev) => (prev ? { completed: prev.total, current: null, total: prev.total } : prev));
        setState({ kind: 'complete', versionId });
        onCompleteRef.current?.(versionId);
        if (redirectOnComplete) {
          redirectTimer = setTimeout(() => {
            router.replace(`/studio/${encodeURIComponent(trackId)}`);
            router.refresh();
          }, 900);
        }
      });

      source.addEventListener('error', (event) => {
        if (finished) return;
        finished = true;
        source?.close();
        if (event instanceof MessageEvent && typeof event.data === 'string') {
          const parsed = SseErrorEventSchema.safeParse(safeJson(event.data));
          setState({
            kind: 'error',
            message: parsed.success ? parsed.data.message : 'Track generation failed.',
          });
          return;
        }
        setState({
          kind: 'error',
          message: 'The connection to the Track generator closed before the Track was ready.',
        });
      });
    }

    void start();
    return () => {
      cancelled = true;
      finished = true;
      source?.close();
      if (redirectTimer) clearTimeout(redirectTimer);
    };
  }, [trackId, attempt, redirectOnComplete, router]);

  const activeIndex = state.kind === 'complete' ? STAGES.length - 1 : stageIndexFor(progress.step);
  const percent = state.kind === 'complete' ? 100 : Math.max(0, Math.min(100, Math.round(progress.percent)));

  return (
    <section aria-labelledby="generation-heading" className="pulse-card-elevated flex flex-col gap-5 p-5 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="pulse-label">Live Build</p>
          <h2 id="generation-heading" className="mt-1 text-lg font-semibold tracking-tight">
            {trackTitle ? `Building “${trackTitle}”` : 'Building your Track'}
          </h2>
        </div>
        <span
          className={cn(
            'pulse-metric text-2xl font-semibold',
            state.kind === 'error' ? 'text-pulse-crimson' : state.kind === 'complete' ? 'text-pulse-emerald' : 'text-pulse-primary',
          )}
        >
          {percent}%
        </span>
      </div>

      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label="Track generation progress"
        className="h-2 w-full overflow-hidden rounded-full bg-pulse-bg"
      >
        <div
          className={cn(
            'h-full rounded-full transition-[width] duration-700 ease-out',
            state.kind === 'error' ? 'bg-pulse-crimson' : state.kind === 'complete' ? 'bg-pulse-emerald' : 'bg-pulse-indigo',
          )}
          style={{ width: `${percent}%` }}
        />
      </div>

      <ol className="flex flex-col gap-1">
        {STAGES.map((stage, index) => {
          const done = index < activeIndex || state.kind === 'complete';
          const active = index === activeIndex && state.kind !== 'complete';
          const failed = active && state.kind === 'error';
          return (
            <li key={stage.id} className="flex gap-3">
              <div className="flex flex-col items-center">
                <span
                  className={cn(
                    'flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-bold transition-colors',
                    done && 'border-pulse-emerald bg-pulse-emerald/15 text-pulse-emerald',
                    active && !failed && 'pulse-ring border-pulse-indigo bg-pulse-indigo/15 text-pulse-indigo',
                    failed && 'border-pulse-crimson bg-pulse-crimson/15 text-pulse-crimson',
                    !done && !active && 'border-pulse-border text-pulse-muted',
                  )}
                >
                  {done ? (
                    <Check aria-hidden className="size-4" />
                  ) : failed ? (
                    <CircleAlert aria-hidden className="size-4" />
                  ) : active ? (
                    <LoaderCircle aria-hidden className="size-4 animate-spin" />
                  ) : (
                    index + 1
                  )}
                </span>
                {index < STAGES.length - 1 ? (
                  <span aria-hidden className={cn('my-1 w-px flex-1', done ? 'bg-pulse-emerald/50' : 'bg-pulse-border')} />
                ) : null}
              </div>
              <div className="min-w-0 flex-1 pb-3">
                <p className={cn('text-sm font-semibold', !done && !active && 'text-pulse-muted')}>
                  {stage.id === 'units' && unitCounter ? `${stage.label} 1–${unitCounter.total}` : stage.label}
                  <span className="sr-only">{done ? ' — done' : active ? ' — in progress' : ' — waiting'}</span>
                </p>
                {stage.id === 'units' && unitCounter ? (
                  <ul aria-label="Checkpoints" className="mt-1.5 flex flex-wrap gap-1.5">
                    {Array.from({ length: unitCounter.total }, (_, i) => {
                      const n = i + 1;
                      const unitDone = done || n <= unitCounter.completed;
                      const unitActive = active && !unitDone && n === unitCounter.current;
                      return (
                        <li
                          key={n}
                          className={cn(
                            'pulse-metric flex size-6 items-center justify-center rounded-full border text-[0.68rem]',
                            unitDone && 'border-pulse-emerald/60 bg-pulse-emerald/15 text-pulse-emerald',
                            unitActive && 'border-pulse-indigo bg-pulse-indigo/20 text-pulse-primary',
                            !unitDone && !unitActive && 'border-pulse-border text-pulse-muted',
                          )}
                        >
                          {n}
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
                {active ? (
                  <p aria-live="polite" className="mt-1 text-xs text-pulse-secondary">
                    {progress.message}
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>

      {state.kind === 'approval' && sourceReview?.bundle ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-pulse-md border border-pulse-indigo/40 bg-pulse-indigo/10 p-4">
          <div className="max-w-xl">
            <p className="text-sm font-semibold">Approve the exact uploaded source</p>
            <p className="mt-1 text-xs text-pulse-secondary">
              {sourceReview.bundle.documents.map((document) => document.fileName).join(', ')} · {sourceReview.pages.length} pages. Generation starts after this revision is approved.
            </p>
          </div>
          <button
            type="button"
            className="pulse-btn pulse-btn-primary"
            onClick={() => {
              setState({ kind: 'connecting' });
              void postSourceReview(trackId, 'bundle', {
                bundleId: sourceReview.bundle!.id,
                expectedRevisionHash: sourceReview.bundle!.revisionHash,
              }).then(() => setAttempt((n) => n + 1)).catch((error: unknown) => {
                setState({ kind: 'error', message: error instanceof Error ? error.message : 'Source approval failed.' });
              });
            }}
          >
            <Check aria-hidden className="size-4" /> Approve source bundle revision
          </button>
        </div>
      ) : null}
      {state.kind === 'error' ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-pulse-md border border-pulse-crimson/40 bg-pulse-crimson/10 p-3">
          <p className="text-sm text-pulse-crimson">{state.message}</p>
          <button
            type="button"
            className="pulse-btn"
            onClick={() => {
              setState({ kind: 'connecting' });
              setAttempt((n) => n + 1);
            }}
          >
            <RotateCw aria-hidden className="size-4" />
            Retry
          </button>
        </div>
      ) : null}
      {state.kind === 'complete' ? (
        <p role="status" className="text-sm text-pulse-emerald">
          Your Track is ready. Opening the Track Studio…
        </p>
      ) : null}
    </section>
  );
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}
