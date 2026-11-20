'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, UserCheck, UserX } from 'lucide-react';

export function StatusToggleButton({ uid, displayName, active }: { uid: string; displayName: string; active: boolean }) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function open(): void {
    setError(null);
    dialogRef.current?.showModal();
  }

  async function confirm(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/roster/${encodeURIComponent(uid)}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !active }),
      });
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        const record = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
        throw new Error(typeof record.message === 'string' ? record.message : 'The status could not be changed.');
      }
      dialogRef.current?.close();
      router.refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'The status could not be changed.');
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className={active ? 'pulse-btn pulse-btn-danger size-8 min-h-0 p-0' : 'pulse-btn size-8 min-h-0 p-0'}
        title={active ? 'Deactivate' : 'Reactivate'}
        aria-label={`${active ? 'Deactivate' : 'Reactivate'} ${displayName}`}
        onClick={open}
      >
        {active ? <UserX className="h-3.5 w-3.5" aria-hidden="true" /> : <UserCheck className="h-3.5 w-3.5" aria-hidden="true" />}
      </button>
      <dialog ref={dialogRef} className="pulse-dialog text-left" aria-labelledby={`status-title-${uid}`}>
        <div className="p-6">
          <h2 id={`status-title-${uid}`} className="text-lg font-semibold">
            {active ? `Deactivate ${displayName}?` : `Reactivate ${displayName}?`}
          </h2>
          <p className="mt-2 text-sm text-pulse-secondary">
            {active
              ? 'Sign-in stops immediately and all open sessions end. All completions, scores, and Simulation transcripts stay saved.'
              : 'This user can sign in again with the same account. All earlier history is still available.'}
          </p>
          {error ? (
            <p role="alert" className="mt-3 text-sm text-pulse-crimson">
              {error}
            </p>
          ) : null}
          <div className="mt-6 flex justify-end gap-2">
            <button type="button" className="pulse-btn pulse-btn-ghost" onClick={() => dialogRef.current?.close()} disabled={pending}>
              Cancel
            </button>
            <button
              type="button"
              className={active ? 'pulse-btn pulse-btn-danger' : 'pulse-btn pulse-btn-success'}
              onClick={confirm}
              disabled={pending}
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              {active ? 'Deactivate' : 'Reactivate'}
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
