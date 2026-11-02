import type { UserRole } from '@/lib/schemas/domain';

export type NavIconName = 'home' | 'studio' | 'analytics' | 'roster';

export interface NavItem {
  href: string;
  label: string;
  icon: NavIconName;
}

const HOME: NavItem = { href: '/', label: 'Home', icon: 'home' };
const STUDIO: NavItem = { href: '/studio', label: 'Track Studio', icon: 'studio' };
const ANALYTICS: NavItem = { href: '/analytics', label: 'Analytics', icon: 'analytics' };
const ROSTER: NavItem = { href: '/roster', label: 'Roster', icon: 'roster' };

/** Sidebar navigation for each role (SWARM brief: navigation per role). */
export const NAV_BY_ROLE: Record<UserRole, NavItem[]> = {
  AGENT: [HOME],
  PARTNER_SUPERVISOR: [HOME, ANALYTICS],
  TRAINER: [HOME, STUDIO, ANALYTICS],
  ADMIN: [HOME, STUDIO, ANALYTICS, ROSTER],
  SUPER_ADMIN: [HOME, STUDIO, ANALYTICS, ROSTER],
};
