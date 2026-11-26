'use client';

import { useState } from 'react';
import { Loader2, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Clears one person's daily Verbal Practice count (POST /api/roster/{uid}/reset-practice-limit). */
export function ResetPracticeButton({
  uid,
  displayName,
  disabled = false,
  compact = false,
  onReset,
}: {
  uid: string;
  displayName: string;
  disabled?: boolean;
  compact?: boolean;
  onReset?: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reset(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/roster/${encodeURIComponent(uid)}/reset-practice-limit`, { method: 'POST' });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? 'The count could not be reset. Try again.');
      }
      onReset?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The count could not be reset. Try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        className={cn('pulse-btn', compact && 'h-8 px-2.5 text-xs')}
        onClick={() => void reset()}
        disabled={pending || disabled}
        aria-label={`Reset today's practice count for ${displayName}`}
      >
        {pending ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <RotateCcw aria-hidden className="size-4" />}
        {compact ? 'Reset' : "Reset today's count"}
      </button>
      {error ? <span role="alert" className="text-xs text-pulse-crimson">{error}</span> : null}
    </span>
  );
}
