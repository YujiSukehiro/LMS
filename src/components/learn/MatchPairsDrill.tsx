'use client';

import { matchColumnLabels } from './match-labels';
import { useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import type { LearnerDrill } from '@/lib/schemas/learning';
import { cn, seededShuffle } from '@/lib/utils';
import { DrillCheckButton, TileKey, tileClass, type DrillViewProps, type TileState } from './drill-shared';
import { digitKeyIndex, useHotkeys } from './useHotkeys';

type MatchPairsLearnerDrill = Extract<LearnerDrill, { kind: 'MATCH_PAIRS' }>;
type MatchPairsAnswer = { kind: 'MATCH_PAIRS'; matches: Record<string, string> };
type Side = 'left' | 'right';
interface Pick {
  side: Side;
  optionId: string;
}

/** MATCH_PAIRS: pair left and right options, then submit the complete mapping for server grading. */
export function MatchPairsDrill({
  drill,
  seed,
  locked,
  busy,
  result,
  onAnswer,
}: DrillViewProps<MatchPairsLearnerDrill, MatchPairsAnswer>) {
  const leftItems = useMemo(() => seededShuffle(drill.leftOptions, `${seed}:left`), [drill.leftOptions, seed]);
  const rightItems = useMemo(() => seededShuffle(drill.rightOptions, `${seed}:right`), [drill.rightOptions, seed]);
  const [matches, setMatches] = useState<Record<string, string>>({});
  const [active, setActive] = useState<Pick | null>(null);
  const [announcement, setAnnouncement] = useState('');

  const choose = (side: Side, optionId: string) => {
    if (locked) return;
    if (!active || active.side === side) {
      setActive(active && active.side === side && active.optionId === optionId ? null : { side, optionId });
      return;
    }

    const leftId = side === 'left' ? optionId : active.optionId;
    const rightId = side === 'right' ? optionId : active.optionId;
    const leftText = drill.leftOptions.find((option) => option.id === leftId)?.text ?? 'Trigger';
    const rightText = drill.rightOptions.find((option) => option.id === rightId)?.text ?? 'Match';
    setMatches((current) => {
      const next = Object.fromEntries(
        Object.entries(current).filter(([existingLeft, existingRight]) => existingLeft !== leftId && existingRight !== rightId),
      );
      next[leftId] = rightId;
      return next;
    });
    setActive(null);
    setAnnouncement(`Paired: ${leftText} with ${rightText}.`);
  };

  const keyColumn: Side = active?.side === 'left' ? 'right' : 'left';
  const complete = drill.leftOptions.every((option) => Boolean(matches[option.id]));

  const check = () => {
    if (locked || busy || !complete) return;
    onAnswer({ kind: 'MATCH_PAIRS', matches });
  };

  useHotkeys((event) => {
    const index = digitKeyIndex(event);
    const column = keyColumn === 'left' ? leftItems : rightItems;
    if (index >= 0 && index < column.length) {
      choose(keyColumn, column[index].id);
      return true;
    }
    if (event.key === 'Escape') {
      setActive(null);
      return true;
    }
    if (event.key === 'Enter') {
      check();
      return true;
    }
    return false;
  }, !locked);

  const pairedRightFor = (side: Side, optionId: string): string | null => {
    if (side === 'left') return matches[optionId] ?? null;
    return Object.keys(matches).find((leftId) => matches[leftId] === optionId) ?? null;
  };

  const stateFor = (side: Side, optionId: string): TileState => {
    const pairedLeft = side === 'left' ? optionId : pairedRightFor(side, optionId);
    if (result?.correctAnswer?.kind === 'MATCH_PAIRS') {
      if (!pairedLeft || !matches[pairedLeft]) return 'muted';
      return result.correctAnswer.matches[pairedLeft] === matches[pairedLeft] ? 'correct' : 'wrong';
    }
    if (active && active.side === side && active.optionId === optionId) return 'selected';
    return pairedRightFor(side, optionId) ? 'selected' : 'idle';
  };

  const renderColumn = (side: Side, items: typeof leftItems) => (
    <ul aria-label={side === 'left' ? 'Triggers' : 'Matches'} className="space-y-2.5">
      {items.map((option, index) => {
        const state = stateFor(side, option.id);
        const isPaired = Boolean(pairedRightFor(side, option.id));
        return (
          <li key={option.id}>
            <button
              type="button"
              disabled={locked}
              data-pulse-hotkeys=""
              aria-pressed={state === 'selected'}
              onClick={() => choose(side, option.id)}
              className={cn(tileClass(state), 'min-h-16 text-sm')}
            >
              {isPaired && !result ? (
                <Check aria-hidden className="size-4 shrink-0 text-pulse-indigo" />
              ) : (
                <TileKey label={keyColumn === side && !locked ? String(index + 1) : '·'} state={state} />
              )}
              <span className="min-w-0 flex-1">{option.text}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );

  const columnLabels = matchColumnLabels(drill.prompt);
  return (
    <div>
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
      <div className="grid grid-cols-2 gap-3 @lg:gap-5">
        <div>
          <p className="pulse-label mb-2">{columnLabels.left}</p>
          {renderColumn('left', leftItems)}
        </div>
        <div>
          <p className="pulse-label mb-2">{columnLabels.right}</p>
          {renderColumn('right', rightItems)}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-pulse-muted">
        <span>
          {result
            ? 'Server-graded pairs shown above.'
            : keyColumn === 'left'
              ? `Pick an item on the left (keys 1–${leftItems.length}), then its match on the right.`
              : `Now pick its match on the right (keys 1–${rightItems.length}). Esc clears.`}
        </span>
        <span className="pulse-metric">{Object.keys(matches).length}/{drill.leftOptions.length} paired</span>
      </div>
      {!result ? (
        <DrillCheckButton
          onCheck={check}
          disabled={!complete}
          busy={busy}
          hint="Pair every trigger, then press Enter to check."
        />
      ) : null}
    </div>
  );
}
