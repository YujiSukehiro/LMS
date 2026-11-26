'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Headset, Loader2, RotateCcw } from 'lucide-react';
import { SIM_COPY } from '@/lib/policy/training-policy';
import { cn } from '@/lib/utils';

/**
 * Today's Verbal Practice count for one agent, with a Reset for staff who manage them (Connor 2026-11-26: agents
 * must finish required trainings to work, so nobody should wait for the midnight-UTC reset).
 */
export function PracticeLimitCard({
  uid,
  displayName,
  counted: serverCounted,
  limit,
  canReset,
  resetToday: serverResetToday,
}: {
  uid: string;
  displayName: string;
  counted: number;
  limit: number;
  canReset: boolean;
  resetToday: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  // After a reset, show the new state right away instead of waiting for the server refresh.
  const counted = done ? 0 : serverCounted;
  const resetToday = done || serverResetToday;
  const atLimit = counted >= limit;

  async function reset(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/roster/${encodeURIComponent(uid)}/reset-practice-limit`, { method: 'POST' });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? 'The count could not be reset. Try again.');
      }
      setDone(true);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The count could not be reset. Try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <section aria-label={`${SIM_COPY.singular} today`} className="pulse-card flex flex-wrap items-center gap-3 p-4">
      <Headset aria-hidden className={cn('size-5 shrink-0', atLimit ? 'text-pulse-amber' : 'text-pulse-muted')} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">
          {SIM_COPY.singular} calls today: <span className="pulse-metric">{counted}</span> of <span className="pulse-metric">{limit}</span>
          {atLimit ? <span className="pulse-pill pulse-pill-amber ml-2">Limit reached</span> : null}
        </p>
        <p className="text-xs text-pulse-muted">
          Calls with fewer than 2 replies do not count. The count resets at midnight UTC
          {resetToday ? '; it was already reset by staff today.' : '.'}
        </p>
        {error ? <p role="alert" className="mt-1 text-xs text-pulse-crimson">{error}</p> : null}
        {done && !error ? <p role="status" className="mt-1 text-xs text-pulse-emerald">Reset. {displayName} can practice again now.</p> : null}
      </div>
      {canReset ? (
        <button type="button" className="pulse-btn" onClick={() => void reset()} disabled={pending || counted === 0}>
          {pending ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <RotateCcw aria-hidden className="size-4" />}
          Reset today&apos;s count
        </button>
      ) : null}
    </section>
  );
}
