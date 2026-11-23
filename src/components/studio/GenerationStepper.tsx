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
import { fetchSourceReview, isNoActiveSourceBundle, postSourceReview, runSourceContradictionCheck, type SourceReviewData } from './source-review-api';
import type { SourceConflict } from '@/lib/schemas/source-truth';

type ContradictionCheckState = { kind: 'idle' } | { kind: 'checking' } | { kind: 'done' } | { kind: 'failed'; message: string };

function isOpenConflict(conflict: SourceConflict): boolean {
  return conflict.status === 'open' || conflict.status === 'sme_review';
}
import { estimateMinutesLeft, formatMinutesLeft, isReplayMessage, parseCheckpointProgress, type CheckpointProgress, type EtaSample } from './generation-view';

/** Consecutive dropped connections (no progress in between) before the stepper shows an error. */
const MAX_SILENT_RECONNECTS = 6;
const RECONNECT_DELAY_MS = 3000;
const REPLAY_SETTLE_MS = 20_000;

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
  const [contradictionCheck, setContradictionCheck] = useState<ContradictionCheckState>({ kind: 'idle' });
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [unitCounter, setUnitCounter] = useState<CheckpointProgress | null>(() =>
    initialProgress?.step === 'BUILDING_UNITS' ? parseCheckpointProgress(initialProgress.message) : null,
  );
  const [eta, setEta] = useState<{ first: EtaSample | null; latest: EtaSample } | null>(null);
  const dropsRef = useRef(0);
  const openedAtRef = useRef(0);
  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    let source: EventSource | undefined;
    let finished = false;
    let cancelled = false;
    let redirectTimer: ReturnType<typeof setTimeout> | undefined;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

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
        setContradictionCheck({ kind: 'checking' });
        try {
          await runSourceContradictionCheck(trackId, review.bundle.id);
          const refreshed = await fetchSourceReview(trackId, review.bundle.id);
          if (!cancelled) {
            setSourceReview(refreshed);
            setContradictionCheck({ kind: 'done' });
          }
        } catch (error) {
          if (!cancelled) setContradictionCheck({ kind: 'failed', message: error instanceof Error ? error.message : 'The contradiction check did not finish.' });
        }
        return;
      }

      source = new EventSource(`/api/tracks/${encodeURIComponent(trackId)}/generate`);
      source.addEventListener('open', () => {
        openedAtRef.current = Date.now();
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
        dropsRef.current = 0;
        setProgress(next);
        // Resumed Checkpoints replay from saved checkpoints in seconds; timing them would make the estimate far too short.
        // The first seconds after (re)connecting can also be replay, so the pace starts 20 s after the stream opened.
        if (!isReplayMessage(next.message)) {
          const sample = { at: Date.now(), percent: next.percent };
          const settled = sample.at - openedAtRef.current >= REPLAY_SETTLE_MS;
          setEta((prev) => ({ first: prev?.first ?? (settled ? sample : null), latest: sample }));
        }
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
        // A dropped stream is not a failed build: the hosting request limit (5 min on Cloud Run) or a network
        // blip ends it while the build goes on. Reconnect quietly; the generate route follows or resumes it.
        if (dropsRef.current < MAX_SILENT_RECONNECTS) {
          dropsRef.current += 1;
          reconnectTimer = setTimeout(() => {
            if (!cancelled) setAttempt((n) => n + 1);
          }, RECONNECT_DELAY_MS);
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
      if (reconnectTimer) clearTimeout(reconnectTimer);
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
      {state.kind === 'running' || state.kind === 'connecting' ? (
        <EtaLine eta={eta} checkpointTotal={unitCounter?.total ?? null} />
      ) : null}

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
                  ) : active && state.kind === 'approval' ? (
                    index + 1
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
                  <span className="sr-only">{done ? ' — done' : failed ? ' — failed' : active ? (state.kind === 'approval' ? ' — waiting for your approval' : ' — in progress') : ' — waiting'}</span>
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
        <div className="flex flex-col gap-3 rounded-pulse-md border border-pulse-indigo/40 bg-pulse-indigo/10 p-4">
        <ContradictionList
          check={contradictionCheck}
          conflicts={sourceReview.conflicts.filter((conflict) => conflict.origin === 'contradiction_check')}
          decidingId={decidingId}
          onDecide={(conflict, status, decision) => {
            setDecidingId(conflict.id);
            void postSourceReview(trackId, 'conflict', {
              bundleId: sourceReview.bundle!.id,
              expectedRevisionHash: sourceReview.bundle!.revisionHash,
              conflictId: conflict.id,
              status,
              decision,
            })
              .then(() => fetchSourceReview(trackId, sourceReview.bundle!.id))
              .then((refreshed) => setSourceReview(refreshed))
              .catch((error: unknown) => setContradictionCheck({ kind: 'failed', message: error instanceof Error ? error.message : 'The decision did not save.' }))
              .finally(() => setDecidingId(null));
          }}
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="max-w-xl">
            <p className="text-sm font-semibold">Approve the exact uploaded source</p>
            <p className="mt-1 text-xs text-pulse-secondary">
              {sourceReview.bundle.documents.map((document) => document.fileName).join(', ')} · {sourceReview.pages.length} pages. Generation starts after this revision is approved.
              {sourceReview.conflicts.some(isOpenConflict) ? ' Decide each possible contradiction above first.' : ''}
            </p>
          </div>
          <button
            type="button"
            className="pulse-btn pulse-btn-primary"
            disabled={contradictionCheck.kind === 'checking' || sourceReview.conflicts.some(isOpenConflict)}
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

/** Wrap a quote in curly quotes unless it already starts with a quote mark. */
function quoted(text: string): string {
  return /^["“'‘]/.test(text) ? text : `“${text}”`;
}

function ContradictionList({
  check,
  conflicts,
  decidingId,
  onDecide,
}: {
  check: ContradictionCheckState;
  conflicts: SourceConflict[];
  decidingId: string | null;
  onDecide: (conflict: SourceConflict, status: 'resolved' | 'accepted_context_difference', decision: string) => void;
}) {
  if (check.kind === 'checking') {
    return (
      <p role="status" className="flex items-center gap-2 text-xs text-pulse-secondary">
        <LoaderCircle aria-hidden className="size-3.5 animate-spin" /> Checking the PDF for places where it contradicts itself…
      </p>
    );
  }
  if (check.kind === 'failed') return <p className="text-xs text-pulse-amber">{check.message}</p>;
  if (check.kind !== 'done') return null;
  const open = conflicts.filter(isOpenConflict);
  if (conflicts.length === 0) return <p className="text-xs text-pulse-secondary">No contradictions found in this PDF.</p>;
  return (
    <section aria-label="Possible contradictions in this PDF" className="flex flex-col gap-2">
      <p className="text-sm font-semibold">
        {conflicts.length === 1 ? '1 possible contradiction' : `${conflicts.length} possible contradictions`} in this PDF
        {open.length > 0 ? ` · ${open.length} to decide` : ' · all decided'}
      </p>
      {conflicts.map((conflict) => {
        const [rule, other] = conflict.sourceRefs;
        const decided = !isOpenConflict(conflict);
        return (
          <div key={conflict.id} className="rounded-pulse-md border border-pulse-border bg-pulse-surface-1 p-3">
            <p className="text-xs font-semibold">
              <span className={cn('mr-2 uppercase', conflict.severity === 'critical' ? 'text-pulse-crimson' : 'text-pulse-amber')}>{conflict.severity}</span>
              {conflict.summary ?? 'Two passages disagree.'}
            </p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <blockquote className="rounded-pulse-sm bg-pulse-bg p-2 text-xs"><span className="text-pulse-muted">Rule · page {rule.pageNumber}</span><br />{quoted(rule.exactText)}</blockquote>
              <blockquote className="rounded-pulse-sm bg-pulse-bg p-2 text-xs"><span className="text-pulse-muted">Conflicting · page {other.pageNumber}</span><br />{quoted(other.exactText)}</blockquote>
            </div>
            {decided ? (
              <p className="mt-2 text-xs text-pulse-emerald">Decided: {conflict.decision}</p>
            ) : (
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="pulse-btn pulse-btn-primary text-xs"
                  disabled={decidingId !== null}
                  onClick={() =>
                    onDecide(
                      conflict,
                      'resolved',
                      `Follow the rule on page ${rule.pageNumber}: "${rule.exactText}". Do not teach the passage on page ${other.pageNumber} where it breaks that rule.`,
                    )
                  }
                >
                  Follow the rule (page {rule.pageNumber})
                </button>
                <button
                  type="button"
                  className="pulse-btn text-xs"
                  disabled={decidingId !== null}
                  onClick={() => onDecide(conflict, 'accepted_context_difference', 'Trainer reviewed: both passages stand; not a contradiction.')}
                >
                  Not a contradiction
                </button>
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}

function EtaLine({ eta, checkpointTotal }: { eta: { first: EtaSample | null; latest: EtaSample } | null; checkpointTotal: number | null }) {
  // Re-render each 30 s so the estimate does not freeze between progress events.
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(timer);
  }, []);
  const minutes = eta ? estimateMinutesLeft({ first: eta.first, latest: eta.latest, checkpointTotal }) : null;
  return (
    <p className="-mt-2 text-xs text-pulse-secondary">
      <span className="font-semibold text-pulse-primary">Estimated time to completion: {minutes ? formatMinutesLeft(minutes) : 'working it out'}. </span>
      You can leave this page. The build keeps running, and the Track shows up in Track Studio when it is ready.
    </p>
  );
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}
