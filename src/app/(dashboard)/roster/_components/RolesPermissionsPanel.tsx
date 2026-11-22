import { Check, ChevronDown, Minus } from 'lucide-react';
import { ALL_ROLES, PERMISSIONS, type Permission } from '@/lib/auth/rbac';
import { ROLE_LABELS } from '@/lib/schemas/constants';
import type { UserRole } from '@/lib/schemas/domain';
import { cn } from '@/lib/utils';

const GROUP_ORDER = ['Learning', 'Content', 'Insight', 'People', 'Cohorts'] as const;

/** Read-only reference of the RBAC matrix the server enforces, generated from `@/lib/auth/rbac`. */
export function RolesPermissionsPanel({ actorRole }: { actorRole: UserRole }) {
  const entries = Object.entries(PERMISSIONS) as Array<[Permission, (typeof PERMISSIONS)[Permission]]>;
  return (
    <details className="pulse-card group" aria-label="Roles and permissions">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
        <span>
          <span className="text-sm font-semibold">Roles &amp; permissions</span>
          <span className="ml-2 text-xs text-pulse-muted">
            Admins manage only roles below their own; Super Admins manage everyone. Nobody edits their own access.
          </span>
        </span>
        <ChevronDown aria-hidden className="size-4 shrink-0 text-pulse-muted transition-transform group-open:rotate-180" />
      </summary>
      <div className="relative overflow-x-auto border-t border-pulse-border-subtle">
        <table className="w-full min-w-[720px] text-left text-sm">
          <caption className="sr-only">What each role can do</caption>
          <thead>
            <tr className="border-b border-pulse-border-subtle">
              <th scope="col" className="pulse-label px-4 py-2">Permission</th>
              {ALL_ROLES.map((role) => (
                <th
                  key={role}
                  scope="col"
                  className={cn('pulse-label px-2 py-2 text-center', role === actorRole && 'text-pulse-indigo-text')}
                >
                  {ROLE_LABELS[role]}
                  {role === actorRole ? <span className="sr-only"> (your role)</span> : null}
                </th>
              ))}
            </tr>
          </thead>
          {GROUP_ORDER.map((group) => (
            <tbody key={group}>
              <tr>
                <th colSpan={ALL_ROLES.length + 1} scope="colgroup" className="bg-pulse-surface-2/50 px-4 py-1 text-xs font-semibold text-pulse-muted">
                  {group}
                </th>
              </tr>
              {entries
                .filter(([, info]) => info.group === group)
                .map(([permission, info]) => (
                  <tr key={permission} className="border-b border-pulse-border-subtle/60 last:border-0">
                    <th scope="row" className="px-4 py-1.5 font-normal text-pulse-secondary">{info.label}</th>
                    {ALL_ROLES.map((role) => (
                      <td key={role} className="px-2 py-1.5 text-center">
                        {info.roles.includes(role) ? (
                          <Check aria-label="Allowed" className="inline size-4 text-pulse-emerald" />
                        ) : (
                          <Minus aria-label="Not allowed" className="inline size-4 text-pulse-muted/50" />
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
            </tbody>
          ))}
        </table>
      </div>
    </details>
  );
}
