'use client';

import { useEffect, useRef } from 'react';
import { ArrowRight, CircleCheck, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SourcePageBadge } from './SourcePageBadge';

export type FeedbackStatus = 'correct' | 'recovered' | 'incorrect';

export interface FeedbackDrawerProps {
  status: FeedbackStatus;
  /** XP shown in the headline for a correct answer (0 hides it). */
  xp: number;
  explanation: string;
  /** Lines that describe the correct answer (shown when the answer was wrong). */
  correctAnswer?: string[];
  sourcePages: number[];
  citationExpanded?: boolean;
  onToggleCitation?: () => void;
  onContinue: () => void;
  continueLabel?: string;
  className?: string;
}

/** Grounded feedback bar that moves up into view after every Drill answer. */
export function FeedbackDrawer({
  status,
  xp,
  explanation,
  correctAnswer,
  sourcePages,
  citationExpanded,
  onToggleCitation,
  onContinue,
  continueLabel = 'Continue',
  className,
}: FeedbackDrawerProps) {
  const continueRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    continueRef.current?.focus({ preventScroll: true });
  }, []);

  const isCorrect = status !== 'incorrect';
  const headline = isCorrect ? (xp > 0 ? `Correct! +${xp} XP` : 'Correct!') : 'Review Rule';

  return (
    <section
      aria-label="Answer feedback"
      className={cn(
        'pulse-slide-up sticky bottom-0 z-10 mt-6 rounded-pulse-lg border p-4 shadow-[0_-12px_30px_rgb(0_0_0/0.35)] sm:p-5',
        isCorrect
          ? 'border-pulse-emerald/50 bg-[color-mix(in_srgb,var(--pulse-emerald)_12%,var(--pulse-surface-1))]'
          : 'border-pulse-amber/50 bg-[color-mix(in_srgb,var(--pulse-amber)_10%,var(--pulse-surface-1))]',
        className,
      )}
    >
      <div className="flex flex-col gap-4 @lg:flex-row @lg:items-end @lg:justify-between">
        <div className="min-w-0 space-y-2" aria-live="assertive" aria-atomic="true">
          <p
            className={cn(
              'flex items-center gap-2 text-lg font-bold',
              isCorrect ? 'text-pulse-emerald' : 'text-pulse-amber',
            )}
          >
            {isCorrect ? (
              <CircleCheck aria-hidden className="size-5 shrink-0" />
            ) : (
              <TriangleAlert aria-hidden className="size-5 shrink-0" />
            )}
            <span className="pulse-metric">{headline}</span>
          </p>
          {!isCorrect && correctAnswer && correctAnswer.length > 0 ? (
            <div className="text-sm text-pulse-primary">
              <span className="pulse-label">Correct answer</span>
              {correctAnswer.length === 1 ? (
                <p className="mt-0.5 font-semibold">{correctAnswer[0]}</p>
              ) : (
                <ol className="mt-1 list-decimal space-y-0.5 pl-5 font-semibold">
                  {correctAnswer.map((line, index) => (
                    <li key={index}>{line}</li>
                  ))}
                </ol>
              )}
            </div>
          ) : null}
          <p className="text-sm leading-relaxed text-pulse-secondary">{explanation}</p>
          {!isCorrect ? (
            <p className="text-xs text-pulse-muted">This Drill returns at the end of the Checkpoint for another try.</p>
          ) : null}
        </div>
        <button
          ref={continueRef}
          type="button"
          data-pulse-hotkeys=""
          onClick={onContinue}
          className={cn('pulse-btn shrink-0 px-6 py-3 text-base', isCorrect ? 'pulse-btn-success' : 'pulse-btn-primary')}
        >
          {continueLabel}
          <ArrowRight aria-hidden className="size-4" />
          <kbd className="pulse-kbd hidden border-current/30 bg-transparent text-current sm:inline-flex">Enter</kbd>
        </button>
      </div>
      <SourcePageBadge
        pages={sourcePages}
        expanded={citationExpanded}
        onToggle={onToggleCitation}
        showShortcut
        className="mt-3"
      />
    </section>
  );
}
