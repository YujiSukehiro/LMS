'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { LearnerDrill } from '@/lib/schemas/learning';
import { cn, seededShuffle } from '@/lib/utils';
import { DrillCheckButton, TileKey, type DrillViewProps, type TileState, tileClass } from './drill-shared';
import { digitKeyIndex, useHotkeys } from './useHotkeys';

type SequenceLearnerDrill = Extract<LearnerDrill, { kind: 'SEQUENCE_ORDER' }>;
type SequenceAnswer = { kind: 'SEQUENCE_ORDER'; orderedStepIds: string[] };

/** SEQUENCE_ORDER: reorder shuffled step tiles with up/down buttons or the keyboard. */
export function SequenceOrderDrill({
  drill,
  seed,
  locked,
  busy,
  result,
  onAnswer,
}: DrillViewProps<SequenceLearnerDrill, SequenceAnswer>) {
  const stepById = useMemo(() => new Map(drill.steps.map((step) => [step.id, step])), [drill.steps]);
  const [order, setOrder] = useState<string[]>(() => seededShuffle(drill.steps.map((step) => step.id), seed));
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const correctIds = result?.correctAnswer?.kind === 'SEQUENCE_ORDER' ? result.correctAnswer.orderedStepIds : null;

  const move = (from: number, to: number) => {
    if (locked || to < 0 || to >= order.length || from === to) return;
    const next = [...order];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    setOrder(next);
    setActiveIndex(to);
    const text = stepById.get(item)?.text ?? 'Step';
    setAnnouncement(`${text} moved to position ${to + 1} of ${order.length}.`);
  };

  const check = () => {
    if (locked || busy) return;
    onAnswer({ kind: 'SEQUENCE_ORDER', orderedStepIds: order });
  };

  useHotkeys((event) => {
    const index = digitKeyIndex(event);
    if (index >= 0 && index < order.length) {
      setActiveIndex(index);
      return true;
    }
    if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && activeIndex !== null) {
      move(activeIndex, activeIndex + (event.key === 'ArrowUp' ? -1 : 1));
      return true;
    }
    if (event.key === 'Escape') {
      setActiveIndex(null);
      return true;
    }
    if (event.key === 'Enter') {
      check();
      return true;
    }
    return false;
  }, !locked);

  return (
    <div>
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
      <ol aria-label="Steps in your order" className="space-y-2.5">
        {order.map((id, index) => {
          const step = stepById.get(id);
          if (!step) return null;
          const isActive = activeIndex === index;
          const correctPosition = correctIds?.indexOf(id) ?? -1;
          const state: TileState = correctIds
            ? correctIds[index] === id
              ? 'correct'
              : 'wrong'
            : isActive
              ? 'selected'
              : 'idle';
          return (
            <li key={id} className="flex items-stretch gap-2">
              <button
                type="button"
                disabled={locked}
                data-pulse-hotkeys=""
                aria-pressed={isActive}
                aria-label={`Position ${index + 1}: ${step.text}. Select to move with the arrow keys.`}
                onClick={() => setActiveIndex(isActive ? null : index)}
                className={cn(tileClass(state), 'flex-1')}
              >
                <TileKey label={String(index + 1)} state={state} />
                <span className="min-w-0 flex-1">{step.text}</span>
                {correctPosition >= 0 && correctIds?.[index] !== id ? (
                  <span className="pulse-metric shrink-0 text-xs text-pulse-crimson">
                    belongs at #{correctPosition + 1}
                  </span>
                ) : null}
              </button>
              {!result ? (
                <div className="flex flex-col gap-1">
                  <button
                    type="button"
                    className="pulse-btn h-full min-h-0 flex-1 px-2 py-0"
                    onClick={() => move(index, index - 1)}
                    disabled={locked || index === 0}
                    aria-label={`Move "${step.text}" up`}
                  >
                    <ChevronUp aria-hidden className="size-4" />
                  </button>
                  <button
                    type="button"
                    className="pulse-btn h-full min-h-0 flex-1 px-2 py-0"
                    onClick={() => move(index, index + 1)}
                    disabled={locked || index === order.length - 1}
                    aria-label={`Move "${step.text}" down`}
                  >
                    <ChevronDown aria-hidden className="size-4" />
                  </button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
      {!result ? (
        <DrillCheckButton
          onCheck={check}
          disabled={false}
          busy={busy}
          hint="Press a number to pick a step, ↑ / ↓ to move it, Enter to check."
        />
      ) : null}
    </div>
  );
}
