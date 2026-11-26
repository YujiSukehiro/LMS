/**
 * Single source of truth for role-based access control. Pure and client-safe: API routes, pages,
 * navigation and the Roster UI all read this module, so a permission change happens in one place.
 */
import type { UserRole } from '@/lib/schemas/domain';

/** Higher rank = more authority. Used for "can this actor manage that user" checks. */
export const ROLE_RANK: Record<UserRole, number> = {
  AGENT: 0,
  PARTNER_SUPERVISOR: 1,
  TRAINER: 2,
  ADMIN: 3,
  SUPER_ADMIN: 4,
};

export const ALL_ROLES: readonly UserRole[] = ['SUPER_ADMIN', 'ADMIN', 'TRAINER', 'PARTNER_SUPERVISOR', 'AGENT'];

export type Permission =
  | 'learn.take'
  | 'tracks.author'
  | 'tracks.publish'
  | 'certifications.manage'
  | 'sims.manualJudge'
  | 'system.aiHealth'
  | 'progress.view'
  | 'analytics.view'
  | 'analytics.viewAllCohorts'
  | 'roster.view'
  | 'users.invite'
  | 'users.editAccess'
  | 'users.resetPassword'
  | 'users.deactivate'
  | 'sims.resetDailyLimit'
  | 'cohorts.create'
  | 'cohorts.edit'
  | 'cohorts.delete';

interface PermissionInfo {
  label: string;
  group: 'Learning' | 'Content' | 'Insight' | 'People' | 'Cohorts';
  roles: readonly UserRole[];
}

const INTERNAL: readonly UserRole[] = ['SUPER_ADMIN', 'ADMIN', 'TRAINER'];
const ADMINS: readonly UserRole[] = ['SUPER_ADMIN', 'ADMIN'];

export const PERMISSIONS: Record<Permission, PermissionInfo> = {
  'learn.take': { label: 'Take Checkpoints, Verbal Practice and reviews', group: 'Learning', roles: ALL_ROLES },
  'tracks.author': { label: 'Build and edit Tracks', group: 'Content', roles: INTERNAL },
  'tracks.publish': { label: 'Publish Tracks and assign Cohorts', group: 'Content', roles: INTERNAL },
  'certifications.manage': { label: 'Revoke or reconcile certifications', group: 'Content', roles: INTERNAL },
  'sims.manualJudge': { label: 'Score practice by hand', group: 'Content', roles: INTERNAL },
  'system.aiHealth': { label: 'See AI runtime health', group: 'Content', roles: INTERNAL },
  'progress.view': { label: 'See Team Progress', group: 'Insight', roles: [...INTERNAL, 'PARTNER_SUPERVISOR'] },
  'analytics.view': { label: 'See Analytics', group: 'Insight', roles: [...INTERNAL, 'PARTNER_SUPERVISOR'] },
  'analytics.viewAllCohorts': { label: 'See every Cohort (not only their own)', group: 'Insight', roles: INTERNAL },
  'roster.view': { label: 'Open the Roster', group: 'People', roles: [...ADMINS, 'TRAINER'] },
  // Connor 2026-11-23: Trainers can add staff too (Trainers, supervisors and agents; never Admins).
  'users.invite': { label: 'Invite staff and bulk-import agents', group: 'People', roles: [...ADMINS, 'TRAINER'] },
  // Connor 2026-11-23: Trainers get most people permissions; canManageUser still limits them to roles below their own
  // (Partner Supervisors and Agents).
  'users.editAccess': { label: 'Change role, Cohort and Divisions', group: 'People', roles: [...ADMINS, 'TRAINER'] },
  'users.resetPassword': {
    label: 'Issue temporary passwords (supervisors: active agents in their own Cohort)',
    group: 'People',
    roles: [...ADMINS, 'TRAINER', 'PARTNER_SUPERVISOR'],
  },
  'users.deactivate': { label: 'Deactivate and reactivate users', group: 'People', roles: [...ADMINS, 'TRAINER'] },
  // Connor 2026-11-26: staff clear an agent's daily practice count so nobody waits for the midnight-UTC reset.
  // canManageUser scopes it like password resets (supervisors: active agents in their own Cohort).
  'sims.resetDailyLimit': {
    label: "Reset an agent's daily Verbal Practice count (supervisors: active agents in their own Cohort)",
    group: 'People',
    roles: [...ADMINS, 'TRAINER', 'PARTNER_SUPERVISOR'],
  },
  'cohorts.create': { label: 'Create Cohorts', group: 'Cohorts', roles: ADMINS },
  'cohorts.edit': { label: 'Rename, set Divisions, manage join codes', group: 'Cohorts', roles: ADMINS },
  'cohorts.delete': { label: 'Delete empty Cohorts', group: 'Cohorts', roles: ADMINS },
};

export function can(role: UserRole | null | undefined, permission: Permission): boolean {
  return Boolean(role && PERMISSIONS[permission].roles.includes(role));
}

export function rolesWith(permission: Permission): readonly UserRole[] {
  return PERMISSIONS[permission].roles;
}

/**
 * Hierarchy rule for every user-management action (edit access, reset password, deactivate, invite):
 * Super Admins manage everyone; anyone else only manages roles ranked strictly below their own.
 * Nobody manages their own account through the Roster.
 */
export function canManageRole(actorRole: UserRole, targetRole: UserRole): boolean {
  if (actorRole === 'SUPER_ADMIN') return true;
  return ROLE_RANK[targetRole] < ROLE_RANK[actorRole];
}

export function canManageUser(
  actor: { uid: string; role: UserRole; partnerCohortId?: string },
  target: { uid: string; role: UserRole; partnerCohortId?: string; active?: boolean },
  permission: Permission,
): boolean {
  if (actor.uid === target.uid) return false;
  if (!can(actor.role, permission) || !canManageRole(actor.role, target.role)) return false;
  // Partner supervisors only manage active agents in their own Cohort. Missing Cohort data fails closed.
  if (actor.role === 'PARTNER_SUPERVISOR') {
    return (
      target.role === 'AGENT' &&
      target.active === true &&
      typeof actor.partnerCohortId === 'string' &&
      target.partnerCohortId === actor.partnerCohortId
    );
  }
  return true;
}

/** Roles this actor may change an existing user to. */
export function assignableRoles(actorRole: UserRole): UserRole[] {
  // Changing an existing user's role needs users.editAccess; inviting uses invitableRoles.
  if (!can(actorRole, 'users.editAccess')) return [];
  return ALL_ROLES.filter((role) => canManageRole(actorRole, role));
}

/** Roles that see every Cohort's data; they must belong to an internal LogiCall Cohort (QA M3). */
export const STAFF_ROLES: readonly UserRole[] = ['SUPER_ADMIN', 'ADMIN', 'TRAINER'];

/**
 * Role and Cohort must fit: Trainer, Admin and Super Admin only in an internal Cohort, so promoting a partner
 * agent can never hand them every partner's data. Agents and supervisors may be in either (internal test users).
 * Returns a plain reason, or null when the pair is allowed.
 */
export function roleCohortFitError(role: UserRole, cohortIsInternal: boolean): string | null {
  if (STAFF_ROLES.includes(role) && !cohortIsInternal) {
    return 'Trainer, Admin and Super Admin accounts must be in the LogiCall Internal Cohort. Move the user to an internal Cohort first.';
  }
  return null;
}

/**
 * Roles this actor may invite or bulk-import. Trainers add fellow Trainers, Partner Supervisors and Agents (but no
 * Admins); everyone else follows the hierarchy in assignableRoles.
 */
export function invitableRoles(actorRole: UserRole): UserRole[] {
  if (!can(actorRole, 'users.invite')) return [];
  if (actorRole === 'TRAINER') return ['TRAINER', 'PARTNER_SUPERVISOR', 'AGENT'];
  return ALL_ROLES.filter((role) => canManageRole(actorRole, role));
}

/** Plain-language reason a management action is refused, for 403 responses and disabled buttons. */
export function manageDeniedReason(actorRole: UserRole, targetRole: UserRole): string {
  if (targetRole === 'SUPER_ADMIN') return 'Only a Super Admin can manage Super Admin accounts.';
  if (ROLE_RANK[targetRole] >= ROLE_RANK[actorRole]) return 'You can only manage roles below your own.';
  return 'You do not have permission for this action.';
}
