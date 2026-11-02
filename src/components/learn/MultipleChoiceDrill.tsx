'use client';

import { useMemo, useState } from 'react';
import type { LearnerDrill } from '@/lib/schemas/learning';
import { seededShuffle } from '@/lib/utils';
import { DrillCheckButton, TileKey, tileClass, type DrillViewProps, type TileState } from './drill-shared';
import { digitKeyIndex, useHotkeys } from './useHotkeys';

type MultipleChoiceLearnerDrill = Extract<LearnerDrill, { kind: 'MULTIPLE_CHOICE' }>;
type MultipleChoiceAnswer = { kind: 'MULTIPLE_CHOICE'; optionId: string };

/** MULTIPLE_CHOICE: scenario + 4 keyboard-numbered option tiles. */
export function MultipleChoiceDrill({
  drill,
  seed,
  locked,
  busy,
  result,
  onAnswer,
}: DrillViewProps<MultipleChoiceLearnerDrill, MultipleChoiceAnswer>) {
  const options = useMemo(() => seededShuffle(drill.options, seed), [drill.options, seed]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const check = () => {
    if (locked || busy || !selectedId) return;
    onAnswer({ kind: 'MULTIPLE_CHOICE', optionId: selectedId });
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
    if (result?.correctAnswer?.kind === 'MULTIPLE_CHOICE') {
      if (optionId === result.correctAnswer.optionId) return 'correct';
      if (optionId === selectedId) return 'wrong';
      return 'muted';
    }
    return optionId === selectedId ? 'selected' : 'idle';
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
      {!result ? (
        <DrillCheckButton
          onCheck={check}
          disabled={!selectedId}
          busy={busy}
          hint="Press 1–4 to pick an option, then Enter to check."
        />
      ) : null}
    </div>
  );
}
