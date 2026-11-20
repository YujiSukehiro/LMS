'use client';

import { useId, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, UserPlus, X } from 'lucide-react';
import { RosterCreateInviteResponseSchema } from '@/lib/schemas/api';
import { INTERNAL_OPS_ROLES } from '@/lib/schemas/constants';
import type { DivisionId, UserRole } from '@/lib/schemas/domain';
import { DivisionCheckboxes, RoleRadioGroup, readApiError } from './RosterFormFields';

export function InviteStaffDialog({
  cohorts,
  canAssignSuperAdmin,
}: {
  cohorts: Array<{ id: string; name: string }>;
  canAssignSuperAdmin: boolean;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const nameId = useId();
  const emailId = useId();
  const emailHintId = useId();
  const cohortId = useId();

  const defaultCohort = cohorts.find((c) => c.id === 'INTERNAL')?.id ?? cohorts[0]?.id ?? 'INTERNAL';
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<UserRole>('TRAINER');
  const [partnerCohortId, setPartnerCohortId] = useState(defaultCohort);
  const [divisionIds, setDivisionIds] = useState<DivisionId[]>(['TELEHEALTH', 'INBOUND']);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function open(): void {
    setDisplayName('');
    setEmail('');
    setRole('TRAINER');
    setPartnerCohortId(defaultCohort);
    setDivisionIds(['TELEHEALTH', 'INBOUND']);
    setError(null);
    dialogRef.current?.showModal();
  }

  function close(): void {
    dialogRef.current?.close();
  }

  function handleRoleChange(nextRole: UserRole): void {
    setRole(nextRole);
    if (INTERNAL_OPS_ROLES.includes(nextRole) && cohorts.some((c) => c.id === 'INTERNAL')) {
      setPartnerCohortId('INTERNAL');
    }
  }

  function toggleDivision(id: DivisionId): void {
    setDivisionIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  }

  async function submit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (!displayName.trim() || !email.trim()) {
      setError('Enter both full name and work email.');
      return;
    }
    if (divisionIds.length === 0) {
      setError('Select at least one division.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/roster/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: displayName.trim(),
          email: email.trim().toLowerCase(),
          role,
          partnerCohortId,
          divisionIds,
          expiresInDays: 30,
        }),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response, 'The invite could not be created.'));
      }
      RosterCreateInviteResponseSchema.parse(await response.json());
      close();
      router.refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'The invite could not be created.');
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button type="button" className="pulse-btn" onClick={open}>
        <UserPlus className="h-4 w-4" aria-hidden="true" />
        Invite Staff
      </button>

      <dialog ref={dialogRef} className="pulse-dialog text-left" aria-labelledby={titleId}>
        <form onSubmit={submit} className="flex max-h-[calc(100vh-4rem)] flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-pulse-border-subtle p-6">
            <div>
              <h2 id={titleId} className="text-lg font-semibold">
                Invite Staff or Partner Supervisor
              </h2>
              <p className="mt-1 text-sm text-pulse-secondary">
                Pre-assign a role before their first Google Workspace sign-in.
              </p>
            </div>
            <button
              type="button"
              className="pulse-btn pulse-btn-ghost p-2"
              aria-label="Close invite staff modal"
              onClick={close}
              disabled={pending}
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          <div className="space-y-4 overflow-y-auto p-6">
            <div>
              <label htmlFor={nameId} className="pulse-label mb-1.5 block">
                Full name
              </label>
              <input
                id={nameId}
                name="displayName"
                type="text"
                autoComplete="name"
                required
                autoFocus
                className="pulse-input"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </div>

            <div>
              <label htmlFor={emailId} className="pulse-label mb-1.5 block">
                Work email
              </label>
              <p id={emailHintId} className="mb-1.5 text-xs text-pulse-muted">
                When they sign in with Google SSO (or a verified email), Pulse claims this invite automatically.
              </p>
              <input
                id={emailId}
                name="email"
                type="email"
                autoComplete="email"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                aria-describedby={emailHintId}
                required
                className="pulse-input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <RoleRadioGroup
              name="invite-role"
              value={role}
              canAssignSuperAdmin={canAssignSuperAdmin}
              onChange={handleRoleChange}
            />

            <div>
              <label htmlFor={cohortId} className="pulse-label mb-1.5 block">
                Cohort
              </label>
              <select
                id={cohortId}
                name="partnerCohortId"
                className="pulse-select"
                value={partnerCohortId}
                onChange={(e) => setPartnerCohortId(e.target.value)}
              >
                {cohorts.map((cohort) => (
                  <option key={cohort.id} value={cohort.id}>
                    {cohort.name} ({cohort.id})
                  </option>
                ))}
              </select>
            </div>

            <DivisionCheckboxes
              name="invite-divisions"
              selected={divisionIds}
              onToggle={toggleDivision}
            />

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
              Create invite
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
