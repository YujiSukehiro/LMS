'use client';

import { useEffect } from 'react';
import { RotateCw, TriangleAlert } from 'lucide-react';

/** Shared body for route `error.tsx` files. */
export function RouteError({ error, reset, area }: { error: Error & { digest?: string }; reset: () => void; area: string }) {
  useEffect(() => {
    console.error(`[pulse] ${area} error`, error);
  }, [area, error]);
  return (
    <div role="alert" className="mx-auto mt-10 flex max-w-lg flex-col items-center gap-3 rounded-pulse-lg border border-pulse-crimson/40 bg-pulse-crimson/5 p-8 text-center">
      <TriangleAlert aria-hidden className="size-8 text-pulse-crimson" />
      <p className="text-base font-semibold">{area} did not load</p>
      <p className="text-sm text-pulse-muted">
        Pulse could not read the data for this page. Try again. If the problem continues, tell your LogiCall administrator.
      </p>
      {error.digest ? <p className="pulse-metric text-xs text-pulse-muted">Reference: {error.digest}</p> : null}
      <button type="button" className="pulse-btn" onClick={reset}>
        <RotateCw aria-hidden className="size-4" />
        Try again
      </button>
    </div>
  );
}
