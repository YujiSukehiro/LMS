import type { UserRole } from '@/lib/schemas/domain';

export type NavIconName = 'home' | 'retention' | 'studio' | 'progress' | 'analytics' | 'roster';

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

/** Sidebar navigation for each role (SWARM brief: navigation per role). */
export const NAV_BY_ROLE: Record<UserRole, NavItem[]> = {
  AGENT: [HOME, RETENTION],
  PARTNER_SUPERVISOR: [HOME, PROGRESS, ANALYTICS],
  TRAINER: [HOME, STUDIO, PROGRESS, ANALYTICS],
  ADMIN: [HOME, STUDIO, PROGRESS, ANALYTICS, ROSTER],
  SUPER_ADMIN: [HOME, STUDIO, PROGRESS, ANALYTICS, ROSTER],
};
