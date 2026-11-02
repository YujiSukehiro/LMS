'use client';

import { useState } from 'react';
import { Check, MessageSquareQuote, X } from 'lucide-react';
import type { TrueFalseSpotDrill as TrueFalseSpotDrillItem } from '@/lib/schemas/curriculum';
import { cn } from '@/lib/utils';
import { DrillCheckButton, TileKey, tileClass, type DrillViewProps, type TileState } from './drill-shared';
import { useHotkeys } from './useHotkeys';

type Verdict = 'compliant' | 'violation';

/** TRUE_FALSE_SPOT: an agent quote or action + two verdict buttons. */
export function TrueFalseSpotDrill({ drill, locked, onAnswer }: DrillViewProps<TrueFalseSpotDrillItem>) {
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const correctVerdict: Verdict = drill.isCompliant ? 'compliant' : 'violation';

  const check = () => {
    if (locked || !verdict) return;
    onAnswer(verdict === correctVerdict);
  };

  useHotkeys((event) => {
    if (event.key === '1') {
      setVerdict('compliant');
      return true;
    }
    if (event.key === '2') {
      setVerdict('violation');
      return true;
    }
    if (event.key === 'Enter') {
      check();
      return true;
    }
    return false;
  }, !locked);

  const stateFor = (value: Verdict): TileState => {
    if (!locked) return value === verdict ? 'selected' : 'idle';
    if (value === correctVerdict) return 'correct';
    if (value === verdict) return 'wrong';
    return 'muted';
  };

  const verdicts: Array<{ value: Verdict; label: string; key: string }> = [
    { value: 'compliant', label: 'Policy Compliant', key: '1' },
    { value: 'violation', label: 'Policy Violation', key: '2' },
  ];

  return (
    <div>
      <blockquote className="flex gap-3 rounded-pulse-lg border border-pulse-border bg-pulse-bg px-4 py-4 text-[1.02rem] leading-relaxed text-pulse-primary">
        <MessageSquareQuote aria-hidden className="mt-1 size-5 shrink-0 text-pulse-muted" />
        <p className="italic">&ldquo;{drill.statement}&rdquo;</p>
      </blockquote>

      <div role="radiogroup" aria-label="Verdict" className="mt-4 grid gap-3 @md:grid-cols-2">
        {verdicts.map(({ value, label, key }) => {
          const state = stateFor(value);
          const isCompliant = value === 'compliant';
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={verdict === value}
              disabled={locked}
              data-pulse-hotkeys=""
              onClick={() => setVerdict(value)}
              className={cn(tileClass(state), 'justify-center py-5 text-base font-bold')}
            >
              <TileKey label={key} state={state} />
              <span
                className={cn(
                  'inline-flex items-center gap-2',
                  state === 'idle' && (isCompliant ? 'text-pulse-emerald' : 'text-pulse-crimson'),
                )}
              >
                {isCompliant ? <Check aria-hidden className="size-5" /> : <X aria-hidden className="size-5" />}
                {label}
              </span>
            </button>
          );
        })}
      </div>

      {!locked ? (
        <DrillCheckButton onCheck={check} disabled={!verdict} hint="Press 1 or 2 to pick a verdict, then Enter." />
      ) : null}
    </div>
  );
}
