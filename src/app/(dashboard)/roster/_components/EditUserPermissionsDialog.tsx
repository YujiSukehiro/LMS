'use client';

import { useId, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Shield, X } from 'lucide-react';
import { RosterUpdatePermissionsResponseSchema } from '@/lib/schemas/api';
import { INTERNAL_OPS_ROLES } from '@/lib/schemas/constants';
import type { DivisionId, UserDoc, UserRole } from '@/lib/schemas/domain';
import { DivisionCheckboxes, RoleRadioGroup, readApiError } from './RosterFormFields';

interface EditableUser {
  uid: string;
  displayName: string;
  email: string;
  lcNumber: string | null;
  authMethod: UserDoc['authMethod'];
  role: UserRole;
  partnerCohortId: string;
  divisionIds: DivisionId[];
}

export function EditUserPermissionsDialog({
  user,
  cohorts,
  canAssignSuperAdmin,
}: {
  user: EditableUser;
  cohorts: Array<{ id: string; name: string; isInternal: boolean }>;
  canAssignSuperAdmin: boolean;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const nameId = useId();
  const cohortId = useId();
  const [displayName, setDisplayName] = useState(user.displayName);
  const [role, setRole] = useState<UserRole>(user.role);
  const [partnerCohortId, setPartnerCohortId] = useState(user.partnerCohortId);
  const [divisionIds, setDivisionIds] = useState<DivisionId[]>(user.divisionIds);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function open(): void {
    setDisplayName(user.displayName);
    setRole(user.role);
    setPartnerCohortId(user.partnerCohortId);
    setDivisionIds(user.divisionIds.length > 0 ? user.divisionIds : ['TELEHEALTH']);
    setError(null);
    dialogRef.current?.showModal();
  }

  function close(): void {
    dialogRef.current?.close();
  }

  function handleRoleChange(nextRole: UserRole): void {
    setRole(nextRole);
    const hasInternalCohort = cohorts.some((c) => c.id === 'INTERNAL');
    if (INTERNAL_OPS_ROLES.includes(nextRole) && hasInternalCohort && partnerCohortId !== 'INTERNAL') {
      setPartnerCohortId('INTERNAL');
    }
  }

  function toggleDivision(id: DivisionId): void {
    setDivisionIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  }

  async function submit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (!displayName.trim()) {
      setError('Enter a display name.');
      return;
    }
    if (divisionIds.length === 0) {
      setError('Select at least one division.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/roster/${encodeURIComponent(user.uid)}/permissions`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: displayName.trim(),
          role,
          partnerCohortId,
          divisionIds,
        }),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response, 'Access settings could not be updated.'));
      }
      RosterUpdatePermissionsResponseSchema.parse(await response.json());
      close();
      router.refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Access settings could not be updated.');
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="pulse-btn px-2.5 py-1 text-xs"
        aria-label={`Edit access for ${user.displayName}`}
        onClick={open}
      >
        <Shield className="h-3.5 w-3.5" aria-hidden="true" />
        Edit access
      </button>

      <dialog ref={dialogRef} className="pulse-dialog text-left" aria-labelledby={titleId}>
        <form onSubmit={submit} className="flex max-h-[calc(100vh-4rem)] flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-pulse-border-subtle p-6">
            <div>
              <h2 id={titleId} className="text-lg font-semibold">
                Edit access · {user.displayName}
              </h2>
              <p className="mt-1 text-xs text-pulse-muted">
                {user.lcNumber ?? user.email} · Changing role or Cohort updates claims and revokes old sessions.
              </p>
            </div>
            <button
              type="button"
              className="pulse-btn pulse-btn-ghost p-2"
              aria-label={`Close edit access modal for ${user.displayName}`}
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

            <RoleRadioGroup
              name={`role-${user.uid}`}
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
              name={`divisions-${user.uid}`}
              selected={divisionIds}
              onToggle={toggleDivision}
              hint="Select all campaign divisions this user should have access to."
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
              Save access
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
