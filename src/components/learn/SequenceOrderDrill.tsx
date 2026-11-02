'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { SequenceOrderDrill as SequenceOrderDrillItem } from '@/lib/schemas/curriculum';
import { cn, seededShuffle } from '@/lib/utils';
import { DrillCheckButton, TileKey, type DrillViewProps, type TileState, tileClass } from './drill-shared';
import { digitKeyIndex, useHotkeys } from './useHotkeys';

/** Shuffles step IDs deterministically and never starts in the solved order. */
function initialOrder(stepIds: string[], seed: string): string[] {
  const shuffled = seededShuffle(stepIds, seed);
  const solved = shuffled.every((id, index) => id === stepIds[index]);
  if (!solved || shuffled.length < 2) return shuffled;
  return [...shuffled.slice(1), shuffled[0]];
}

/** SEQUENCE_ORDER: reorder shuffled step tiles with up/down buttons or the keyboard. */
export function SequenceOrderDrill({ drill, seed, locked, onAnswer }: DrillViewProps<SequenceOrderDrillItem>) {
  const correctIds = useMemo(() => drill.orderedSteps.map((step) => step.id), [drill.orderedSteps]);
  const stepById = useMemo(() => new Map(drill.orderedSteps.map((step) => [step.id, step])), [drill.orderedSteps]);
  const [order, setOrder] = useState<string[]>(() => initialOrder(correctIds, seed));
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState('');

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
    if (locked) return;
    onAnswer(order.every((id, index) => id === correctIds[index]));
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
          const state: TileState = locked
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
                {locked && correctIds[index] !== id ? (
                  <span className="pulse-metric shrink-0 text-xs text-pulse-crimson">
                    belongs at #{correctIds.indexOf(id) + 1}
                  </span>
                ) : null}
              </button>
              {!locked ? (
                <div className="flex flex-col gap-1">
                  <button
                    type="button"
                    className="pulse-btn h-full min-h-0 flex-1 px-2 py-0"
                    onClick={() => move(index, index - 1)}
                    disabled={index === 0}
                    aria-label={`Move "${step.text}" up`}
                  >
                    <ChevronUp aria-hidden className="size-4" />
                  </button>
                  <button
                    type="button"
                    className="pulse-btn h-full min-h-0 flex-1 px-2 py-0"
                    onClick={() => move(index, index + 1)}
                    disabled={index === order.length - 1}
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
      {!locked ? (
        <DrillCheckButton
          onCheck={check}
          disabled={false}
          hint="Press a number to pick a step, ↑ / ↓ to move it, Enter to check."
        />
      ) : null}
    </div>
  );
}
