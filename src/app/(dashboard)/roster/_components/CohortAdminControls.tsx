'use client';

import { useId, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Copy, Loader2, Pencil, Plus, RefreshCw, Trash2, X } from 'lucide-react';
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

/** Rename a Cohort and change its default Divisions (internal Cohort included). */
export function EditCohortDialog({
  cohortId,
  cohortName,
  defaultDivisionIds,
}: {
  cohortId: string;
  cohortName: string;
  defaultDivisionIds: DivisionId[];
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const nameId = useId();
  const [name, setName] = useState(cohortName);
  const [divisionIds, setDivisionIds] = useState<DivisionId[]>(defaultDivisionIds);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function open(): void {
    setName(cohortName);
    setDivisionIds(defaultDivisionIds);
    setError(null);
    dialogRef.current?.showModal();
  }

  async function submit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (name.trim().length < 2) return setError('Enter a name with at least 2 characters.');
    if (divisionIds.length === 0) return setError('Select at least one Division.');
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/roster/cohorts/${encodeURIComponent(cohortId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update_details', name: name.trim(), defaultDivisionIds: divisionIds }),
      });
      if (!response.ok) throw new Error(await readApiError(response, 'The Cohort could not be saved.'));
      RosterCohortResponseSchema.parse(await response.json());
      dialogRef.current?.close();
      router.refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'The Cohort could not be saved.');
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="pulse-btn pulse-btn-ghost size-7 min-h-0 p-0"
        aria-label={`Edit ${cohortName}`}
        title="Edit Cohort"
        onClick={open}
      >
        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      <dialog ref={dialogRef} className="pulse-dialog text-left" aria-labelledby={titleId}>
        <form onSubmit={submit} className="flex flex-col">
          <div className="border-b border-pulse-border-subtle p-5">
            <h2 id={titleId} className="text-lg font-semibold">Edit {cohortName}</h2>
            <p className="mt-0.5 text-xs text-pulse-muted">
              Cohort ID <span className="pulse-metric">{cohortId}</span> stays the same.
            </p>
          </div>
          <div className="space-y-4 p-5">
            <div>
              <label htmlFor={nameId} className="pulse-label mb-1.5 block">Display name</label>
              <input id={nameId} className="pulse-input" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <DivisionCheckboxes
              name={`edit-divisions-${cohortId}`}
              legend="Default divisions"
              selected={divisionIds}
              onToggle={(id) => setDivisionIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]))}
            />
            {error ? <p role="alert" className="text-sm text-pulse-crimson">{error}</p> : null}
          </div>
          <div className="flex justify-end gap-2 border-t border-pulse-border-subtle p-5">
            <button type="button" className="pulse-btn pulse-btn-ghost" onClick={() => dialogRef.current?.close()} disabled={pending}>
              Cancel
            </button>
            <button type="submit" className="pulse-btn pulse-btn-primary" disabled={pending}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              Save
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}

/** Delete an empty Cohort after a typed confirmation; the server refuses while users, invites or sole Track assignments remain. */
export function DeleteCohortDialog({
  cohortId,
  cohortName,
  memberCount,
}: {
  cohortId: string;
  cohortName: string;
  memberCount: number;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const confirmId = useId();
  const [typed, setTyped] = useState('');
  const [copied, setCopied] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function open(): void {
    setTyped('');
    setCopied(false);
    setError(null);
    dialogRef.current?.showModal();
  }

  async function copyId(): Promise<void> {
    try {
      await navigator.clipboard.writeText(cohortId);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Copy is blocked in this browser. Type the ID instead.');
    }
  }

  async function remove(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/roster/cohorts/${encodeURIComponent(cohortId)}`, { method: 'DELETE' });
      if (!response.ok) throw new Error(await readApiError(response, 'The Cohort could not be deleted.'));
      dialogRef.current?.close();
      router.refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'The Cohort could not be deleted.');
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="pulse-btn pulse-btn-ghost size-7 min-h-0 p-0 text-pulse-crimson"
        aria-label={`Delete ${cohortName}`}
        title="Delete Cohort"
        onClick={open}
      >
        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      <dialog ref={dialogRef} className="pulse-dialog text-left" aria-labelledby={titleId}>
        <div className="p-5">
          <h2 id={titleId} className="text-lg font-semibold">Delete {cohortName}?</h2>
          {memberCount > 0 ? (
            <p className="mt-2 text-sm text-pulse-secondary">
              <span className="pulse-metric">{memberCount}</span> user{memberCount === 1 ? '' : 's'} still belong
              {memberCount === 1 ? 's' : ''} to this Cohort. Move {memberCount === 1 ? 'them' : 'them all'} to another Cohort with
              <span className="font-medium"> Access</span> before deleting.
            </p>
          ) : (
            <>
              <p className="mt-2 text-sm text-pulse-secondary">
                This removes the Cohort and its join code. Tracks assigned to it will no longer list it. This cannot be undone.
              </p>
              <div className="mb-1.5 mt-4 flex flex-wrap items-center gap-1.5 text-sm text-pulse-secondary">
                <label htmlFor={confirmId}>Type</label>
                <button
                  type="button"
                  onClick={() => void copyId()}
                  title="Click to copy"
                  aria-label={`Copy Cohort ID ${cohortId}`}
                  className="inline-flex items-center gap-1 rounded-pulse-sm border border-pulse-border bg-pulse-surface-2 px-1.5 py-0.5 pulse-metric text-sm font-bold text-pulse-primary hover:border-pulse-indigo hover:text-pulse-indigo-text"
                >
                  {cohortId}
                  {copied ? <Check className="h-3.5 w-3.5 text-pulse-emerald" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5 text-pulse-muted" aria-hidden="true" />}
                </button>
                <span>to confirm</span>
                <span role="status" className="text-xs text-pulse-emerald">
                  {copied ? 'Copied' : ''}
                </span>
              </div>
              <input
                id={confirmId}
                className="pulse-input pulse-metric"
                autoComplete="off"
                value={typed}
                onChange={(e) => setTyped(e.target.value.toUpperCase())}
              />
            </>
          )}
          {error ? <p role="alert" className="mt-3 text-sm text-pulse-crimson">{error}</p> : null}
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" className="pulse-btn pulse-btn-ghost" onClick={() => dialogRef.current?.close()} disabled={pending}>
              Cancel
            </button>
            <button
              type="button"
              className="pulse-btn pulse-btn-danger"
              onClick={() => void remove()}
              disabled={pending || memberCount > 0 || typed !== cohortId}
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              Delete Cohort
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}

/** Issue a fresh one-time setup link for a pending invite and copy it (the previous link stops working). */
export function CopyInviteLinkButton({ inviteId, displayName }: { inviteId: string; displayName: string }) {
  const [state, setState] = useState<'idle' | 'pending' | 'copied' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  async function copyLink(): Promise<void> {
    setState('pending');
    setMessage(null);
    try {
      const response = await fetch(`/api/roster/invites/${encodeURIComponent(inviteId)}/link`, { method: 'POST' });
      if (!response.ok) throw new Error(await readApiError(response, 'The link could not be created.'));
      const body = (await response.json()) as { setupPath?: string };
      const link = `${window.location.origin}${body.setupPath ?? ''}`;
      try {
        await navigator.clipboard.writeText(link);
        setState('copied');
        window.setTimeout(() => setState('idle'), 2500);
      } catch {
        setState('error');
        setMessage(link);
      }
    } catch (requestError) {
      setState('error');
      setMessage(requestError instanceof Error ? requestError.message : 'The link could not be created.');
    }
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        className="pulse-btn px-2.5 py-1 text-xs"
        aria-label={`Copy a new setup link for ${displayName}`}
        title="Creates a new link; the old one stops working"
        onClick={() => void copyLink()}
        disabled={state === 'pending'}
      >
        {state === 'pending' ? (
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
        ) : state === 'copied' ? (
          <Check className="h-3 w-3 text-pulse-emerald" aria-hidden="true" />
        ) : (
          <Copy className="h-3 w-3" aria-hidden="true" />
        )}
        {state === 'copied' ? 'Copied' : 'Copy link'}
      </button>
      {message ? <span className="max-w-64 break-all text-[0.7rem] text-pulse-muted">{message}</span> : null}
    </span>
  );
}
