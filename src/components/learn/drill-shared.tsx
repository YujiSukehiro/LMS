'use client';

import { CornerDownLeft, LoaderCircle } from 'lucide-react';
import type { DrillAnswerResponse } from '@/lib/schemas/api';
import type { DrillAnswer } from '@/lib/schemas/learning';
import { cn } from '@/lib/utils';

/** Common props of every per-kind Drill component. */
export interface DrillViewProps<D, A extends DrillAnswer = DrillAnswer> {
  drill: D;
  /** Seed for deterministic option shuffles. */
  seed: string;
  /** Stops input while the server grades and after feedback arrives. */
  locked: boolean;
  /** True while either the start or answer request is in flight. */
  busy: boolean;
  /** Server grading for the current answer, or null while answering/retrying. */
  result: DrillAnswerResponse | null;
  /** Sends a learner answer to the runner; correctness is never decided here. */
  onAnswer: (answer: A) => void;
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

/** "Check" submit row shown under a Drill until server feedback arrives. */
export function DrillCheckButton({
  onCheck,
  disabled,
  busy = false,
  hint,
}: {
  onCheck: () => void;
  disabled: boolean;
  busy?: boolean;
  hint?: string;
}) {
  return (
    <div className="mt-5 flex flex-col-reverse items-stretch gap-3 @md:flex-row @md:items-center @md:justify-between">
      <p className="text-xs text-pulse-muted">{busy ? 'Waiting for the server to grade your answer…' : hint}</p>
      <button
        type="button"
        onClick={onCheck}
        disabled={disabled || busy}
        aria-busy={busy}
        data-pulse-hotkeys=""
        className="pulse-btn pulse-btn-primary px-8 py-3 text-base"
      >
        {busy ? 'Checking…' : 'Check'}
        {busy ? (
          <LoaderCircle aria-hidden className="size-4 animate-spin" />
        ) : (
          <CornerDownLeft aria-hidden className="size-4" />
        )}
      </button>
    </div>
  );
}

/** Stable key generated in the browser; retained by the caller across retries. */
export function createIdempotencyKey(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  if (globalThis.crypto?.getRandomValues) {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}
