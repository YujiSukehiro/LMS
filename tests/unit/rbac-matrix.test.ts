import { describe, expect, it } from 'vitest';
import { ALL_ROLES, PERMISSIONS, assignableRoles, can, canManageRole, canManageUser, invitableRoles, roleCohortFitError } from '@/lib/auth/rbac';
import { ANALYTICS_ROLES, INTERNAL_OPS_ROLES, ROSTER_ADMIN_ROLES } from '@/lib/schemas/constants';
import { NAV_BY_ROLE } from '@/components/layout/nav-config';

describe('RBAC matrix', () => {
  it('keeps the legacy role lists in sync with the matrix', () => {
    expect([...INTERNAL_OPS_ROLES]).toEqual(['SUPER_ADMIN', 'ADMIN', 'TRAINER']);
    expect([...ROSTER_ADMIN_ROLES]).toEqual(['SUPER_ADMIN', 'ADMIN', 'TRAINER']);
    expect([...ANALYTICS_ROLES]).toEqual(['SUPER_ADMIN', 'ADMIN', 'TRAINER', 'PARTNER_SUPERVISOR']);
  });

  it('lets everyone learn but only admins manage people and Cohorts', () => {
    for (const role of ALL_ROLES) expect(can(role, 'learn.take')).toBe(true);
    for (const permission of ['cohorts.create', 'cohorts.edit', 'cohorts.delete'] as const) {
      expect(PERMISSIONS[permission].roles).toEqual(['SUPER_ADMIN', 'ADMIN']);
    }
    // Connor 2026-11-23: Trainers get most people permissions, limited by the hierarchy to supervisors and agents.
    for (const permission of ['users.editAccess', 'users.deactivate'] as const) {
      expect(PERMISSIONS[permission].roles).toEqual(['SUPER_ADMIN', 'ADMIN', 'TRAINER']);
    }
    const trainer = { uid: 't', role: 'TRAINER' as const };
    expect(canManageUser(trainer, { uid: 'x', role: 'AGENT' }, 'users.editAccess')).toBe(true);
    expect(canManageUser(trainer, { uid: 'x', role: 'PARTNER_SUPERVISOR' }, 'users.deactivate')).toBe(true);
    expect(canManageUser(trainer, { uid: 'x', role: 'TRAINER' }, 'users.editAccess')).toBe(false);
    expect(canManageUser(trainer, { uid: 'x', role: 'ADMIN' }, 'users.resetPassword')).toBe(false);
    // Connor 2026-11-23: Trainers open the Roster and add staff (Trainers, supervisors, agents; never Admins).
    expect(PERMISSIONS['roster.view'].roles).toEqual(['SUPER_ADMIN', 'ADMIN', 'TRAINER']);
    expect(PERMISSIONS['users.invite'].roles).toEqual(['SUPER_ADMIN', 'ADMIN', 'TRAINER']);
    expect(invitableRoles('TRAINER')).toEqual(['TRAINER', 'PARTNER_SUPERVISOR', 'AGENT']);
    expect(invitableRoles('ADMIN')).toEqual(['TRAINER', 'PARTNER_SUPERVISOR', 'AGENT']);
    expect(invitableRoles('PARTNER_SUPERVISOR')).toEqual([]);
    // Supervisors can issue temporary passwords, scoped by canManageUser to active agents in their own Cohort.
    expect(PERMISSIONS['users.resetPassword'].roles).toEqual(['SUPER_ADMIN', 'ADMIN', 'TRAINER', 'PARTNER_SUPERVISOR']);
    expect(can('PARTNER_SUPERVISOR', 'analytics.viewAllCohorts')).toBe(false);
    expect(can(undefined, 'learn.take')).toBe(false);
  });

  it('applies the hierarchy: Super Admin manages all, others only strictly lower roles, nobody themselves', () => {
    expect(ALL_ROLES.every((role) => canManageRole('SUPER_ADMIN', role))).toBe(true);
    expect(canManageRole('ADMIN', 'ADMIN')).toBe(false);
    expect(canManageRole('ADMIN', 'SUPER_ADMIN')).toBe(false);
    expect(canManageRole('ADMIN', 'TRAINER')).toBe(true);
    expect(assignableRoles('ADMIN')).toEqual(['TRAINER', 'PARTNER_SUPERVISOR', 'AGENT']);
    expect(assignableRoles('SUPER_ADMIN')).toEqual(ALL_ROLES);
    expect(assignableRoles('TRAINER')).toEqual(['PARTNER_SUPERVISOR', 'AGENT']);
    const actor = { uid: 'a', role: 'SUPER_ADMIN' as const };
    expect(canManageUser(actor, { uid: 'a', role: 'AGENT' }, 'users.editAccess')).toBe(false);
    expect(canManageUser({ uid: 't', role: 'TRAINER' }, { uid: 'x', role: 'TRAINER' }, 'users.editAccess')).toBe(false);
  });

  it('scopes supervisor password resets to active agents in their own Cohort', () => {
    const sup = { uid: 's', role: 'PARTNER_SUPERVISOR' as const, partnerCohortId: 'THS' };
    expect(canManageUser(sup, { uid: 'a', role: 'AGENT', partnerCohortId: 'THS', active: true }, 'users.resetPassword')).toBe(true);
    expect(canManageUser(sup, { uid: 'a', role: 'AGENT', partnerCohortId: 'DOZ', active: true }, 'users.resetPassword')).toBe(false);
    expect(canManageUser(sup, { uid: 'a', role: 'AGENT', partnerCohortId: 'THS', active: false }, 'users.resetPassword')).toBe(false);
    expect(canManageUser(sup, { uid: 'a', role: 'AGENT' }, 'users.resetPassword')).toBe(false);
    expect(canManageUser(sup, { uid: 'a', role: 'AGENT', partnerCohortId: 'THS', active: true }, 'users.editAccess')).toBe(false);
  });

  it('keeps staff roles in an internal Cohort', () => {
    expect(roleCohortFitError('TRAINER', false)).not.toBeNull();
    expect(roleCohortFitError('ADMIN', false)).not.toBeNull();
    expect(roleCohortFitError('TRAINER', true)).toBeNull();
    expect(roleCohortFitError('AGENT', false)).toBeNull();
    expect(roleCohortFitError('PARTNER_SUPERVISOR', true)).toBeNull();
  });

  it('derives navigation from permissions', () => {
    expect(NAV_BY_ROLE.AGENT.map((item) => item.href)).toEqual(['/', '/learn', '/learn/review']);
    expect(NAV_BY_ROLE.PARTNER_SUPERVISOR.map((item) => item.href)).toEqual(['/', '/learn', '/progress', '/analytics']);
    expect(NAV_BY_ROLE.TRAINER.map((item) => item.href)).toEqual(['/', '/learn', '/studio', '/progress', '/analytics', '/roster']);
    expect(NAV_BY_ROLE.ADMIN.map((item) => item.href)).toEqual(['/', '/learn', '/studio', '/progress', '/analytics', '/roster']);
    expect(NAV_BY_ROLE.SUPER_ADMIN).toEqual(NAV_BY_ROLE.ADMIN);
  });
});
