import type { UserRole } from '@/lib/schemas/domain';
import { ALL_ROLES, can } from '@/lib/auth/rbac';

export type NavIconName = 'home' | 'retention' | 'studio' | 'progress' | 'analytics' | 'roster' | 'guide';

export interface NavItem {
  href: string;
  label: string;
  icon: NavIconName;
}

const HOME: NavItem = { href: '/', label: 'Home', icon: 'home' };
const RETENTION: NavItem = { href: '/learn/review', label: 'Retention', icon: 'retention' };
const STUDIO: NavItem = { href: '/studio', label: 'Track Studio', icon: 'studio' };
const PROGRESS: NavItem = { href: '/progress', label: 'Team Progress', icon: 'progress' };
const ANALYTICS: NavItem = { href: '/analytics', label: 'Analytics', icon: 'analytics' };
const ROSTER: NavItem = { href: '/roster', label: 'Roster', icon: 'roster' };

function navFor(role: UserRole): NavItem[] {
  const items: NavItem[] = [HOME];
  // Agents get the Retention shortcut; staff can still open /learn/review directly.
  if (role === 'AGENT') items.push(RETENTION);
  if (can(role, 'tracks.author')) items.push(STUDIO);
  if (can(role, 'progress.view')) items.push(PROGRESS);
  if (can(role, 'analytics.view')) items.push(ANALYTICS);
  if (can(role, 'roster.view')) items.push(ROSTER);
  return items;
}

/** Sidebar navigation for each role, derived from the RBAC matrix in `@/lib/auth/rbac`. */
export const NAV_BY_ROLE: Record<UserRole, NavItem[]> = Object.fromEntries(
  ALL_ROLES.map((role) => [role, navFor(role)]),
) as Record<UserRole, NavItem[]>;

/** The how-to Guide: every signed-in role, shown at the foot of the sidebar and in the account menu. */
export const GUIDE_NAV_ITEM: NavItem = { href: '/guide', label: 'Guide', icon: 'guide' };
