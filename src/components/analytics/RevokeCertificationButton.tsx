'use client';

import { useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, ShieldOff, X } from 'lucide-react';

/**
 * Revoke a learner's certification for one Track (Connor 2026-11-24: Admins and Trainers need a way to take a
 * certification back, for example after a compliance problem). The reason is kept in the certification history.
 */
export function RevokeCertificationButton({ learnerId, trackId, trackTitle, learnerName }: { learnerId: string; trackId: string; trackTitle: string; learnerName: string }) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const reasonId = useId();
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function revoke(): Promise<void> {
    if (!reason.trim()) {
      setError('Write the reason. It is kept in the certification history.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/certifications/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ learnerId, trackId, reason: reason.trim() }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? 'The certification was not revoked.');
      }
      dialogRef.current?.close();
      router.refresh();
    } catch (revokeError) {
      setError(revokeError instanceof Error ? revokeError.message : 'The certification was not revoked.');
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="pulse-btn pulse-btn-ghost px-2 py-1 text-xs text-pulse-crimson"
        aria-label={`Revoke ${trackTitle} certification for ${learnerName}`}
        onClick={() => {
          setReason('');
          setError(null);
          dialogRef.current?.showModal();
        }}
      >
        <ShieldOff className="h-3.5 w-3.5" aria-hidden="true" />
        Revoke
      </button>
      <dialog ref={dialogRef} className="pulse-dialog text-left" aria-labelledby={titleId}>
        <div className="flex items-start justify-between gap-4 border-b border-pulse-border-subtle p-5">
          <div>
            <h2 id={titleId} className="text-lg font-semibold">
              Revoke certification
            </h2>
            <p className="mt-1 text-xs text-pulse-muted">
              {learnerName} · {trackTitle}
            </p>
          </div>
          <button type="button" className="pulse-btn pulse-btn-ghost p-2" aria-label="Close" onClick={() => dialogRef.current?.close()} disabled={pending}>
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="flex flex-col gap-3 p-5">
          <p className="text-sm text-pulse-secondary">
            They will no longer count as certified or ready for calls on this Track. Their training history stays. The reason and
            your name are recorded.
          </p>
          <label htmlFor={reasonId} className="pulse-label">
            Reason
          </label>
          <textarea
            id={reasonId}
            className="pulse-input min-h-24"
            maxLength={1000}
            placeholder="For example: compliance violation on 11/20 call, or policy changed"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          {error ? (
            <p role="alert" className="text-sm text-pulse-crimson">
              {error}
            </p>
          ) : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-pulse-border-subtle p-5">
          <button type="button" className="pulse-btn pulse-btn-ghost" onClick={() => dialogRef.current?.close()} disabled={pending}>
            Cancel
          </button>
          <button type="button" className="pulse-btn pulse-btn-danger" onClick={revoke} disabled={pending}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ShieldOff className="h-4 w-4" aria-hidden="true" />}
            Revoke certification
          </button>
        </div>
      </dialog>
    </>
  );
}
