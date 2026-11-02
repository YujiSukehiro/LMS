'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { Loader2, UserPlus } from 'lucide-react';
import { establishServerSession, getClientAuth } from '@/lib/firebase/client';
import { describeAuthError } from '@/lib/firebase/auth-errors';
import { ClaimInviteResponseSchema } from '@/lib/schemas/api';
import { LC_ID_PATTERN } from '@/lib/schemas/constants';

export function JoinForm({ joinCode, cohortName }: { joinCode: string; cohortName: string | null }) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState('');
  const [lcNumber, setLcNumber] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function validate(): string | null {
    if (!displayName.trim()) return 'Type your full name.';
    if (!LC_ID_PATTERN.test(lcNumber.trim())) return 'Type your LC Number in the format LC-1042.';
    if (password.length < 8) return 'Use a password with 8 characters or more.';
    if (password !== confirmPassword) return 'The two passwords are not the same.';
    return null;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setPending(true);
    try {
      const response = await fetch('/api/auth/claim-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          joinCode,
          displayName: displayName.trim(),
          lcNumber: lcNumber.trim().toUpperCase(),
          password,
        }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const record = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
        const code = typeof record.error === 'string' ? record.error : null;
        const message = typeof record.message === 'string' ? record.message : null;
        throw Object.assign(new Error(message ?? 'Your account could not be created. Try again.'), {
          code: code && code !== 'VALIDATION_FAILED' ? code : undefined,
        });
      }
      const { emailForSignIn } = ClaimInviteResponseSchema.parse(body);
      const auth = getClientAuth();
      const credential = await signInWithEmailAndPassword(auth, emailForSignIn, password);
      try {
        await establishServerSession(credential.user);
      } catch (sessionError) {
        await signOut(auth).catch(() => undefined);
        throw sessionError;
      }
      router.replace('/');
      router.refresh();
    } catch (claimError) {
      setError(describeAuthError(claimError));
      setPending(false);
    }
  }

  return (
    <div className="pulse-card p-6 sm:p-8">
      <h1 className="text-xl font-semibold tracking-tight">Claim Your Agent Access</h1>
      <p className="mt-1 text-sm text-pulse-secondary">
        {cohortName ? (
          <>
            You are joining the <span className="font-medium text-pulse-primary">{cohortName}</span> Cohort.
          </>
        ) : (
          'Create your LogiCall Pulse account with your Cohort join code.'
        )}
      </p>

      <div className="mt-4 flex items-center justify-between rounded-pulse-md border border-pulse-border bg-pulse-surface-2 px-3 py-2">
        <span className="pulse-label">Cohort Join Code</span>
        <span className="pulse-metric text-sm font-semibold text-pulse-indigo">{joinCode}</span>
      </div>

      {error ? (
        <p
          role="alert"
          className="mt-4 rounded-pulse-md border border-pulse-crimson/50 bg-pulse-crimson/10 px-3 py-2 text-sm text-pulse-crimson"
        >
          {error}
        </p>
      ) : null}

      <form className="mt-5 space-y-4" onSubmit={handleSubmit} noValidate>
        <div>
          <label htmlFor="join-name" className="pulse-label mb-1.5 block">
            Full Name
          </label>
          <input
            id="join-name"
            className="pulse-input w-full"
            autoComplete="name"
            maxLength={100}
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            disabled={pending}
          />
        </div>
        <div>
          <label htmlFor="join-lc" className="pulse-label mb-1.5 block">
            LC Number
          </label>
          <input
            id="join-lc"
            className="pulse-input w-full font-mono uppercase"
            autoComplete="username"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder="LC-1042"
            value={lcNumber}
            onChange={(event) => setLcNumber(event.target.value)}
            disabled={pending}
          />
        </div>
        <div>
          <label htmlFor="join-password" className="pulse-label mb-1.5 block">
            Password
          </label>
          <input
            id="join-password"
            type="password"
            className="pulse-input w-full"
            autoComplete="new-password"
            minLength={8}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={pending}
          />
        </div>
        <div>
          <label htmlFor="join-confirm" className="pulse-label mb-1.5 block">
            Confirm Password
          </label>
          <input
            id="join-confirm"
            type="password"
            className="pulse-input w-full"
            autoComplete="new-password"
            minLength={8}
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            disabled={pending}
          />
        </div>
        <button type="submit" className="pulse-btn pulse-btn-primary w-full justify-center py-2.5" disabled={pending}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <UserPlus className="h-4 w-4" aria-hidden="true" />}
          Create Account &amp; Sign In
        </button>
      </form>

      <p className="mt-5 text-center text-sm text-pulse-muted">
        Already have an account?{' '}
        <Link href="/login" className="font-medium text-pulse-indigo hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
