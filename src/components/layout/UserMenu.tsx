'use client';

import { emailToLcNumber } from '@/lib/firebase/lc-id';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { BookOpen, ChevronDown, LoaderCircle, LogOut } from 'lucide-react';
import { signOutEverywhere } from '@/lib/firebase/client';
import { AnchoredPopover } from './AnchoredPopover';
import { ThemeSwitcher } from './ThemeSwitcher';

export function UserMenu({ uid, displayName, email }: { uid: string; displayName: string; email: string }) {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

  async function handleSignOut() {
    setSigningOut(true);
    setError(null);
    try {
      await signOutEverywhere();
      router.replace('/login');
      router.refresh();
    } catch {
      setSigningOut(false);
      setError('Sign-out did not complete. Try again.');
    }
  }

  return (
    <AnchoredPopover
      align="end"
      triggerLabel={`Account menu for ${displayName}`}
      triggerClassName="flex items-center gap-2 rounded-pulse-md px-1.5 py-1 hover:bg-pulse-surface-2"
      trigger={
        <>
          <span className="flex size-8 items-center justify-center rounded-full bg-pulse-surface-2 text-xs font-bold text-pulse-secondary ring-1 ring-pulse-border">
            {initials || '?'}
          </span>
          <span className="hidden max-w-40 truncate text-sm font-medium md:inline">{displayName}</span>
          <ChevronDown aria-hidden className="size-4 text-pulse-muted" />
        </>
      }
      panelClassName="w-72"
    >
      {(close) => (
        <div className="flex flex-col gap-1">
          <div className="border-b border-pulse-border px-2.5 pb-2 pt-1.5">
            <p className="truncate text-sm font-semibold">{displayName}</p>
            {/* QA L3: LC-ID agents see their LC Number, never the internal sign-in address. */}
            <p className="pulse-metric truncate text-xs text-pulse-muted">{emailToLcNumber(email) ?? email}</p>
          </div>
          <ThemeSwitcher uid={uid} className="border-b border-pulse-border pb-2 pt-1" />
          <Link
            href="/how-to"
            onClick={close}
            className="flex items-center gap-2 rounded-pulse-sm px-2.5 py-2 text-sm text-pulse-secondary hover:bg-pulse-elevated"
          >
            <BookOpen aria-hidden className="size-4" />
            How To
          </Link>
          <button
            type="button"
            onClick={handleSignOut}
            disabled={signingOut}
            className="flex items-center gap-2 rounded-pulse-sm px-2.5 py-2 text-left text-sm text-pulse-secondary hover:bg-pulse-elevated disabled:opacity-60"
          >
            {signingOut ? (
              <LoaderCircle aria-hidden className="size-4 animate-spin" />
            ) : (
              <LogOut aria-hidden className="size-4" />
            )}
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
          {error ? (
            <p role="alert" className="px-2.5 pb-1 text-xs text-pulse-crimson">
              {error}
            </p>
          ) : null}
        </div>
      )}
    </AnchoredPopover>
  );
}
