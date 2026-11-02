'use client';

import Link from 'next/link';
import { RotateCcw, TriangleAlert } from 'lucide-react';

export default function LearnError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="pulse-card-elevated mx-auto flex max-w-xl flex-col items-center gap-4 p-8 text-center">
      <TriangleAlert aria-hidden className="size-8 text-pulse-amber" />
      <div>
        <h1 className="text-lg font-bold">This Track could not load</h1>
        <p className="mt-1 text-sm text-pulse-secondary">
          Something went wrong while loading your training. Try again, or go back to Home.
        </p>
        {error.digest ? <p className="pulse-metric mt-2 text-xs text-pulse-muted">Reference: {error.digest}</p> : null}
      </div>
      <div className="flex gap-2">
        <Link href="/" className="pulse-btn">
          Back to Home
        </Link>
        <button type="button" className="pulse-btn pulse-btn-primary" onClick={reset}>
          <RotateCcw aria-hidden className="size-4" />
          Try Again
        </button>
      </div>
    </div>
  );
}
