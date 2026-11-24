import type { UserRole } from '@/lib/schemas/domain';
import { GUIDE_ROLES, type GuideRoleId } from './types';

/** The guide a signed-in role reads by default. */
export function guideRoleFor(role: UserRole): GuideRoleId {
  switch (role) {
    case 'AGENT':
      return 'AGENT';
    case 'PARTNER_SUPERVISOR':
      return 'SUPERVISOR';
    case 'TRAINER':
      return 'TRAINER';
    case 'ADMIN':
    case 'SUPER_ADMIN':
      return 'ADMIN';
  }
}

/**
 * Guides a role may open: its own plus the guides of the roles it manages.
 * Admin sees all; Trainer sees Trainer, Supervisor, Agent; Supervisor sees Supervisor, Agent; Agent sees Agent.
 * Returned in tab order, the reader's own guide first.
 */
export function visibleGuideRoles(role: UserRole): GuideRoleId[] {
  const own = guideRoleFor(role);
  const rank = GUIDE_ROLES.indexOf(own);
  const managed = GUIDE_ROLES.filter((_, index) => index < rank).reverse();
  return [own, ...managed];
}

/** `?role=` value for a guide (lower case, e.g. "agent"). */
export function guideRoleParam(role: GuideRoleId): string {
  return role.toLowerCase();
}

/** Resolve the `?role=` search param to a guide this role may open, or the role's own guide. */
export function resolveGuideRole(role: UserRole, param: string | null | undefined): GuideRoleId {
  const allowed = visibleGuideRoles(role);
  const wanted = (param ?? '').trim().toUpperCase();
  return allowed.find((id) => id === wanted) ?? allowed[0];
}

/** Path of the Guide page, optionally on a given tab and section. */
export function guideHref(role?: GuideRoleId, sectionId?: string): string {
  const query = role ? `?role=${guideRoleParam(role)}` : '';
  return `/how-to${query}${sectionId ? `#${sectionId}` : ''}`;
}
