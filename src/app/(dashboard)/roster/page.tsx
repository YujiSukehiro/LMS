import type { Metadata } from 'next';
import { Users } from 'lucide-react';
import { adminDb } from '@/lib/firebase/admin';
import { requirePageUser } from '@/lib/firebase/auth-guard';
import { CohortDocSchema, DivisionIdSchema, UserRoleSchema, type CohortDoc, type DivisionId, type UserRole } from '@/lib/schemas/domain';
import { DIVISION_LABELS, ROLE_LABELS, ROSTER_ADMIN_ROLES } from '@/lib/schemas/constants';
import { cn } from '@/lib/utils';
import { BulkImportDialog } from './_components/BulkImportDialog';
import { CopyJoinLinkButton } from './_components/CopyJoinLinkButton';
import { RosterFilters, type StatusFilter } from './_components/RosterFilters';
import { StatusToggleButton } from './_components/StatusToggleButton';

export const metadata: Metadata = { title: 'Roster' };
export const dynamic = 'force-dynamic';

const MAX_ROSTER_ROWS = 2000;

interface RosterRow {
  uid: string;
  displayName: string;
  email: string;
  lcNumber: string | null;
  role: UserRole;
  partnerCohortId: string;
  divisionIds: DivisionId[];
  readiness: number;
  active: boolean;
}

const ROLE_PILL: Record<UserRole, string> = {
  SUPER_ADMIN: 'pulse-pill-crimson',
  ADMIN: 'pulse-pill-amber',
  TRAINER: 'pulse-pill-indigo',
  PARTNER_SUPERVISOR: 'pulse-pill-emerald',
  AGENT: '',
};

const DIVISION_PILL: Record<DivisionId, string> = {
  TELEHEALTH: 'pulse-pill-telehealth',
  INBOUND: 'pulse-pill-inbound',
  OUTBOUND: 'pulse-pill-outbound',
};

function toRosterRow(uid: string, data: Record<string, unknown>): RosterRow | null {
  const role = UserRoleSchema.safeParse(data.role);
  if (!role.success || typeof data.partnerCohortId !== 'string') return null;
  const divisions = Array.isArray(data.divisionIds)
    ? data.divisionIds.flatMap((value) => {
        const parsed = DivisionIdSchema.safeParse(value);
        return parsed.success ? [parsed.data] : [];
      })
    : [];
  const stats = typeof data.stats === 'object' && data.stats !== null ? (data.stats as Record<string, unknown>) : {};
  const email = typeof data.email === 'string' ? data.email : '';
  return {
    uid,
    displayName: typeof data.displayName === 'string' && data.displayName ? data.displayName : email || uid,
    email,
    lcNumber: typeof data.lcNumber === 'string' ? data.lcNumber : null,
    role: role.data,
    partnerCohortId: data.partnerCohortId,
    divisionIds: divisions,
    readiness: typeof stats.overallReadinessScore === 'number' ? Math.round(stats.overallReadinessScore) : 0,
    active: data.active === true,
  };
}

function readinessClass(score: number): string {
  if (score >= 85) return 'text-pulse-emerald';
  if (score >= 70) return 'text-pulse-amber';
  if (score > 0) return 'text-pulse-crimson';
  return 'text-pulse-muted';
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function RosterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requirePageUser(ROSTER_ADMIN_ROLES);
  const params = await searchParams;

  const cohortSnaps = await adminDb.collection('cohorts').get();
  const cohorts: CohortDoc[] = cohortSnaps.docs
    .flatMap((doc) => {
      const parsed = CohortDocSchema.safeParse({ id: doc.id, ...doc.data() });
      return parsed.success ? [parsed.data] : [];
    })
    .sort((a, b) => Number(b.isInternal) - Number(a.isInternal) || a.name.localeCompare(b.name));
  const cohortNames = new Map(cohorts.map((cohort) => [cohort.id, cohort.name]));

  const requestedCohort = firstParam(params.cohort);
  const cohortFilter = requestedCohort && cohortNames.has(requestedCohort) ? requestedCohort : 'ALL';
  const requestedStatus = firstParam(params.status);
  const statusFilter: StatusFilter =
    requestedStatus === 'inactive' || requestedStatus === 'all' ? requestedStatus : 'active';

  const usersQuery =
    cohortFilter === 'ALL'
      ? adminDb.collection('users').limit(MAX_ROSTER_ROWS)
      : adminDb.collection('users').where('partnerCohortId', '==', cohortFilter).limit(MAX_ROSTER_ROWS);
  const userSnaps = await usersQuery.get();
  const allRows = userSnaps.docs
    .map((doc) => toRosterRow(doc.id, doc.data()))
    .filter((row): row is RosterRow => row !== null);
  const rows = allRows
    .filter((row) => (statusFilter === 'all' ? true : statusFilter === 'active' ? row.active : !row.active))
    .sort((a, b) => Number(b.active) - Number(a.active) || a.displayName.localeCompare(b.displayName));

  const activeCount = allRows.filter((row) => row.active).length;
  const inactiveCount = allRows.length - activeCount;

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="pulse-label">Roster</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Agents, Supervisors &amp; Staff</h1>
          <p className="mt-1 text-sm text-pulse-secondary">
            Import LC-ID accounts, share Cohort join codes, and deactivate access in 1 click. Deactivation keeps all
            history.
          </p>
        </div>
        <BulkImportDialog
          cohorts={cohorts.map((cohort) => ({ id: cohort.id, name: cohort.name }))}
          canCreateSuperAdmin={actor.role === 'SUPER_ADMIN'}
        />
      </header>

      <section aria-labelledby="cohort-heading">
        <h2 id="cohort-heading" className="pulse-label mb-3">
          Cohorts
        </h2>
        {cohorts.length === 0 ? (
          <p className="pulse-card p-4 text-sm text-pulse-muted">No Cohorts exist yet. Run the seed script to create them.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {cohorts.map((cohort) => (
              <article key={cohort.id} className="pulse-card flex flex-col gap-3 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-semibold">{cohort.name}</h3>
                    <p className="pulse-metric text-xs text-pulse-muted">{cohort.id}</p>
                  </div>
                  <div className="text-right">
                    <p className="pulse-metric text-xl font-semibold">{cohort.activeAgentCount}</p>
                    <p className="text-xs text-pulse-muted">active Agents</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {cohort.defaultDivisionIds.map((divisionId) => (
                    <span key={divisionId} className={cn('pulse-pill', DIVISION_PILL[divisionId])}>
                      {DIVISION_LABELS[divisionId]}
                    </span>
                  ))}
                </div>
                <div className="mt-auto flex items-center justify-between gap-2 border-t border-pulse-border-subtle pt-3">
                  {cohort.joinCode && cohort.joinCodeEnabled ? (
                    <>
                      <span className="pulse-metric text-sm font-semibold text-pulse-indigo">{cohort.joinCode}</span>
                      <CopyJoinLinkButton joinCode={cohort.joinCode} />
                    </>
                  ) : (
                    <span className="text-xs text-pulse-muted">
                      {cohort.joinCode ? `Join code ${cohort.joinCode} is off` : 'No join code (invite only)'}
                    </span>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="users-heading" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="users-heading" className="flex items-center gap-2 text-lg font-semibold">
            <Users className="h-5 w-5 text-pulse-muted" aria-hidden="true" />
            Users
            <span className="pulse-metric text-sm font-normal text-pulse-muted">
              {activeCount} active · {inactiveCount} inactive
            </span>
          </h2>
          <RosterFilters
            cohorts={cohorts.map((cohort) => ({ id: cohort.id, name: cohort.name }))}
            cohort={cohortFilter}
            status={statusFilter}
          />
        </div>

        <div className="pulse-card overflow-x-auto">
          <table className="w-full min-w-[880px] text-left text-sm">
            <thead>
              <tr className="border-b border-pulse-border-subtle">
                <th scope="col" className="pulse-label px-4 py-3">Name</th>
                <th scope="col" className="pulse-label px-4 py-3">LC Number / Email</th>
                <th scope="col" className="pulse-label px-4 py-3">Role</th>
                <th scope="col" className="pulse-label px-4 py-3">Cohort</th>
                <th scope="col" className="pulse-label px-4 py-3">Divisions</th>
                <th scope="col" className="pulse-label px-4 py-3 text-right" title="Blended Drill and Simulation score; not certification readiness">Training score</th>
                <th scope="col" className="pulse-label px-4 py-3">Status</th>
                <th scope="col" className="pulse-label px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-pulse-muted">
                    No users match these filters.
                  </td>
                </tr>
              ) : (
                rows.map((row) => {
                  const isSelf = row.uid === actor.uid;
                  const locked = isSelf || (row.role === 'SUPER_ADMIN' && actor.role !== 'SUPER_ADMIN');
                  return (
                    <tr
                      key={row.uid}
                      className={cn('border-b border-pulse-border-subtle last:border-0', !row.active && 'opacity-60')}
                    >
                      <td className="px-4 py-3 font-medium">
                        {row.displayName}
                        {isSelf ? <span className="ml-2 text-xs text-pulse-muted">(you)</span> : null}
                      </td>
                      <td className="px-4 py-3">
                        {row.lcNumber ? (
                          <span className="pulse-metric">{row.lcNumber}</span>
                        ) : (
                          <span className="text-pulse-secondary">{row.email}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn('pulse-pill', ROLE_PILL[row.role])}>{ROLE_LABELS[row.role]}</span>
                      </td>
                      <td className="px-4 py-3 text-pulse-secondary">
                        {cohortNames.get(row.partnerCohortId) ?? row.partnerCohortId}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {row.divisionIds.length === 0 ? (
                            <span className="text-pulse-muted">None</span>
                          ) : (
                            row.divisionIds.map((divisionId) => (
                              <span key={divisionId} className={cn('pulse-pill', DIVISION_PILL[divisionId])}>
                                {DIVISION_LABELS[divisionId]}
                              </span>
                            ))
                          )}
                        </div>
                      </td>
                      <td className={cn('pulse-metric px-4 py-3 text-right font-semibold', readinessClass(row.readiness))}>
                        {row.readiness}%
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn('pulse-pill', row.active ? 'pulse-pill-emerald' : 'pulse-pill-crimson')}>
                          {row.active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {locked ? (
                          <span className="text-xs text-pulse-muted">{isSelf ? 'Your account' : 'Super Admin only'}</span>
                        ) : (
                          <StatusToggleButton uid={row.uid} displayName={row.displayName} active={row.active} />
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {userSnaps.size >= MAX_ROSTER_ROWS ? (
          <p className="text-xs text-pulse-muted">
            The first {MAX_ROSTER_ROWS} users are shown. Filter by Cohort to see the rest.
          </p>
        ) : null}
      </section>
    </div>
  );
}
