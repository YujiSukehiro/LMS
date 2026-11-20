'use client';

import { useId, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Plus, RefreshCw, X } from 'lucide-react';
import { RosterCohortResponseSchema } from '@/lib/schemas/api';
import type { DivisionId } from '@/lib/schemas/domain';
import { DivisionCheckboxes, readApiError } from './RosterFormFields';

export function CreateCohortDialog() {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const idInputId = useId();
  const idHintId = useId();
  const nameInputId = useId();
  const joinToggleId = useId();

  const [cohortCode, setCohortCode] = useState('');
  const [name, setName] = useState('');
  const [divisionIds, setDivisionIds] = useState<DivisionId[]>(['TELEHEALTH']);
  const [joinCodeEnabled, setJoinCodeEnabled] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function open(): void {
    setCohortCode('');
    setName('');
    setDivisionIds(['TELEHEALTH']);
    setJoinCodeEnabled(true);
    setError(null);
    dialogRef.current?.showModal();
  }

  function close(): void {
    dialogRef.current?.close();
  }

  function toggleDivision(id: DivisionId): void {
    setDivisionIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  }

  async function submit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    const cleanedId = cohortCode.trim().toUpperCase();
    if (!cleanedId || !name.trim()) {
      setError('Enter both a Cohort ID and display name.');
      return;
    }
    if (divisionIds.length === 0) {
      setError('Select at least one default division.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/roster/cohorts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: cleanedId,
          name: name.trim(),
          defaultDivisionIds: divisionIds,
          joinCodeEnabled,
        }),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response, 'The Cohort could not be created.'));
      }
      RosterCohortResponseSchema.parse(await response.json());
      close();
      router.refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'The Cohort could not be created.');
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button type="button" className="pulse-btn px-3 py-1.5 text-xs" onClick={open}>
        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
        New Cohort
      </button>

      <dialog ref={dialogRef} className="pulse-dialog text-left" aria-labelledby={titleId}>
        <form onSubmit={submit} className="flex max-h-[calc(100vh-4rem)] flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-pulse-border-subtle p-6">
            <div>
              <h2 id={titleId} className="text-lg font-semibold">
                Create Partner Cohort
              </h2>
              <p className="mt-1 text-sm text-pulse-secondary">
                Add a new operational BPO team with its own Cohort isolation and join code.
              </p>
            </div>
            <button
              type="button"
              className="pulse-btn pulse-btn-ghost p-2"
              aria-label="Close new cohort modal"
              onClick={close}
              disabled={pending}
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          <div className="space-y-4 overflow-y-auto p-6">
            <div>
              <label htmlFor={idInputId} className="pulse-label mb-1.5 block">
                Cohort ID
              </label>
              <p id={idHintId} className="mb-1.5 text-xs text-pulse-muted">
                2 to 32 uppercase letters, numbers, or underscores (for example BPO_EAST).
              </p>
              <input
                id={idInputId}
                name="cohortId"
                type="text"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                aria-describedby={idHintId}
                required
                autoFocus
                className="pulse-input pulse-metric"
                value={cohortCode}
                onChange={(e) => setCohortCode(e.target.value.toUpperCase())}
              />
            </div>

            <div>
              <label htmlFor={nameInputId} className="pulse-label mb-1.5 block">
                Display name
              </label>
              <input
                id={nameInputId}
                name="cohortName"
                type="text"
                required
                className="pulse-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <DivisionCheckboxes
              name="cohort-divisions"
              legend="Default divisions"
              selected={divisionIds}
              onToggle={toggleDivision}
            />

            <div className="flex items-center gap-2 pt-1 text-sm">
              <input
                id={joinToggleId}
                name="joinCodeEnabled"
                type="checkbox"
                checked={joinCodeEnabled}
                onChange={(e) => setJoinCodeEnabled(e.target.checked)}
                style={{ accentColor: 'var(--pulse-indigo)' }}
                className="h-4 w-4"
              />
              <label htmlFor={joinToggleId} className="cursor-pointer font-medium">
                Enable self-serve Cohort join link on creation
              </label>
            </div>

            {error ? (
              <p role="alert" className="text-sm text-pulse-crimson">
                {error}
              </p>
            ) : null}
          </div>

          <div className="flex justify-end gap-2 border-t border-pulse-border-subtle p-6">
            <button type="button" className="pulse-btn pulse-btn-ghost" onClick={close} disabled={pending}>
              Cancel
            </button>
            <button type="submit" className="pulse-btn pulse-btn-primary" disabled={pending}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              Create Cohort
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}

export function CohortCardActions({
  cohortId,
  cohortName,
  joinCodeEnabled,
}: {
  cohortId: string;
  cohortName: string;
  joinCodeEnabled: boolean;
}) {
  const router = useRouter();
  const [pendingAction, setPendingAction] = useState<'rotate' | 'toggle' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function mutate(payload: { action: 'rotate_join_code' } | { action: 'toggle_join_code'; enabled: boolean }) {
    setPendingAction(payload.action === 'rotate_join_code' ? 'rotate' : 'toggle');
    setError(null);
    try {
      const response = await fetch(`/api/roster/cohorts/${encodeURIComponent(cohortId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response, 'The Cohort setting could not be updated.'));
      }
      RosterCohortResponseSchema.parse(await response.json());
      router.refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Update failed.');
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          className="pulse-btn pulse-btn-ghost px-2 py-1 text-xs"
          aria-label={`Rotate code for ${cohortName}`}
          disabled={pendingAction !== null}
          onClick={() => void mutate({ action: 'rotate_join_code' })}
        >
          {pendingAction === 'rotate' ? (
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw className="h-3 w-3" aria-hidden="true" />
          )}
          Rotate code
        </button>
        <button
          type="button"
          className="pulse-btn pulse-btn-ghost px-2 py-1 text-xs"
          aria-label={`${joinCodeEnabled ? 'Disable join' : 'Enable join'} for ${cohortName}`}
          disabled={pendingAction !== null}
          onClick={() => void mutate({ action: 'toggle_join_code', enabled: !joinCodeEnabled })}
        >
          {joinCodeEnabled ? 'Disable join' : 'Enable join'}
        </button>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-pulse-crimson">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function RevokeInviteButton({ inviteId, displayName }: { inviteId: string; displayName: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function revoke(): Promise<void> {
    setPending(true);
    try {
      const response = await fetch(`/api/roster/invites/${encodeURIComponent(inviteId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'REVOKED' }),
      });
      if (response.ok) router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      className="pulse-btn pulse-btn-danger px-2.5 py-1 text-xs"
      aria-label={`Revoke invite for ${displayName}`}
      onClick={() => void revoke()}
      disabled={pending}
    >
      {pending ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : null}
      Revoke
    </button>
  );
}

export function BootstrapCohortsButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function bootstrap(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/roster/cohorts/bootstrap', { method: 'POST' });
      if (!response.ok) {
        throw new Error(await readApiError(response, 'Default Cohorts could not be initialized.'));
      }
      router.refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Default Cohorts could not be initialized.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-1.5">
      <button
        type="button"
        className="pulse-btn pulse-btn-primary text-xs"
        onClick={() => void bootstrap()}
        disabled={pending}
      >
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Plus className="h-3.5 w-3.5" aria-hidden="true" />}
        Initialize 8 Default Cohorts
      </button>
      {error ? (
        <p role="alert" className="text-xs text-pulse-crimson">
          {error}
        </p>
      ) : null}
    </div>
  );
}
