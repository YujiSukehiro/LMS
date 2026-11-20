'use client';

import { useId, useRef, useState } from 'react';
import { Check, Copy, KeyRound, Loader2 } from 'lucide-react';
import { RosterResetPasswordResponseSchema } from '@/lib/schemas/api';
import { readApiError } from './RosterFormFields';

export function ResetPasswordDialog({
  uid,
  displayName,
  loginIdentifier,
}: {
  uid: string;
  displayName: string;
  loginIdentifier: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<{ loginIdentifier: string; temporaryPassword: string } | null>(null);
  const [copied, setCopied] = useState(false);

  function open(): void {
    setError(null);
    setCredentials(null);
    setCopied(false);
    dialogRef.current?.showModal();
  }

  function close(): void {
    dialogRef.current?.close();
  }

  async function confirmReset(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/roster/${encodeURIComponent(uid)}/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response, 'The password could not be reset.'));
      }
      const parsed = RosterResetPasswordResponseSchema.parse(await response.json());
      setCredentials({
        loginIdentifier: parsed.loginIdentifier,
        temporaryPassword: parsed.temporaryPassword,
      });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'The password could not be reset.');
    } finally {
      setPending(false);
    }
  }

  async function copyCredentials(): Promise<void> {
    if (!credentials) return;
    const text = `Login: ${credentials.loginIdentifier}\nTemporary Password: ${credentials.temporaryPassword}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt('Copy temporary credentials:', text);
    }
  }

  return (
    <>
      <button
        type="button"
        className="pulse-btn px-2.5 py-1 text-xs"
        aria-label={`Reset password for ${displayName}`}
        onClick={open}
      >
        <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
        Reset password
      </button>

      <dialog ref={dialogRef} className="pulse-dialog text-left" aria-labelledby={titleId}>
        <div className="p-6">
          <h2 id={titleId} className="text-lg font-semibold">
            {credentials ? `New password ready for ${displayName}` : `Reset password for ${displayName}?`}
          </h2>

          {credentials ? (
            <div className="mt-4 space-y-3">
              <p className="text-sm text-pulse-secondary">
                Share this one-time temporary password securely. Existing sessions for this account were revoked.
              </p>
              <div className="space-y-1.5 rounded-md border border-pulse-border bg-pulse-surface-2 p-3 text-sm">
                <div>
                  <span className="text-xs text-pulse-muted">Login ID: </span>
                  <span className="pulse-metric font-semibold">{credentials.loginIdentifier}</span>
                </div>
                <div>
                  <span className="text-xs text-pulse-muted">Temporary Password: </span>
                  <span className="pulse-metric font-semibold select-all">{credentials.temporaryPassword}</span>
                </div>
              </div>
              <div role="status" className="text-xs text-pulse-emerald">
                {copied ? 'Credentials copied to clipboard.' : ''}
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" className="pulse-btn" onClick={copyCredentials}>
                  {copied ? (
                    <Check className="h-4 w-4 text-pulse-emerald" aria-hidden="true" />
                  ) : (
                    <Copy className="h-4 w-4" aria-hidden="true" />
                  )}
                  Copy credentials
                </button>
                <button type="button" className="pulse-btn pulse-btn-primary" autoFocus onClick={close}>
                  Done
                </button>
              </div>
            </div>
          ) : (
            <>
              <p className="mt-2 text-sm text-pulse-secondary">
                This immediately replaces the password for <span className="pulse-metric font-medium">{loginIdentifier}</span>{' '}
                and signs out any active browser sessions for this user.
              </p>
              {error ? (
                <p role="alert" className="mt-3 text-sm text-pulse-crimson">
                  {error}
                </p>
              ) : null}
              <div className="mt-6 flex justify-end gap-2">
                <button
                  type="button"
                  className="pulse-btn pulse-btn-ghost"
                  autoFocus
                  onClick={close}
                  disabled={pending}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="pulse-btn pulse-btn-primary"
                  onClick={confirmReset}
                  disabled={pending}
                >
                  {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                  Issue Temporary Password
                </button>
              </div>
            </>
          )}
        </div>
      </dialog>
    </>
  );
}
