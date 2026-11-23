'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { KeyRound, Loader2 } from 'lucide-react';
import { establishServerSession, getClientAuth } from '@/lib/firebase/client';
import { describeAuthError } from '@/lib/firebase/auth-errors';

const MIN_LENGTH = 10;

/** Replace a temporary password, then sign in again with the new one so the session drops the temporary flag. */
export function NewPasswordForm({ email, required }: { email: string; required: boolean }) {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    if (password.length < MIN_LENGTH) return setError(`Use at least ${MIN_LENGTH} characters.`);
    if (password !== confirm) return setError('The two passwords do not match.');
    setPending(true);
    try {
      const response = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ newPassword: password }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? 'The new password could not be saved. Try again.');
      }
      // Old sessions were revoked; sign in again with the new password for a fresh session.
      const auth = getClientAuth();
      await signOut(auth).catch(() => undefined);
      const credential = await signInWithEmailAndPassword(auth, email, password);
      await establishServerSession(credential.user);
      router.replace('/');
      router.refresh();
    } catch (submitError) {
      setError(describeAuthError(submitError));
      setPending(false);
    }
  }

  return (
    <div className="pulse-card p-6 sm:p-8">
      <h1 className="text-xl font-semibold tracking-tight">Choose a new password</h1>
      <p className="mt-1 text-sm text-pulse-secondary">
        {required
          ? 'You signed in with a temporary password. Choose your own password to continue.'
          : 'Choose a new password for your account.'}
      </p>
      {error ? (
        <p role="alert" className="mt-4 rounded-pulse-md border border-pulse-crimson/50 bg-pulse-crimson/10 px-3 py-2 text-sm text-pulse-crimson">
          {error}
        </p>
      ) : null}
      <form className="mt-6 space-y-4" onSubmit={onSubmit} noValidate>
        <div>
          <label htmlFor="new-password" className="pulse-label mb-1.5 block">
            New password
          </label>
          <input
            id="new-password"
            type="password"
            className="pulse-input w-full"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={pending}
            aria-describedby="new-password-hint"
          />
          <p id="new-password-hint" className="mt-1 text-xs text-pulse-muted">
            At least {MIN_LENGTH} characters. Don&apos;t reuse the temporary password.
          </p>
        </div>
        <div>
          <label htmlFor="confirm-password" className="pulse-label mb-1.5 block">
            Type it again
          </label>
          <input
            id="confirm-password"
            type="password"
            className="pulse-input w-full"
            autoComplete="new-password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            disabled={pending}
          />
        </div>
        <button type="submit" className="pulse-btn pulse-btn-primary w-full justify-center py-2.5" disabled={pending}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <KeyRound className="h-4 w-4" aria-hidden="true" />}
          Save password and continue
        </button>
      </form>
    </div>
  );
}
