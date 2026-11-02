'use client';

import { useMemo, useState } from 'react';
import type { MultipleChoiceDrill as MultipleChoiceDrillItem } from '@/lib/schemas/curriculum';
import { seededShuffle } from '@/lib/utils';
import { DrillCheckButton, TileKey, tileClass, type DrillViewProps, type TileState } from './drill-shared';
import { digitKeyIndex, useHotkeys } from './useHotkeys';

/** MULTIPLE_CHOICE: scenario + 4 keyboard-numbered option tiles. */
export function MultipleChoiceDrill({ drill, seed, locked, onAnswer }: DrillViewProps<MultipleChoiceDrillItem>) {
  const options = useMemo(() => seededShuffle(drill.options, seed), [drill.options, seed]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const check = () => {
    if (locked || !selectedId) return;
    onAnswer(selectedId === drill.correctOptionId);
  };

  useHotkeys((event) => {
    const index = digitKeyIndex(event);
    if (index >= 0 && index < options.length) {
      setSelectedId(options[index].id);
      return true;
    }
    if (event.key === 'Enter') {
      check();
      return true;
    }
    return false;
  }, !locked);

  const stateFor = (optionId: string): TileState => {
    if (!locked) return optionId === selectedId ? 'selected' : 'idle';
    if (optionId === drill.correctOptionId) return 'correct';
    if (optionId === selectedId) return 'wrong';
    return 'muted';
  };

  return (
    <div>
      <div role="radiogroup" aria-label="Answer options" className="grid gap-3 @xl:grid-cols-2">
        {options.map((option, index) => {
          const state = stateFor(option.id);
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={option.id === selectedId}
              disabled={locked}
              data-pulse-hotkeys=""
              onClick={() => setSelectedId(option.id)}
              className={tileClass(state)}
            >
              <TileKey label={String(index + 1)} state={state} />
              <span className="min-w-0 flex-1">{option.text}</span>
            </button>
          );
        })}
      </div>
      {!locked ? (
        <DrillCheckButton
          onCheck={check}
          disabled={!selectedId}
          hint="Press 1–4 to pick an option, then Enter to check."
        />
      ) : null}
    </div>
  );
}
