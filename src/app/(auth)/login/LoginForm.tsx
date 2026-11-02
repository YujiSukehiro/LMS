'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { GoogleAuthProvider, signInWithEmailAndPassword, signInWithPopup, signOut, type User } from 'firebase/auth';
import { ArrowRight, KeyRound, Loader2, X } from 'lucide-react';
import { establishServerSession, getClientAuth, identifierToEmail } from '@/lib/firebase/client';
import { describeAuthError, isSilentAuthError } from '@/lib/firebase/auth-errors';

type Pending = 'google' | 'password' | null;

function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="h-4 w-4" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

export function LoginForm({ nextPath, notice }: { nextPath: string; notice: string | null }) {
  const router = useRouter();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState('');
  const joinDialogRef = useRef<HTMLDialogElement>(null);

  async function finishSignIn(user: User): Promise<void> {
    try {
      await establishServerSession(user);
    } catch (sessionError) {
      // Do not leave a client sign-in without a server session.
      await signOut(getClientAuth()).catch(() => undefined);
      throw sessionError;
    }
    router.replace(nextPath);
    router.refresh();
  }

  async function handleGoogle(): Promise<void> {
    setError(null);
    setPending('google');
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ hd: 'logicall.io', prompt: 'select_account' });
      const credential = await signInWithPopup(getClientAuth(), provider);
      await finishSignIn(credential.user);
    } catch (signInError) {
      if (!isSilentAuthError(signInError)) setError(describeAuthError(signInError));
      setPending(null);
    }
  }

  async function handlePassword(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    if (!identifier.trim() || !password) {
      setError('Type your LC Number or email, and your password.');
      return;
    }
    setPending('password');
    try {
      const credential = await signInWithEmailAndPassword(getClientAuth(), identifierToEmail(identifier), password);
      await finishSignIn(credential.user);
    } catch (signInError) {
      setError(describeAuthError(signInError));
      setPending(null);
    }
  }

  function handleJoin(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const code = joinCode.trim().toUpperCase();
    if (!code) return;
    joinDialogRef.current?.close();
    router.push(`/join/${encodeURIComponent(code)}`);
  }

  const busy = pending !== null;

  return (
    <div className="pulse-card p-6 sm:p-8">
      <h1 className="text-xl font-semibold tracking-tight">LogiCall Pulse Operations Sign-In</h1>
      <p className="mt-1 text-sm text-pulse-secondary">Campaign readiness, Drills, and Live Call Sims.</p>

      {notice && !error ? (
        <p role="status" className="mt-4 rounded-pulse-md border border-pulse-border bg-pulse-surface-2 px-3 py-2 text-sm text-pulse-secondary">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p
          role="alert"
          className="mt-4 rounded-pulse-md border border-pulse-crimson/50 bg-pulse-crimson/10 px-3 py-2 text-sm text-pulse-crimson"
        >
          {error}
        </p>
      ) : null}

      <button type="button" className="pulse-btn pulse-btn-primary mt-6 w-full justify-center py-2.5" onClick={handleGoogle} disabled={busy}>
        {pending === 'google' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <GoogleMark />}
        Continue with Google (@logicall.io)
      </button>

      <div className="my-6 flex items-center gap-3" role="separator">
        <span className="h-px flex-1 bg-pulse-border" />
        <span className="pulse-label whitespace-nowrap">External Partner &amp; Agent ID Access</span>
        <span className="h-px flex-1 bg-pulse-border" />
      </div>

      <form className="space-y-4" onSubmit={handlePassword} noValidate>
        <div>
          <label htmlFor="login-identifier" className="pulse-label mb-1.5 block">
            LC Number or Email
          </label>
          <input
            id="login-identifier"
            className="pulse-input w-full"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="LC-1042 or name@partner.com"
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
            disabled={busy}
          />
        </div>
        <div>
          <label htmlFor="login-password" className="pulse-label mb-1.5 block">
            Password
          </label>
          <input
            id="login-password"
            type="password"
            className="pulse-input w-full"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={busy}
          />
        </div>
        <button type="submit" className="pulse-btn w-full justify-center py-2.5" disabled={busy}>
          {pending === 'password' ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <KeyRound className="h-4 w-4" aria-hidden="true" />
          )}
          Sign In
        </button>
      </form>

      <button
        type="button"
        className="mt-5 inline-flex w-full items-center justify-center gap-1 text-sm font-medium text-pulse-indigo hover:underline"
        onClick={() => joinDialogRef.current?.showModal()}
      >
        Have a Team Join Code? Claim Access <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </button>

      <dialog ref={joinDialogRef} className="pulse-dialog" aria-labelledby="join-dialog-title">
        <form className="p-6" onSubmit={handleJoin}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 id="join-dialog-title" className="text-lg font-semibold">
                Claim Access with a Join Code
              </h2>
              <p className="mt-1 text-sm text-pulse-secondary">
                Type the Cohort join code that your supervisor gave you (for example THS-7842).
              </p>
            </div>
            <button
              type="button"
              className="pulse-btn pulse-btn-ghost p-1.5"
              aria-label="Close"
              onClick={() => joinDialogRef.current?.close()}
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <label htmlFor="join-code" className="pulse-label mb-1.5 mt-5 block">
            Join Code
          </label>
          <input
            id="join-code"
            className="pulse-input w-full font-mono uppercase"
            autoComplete="off"
            spellCheck={false}
            placeholder="THS-7842"
            value={joinCode}
            onChange={(event) => setJoinCode(event.target.value)}
            required
          />
          <div className="mt-6 flex justify-end gap-2">
            <button type="button" className="pulse-btn pulse-btn-ghost" onClick={() => joinDialogRef.current?.close()}>
              Cancel
            </button>
            <button type="submit" className="pulse-btn pulse-btn-primary" disabled={!joinCode.trim()}>
              Continue <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
