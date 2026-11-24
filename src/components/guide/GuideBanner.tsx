'use client';

import Link from 'next/link';
import { useState } from 'react';
import { BookOpen, X } from 'lucide-react';
import { markGuideSeen } from './guide-banner-cookie';

/** "New here? Read your guide" on Home, until the user dismisses it or opens the Guide. */
export function GuideBanner({ uid, roleLabel }: { uid: string; roleLabel: string }) {
  const [open, setOpen] = useState(true);
  if (!open) return null;
  return (
    <aside
      aria-label="Guide for new users"
      className="pulse-card mb-4 flex flex-wrap items-center gap-3 border-pulse-indigo/40 bg-pulse-indigo/5 px-4 py-3"
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-pulse-md bg-pulse-indigo/15 text-pulse-indigo">
        <BookOpen aria-hidden className="size-4" />
      </span>
      <p className="min-w-0 flex-1 basis-56 text-sm">
        <span className="font-semibold">New here?</span>{' '}
        <span className="text-pulse-secondary">The {roleLabel} guide shows what each page does and how to use it, step by step.</span>
      </p>
      <div className="flex items-center gap-1">
        <Link href="/guide" className="pulse-btn pulse-btn-primary text-sm" onClick={() => markGuideSeen(uid)}>
          Read your guide
        </Link>
        <button
          type="button"
          aria-label="Dismiss"
          className="pulse-btn pulse-btn-ghost p-1.5"
          onClick={() => {
            markGuideSeen(uid);
            setOpen(false);
          }}
        >
          <X aria-hidden className="size-4" />
        </button>
      </div>
    </aside>
  );
}
