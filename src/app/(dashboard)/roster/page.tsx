import type { Metadata } from 'next';
import { Mail, Users } from 'lucide-react';
import { adminDb } from '@/lib/firebase/admin';
import { requirePageUser } from '@/lib/firebase/auth-guard';
import {
  CohortDocSchema,
  DivisionIdSchema,
  RosterInviteDocSchema,
  UserRoleSchema,
  type CohortDoc,
  type DivisionId,
  type RosterInviteDoc,
  type UserDoc,
  type UserRole,
} from '@/lib/schemas/domain';
import { DIVISION_LABELS, ROLE_LABELS, ROSTER_ADMIN_ROLES } from '@/lib/schemas/constants';
import { cn } from '@/lib/utils';
import { BulkImportDialog } from './_components/BulkImportDialog';
import { BootstrapCohortsButton, CohortCardActions, CreateCohortDialog, RevokeInviteButton } from './_components/CohortAdminControls';
import { CopyJoinLinkButton } from './_components/CopyJoinLinkButton';
import { EditUserPermissionsDialog } from './_components/EditUserPermissionsDialog';
import { InviteStaffDialog } from './_components/InviteStaffDialog';
import { ResetPasswordDialog } from './_components/ResetPasswordDialog';
import { RosterFilters, type StatusFilter } from './_components/RosterFilters';
import { StatusToggleButton } from './_components/StatusToggleButton';

export const metadata: Metadata = { title: 'Roster' };
export const dynamic = 'force-dynamic';

const MAX_ROSTER_ROWS = 2000;

interface RosterRow {
  uid: string;
  displayName: string;
  email: string;
  authMethod: UserDoc['authMethod'];
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

function parseAuthMethod(raw: unknown, lcNumber: string | null): UserDoc['authMethod'] {
  if (raw === 'GOOGLE_SSO' || raw === 'EMAIL_PASSWORD' || raw === 'LC_ID_PASSWORD') return raw;
  return lcNumber ? 'LC_ID_PASSWORD' : 'EMAIL_PASSWORD';
}

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
  const lcNumber = typeof data.lcNumber === 'string' ? data.lcNumber : null;
  return {
    uid,
    displayName: typeof data.displayName === 'string' && data.displayName ? data.displayName : email || uid,
    email,
    authMethod: parseAuthMethod(data.authMethod, lcNumber),
    lcNumber,
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

function formatExpiry(expiresAt: number | null): string {
  if (!expiresAt) return 'No expiry';
  return new Date(expiresAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default async function RosterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requirePageUser(ROSTER_ADMIN_ROLES);
  const params = await searchParams;

  const [cohortSnaps, inviteSnaps] = await Promise.all([
    adminDb.collection('cohorts').get(),
    adminDb.collection('rosterInvites').where('status', '==', 'PENDING').limit(200).get(),
  ]);

  const cohorts: CohortDoc[] = cohortSnaps.docs
    .flatMap((doc) => {
      const parsed = CohortDocSchema.safeParse({ id: doc.id, ...doc.data() });
      return parsed.success ? [parsed.data] : [];
    })
    .sort((a, b) => Number(b.isInternal) - Number(a.isInternal) || a.name.localeCompare(b.name));
  const cohortNames = new Map(cohorts.map((cohort) => [cohort.id, cohort.name]));
  const cohortChoices = cohorts.map((cohort) => ({
    id: cohort.id,
    name: cohort.name,
    isInternal: cohort.isInternal,
  }));

  const now = Date.now();
  const pendingInvites: RosterInviteDoc[] = inviteSnaps.docs
    .flatMap((doc) => {
      const parsed = RosterInviteDocSchema.safeParse({ id: doc.id, ...doc.data() });
      if (!parsed.success) return [];
      if (parsed.data.expiresAt !== null && parsed.data.expiresAt <= now) return [];
      return [parsed.data];
    })
    .sort((a, b) => b.createdAt - a.createdAt);

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
  const canManageSuperAdmin = actor.role === 'SUPER_ADMIN';

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="pulse-label">Roster</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Agents, Supervisors &amp; Staff</h1>
          <p className="mt-1 text-sm text-pulse-secondary">
            Manage RBAC roles, invite internal staff, rotate Cohort join codes, and deactivate access in 1 click.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <InviteStaffDialog
            cohorts={cohortChoices.map((c) => ({ id: c.id, name: c.name }))}
            canAssignSuperAdmin={canManageSuperAdmin}
          />
          <BulkImportDialog
            cohorts={cohortChoices.map((c) => ({ id: c.id, name: c.name }))}
            canCreateSuperAdmin={canManageSuperAdmin}
          />
        </div>
      </header>

      <section aria-labelledby="cohort-heading">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 id="cohort-heading" className="pulse-label">
            Cohorts
          </h2>
          <CreateCohortDialog />
        </div>
        {cohorts.length === 0 ? (
          <div className="pulse-card flex flex-wrap items-center justify-between gap-3 p-4">
            <p className="text-sm text-pulse-muted">
              No Cohorts exist yet. Initialize the 8 default Cohorts or click New Cohort.
            </p>
            <BootstrapCohortsButton />
          </div>
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
                <div className="mt-auto space-y-2 border-t border-pulse-border-subtle pt-3">
                  <div className="flex items-center justify-between gap-2">
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
                  {!cohort.isInternal ? (
                    <CohortCardActions
                      cohortId={cohort.id}
                      cohortName={cohort.name}
                      joinCodeEnabled={cohort.joinCodeEnabled}
                    />
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {pendingInvites.length > 0 ? (
        <section aria-labelledby="invites-heading" className="space-y-3">
          <h2 id="invites-heading" className="flex items-center gap-2 text-lg font-semibold">
            <Mail className="h-5 w-5 text-pulse-muted" aria-hidden="true" />
            Pending Staff &amp; Supervisor Invites
            <span className="pulse-metric text-sm font-normal text-pulse-muted">{pendingInvites.length} pending</span>
          </h2>
          <div tabIndex={0} role="region" aria-labelledby="invites-heading" className="pulse-card overflow-x-auto">
            <table className="w-full min-w-[780px] text-left text-sm">
              <thead>
                <tr className="border-b border-pulse-border-subtle">
                  <th scope="col" className="pulse-label px-4 py-3">Name</th>
                  <th scope="col" className="pulse-label px-4 py-3">Email</th>
                  <th scope="col" className="pulse-label px-4 py-3">Role</th>
                  <th scope="col" className="pulse-label px-4 py-3">Cohort</th>
                  <th scope="col" className="pulse-label px-4 py-3">Divisions</th>
                  <th scope="col" className="pulse-label px-4 py-3">Expires</th>
                  <th scope="col" className="pulse-label px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {pendingInvites.map((invite) => {
                  const lockedInvite = invite.role === 'SUPER_ADMIN' && !canManageSuperAdmin;
                  return (
                    <tr key={invite.id} className="border-b border-pulse-border-subtle last:border-0">
                      <th scope="row" className="px-4 py-3 font-medium">
                        {invite.displayName}
                      </th>
                      <td className="px-4 py-3 text-pulse-secondary">{invite.email ?? invite.lcNumber ?? '—'}</td>
                      <td className="px-4 py-3">
                        <span className={cn('pulse-pill', ROLE_PILL[invite.role])}>{ROLE_LABELS[invite.role]}</span>
                      </td>
                      <td className="px-4 py-3 text-pulse-secondary">
                        {cohortNames.get(invite.partnerCohortId) ?? invite.partnerCohortId}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {invite.divisionIds.map((divisionId) => (
                            <span key={divisionId} className={cn('pulse-pill', DIVISION_PILL[divisionId])}>
                              {DIVISION_LABELS[divisionId]}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-pulse-muted">{formatExpiry(invite.expiresAt)}</td>
                      <td className="px-4 py-3 text-right">
                        {lockedInvite ? (
                          <span className="text-xs text-pulse-muted">Super Admin only</span>
                        ) : (
                          <RevokeInviteButton inviteId={invite.id} displayName={invite.displayName} />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

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
            cohorts={cohortChoices.map((cohort) => ({ id: cohort.id, name: cohort.name }))}
            cohort={cohortFilter}
            status={statusFilter}
          />
        </div>

        <div tabIndex={0} role="region" aria-labelledby="users-heading" className="pulse-card overflow-x-auto">
          <table className="w-full min-w-[960px] text-left text-sm">
            <thead>
              <tr className="border-b border-pulse-border-subtle">
                <th scope="col" className="pulse-label px-4 py-3">Name</th>
                <th scope="col" className="pulse-label px-4 py-3">LC Number / Email</th>
                <th scope="col" className="pulse-label px-4 py-3">Role</th>
                <th scope="col" className="pulse-label px-4 py-3">Cohort</th>
                <th scope="col" className="pulse-label px-4 py-3">Divisions</th>
                <th scope="col" className="pulse-label px-4 py-3 text-right" title="Blended Drill and Simulation score; not certification readiness">Training score</th>
                <th scope="col" className="pulse-label px-4 py-3">Status</th>
                <th scope="col" className="pulse-label px-4 py-3 text-right">Actions</th>
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
                  const locked = isSelf || (row.role === 'SUPER_ADMIN' && !canManageSuperAdmin);
                  return (
                    <tr
                      key={row.uid}
                      className={cn('border-b border-pulse-border-subtle last:border-0', !row.active && 'opacity-60')}
                    >
                      <th scope="row" className="px-4 py-3 font-medium">
                        {row.displayName}
                        {isSelf ? <span className="ml-2 text-xs font-normal text-pulse-muted">(you)</span> : null}
                      </th>
                      <td className="px-4 py-3">
                        {row.lcNumber ? (
                          <span className="pulse-metric">{row.lcNumber}</span>
                        ) : (
                          <div>
                            <span className="text-pulse-secondary">{row.email}</span>
                            {row.authMethod === 'GOOGLE_SSO' ? (
                              <span className="block text-[11px] text-pulse-muted">Google SSO</span>
                            ) : null}
                          </div>
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
                          <div className="flex flex-wrap justify-end gap-1.5">
                            <EditUserPermissionsDialog
                              user={row}
                              cohorts={cohortChoices}
                              canAssignSuperAdmin={canManageSuperAdmin}
                            />
                            {row.authMethod !== 'GOOGLE_SSO' ? (
                              <ResetPasswordDialog
                                uid={row.uid}
                                displayName={row.displayName}
                                loginIdentifier={row.lcNumber ?? row.email}
                              />
                            ) : null}
                            <StatusToggleButton uid={row.uid} displayName={row.displayName} active={row.active} />
                          </div>
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
