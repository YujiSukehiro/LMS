'use client';

import { CornerDownLeft } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Common props of every per-kind Drill component. */
export interface DrillViewProps<D> {
  drill: D;
  /** Seed for deterministic option shuffles. */
  seed: string;
  /** true once the answer is checked: the Drill shows the result and stops taking input. */
  locked: boolean;
  /** Called once with the result of this attempt. */
  onAnswer: (correct: boolean) => void;
}

export type TileState = 'idle' | 'selected' | 'correct' | 'wrong' | 'muted';

/** Tactile tile styling shared by all Drill kinds (thick bottom edge, press-down on click). */
export function tileClass(state: TileState): string {
  return cn(
    'group relative flex w-full items-center gap-3 rounded-pulse-lg border-2 border-b-4 px-4 py-3.5 text-left text-[0.95rem] font-medium',
    'transition-[background-color,border-color,transform,color] duration-150 active:translate-y-0.5 active:border-b-2',
    'disabled:cursor-default disabled:active:translate-y-0 disabled:active:border-b-4',
    state === 'idle' &&
      'cursor-pointer border-pulse-border bg-pulse-surface-2 text-pulse-primary hover:border-pulse-indigo/60 hover:bg-pulse-elevated',
    state === 'selected' && 'cursor-pointer border-pulse-indigo bg-pulse-indigo/15 text-pulse-primary',
    state === 'correct' && 'border-pulse-emerald bg-pulse-emerald/15 text-pulse-primary',
    state === 'wrong' && 'border-pulse-crimson bg-pulse-crimson/15 text-pulse-primary',
    state === 'muted' && 'border-pulse-border-subtle bg-pulse-surface-1 text-pulse-muted',
  );
}

/** Small key-number badge inside a tile. */
export function TileKey({ label, state }: { label: string; state: TileState }) {
  return (
    <span
      aria-hidden
      className={cn(
        'pulse-kbd shrink-0',
        state === 'selected' && 'border-pulse-indigo text-pulse-indigo',
        state === 'correct' && 'border-pulse-emerald text-pulse-emerald',
        state === 'wrong' && 'border-pulse-crimson text-pulse-crimson',
      )}
    >
      {label}
    </span>
  );
}

/** "Check" submit row shown under a Drill until the answer is checked. */
export function DrillCheckButton({
  onCheck,
  disabled,
  hint,
}: {
  onCheck: () => void;
  disabled: boolean;
  hint?: string;
}) {
  return (
    <div className="mt-5 flex flex-col-reverse items-stretch gap-3 @md:flex-row @md:items-center @md:justify-between">
      <p className="text-xs text-pulse-muted">{hint}</p>
      <button
        type="button"
        onClick={onCheck}
        disabled={disabled}
        data-pulse-hotkeys=""
        className="pulse-btn pulse-btn-primary px-8 py-3 text-base"
      >
        Check
        <CornerDownLeft aria-hidden className="size-4" />
      </button>
    </div>
  );
}

/** Normalizes a word for FILL_BLANK_CHOICE comparison. */
export function normalizeWord(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}
