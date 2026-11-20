'use client';

import { useId } from 'react';
import { DIVISION_LABELS, ROLE_LABELS } from '@/lib/schemas/constants';
import type { DivisionId, UserRole } from '@/lib/schemas/domain';

export const ALL_DIVISION_IDS: readonly DivisionId[] = ['TELEHEALTH', 'INBOUND', 'OUTBOUND'];
export const EDITABLE_ROLES: readonly UserRole[] = [
  'AGENT',
  'PARTNER_SUPERVISOR',
  'TRAINER',
  'ADMIN',
  'SUPER_ADMIN',
];

export async function readApiError(response: Response, fallback: string): Promise<string> {
  const body: unknown = await response.json().catch(() => null);
  const record = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  return typeof record.message === 'string' && record.message.trim().length > 0 ? record.message : fallback;
}

export function RoleRadioGroup({
  name,
  value,
  canAssignSuperAdmin,
  onChange,
  legend = 'Role',
}: {
  name: string;
  value: UserRole;
  canAssignSuperAdmin: boolean;
  onChange: (role: UserRole) => void;
  legend?: string;
}) {
  const baseId = useId();
  const visibleRoles = EDITABLE_ROLES.filter((role) => role !== 'SUPER_ADMIN' || canAssignSuperAdmin || value === 'SUPER_ADMIN');

  return (
    <fieldset className="space-y-2">
      <legend className="pulse-label">{legend}</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {visibleRoles.map((role) => {
          const id = `${baseId}-${role}`;
          return (
            <div
              key={role}
              className="flex items-center gap-2 rounded-md border border-pulse-border px-3 py-2 text-sm"
            >
              <input
                type="radio"
                id={id}
                name={name}
                value={role}
                checked={value === role}
                disabled={role === 'SUPER_ADMIN' && !canAssignSuperAdmin}
                onChange={() => onChange(role)}
                style={{ accentColor: 'var(--pulse-indigo)' }}
                className="h-4 w-4 shrink-0"
              />
              <label htmlFor={id} className="w-full cursor-pointer font-medium">
                {ROLE_LABELS[role]}
              </label>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}

export function DivisionCheckboxes({
  name,
  selected,
  onToggle,
  legend = 'Divisions',
  hint,
}: {
  name: string;
  selected: DivisionId[];
  onToggle: (divisionId: DivisionId) => void;
  legend?: string;
  hint?: string;
}) {
  const baseId = useId();
  const hintId = `${baseId}-hint`;

  return (
    <fieldset className="space-y-2" aria-describedby={hint ? hintId : undefined}>
      <legend className="pulse-label">{legend}</legend>
      {hint ? (
        <p id={hintId} className="text-xs text-pulse-muted">
          {hint}
        </p>
      ) : null}
      <div className="grid gap-2 sm:grid-cols-3">
        {ALL_DIVISION_IDS.map((divisionId) => {
          const id = `${baseId}-${divisionId}`;
          const checked = selected.includes(divisionId);
          return (
            <div
              key={divisionId}
              className="flex items-center gap-2 rounded-md border border-pulse-border px-3 py-2 text-sm"
            >
              <input
                type="checkbox"
                id={id}
                name={name}
                value={divisionId}
                checked={checked}
                onChange={() => onToggle(divisionId)}
                style={{ accentColor: 'var(--pulse-indigo)' }}
                className="h-4 w-4 shrink-0"
              />
              <label htmlFor={id} className="w-full cursor-pointer font-medium">
                {DIVISION_LABELS[divisionId]}
              </label>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}
