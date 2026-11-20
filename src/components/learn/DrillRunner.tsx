'use client';

import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { CircleCheck, Flame, TriangleAlert } from 'lucide-react';
import type { CompetencyPillar, DrillItem } from '@/lib/schemas/curriculum';
import {
  DrillAnswerResponseSchema,
  DrillStartResponseSchema,
  type DrillAnswerRequest,
  type DrillAnswerResponse,
  type DrillResult,
  type DrillStartRequest,
  type DrillStartResponse,
} from '@/lib/schemas/api';
import type { DrillAnswer, LearnerDrill, LearnerDrillKind } from '@/lib/schemas/learning';
import { XP_RULES } from '@/lib/schemas/constants';
import { cn } from '@/lib/utils';
import { describeApiError, describeNetworkError } from '@/app/(dashboard)/learn/_lib/api-errors';
import { FeedbackDrawer, type FeedbackStatus } from './FeedbackDrawer';
import { FillBlankChoiceDrill } from './FillBlankChoiceDrill';
import { MatchPairsDrill } from './MatchPairsDrill';
import { MistakeBanner } from './MistakeBanner';
import { MultipleChoiceDrill } from './MultipleChoiceDrill';
import { SegmentedProgress, type SegmentState } from './SegmentedProgress';
import { SequenceOrderDrill } from './SequenceOrderDrill';
import { TrueFalseSpotDrill } from './TrueFalseSpotDrill';
import { createIdempotencyKey } from './drill-shared';
import { useHotkeys } from './useHotkeys';
import { checkpointScoreLine, summarizeDrillRound, type DrillRoundSummary, type RoundFirstAnswer } from './round-score';

export interface DrillRunnerProgress {
  /** One segment per Drill, in Drill order. */
  segments: SegmentState[];
  /** Consecutive correct answers (combo streak). */
  streak: number;
}

export interface DrillRunnerProps {
  /** Full items are accepted only for legacy studio type compatibility and are stripped before rendering. */
  drills: Array<LearnerDrill | DrillItem>;
  pillars: CompetencyPillar[];
  /** Seed for deterministic shuffles. */
  seed: string;
  /** Server progress context. Optional only so an unconnected studio preview fails closed. */
  trackId?: string;
  versionId?: string;
  unitId?: string;
  /** Called once when every Drill is cleared, using accumulated server responses; `round` scores this sitting. */
  onComplete: (results: DrillResult[], round: DrillRoundSummary) => void;
  /** Optional progress feed for an outer progress bar (pass a stable callback). */
  onProgress?: (progress: DrillRunnerProgress) => void;
  /** Hide the built-in progress bar (when the parent renders its own). */
  hideProgress?: boolean;
}

function toLearnerDrill(drill: LearnerDrill | DrillItem): LearnerDrill {
  const base = {
    id: drill.id,
    competencyPillarId: drill.competencyPillarId,
    prompt: drill.prompt,
    ruleIds: drill.ruleIds ?? [],
    variationOfDrillId: drill.variationOfDrillId,
  };
  switch (drill.kind) {
    case 'MULTIPLE_CHOICE':
      return { ...base, kind: drill.kind, options: drill.options };
    case 'TRUE_FALSE_SPOT':
      return { ...base, kind: drill.kind, statement: drill.statement };
    case 'SEQUENCE_ORDER':
      return { ...base, kind: drill.kind, steps: 'steps' in drill ? drill.steps : drill.orderedSteps };
    case 'MATCH_PAIRS':
      return {
        ...base,
        kind: drill.kind,
        leftOptions: 'leftOptions' in drill
          ? drill.leftOptions
          : drill.pairs.map((pair) => ({ id: pair.id, text: pair.leftPrompt })),
        rightOptions: 'rightOptions' in drill
          ? drill.rightOptions
          : drill.pairs.map((pair) => ({ id: pair.id, text: pair.rightMatch })),
      };
    case 'FILL_BLANK_CHOICE':
      return { ...base, kind: drill.kind, sentenceTemplate: drill.sentenceTemplate, wordBank: drill.wordBank };
  }
}

export const DRILL_KIND_LABELS: Record<LearnerDrillKind, string> = {
  MULTIPLE_CHOICE: 'Scenario Choice',
  TRUE_FALSE_SPOT: 'Spot the Violation',
  SEQUENCE_ORDER: 'Call-Flow Order',
  MATCH_PAIRS: 'Match Pairs',
  FILL_BLANK_CHOICE: 'Complete the Script',
};

/** Describes only server-returned IDs/words that exist in the learner-safe Drill DTO. */
export function describeCorrectAnswer(drill: LearnerDrill, answer: DrillAnswer): string[] {
  switch (drill.kind) {
    case 'MULTIPLE_CHOICE': {
      if (answer.kind !== 'MULTIPLE_CHOICE') return [];
      const option = drill.options.find((item) => item.id === answer.optionId);
      return option ? [option.text] : [];
    }
    case 'TRUE_FALSE_SPOT':
      return answer.kind === 'TRUE_FALSE_SPOT'
        ? [answer.isCompliant ? '✓ Policy Compliant' : '✕ Policy Violation']
        : [];
    case 'SEQUENCE_ORDER':
      if (answer.kind !== 'SEQUENCE_ORDER') return [];
      return answer.orderedStepIds.flatMap((id) => {
        const step = drill.steps.find((item) => item.id === id);
        return step ? [step.text] : [];
      });
    case 'MATCH_PAIRS':
      if (answer.kind !== 'MATCH_PAIRS') return [];
      return drill.leftOptions.flatMap((left) => {
        const rightId = answer.matches[left.id];
        const right = drill.rightOptions.find((item) => item.id === rightId);
        return right ? [`${left.text} → ${right.text}`] : [];
      });
    case 'FILL_BLANK_CHOICE':
      return answer.kind === 'FILL_BLANK_CHOICE' && drill.wordBank.includes(answer.word) ? [answer.word] : [];
  }
}

interface QueueEntry {
  drillIndex: number;
  /** Local round number used only for labels and option shuffling, never grading. */
  attempt: number;
  idempotencyKey: string;
}

interface RunnerState {
  queue: QueueEntry[];
  position: number;
  phase: 'answering' | 'feedback' | 'done';
  response: DrillAnswerResponse | null;
  /** drillIndex -> server result for the initial attempt, when one was submitted. */
  firstTry: Record<number, boolean>;
  /** drillIndex -> server-derived first-independent result for the clearing answer. */
  firstIndependent: Record<number, boolean>;
  /** drillIndex -> how the server says it was cleared. */
  cleared: Record<number, 'first' | 'recovered'>;
  /** drillIndex -> the first answer given in this round (attempt 0), whatever its attempt kind. */
  roundFirst: Record<number, RoundFirstAnswer>;
  streak: number;
  bestStreak: number;
  citationOpen: boolean;
}

type RunnerAction =
  | { type: 'answer'; position: number; response: DrillAnswerResponse; recoveryKey: string }
  | { type: 'continue' }
  | { type: 'toggleCitation' };

function initialState(count: number): RunnerState {
  return {
    queue: Array.from({ length: count }, (_, drillIndex) => ({
      drillIndex,
      attempt: 0,
      idempotencyKey: createIdempotencyKey(),
    })),
    position: 0,
    phase: count === 0 ? 'done' : 'answering',
    response: null,
    firstTry: {},
    firstIndependent: {},
    cleared: {},
    roundFirst: {},
    streak: 0,
    bestStreak: 0,
    citationOpen: false,
  };
}

function reducer(state: RunnerState, action: RunnerAction): RunnerState {
  switch (action.type) {
    case 'toggleCitation':
      return { ...state, citationOpen: !state.citationOpen };
    case 'answer': {
      if (state.phase !== 'answering' || state.position !== action.position) return state;
      const entry = state.queue[state.position];
      if (!entry) return state;
      const { response } = action;
      const firstTry =
        response.attemptKind === 'initial'
          ? { ...state.firstTry, [entry.drillIndex]: response.correct }
          : state.firstTry;
      const roundFirst = entry.attempt === 0
        ? { ...state.roundFirst, [entry.drillIndex]: { correct: response.correct, firstIndependent: response.firstIndependent } }
        : state.roundFirst;
      if (response.correct) {
        const streak = state.streak + 1;
        return {
          ...state,
          phase: 'feedback',
          response,
          firstTry,
          roundFirst,
          firstIndependent: { ...state.firstIndependent, [entry.drillIndex]: response.firstIndependent },
          cleared: { ...state.cleared, [entry.drillIndex]: response.firstIndependent ? 'first' : 'recovered' },
          streak,
          bestStreak: Math.max(state.bestStreak, streak),
          citationOpen: false,
        };
      }
      return {
        ...state,
        phase: 'feedback',
        response,
        firstTry,
        roundFirst,
        queue: [
          ...state.queue,
          { drillIndex: entry.drillIndex, attempt: entry.attempt + 1, idempotencyKey: action.recoveryKey },
        ],
        streak: 0,
        citationOpen: false,
      };
    }
    case 'continue': {
      if (state.phase !== 'feedback') return state;
      if (state.position + 1 < state.queue.length) {
        return { ...state, position: state.position + 1, phase: 'answering', response: null, citationOpen: false };
      }
      return { ...state, phase: 'done', response: null, citationOpen: false };
    }
  }
}

async function responseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function submissionErrorMessage(error: unknown): string {
  if (error instanceof TypeError) return describeNetworkError(error);
  if (error instanceof Error) return error.message;
  return describeNetworkError(error);
}

/** Runs server-graded Drills and re-queues each missed Drill until the server returns correct. */
export function DrillRunner({
  drills: inputDrills,
  pillars,
  seed,
  trackId,
  versionId,
  unitId,
  onComplete,
  onProgress,
  hideProgress = false,
}: DrillRunnerProps) {
  const drills = useMemo(() => inputDrills.map(toLearnerDrill), [inputDrills]);
  const [state, dispatch] = useReducer(reducer, drills.length, initialState);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const promptRef = useRef<HTMLHeadingElement>(null);
  const completedRef = useRef(false);
  const firstItemRef = useRef(true);
  const submittingRef = useRef(false);
  const startsRef = useRef(new Map<number, DrillStartResponse>());

  const pillarLabels = useMemo(() => new Map(pillars.map((p) => [p.id, p.label])), [pillars]);
  const entry = state.phase === 'done' ? undefined : state.queue[state.position];
  const drill = entry ? drills[entry.drillIndex] : undefined;

  const segments = useMemo<SegmentState[]>(
    () =>
      drills.map((_, index) => {
        const cleared = state.cleared[index];
        if (cleared === 'first') return 'done';
        if (cleared === 'recovered') return 'recovered';
        if (entry && entry.drillIndex === index && state.phase === 'answering') return 'current';
        if (state.firstTry[index] === false) return 'missed';
        return 'pending';
      }),
    [drills, state.cleared, state.firstTry, state.phase, entry],
  );

  useEffect(() => {
    onProgress?.({ segments, streak: state.streak });
  }, [segments, state.streak, onProgress]);

  const results = useMemo<DrillResult[]>(
    () =>
      drills.map((item, index) => ({
        drillId: item.id,
        competencyPillarId: item.competencyPillarId,
        passedFirstTry: state.firstIndependent[index] === true,
      })),
    [drills, state.firstIndependent],
  );

  const round = useMemo(() => summarizeDrillRound(state.roundFirst, drills.length), [state.roundFirst, drills.length]);

  useEffect(() => {
    if (state.phase !== 'done' || completedRef.current) return;
    completedRef.current = true;
    onComplete(results, round);
  }, [state.phase, results, round, onComplete]);

  useEffect(() => {
    if (state.phase !== 'answering') return;
    if (firstItemRef.current) {
      firstItemRef.current = false;
      return;
    }
    promptRef.current?.focus({ preventScroll: true });
    promptRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [state.position, state.phase]);

  useHotkeys((event) => {
    if (event.key === 'Enter') {
      dispatch({ type: 'continue' });
      return true;
    }
    if (event.key === ' ') {
      dispatch({ type: 'toggleCitation' });
      return true;
    }
    return false;
  }, state.phase === 'feedback');

  const submitAnswer = async (answer: DrillAnswer) => {
    if (submittingRef.current || state.phase !== 'answering' || !entry || !drill) return;
    if (!trackId || !versionId || !unitId) {
      setSubmitError('Server grading is not connected for this Drill preview.');
      return;
    }

    const position = state.position;
    const queueEntry = entry;
    submittingRef.current = true;
    setSubmitting(true);
    setSubmitError(null);

    try {
      let start = startsRef.current.get(position);
      if (!start) {
        const startBody: DrillStartRequest = { trackId, versionId, unitId, drillId: drill.id };
        const startResponse = await fetch('/api/progress/drill-start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(startBody),
        });
        if (!startResponse.ok) throw new Error(await describeApiError(startResponse, 'progress'));
        const parsedStart = DrillStartResponseSchema.safeParse(await responseJson(startResponse));
        if (!parsedStart.success) {
          throw new Error('The server reply was not readable. Your answer is still here; try again.');
        }
        start = parsedStart.data;
        startsRef.current.set(position, start);
      }

      const answerBody: DrillAnswerRequest = {
        trackId,
        versionId,
        unitId,
        drillId: drill.id,
        startId: start.startId,
        idempotencyKey: queueEntry.idempotencyKey,
        answer,
      };
      const answerResponse = await fetch('/api/progress/drill-answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(answerBody),
      });
      if (!answerResponse.ok) throw new Error(await describeApiError(answerResponse, 'progress'));
      const parsedAnswer = DrillAnswerResponseSchema.safeParse(await responseJson(answerResponse));
      if (!parsedAnswer.success) {
        throw new Error('The server reply was not readable. Your answer is still here; try again.');
      }
      dispatch({ type: 'answer', position, response: parsedAnswer.data, recoveryKey: createIdempotencyKey() });
    } catch (error) {
      setSubmitError(submissionErrorMessage(error));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const firstTryCorrect = results.filter((result) => result.passedFirstTry).length;

  if (state.phase === 'done' || !drill || !entry) {
    const score = checkpointScoreLine(
      { firstTryCorrect, total: drills.length, accuracyPct: drills.length === 0 ? 100 : Math.round((firstTryCorrect / drills.length) * 100) },
      round,
    );
    return (
      <section className="pulse-cq w-full" aria-live="polite">
        <div className="pulse-card-elevated flex flex-col items-center gap-3 p-8 text-center">
          <CircleCheck aria-hidden className="size-10 text-pulse-emerald" />
          <h2 className="text-xl font-bold">All Drills cleared</h2>
          <p className="text-sm text-pulse-secondary">
            {score.label} <span className="pulse-metric font-semibold text-pulse-primary">{score.pct}%</span> (
            <span className="pulse-metric">{score.detail}</span>
            )
            {state.bestStreak >= 2 ? (
              <>
                {' '}· best combo <span className="pulse-metric font-semibold text-pulse-amber">{state.bestStreak}</span>
              </>
            ) : null}
          </p>
          {drills.length === 0 ? (
            <p className="text-xs text-pulse-muted">This Checkpoint has no Drills.</p>
          ) : null}
        </div>
      </section>
    );
  }

  const isRecovery = entry.attempt > 0;
  const remaining = state.queue.length - state.position;
  const response = state.response;
  const feedbackStatus: FeedbackStatus = response?.correct
    ? response.attemptKind === 'initial' && response.firstIndependent
      ? 'correct'
      : 'recovered'
    : 'incorrect';
  const feedbackXp = !response?.correct
    ? 0
    : response.firstIndependent
      ? XP_RULES.perFirstTryCorrectDrill
      : XP_RULES.perRecoveredDrill;
  const isLastItem = state.position + 1 >= state.queue.length;
  const pillarLabel = pillarLabels.get(drill.competencyPillarId);
  const itemSeed = `${seed}:${drill.id}:${entry.attempt}`;
  const viewProps = {
    seed: itemSeed,
    locked: state.phase !== 'answering' || submitting,
    busy: submitting,
    result: response,
    onAnswer: submitAnswer,
  };

  return (
    <section className="pulse-cq w-full" aria-label="Drills">
      {!hideProgress ? <SegmentedProgress segments={segments} streak={state.streak} className="mb-4" /> : null}

      {isRecovery ? <MistakeBanner round={entry.attempt + 1} remaining={remaining} className="mb-4" /> : null}

      <article
        key={state.position}
        aria-busy={submitting}
        className={cn(
          'pulse-card-elevated pulse-slide-up p-5 @lg:p-7',
          state.phase === 'feedback' && (response?.correct ? 'border-pulse-emerald/60' : 'border-pulse-amber/60'),
        )}
      >
        <header className="mb-4 flex flex-wrap items-center gap-2">
          <span className="pulse-label">
            {isRecovery ? (
              'Review'
            ) : (
              <>
                Drill <span className="pulse-metric">{entry.drillIndex + 1}</span> of{' '}
                <span className="pulse-metric">{drills.length}</span>
              </>
            )}
          </span>
          <span className="pulse-pill">{DRILL_KIND_LABELS[drill.kind]}</span>
          {pillarLabel ? <span className="pulse-pill pulse-pill-indigo">{pillarLabel}</span> : null}
          {hideProgress || state.streak < 2 ? null : (
            <span className="pulse-pill pulse-pill-amber ml-auto">
              <Flame aria-hidden className="size-3.5" />
              <span className="pulse-metric">{state.streak} in a row</span>
            </span>
          )}
        </header>

        <h2
          ref={promptRef}
          tabIndex={-1}
          className="mb-5 text-lg font-semibold leading-snug text-pulse-primary outline-none @lg:text-xl"
        >
          {drill.prompt}
        </h2>

        {drill.kind === 'MULTIPLE_CHOICE' ? <MultipleChoiceDrill drill={drill} {...viewProps} /> : null}
        {drill.kind === 'TRUE_FALSE_SPOT' ? <TrueFalseSpotDrill drill={drill} {...viewProps} /> : null}
        {drill.kind === 'SEQUENCE_ORDER' ? <SequenceOrderDrill drill={drill} {...viewProps} /> : null}
        {drill.kind === 'MATCH_PAIRS' ? <MatchPairsDrill drill={drill} {...viewProps} /> : null}
        {drill.kind === 'FILL_BLANK_CHOICE' ? <FillBlankChoiceDrill drill={drill} {...viewProps} /> : null}
      </article>

      {submitError && state.phase === 'answering' ? (
        <div role="alert" className="mt-4 flex gap-3 rounded-pulse-lg border border-pulse-amber/50 bg-pulse-amber/10 p-4">
          <TriangleAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-pulse-amber" />
          <div>
            <p className="font-semibold text-pulse-primary">Your answer was not submitted</p>
            <p className="mt-1 text-sm text-pulse-secondary">{submitError}</p>
            <p className="mt-1 text-xs text-pulse-muted">Your answer is still selected. Select Check to try again.</p>
          </div>
        </div>
      ) : null}

      {state.phase === 'feedback' && response ? (
        <FeedbackDrawer
          status={feedbackStatus}
          xp={feedbackXp}
          explanation={response.explanation ?? 'This submission was already recorded. Start a new attempt for fresh feedback.'}
          correctAnswer={response.correct || !response.correctAnswer
            ? undefined
            : describeCorrectAnswer(drill, response.correctAnswer)}
          sourcePages={response.sourcePages}
          citationExpanded={state.citationOpen}
          onToggleCitation={() => dispatch({ type: 'toggleCitation' })}
          onContinue={() => dispatch({ type: 'continue' })}
          continueLabel={response.correct && isLastItem ? 'Finish Drills' : 'Continue'}
        />
      ) : null}
    </section>
  );
}
