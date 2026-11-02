'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import type { MatchPairsDrill as MatchPairsDrillItem } from '@/lib/schemas/curriculum';
import { cn, seededShuffle } from '@/lib/utils';
import { TileKey, tileClass, type DrillViewProps, type TileState } from './drill-shared';
import { digitKeyIndex, useHotkeys } from './useHotkeys';

type Side = 'left' | 'right';
interface Pick {
  side: Side;
  pairId: string;
}

const WRONG_FLASH_MS = 650;

/**
 * MATCH_PAIRS: click a trigger on the left, then its match on the right (either order works).
 * Correct pairs lock in emerald; a wrong pair flashes crimson and counts as a miss.
 * The attempt passes only when every pair is matched with zero misses.
 */
export function MatchPairsDrill({ drill, seed, locked, onAnswer }: DrillViewProps<MatchPairsDrillItem>) {
  const leftItems = useMemo(() => seededShuffle(drill.pairs, `${seed}:left`), [drill.pairs, seed]);
  const rightItems = useMemo(() => seededShuffle(drill.pairs, `${seed}:right`), [drill.pairs, seed]);
  const [matched, setMatched] = useState<ReadonlySet<string>>(() => new Set());
  const [active, setActive] = useState<Pick | null>(null);
  const [wrongFlash, setWrongFlash] = useState<{ left: string; right: string } | null>(null);
  const [misses, setMisses] = useState(0);
  const [announcement, setAnnouncement] = useState('');
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    },
    [],
  );

  const choose = (side: Side, pairId: string) => {
    if (locked || matched.has(pairId)) return;
    if (!active || active.side === side) {
      setActive(active && active.side === side && active.pairId === pairId ? null : { side, pairId });
      return;
    }
    const leftId = side === 'left' ? pairId : active.pairId;
    const rightId = side === 'right' ? pairId : active.pairId;
    setActive(null);
    const pair = drill.pairs.find((p) => p.id === leftId);
    if (leftId === rightId) {
      const next = new Set(matched);
      next.add(leftId);
      setMatched(next);
      setAnnouncement(`Matched: ${pair?.leftPrompt ?? ''} with ${pair?.rightMatch ?? ''}.`);
      if (next.size === drill.pairs.length) onAnswer(misses === 0);
      return;
    }
    setMisses((value) => value + 1);
    setAnnouncement('Not a match. Try again.');
    setWrongFlash({ left: leftId, right: rightId });
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setWrongFlash(null), WRONG_FLASH_MS);
  };

  const keyColumn: Side = active?.side === 'left' ? 'right' : 'left';

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
    return false;
  }, !locked);

  const stateFor = (side: Side, pairId: string): TileState => {
    if (matched.has(pairId)) return 'correct';
    if (wrongFlash && wrongFlash[side] === pairId) return 'wrong';
    if (active && active.side === side && active.pairId === pairId) return 'selected';
    return locked ? 'muted' : 'idle';
  };

  const renderColumn = (side: Side, items: typeof leftItems) => (
    <ul aria-label={side === 'left' ? 'Triggers' : 'Matches'} className="space-y-2.5">
      {items.map((pair, index) => {
        const state = stateFor(side, pair.id);
        const isMatched = matched.has(pair.id);
        const text = side === 'left' ? pair.leftPrompt : pair.rightMatch;
        return (
          <li key={pair.id}>
            <button
              type="button"
              disabled={locked || isMatched}
              data-pulse-hotkeys=""
              aria-pressed={state === 'selected'}
              onClick={() => choose(side, pair.id)}
              className={cn(tileClass(state), 'min-h-16 text-sm', state === 'wrong' && 'animate-pulse')}
            >
              {isMatched ? (
                <Check aria-hidden className="size-4 shrink-0 text-pulse-emerald" />
              ) : (
                <TileKey label={keyColumn === side && !locked ? String(index + 1) : '·'} state={state} />
              )}
              <span className="min-w-0 flex-1">{text}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );

  return (
    <div>
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
      <div className="grid grid-cols-2 gap-3 @lg:gap-5">
        <div>
          <p className="pulse-label mb-2">Trigger</p>
          {renderColumn('left', leftItems)}
        </div>
        <div>
          <p className="pulse-label mb-2">Match</p>
          {renderColumn('right', rightItems)}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-pulse-muted">
        <span>
          {locked
            ? 'All pairs matched.'
            : keyColumn === 'left'
              ? 'Pick a trigger on the left (keys 1–4), then its match on the right.'
              : 'Now pick its match on the right (keys 1–4). Esc clears.'}
        </span>
        <span className="pulse-metric">
          {matched.size}/{drill.pairs.length} matched
          {misses > 0 ? <span className="ml-2 text-pulse-crimson">{misses} missed</span> : null}
        </span>
      </div>
    </div>
  );
}
