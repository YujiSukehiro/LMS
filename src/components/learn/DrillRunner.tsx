'use client';

import { useEffect, useMemo, useReducer, useRef } from 'react';
import { CircleCheck, Flame } from 'lucide-react';
import type { CompetencyPillar, DrillItem, DrillKind } from '@/lib/schemas/curriculum';
import type { DrillResult } from '@/lib/schemas/api';
import { XP_RULES } from '@/lib/schemas/constants';
import { cn } from '@/lib/utils';
import { FeedbackDrawer, type FeedbackStatus } from './FeedbackDrawer';
import { FillBlankChoiceDrill } from './FillBlankChoiceDrill';
import { MatchPairsDrill } from './MatchPairsDrill';
import { MistakeBanner } from './MistakeBanner';
import { MultipleChoiceDrill } from './MultipleChoiceDrill';
import { SegmentedProgress, type SegmentState } from './SegmentedProgress';
import { SequenceOrderDrill } from './SequenceOrderDrill';
import { TrueFalseSpotDrill } from './TrueFalseSpotDrill';
import { useHotkeys } from './useHotkeys';

export interface DrillRunnerProgress {
  /** One segment per Drill, in Drill order. */
  segments: SegmentState[];
  /** Consecutive correct answers (combo streak). */
  streak: number;
}

export interface DrillRunnerProps {
  drills: DrillItem[];
  pillars: CompetencyPillar[];
  /** Seed for deterministic shuffles. */
  seed: string;
  /** Called once when every Drill is cleared: one entry per Drill with the true first-try result. */
  onComplete: (results: DrillResult[]) => void;
  /** Optional progress feed for an outer progress bar (pass a stable callback). */
  onProgress?: (progress: DrillRunnerProgress) => void;
  /** Hide the built-in progress bar (when the parent renders its own). */
  hideProgress?: boolean;
}

export const DRILL_KIND_LABELS: Record<DrillKind, string> = {
  MULTIPLE_CHOICE: 'Scenario Choice',
  TRUE_FALSE_SPOT: 'Spot the Violation',
  SEQUENCE_ORDER: 'Call-Flow Order',
  MATCH_PAIRS: 'Match Pairs',
  FILL_BLANK_CHOICE: 'Complete the Script',
};

/** Plain-English description of the correct answer for the feedback drawer. */
export function describeCorrectAnswer(drill: DrillItem): string[] {
  switch (drill.kind) {
    case 'MULTIPLE_CHOICE': {
      const option = drill.options.find((o) => o.id === drill.correctOptionId);
      return option ? [option.text] : [];
    }
    case 'TRUE_FALSE_SPOT':
      return [drill.isCompliant ? '✓ Policy Compliant' : '✕ Policy Violation'];
    case 'SEQUENCE_ORDER':
      return drill.orderedSteps.map((step) => step.text);
    case 'MATCH_PAIRS':
      return drill.pairs.map((pair) => `${pair.leftPrompt} → ${pair.rightMatch}`);
    case 'FILL_BLANK_CHOICE':
      return [drill.correctWord];
  }
}

interface QueueEntry {
  drillIndex: number;
  attempt: number;
}

interface RunnerState {
  queue: QueueEntry[];
  position: number;
  phase: 'answering' | 'feedback' | 'done';
  lastCorrect: boolean;
  /** drillIndex -> first-try result */
  firstTry: Record<number, boolean>;
  /** drillIndex -> how it was cleared */
  cleared: Record<number, 'first' | 'recovered'>;
  streak: number;
  bestStreak: number;
  citationOpen: boolean;
}

type RunnerAction =
  | { type: 'answer'; correct: boolean }
  | { type: 'continue' }
  | { type: 'toggleCitation' };

function initialState(count: number): RunnerState {
  return {
    queue: Array.from({ length: count }, (_, drillIndex) => ({ drillIndex, attempt: 0 })),
    position: 0,
    phase: count === 0 ? 'done' : 'answering',
    lastCorrect: false,
    firstTry: {},
    cleared: {},
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
      if (state.phase !== 'answering') return state;
      const entry = state.queue[state.position];
      if (!entry) return state;
      const firstTry =
        entry.attempt === 0 ? { ...state.firstTry, [entry.drillIndex]: action.correct } : state.firstTry;
      if (action.correct) {
        const streak = state.streak + 1;
        return {
          ...state,
          phase: 'feedback',
          lastCorrect: true,
          firstTry,
          cleared: { ...state.cleared, [entry.drillIndex]: entry.attempt === 0 ? 'first' : 'recovered' },
          streak,
          bestStreak: Math.max(state.bestStreak, streak),
          citationOpen: false,
        };
      }
      return {
        ...state,
        phase: 'feedback',
        lastCorrect: false,
        firstTry,
        queue: [...state.queue, { drillIndex: entry.drillIndex, attempt: entry.attempt + 1 }],
        streak: 0,
        citationOpen: false,
      };
    }
    case 'continue': {
      if (state.phase !== 'feedback') return state;
      if (state.position + 1 < state.queue.length) {
        return { ...state, position: state.position + 1, phase: 'answering', citationOpen: false };
      }
      return { ...state, phase: 'done', citationOpen: false };
    }
  }
}

/**
 * Phase 2 + 3 of a Checkpoint: runs every Drill, then re-queues each missed Drill until all are cleared.
 * Does not call any API. `onComplete` receives the honest first-try results.
 */
export function DrillRunner({ drills, pillars, seed, onComplete, onProgress, hideProgress = false }: DrillRunnerProps) {
  const [state, dispatch] = useReducer(reducer, drills.length, initialState);
  const promptRef = useRef<HTMLHeadingElement>(null);
  const completedRef = useRef(false);
  const firstItemRef = useRef(true);

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
        passedFirstTry: state.firstTry[index] === true,
      })),
    [drills, state.firstTry],
  );

  useEffect(() => {
    if (state.phase !== 'done' || completedRef.current) return;
    completedRef.current = true;
    onComplete(results);
  }, [state.phase, results, onComplete]);

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

  const firstTryCorrect = results.filter((r) => r.passedFirstTry).length;

  if (state.phase === 'done' || !drill || !entry) {
    const pct = drills.length === 0 ? 100 : Math.round((firstTryCorrect / drills.length) * 100);
    return (
      <section className="pulse-cq w-full" aria-live="polite">
        <div className="pulse-card-elevated flex flex-col items-center gap-3 p-8 text-center">
          <CircleCheck aria-hidden className="size-10 text-pulse-emerald" />
          <h2 className="text-xl font-bold">All Drills cleared</h2>
          <p className="text-sm text-pulse-secondary">
            First-try accuracy <span className="pulse-metric font-semibold text-pulse-primary">{pct}%</span> (
            <span className="pulse-metric">
              {firstTryCorrect}/{drills.length}
            </span>
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
  const feedbackStatus: FeedbackStatus = state.lastCorrect ? (isRecovery ? 'recovered' : 'correct') : 'incorrect';
  const feedbackXp = !state.lastCorrect
    ? 0
    : isRecovery
      ? XP_RULES.perRecoveredDrill
      : XP_RULES.perFirstTryCorrectDrill;
  const isLastItem = state.position + 1 >= state.queue.length;
  const pillarLabel = pillarLabels.get(drill.competencyPillarId);
  const itemSeed = `${seed}:${drill.id}:${entry.attempt}`;
  const viewProps = {
    seed: itemSeed,
    locked: state.phase !== 'answering',
    onAnswer: (correct: boolean) => dispatch({ type: 'answer', correct }),
  };

  return (
    <section className="pulse-cq w-full" aria-label="Drills">
      {!hideProgress ? <SegmentedProgress segments={segments} streak={state.streak} className="mb-4" /> : null}

      {isRecovery ? <MistakeBanner round={entry.attempt + 1} remaining={remaining} className="mb-4" /> : null}

      <article
        key={state.position}
        className={cn(
          'pulse-card-elevated pulse-slide-up p-5 @lg:p-7',
          state.phase === 'feedback' && (state.lastCorrect ? 'border-pulse-emerald/60' : 'border-pulse-amber/60'),
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

      {state.phase === 'feedback' ? (
        <FeedbackDrawer
          status={feedbackStatus}
          xp={feedbackXp}
          explanation={drill.explanation}
          correctAnswer={state.lastCorrect ? undefined : describeCorrectAnswer(drill)}
          sourcePages={drill.sourcePages}
          citationExpanded={state.citationOpen}
          onToggleCitation={() => dispatch({ type: 'toggleCitation' })}
          onContinue={() => dispatch({ type: 'continue' })}
          continueLabel={state.lastCorrect && isLastItem ? 'Finish Drills' : 'Continue'}
        />
      ) : null}
    </section>
  );
}
