'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  ArrowRight,
  Award,
  Brain,
  CalendarClock,
  CheckCircle2,
  Flame,
  LoaderCircle,
  RotateCcw,
  Sparkles,
  TriangleAlert,
} from 'lucide-react';
import { DRILL_KIND_LABELS, describeCorrectAnswer } from '@/components/learn/DrillRunner';
import { FeedbackDrawer, type FeedbackStatus } from '@/components/learn/FeedbackDrawer';
import { FillBlankChoiceDrill } from '@/components/learn/FillBlankChoiceDrill';
import { MatchPairsDrill } from '@/components/learn/MatchPairsDrill';
import { MultipleChoiceDrill } from '@/components/learn/MultipleChoiceDrill';
import { SequenceOrderDrill } from '@/components/learn/SequenceOrderDrill';
import { TrueFalseSpotDrill } from '@/components/learn/TrueFalseSpotDrill';
import { createIdempotencyKey } from '@/components/learn/drill-shared';
import { DivisionPill } from '@/components/layout/DivisionPill';
import { describeApiError, describeNetworkError } from '@/app/(dashboard)/learn/_lib/api-errors';
import {
  CompleteReviewResponseSchema,
  DrillAnswerResponseSchema,
  DrillStartResponseSchema,
  type CompleteReviewRequest,
  type CompleteReviewResponse,
  type DrillAnswerRequest,
  type DrillAnswerResponse,
  type DrillStartRequest,
  type DrillStartResponse,
} from '@/lib/schemas/api';
import { XP_RULES } from '@/lib/schemas/constants';
import type { DrillAnswer } from '@/lib/schemas/learning';
import type { RetentionQueueItem, RetentionQueueResult } from '@/lib/services/retention-queue-core';
import { cn } from '@/lib/utils';

type SessionMode = 'due' | 'reinforce';

interface AnsweredEntry {
  item: RetentionQueueItem;
  response: DrillAnswerResponse;
}

function formatDueHint(dueAt: string, nowMs: number): string {
  const diffMs = Date.parse(dueAt) - nowMs;
  if (!Number.isFinite(diffMs)) return 'Scheduled';
  if (diffMs <= 0) return 'Due now';
  const hours = Math.round(diffMs / 3_600_000);
  if (hours < 1) return 'Due in ~10 min';
  if (hours < 24) return `Next review in ${hours} hr${hours === 1 ? '' : 's'}`;
  const days = Math.round(diffMs / 86_400_000);
  return `Next review in ${days} day${days === 1 ? '' : 's'}`;
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof TypeError) return describeNetworkError(error);
  if (error instanceof Error) return error.message;
  return describeNetworkError(error);
}

/** Interactive Knowledge Retention runner for spaced-retrieval and reinforcement reviews. */
export function RetentionRunner({
  queue,
  initialTrackId = null,
}: {
  queue: RetentionQueueResult;
  initialTrackId?: string | null;
}) {
  const initialFilteredDue = initialTrackId
    ? queue.dueItems.filter((item) => item.trackId === initialTrackId)
    : queue.dueItems;
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(initialTrackId);
  const [mode, setMode] = useState<SessionMode>(queue.dueItems.length > 0 ? 'due' : 'reinforce');
  const [activeBatch, setActiveBatch] = useState<RetentionQueueItem[] | null>(() =>
    initialFilteredDue.length > 0 ? initialFilteredDue : null,
  );
  const [position, setPosition] = useState(0);
  const [phase, setPhase] = useState<'idle' | 'answering' | 'feedback' | 'done'>(() =>
    initialFilteredDue.length > 0 ? 'answering' : 'idle',
  );

  const [nowMs, setNowMs] = useState(() => Date.now());
  const [itemResponse, setItemResponse] = useState<DrillAnswerResponse | null>(null);
  const [citationOpen, setCitationOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [answered, setAnswered] = useState<AnsweredEntry[]>([]);

  const [completionState, setCompletionState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [completionError, setCompletionError] = useState<string | null>(null);
  const [completionResult, setCompletionResult] = useState<CompleteReviewResponse | null>(null);
  const [itemKeys, setItemKeys] = useState<string[]>(() => initialFilteredDue.map(() => createIdempotencyKey()));
  const [sessionIdempotencyKey, setSessionIdempotencyKey] = useState(() => createIdempotencyKey());

  const startsRef = useRef<Map<number, DrillStartResponse>>(new Map());
  const submittingRef = useRef(false);
  const promptRef = useRef<HTMLHeadingElement>(null);

  const visibleDue = useMemo(
    () => (selectedTrackId ? queue.dueItems.filter((i) => i.trackId === selectedTrackId) : queue.dueItems),
    [queue.dueItems, selectedTrackId],
  );
  const visibleReinforce = useMemo(
    () => (selectedTrackId ? queue.reinforceItems.filter((i) => i.trackId === selectedTrackId) : queue.reinforceItems),
    [queue.reinforceItems, selectedTrackId],
  );

  const startBatch = useCallback((items: RetentionQueueItem[], nextMode: SessionMode) => {
    if (items.length === 0) return;
    startsRef.current = new Map();
    setMode(nextMode);
    setActiveBatch(items);
    setItemKeys(items.map(() => createIdempotencyKey()));
    setSessionIdempotencyKey(createIdempotencyKey());
    setPosition(0);
    setPhase('answering');
    setItemResponse(null);
    setCitationOpen(false);
    setSubmitError(null);
    setAnswered([]);
    setCompletionState('idle');
    setCompletionError(null);
    setCompletionResult(null);
  }, []);

  const currentItem = activeBatch && phase !== 'idle' && phase !== 'done' ? activeBatch[position] ?? null : null;

  useEffect(() => {
    if (phase === 'answering') {
      promptRef.current?.focus({ preventScroll: true });
    }
  }, [position, phase]);

  const submitAnswer = async (answer: DrillAnswer) => {
    if (submittingRef.current || phase !== 'answering' || !currentItem) return;
    submittingRef.current = true;
    setSubmitting(true);
    setSubmitError(null);

    try {
      let start = startsRef.current.get(position);
      if (!start) {
        const startBody: DrillStartRequest = {
          trackId: currentItem.trackId,
          versionId: currentItem.versionId,
          unitId: currentItem.unitId,
          drillId: currentItem.drill.id,
        };
        const startResponse = await fetch('/api/progress/drill-start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(startBody),
        });
        if (!startResponse.ok) throw new Error(await describeApiError(startResponse, 'progress'));
        const parsedStart = DrillStartResponseSchema.safeParse(await safeJson(startResponse));
        if (!parsedStart.success) throw new Error('The server reply was not readable. Try again.');
        start = parsedStart.data;
        startsRef.current.set(position, start);
      }

      const key = itemKeys[position] ?? createIdempotencyKey();
      const answerBody: DrillAnswerRequest = {
        trackId: currentItem.trackId,
        versionId: currentItem.versionId,
        unitId: currentItem.unitId,
        drillId: currentItem.drill.id,
        startId: start.startId,
        idempotencyKey: key,
        answer,
      };
      const answerResponse = await fetch('/api/progress/drill-answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(answerBody),
      });
      if (!answerResponse.ok) throw new Error(await describeApiError(answerResponse, 'progress'));
      const parsedAnswer = DrillAnswerResponseSchema.safeParse(await safeJson(answerResponse));
      if (!parsedAnswer.success) throw new Error('The server reply was not readable. Try again.');

      setNowMs(Date.now());
      setItemResponse(parsedAnswer.data);
      setAnswered((prev) => [...prev, { item: currentItem, response: parsedAnswer.data }]);
      setPhase('feedback');
      setCitationOpen(false);
    } catch (error) {
      setSubmitError(errorMessage(error));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const finalizeSession = useCallback(
    async (entries: AnsweredEntry[], idempotencyKey: string) => {
      if (entries.length === 0) return;
      setCompletionState('saving');
      setCompletionError(null);
      try {
        const body: CompleteReviewRequest = {
          trackIds: [...new Set(entries.map((entry) => entry.item.trackId))],
          reviewedCount: entries.length,
          idempotencyKey,
        };
        const response = await fetch('/api/progress/complete-review', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!response.ok) throw new Error(await describeApiError(response, 'progress'));
        const parsed = CompleteReviewResponseSchema.safeParse(await safeJson(response));
        if (!parsed.success) throw new Error('Could not confirm XP and certification status.');
        setCompletionResult(parsed.data);
        setCompletionState('saved');
      } catch (error) {
        setCompletionError(errorMessage(error));
        setCompletionState('error');
      }
    },
    [],
  );

  const handleContinue = () => {
    if (phase !== 'feedback' || !activeBatch) return;
    if (position + 1 < activeBatch.length) {
      setPosition((p) => p + 1);
      setPhase('answering');
      setItemResponse(null);
      setCitationOpen(false);
      setSubmitError(null);
      return;
    }
    setPhase('done');
    void finalizeSession(answered, sessionIdempotencyKey);
  };

  // Header pills and the caught-up line follow the Track filter, so a filtered view never mixes in other Tracks' counts.
  const selectedSummary = selectedTrackId ? queue.trackSummaries.find((t) => t.trackId === selectedTrackId) ?? null : null;
  const activeSummary = selectedTrackId
    ? {
        dueCount: selectedSummary?.dueCount ?? 0,
        scheduledCount: selectedSummary?.scheduledCount ?? 0,
        masteredCount: selectedSummary?.masteredCount ?? 0,
        nextUpcomingAt: selectedSummary?.nextUpcomingAt ?? null,
      }
    : queue.summary;

  const activeTrackTitle = selectedTrackId
    ? queue.trackSummaries.find((t) => t.trackId === selectedTrackId)?.trackTitle ?? 'Selected Track'
    : 'All Assigned Tracks';

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 pb-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/" className="inline-flex w-fit items-center gap-1.5 text-xs text-pulse-muted hover:text-pulse-primary">
          <ArrowLeft aria-hidden className="size-4" />
          Back to Home
        </Link>
        {phase !== 'idle' ? (
          <button
            type="button"
            onClick={() => {
              setActiveBatch(null);
              setPhase('idle');
            }}
            className="text-xs font-medium text-pulse-muted hover:text-pulse-primary"
          >
            Exit to queue
          </button>
        ) : null}
      </div>

      <header className="pulse-card px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-lg font-bold tracking-tight">
              <Brain aria-hidden className="size-4 text-pulse-indigo" />
              Keep-Sharp Review
            </h1>
            <p className="text-xs text-pulse-muted">Short recall drills at 1, 3 and 7 days so Playbook rules stick.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className={cn('pulse-pill pulse-metric', activeSummary.dueCount > 0 && 'pulse-pill-amber')}>
              {activeSummary.dueCount} Due Now
            </span>
            <span className="pulse-pill pulse-metric">{activeSummary.scheduledCount} Scheduled</span>
            <span className="pulse-pill pulse-pill-emerald pulse-metric">{activeSummary.masteredCount} Mastered</span>
          </div>
        </div>

        {queue.trackSummaries.length > 1 && phase === 'idle' ? (
          <div className="mt-3 flex flex-wrap gap-1.5 border-t border-pulse-border-subtle pt-3" aria-label="Filter by Track">
            <button
              type="button"
              onClick={() => setSelectedTrackId(null)}
              aria-pressed={selectedTrackId === null}
              className={cn(
                'pulse-pill cursor-pointer transition-colors',
                selectedTrackId === null && 'pulse-pill-indigo',
              )}
            >
              All Tracks ({queue.dueItems.length} due)
            </button>
            {queue.trackSummaries.map((track) => (
              <button
                key={track.trackId}
                type="button"
                onClick={() => setSelectedTrackId(track.trackId)}
                aria-pressed={selectedTrackId === track.trackId}
                className={cn(
                  'pulse-pill cursor-pointer transition-colors',
                  selectedTrackId === track.trackId && 'pulse-pill-indigo',
                )}
              >
                {track.trackTitle} ({track.dueCount} due)
              </button>
            ))}
          </div>
        ) : null}
      </header>

      {phase === 'idle' ? (
        <section className="pulse-card flex flex-col gap-4 p-5">
          {visibleDue.length > 0 ? (
            <>
              <div className="space-y-2">
                <p className="pulse-label">{activeTrackTitle}</p>
                <h2 className="text-xl font-bold text-pulse-primary">
                  <span className="pulse-metric">{visibleDue.length}</span> review drill
                  {visibleDue.length === 1 ? '' : 's'} ready now
                </h2>
                <p className="text-sm text-pulse-secondary">Each correct answer moves that rule to its next review and counts toward certification.</p>
              </div>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => startBatch(visibleDue, 'due')}
                  className="pulse-btn pulse-btn-primary px-5 py-2.5"
                >
                  <Sparkles aria-hidden className="size-4" />
                  Start Due Review ({visibleDue.length})
                </button>
              </div>
            </>
          ) : visibleReinforce.length > 0 ? (
            <>
              <div className="flex items-start gap-3">
                <CheckCircle2 aria-hidden className="mt-0.5 size-6 shrink-0 text-pulse-emerald" />
                <div className="space-y-1">
                  <p className="pulse-label">{activeTrackTitle}</p>
                  <h2 className="text-xl font-bold text-pulse-primary">You&apos;re caught up on due reviews</h2>
                  <p className="text-sm text-pulse-secondary">
                    {activeSummary.nextUpcomingAt
                      ? `${formatDueHint(activeSummary.nextUpcomingAt, nowMs)}. Want extra reps? Practice upcoming Keep-Sharp items now.`
                      : 'Want extra reps? Practice upcoming Keep-Sharp items below.'}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => startBatch(visibleReinforce, 'reinforce')}
                  className="pulse-btn pulse-btn-primary px-5 py-2.5"
                >
                  <CalendarClock aria-hidden className="size-4" />
                  Practice Upcoming Drills ({visibleReinforce.length})
                </button>
                <Link href="/" className="pulse-btn">
                  Back to My Tracks
                </Link>
              </div>
            </>
          ) : (
            <div className="flex flex-col items-start gap-3">
              <p className="pulse-label">No scheduled reviews yet</p>
              <h2 className="text-xl font-bold text-pulse-primary">Complete a Checkpoint first</h2>
              <p className="text-sm text-pulse-secondary">
                Drills you answer in a Checkpoint come back here after 1, 3 and 7 days.
              </p>
              <Link href="/" className="pulse-btn pulse-btn-primary mt-1">
                Browse My Tracks <ArrowRight aria-hidden className="size-4" />
              </Link>
            </div>
          )}
        </section>
      ) : null}

      {phase !== 'idle' && phase !== 'done' && currentItem && activeBatch ? (
        <section className="flex flex-col gap-4" aria-label="Retention drill session">
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between text-xs text-pulse-muted">
              <span>
                {mode === 'due' ? 'Due Review' : 'Keep-Sharp Reinforcement'} · {currentItem.trackTitle}
              </span>
              <span className="pulse-metric">
                {position + 1} / {activeBatch.length}
              </span>
            </div>
            <progress
              className="pulse-progress w-full"
              value={phase === 'feedback' ? position + 1 : position}
              max={activeBatch.length}
              aria-label="Retention review progress"
            />
          </div>

          <article
            key={`${currentItem.trackId}:${currentItem.drill.id}:${position}`}
            aria-busy={submitting}
            className={cn(
              'pulse-card pulse-slide-up p-4 sm:p-5',
              phase === 'feedback' && (itemResponse?.correct ? 'border-pulse-emerald/60' : 'border-pulse-amber/60'),
            )}
          >
            <header className="mb-3 flex flex-wrap items-center gap-1.5 text-xs">
              <DivisionPill divisionId={currentItem.divisionId} short />
              <span className="min-w-0 truncate text-pulse-muted">
                {currentItem.unitTitle} · {currentItem.pillarLabel} · {DRILL_KIND_LABELS[currentItem.drill.kind]}
              </span>
              {currentItem.isOverdue ? (
                <span className="pulse-pill pulse-pill-amber ml-auto">Due</span>
              ) : (
                <span className="pulse-pill ml-auto">Early</span>
              )}
            </header>

            <h2
              ref={promptRef}
              tabIndex={-1}
              className="mb-4 text-lg font-semibold leading-snug text-pulse-primary outline-none"
            >
              {currentItem.drill.prompt}
            </h2>

            {currentItem.drill.kind === 'MULTIPLE_CHOICE' ? (
              <MultipleChoiceDrill
                drill={currentItem.drill}
                seed={`ret:${currentItem.scheduleId}:${position}`}
                locked={phase !== 'answering' || submitting}
                busy={submitting}
                result={itemResponse}
                onAnswer={submitAnswer}
              />
            ) : null}
            {currentItem.drill.kind === 'TRUE_FALSE_SPOT' ? (
              <TrueFalseSpotDrill
                drill={currentItem.drill}
                seed={`ret:${currentItem.scheduleId}:${position}`}
                locked={phase !== 'answering' || submitting}
                busy={submitting}
                result={itemResponse}
                onAnswer={submitAnswer}
              />
            ) : null}
            {currentItem.drill.kind === 'SEQUENCE_ORDER' ? (
              <SequenceOrderDrill
                drill={currentItem.drill}
                seed={`ret:${currentItem.scheduleId}:${position}`}
                locked={phase !== 'answering' || submitting}
                busy={submitting}
                result={itemResponse}
                onAnswer={submitAnswer}
              />
            ) : null}
            {currentItem.drill.kind === 'MATCH_PAIRS' ? (
              <MatchPairsDrill
                drill={currentItem.drill}
                seed={`ret:${currentItem.scheduleId}:${position}`}
                locked={phase !== 'answering' || submitting}
                busy={submitting}
                result={itemResponse}
                onAnswer={submitAnswer}
              />
            ) : null}
            {currentItem.drill.kind === 'FILL_BLANK_CHOICE' ? (
              <FillBlankChoiceDrill
                drill={currentItem.drill}
                seed={`ret:${currentItem.scheduleId}:${position}`}
                locked={phase !== 'answering' || submitting}
                busy={submitting}
                result={itemResponse}
                onAnswer={submitAnswer}
              />
            ) : null}
          </article>

          {submitError && phase === 'answering' ? (
            <div role="alert" className="flex gap-3 rounded-pulse-lg border border-pulse-amber/50 bg-pulse-amber/10 p-4">
              <TriangleAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-pulse-amber" />
              <div>
                <p className="font-semibold text-pulse-primary">Your review answer was not saved</p>
                <p className="mt-1 text-sm text-pulse-secondary">{submitError}</p>
              </div>
            </div>
          ) : null}

          {phase === 'feedback' && itemResponse ? (
            <div className="flex flex-col gap-2">
              {itemResponse.schedule ? (
                <p className="text-xs font-medium text-pulse-secondary">
                  <CalendarClock aria-hidden className="mr-1 inline size-3.5 text-pulse-indigo" />
                  {formatDueHint(itemResponse.schedule.dueAt, nowMs)}
                </p>
              ) : null}
              <FeedbackDrawer
                status={(itemResponse.correct ? 'recovered' : 'incorrect') as FeedbackStatus}
                xp={itemResponse.correct ? XP_RULES.perRecoveredDrill : 0}
                explanation={itemResponse.explanation ?? 'Review recorded.'}
                correctAnswer={
                  itemResponse.correct || !itemResponse.correctAnswer
                    ? undefined
                    : describeCorrectAnswer(currentItem.drill, itemResponse.correctAnswer)
                }
                sourcePages={itemResponse.sourcePages}
                citationExpanded={citationOpen}
                onToggleCitation={() => setCitationOpen((o) => !o)}
                onContinue={handleContinue}
                continueLabel={position + 1 >= activeBatch.length ? 'Finish Review' : 'Next Review Drill'}
              />
            </div>
          ) : null}
        </section>
      ) : null}

      {phase === 'done' && activeBatch ? (
        <section className="pulse-card-elevated pulse-slide-up flex flex-col gap-5 p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1">
              <p className="pulse-label">Retention Session Complete</p>
              <h2 className="text-2xl font-bold text-pulse-primary">
                <span className="pulse-metric">
                  {answered.filter((entry) => entry.response.correct).length} / {answered.length}
                </span>{' '}
                recalled accurately
              </h2>
              <p className="text-sm text-pulse-muted">
                Every correct recall advances that Playbook rule on the 1 → 3 → 7 day spaced ladder.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {completionResult ? (
                <span className="pulse-pill pulse-pill-indigo pulse-metric">+{completionResult.xpAwarded} XP</span>
              ) : null}
              <span className="pulse-pill pulse-pill-amber">
                <Flame aria-hidden className="size-3.5" />
                Streak updated
              </span>
            </div>
          </div>

          {completionState === 'saving' ? (
            <p className="flex items-center gap-2 text-sm text-pulse-muted">
              <LoaderCircle aria-hidden className="size-4 animate-spin" />
              Saving retention XP and checking certification status...
            </p>
          ) : null}

          {completionState === 'error' && completionError ? (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-pulse-lg border border-pulse-amber/50 bg-pulse-amber/10 p-4">
              <p className="text-sm text-pulse-secondary">{completionError}</p>
              <button
                type="button"
                onClick={() => void finalizeSession(answered, sessionIdempotencyKey)}
                className="pulse-btn pulse-btn-primary text-xs"
              >
                <RotateCcw aria-hidden className="size-3.5" /> Retry Save
              </button>
            </div>
          ) : null}

          {completionResult && completionResult.newlyCertifiedTrackIds.length > 0 ? (
            <div className="flex items-start gap-3 rounded-pulse-lg border border-pulse-emerald/40 bg-pulse-emerald/10 p-4">
              <Award aria-hidden className="mt-0.5 size-6 shrink-0 text-pulse-emerald" />
              <div>
                <p className="font-bold text-pulse-emerald">Campaign Certified Unlocked!</p>
                <p className="mt-0.5 text-sm text-pulse-primary">
                  Your spaced retention reviews satisfied all remaining Playbook rule requirements for:{' '}
                  <span className="font-semibold">{completionResult.newlyCertifiedTrackIds.join(', ')}</span>.
                </p>
              </div>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-3">
            <Link href="/" className="pulse-btn pulse-btn-primary">
              Back to Home <ArrowRight aria-hidden className="size-4" />
            </Link>
            <Link href="/learn/review" className="pulse-btn">
              Refresh Retention Queue
            </Link>
          </div>
        </section>
      ) : null}
    </div>
  );
}
