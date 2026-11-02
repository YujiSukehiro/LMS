'use client';

import { useMemo, useState } from 'react';
import { FILL_BLANK_TOKEN, type FillBlankChoiceDrill as FillBlankChoiceDrillItem } from '@/lib/schemas/curriculum';
import { cn, seededShuffle } from '@/lib/utils';
import { DrillCheckButton, TileKey, normalizeWord, tileClass, type DrillViewProps, type TileState } from './drill-shared';
import { digitKeyIndex, useHotkeys } from './useHotkeys';

/** FILL_BLANK_CHOICE: Playbook sentence with a highlighted blank + 4 word-bank chips. */
export function FillBlankChoiceDrill({ drill, seed, locked, onAnswer }: DrillViewProps<FillBlankChoiceDrillItem>) {
  const chips = useMemo(
    () => seededShuffle(drill.wordBank.map((word, index) => ({ key: `${index}`, word })), seed),
    [drill.wordBank, seed],
  );
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selectedWord = chips.find((chip) => chip.key === selectedKey)?.word ?? null;
  const isCorrectWord = (word: string) => normalizeWord(word) === normalizeWord(drill.correctWord);

  const [before, after] = useMemo(() => {
    const at = drill.sentenceTemplate.indexOf(FILL_BLANK_TOKEN);
    if (at === -1) return [drill.sentenceTemplate.trimEnd() + ' ', ''];
    return [drill.sentenceTemplate.slice(0, at), drill.sentenceTemplate.slice(at + FILL_BLANK_TOKEN.length)];
  }, [drill.sentenceTemplate]);

  const check = () => {
    if (locked || selectedWord === null) return;
    onAnswer(isCorrectWord(selectedWord));
  };

  useHotkeys((event) => {
    const index = digitKeyIndex(event);
    if (index >= 0 && index < chips.length) {
      setSelectedKey(chips[index].key);
      return true;
    }
    if (event.key === 'Backspace' || event.key === 'Escape') {
      setSelectedKey(null);
      return true;
    }
    if (event.key === 'Enter') {
      check();
      return true;
    }
    return false;
  }, !locked);

  const blankState: TileState = locked
    ? selectedWord !== null && isCorrectWord(selectedWord)
      ? 'correct'
      : 'wrong'
    : selectedWord
      ? 'selected'
      : 'idle';

  const chipState = (key: string, word: string): TileState => {
    if (!locked) return key === selectedKey ? 'selected' : 'idle';
    if (isCorrectWord(word)) return 'correct';
    if (key === selectedKey) return 'wrong';
    return 'muted';
  };

  return (
    <div>
      <p className="rounded-pulse-lg border border-pulse-border bg-pulse-bg px-4 py-5 text-lg leading-[2.4] text-pulse-primary">
        <span>{before}</span>
        <button
          type="button"
          disabled={locked || selectedWord === null}
          onClick={() => setSelectedKey(null)}
          aria-label={selectedWord ? `Blank filled with ${selectedWord}. Select to clear.` : 'Empty blank'}
          className={cn(
            'mx-1 inline-flex min-w-28 items-center justify-center rounded-pulse-md border-2 border-dashed px-3 py-0.5 align-baseline font-semibold leading-normal transition-colors',
            blankState === 'idle' && 'border-pulse-indigo/60 bg-pulse-indigo/10 text-pulse-muted',
            blankState === 'selected' && 'border-solid border-pulse-indigo bg-pulse-indigo/20 text-pulse-primary',
            blankState === 'correct' && 'border-solid border-pulse-emerald bg-pulse-emerald/15 text-pulse-emerald',
            blankState === 'wrong' && 'border-solid border-pulse-crimson bg-pulse-crimson/15 text-pulse-crimson line-through',
          )}
        >
          {selectedWord ?? ' ? '}
        </button>
        <span>{after}</span>
      </p>

      <div role="radiogroup" aria-label="Word bank" className="mt-4 grid grid-cols-2 gap-2.5 @xl:grid-cols-4">
        {chips.map((chip, index) => {
          const state = chipState(chip.key, chip.word);
          return (
            <button
              key={chip.key}
              type="button"
              role="radio"
              aria-checked={chip.key === selectedKey}
              disabled={locked}
              data-pulse-hotkeys=""
              onClick={() => setSelectedKey(chip.key)}
              className={cn(tileClass(state), 'justify-center px-3 py-3 text-sm')}
            >
              <TileKey label={String(index + 1)} state={state} />
              <span className="min-w-0">{chip.word}</span>
            </button>
          );
        })}
      </div>

      {!locked ? (
        <DrillCheckButton
          onCheck={check}
          disabled={selectedWord === null}
          hint="Press 1–4 to fill the blank, then Enter to check."
        />
      ) : null}
    </div>
  );
}
