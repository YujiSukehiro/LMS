'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { GoogleAuthProvider, signInWithEmailAndPassword, signInWithPopup, signOut, type User } from 'firebase/auth';
import { KeyRound, Loader2 } from 'lucide-react';
import { establishServerSession, getClientAuth } from '@/lib/firebase/client';
import { describeAuthError, isSilentAuthError } from '@/lib/firebase/auth-errors';
import { AcceptInviteResponseSchema } from '@/lib/schemas/api';

/** First-time setup: choose a password for the invited email, or use a Google account with that same email. */
export function InviteSetupForm({ token, email }: { token: string; email: string }) {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pending, setPending] = useState<'password' | 'google' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function finish(user: User): Promise<void> {
    try {
      await establishServerSession(user);
    } catch (sessionError) {
      await signOut(getClientAuth()).catch(() => undefined);
      throw sessionError;
    }
    router.replace('/');
    router.refresh();
  }

  async function createAccount(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (password.length < 8) return setError('Use a password with 8 characters or more.');
    if (password !== confirm) return setError('The two passwords are not the same.');
    setError(null);
    setPending('password');
    try {
      const response = await fetch('/api/auth/accept-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const record = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
        throw new Error(typeof record.message === 'string' ? record.message : 'Your account could not be created. Try again.');
      }
      const { emailForSignIn } = AcceptInviteResponseSchema.parse(body);
      const credential = await signInWithEmailAndPassword(getClientAuth(), emailForSignIn, password);
      await finish(credential.user);
    } catch (setupError) {
      setError(setupError instanceof Error && !('code' in setupError) ? setupError.message : describeAuthError(setupError));
      setPending(null);
    }
  }

  async function signInWithInvitedGoogle(): Promise<void> {
    setError(null);
    setPending('google');
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account', login_hint: email });
      const credential = await signInWithPopup(getClientAuth(), provider);
      if ((credential.user.email ?? '').toLowerCase() !== email.toLowerCase()) {
        // Never delete here: the picked account may be a real, existing user. Just sign it out of this tab.
        await signOut(getClientAuth()).catch(() => undefined);
        throw new Error(`Pick the Google account for ${email}. This invite only works for that address.`);
      }
      await finish(credential.user);
    } catch (googleError) {
      if (!isSilentAuthError(googleError)) {
        setError(googleError instanceof Error && !('code' in googleError) ? googleError.message : describeAuthError(googleError));
      }
      setPending(null);
    }
  }

  return (
    <div className="mt-5 space-y-5">
      <form onSubmit={createAccount} className="space-y-3">
        <div>
          <label className="pulse-label mb-1.5 block" htmlFor="invite-email">Email</label>
          <input id="invite-email" className="pulse-input" value={email} readOnly autoComplete="username" />
        </div>
        <div>
          <label className="pulse-label mb-1.5 block" htmlFor="invite-password">Choose a password</label>
          <input
            id="invite-password"
            type="password"
            className="pulse-input"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={pending !== null}
          />
        </div>
        <div>
          <label className="pulse-label mb-1.5 block" htmlFor="invite-confirm">Confirm password</label>
          <input
            id="invite-confirm"
            type="password"
            className="pulse-input"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            disabled={pending !== null}
          />
        </div>
        {error ? <p role="alert" className="text-sm text-pulse-crimson">{error}</p> : null}
        <button type="submit" className="pulse-btn pulse-btn-primary w-full" disabled={pending !== null}>
          {pending === 'password' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <KeyRound className="h-4 w-4" aria-hidden="true" />}
          Create my account
        </button>
      </form>
      <div className="flex items-center gap-3 text-xs text-pulse-muted">
        <span className="h-px flex-1 bg-pulse-border-subtle" /> or <span className="h-px flex-1 bg-pulse-border-subtle" />
      </div>
      <button type="button" className="pulse-btn w-full" onClick={() => void signInWithInvitedGoogle()} disabled={pending !== null}>
        {pending === 'google' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
        Use my Google account ({email})
      </button>
    </div>
  );
}
