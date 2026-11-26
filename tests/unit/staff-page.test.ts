import { describe, expect, it } from 'vitest';
import { PERMISSIONS, canSeeOnStaffPage } from '@/lib/auth/rbac';
import { NAV_BY_ROLE } from '@/components/layout/nav-config';
import type { UserRole } from '@/lib/schemas/domain';
import { matchesStaffFilter, matchesStaffSearch, parseStaffFilter, staffFlags, visibleEmail } from '@/lib/services/staff-rules';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 26, 17);
const p = (uid: string, role: UserRole, cohort = 'TELEHEALTH_OUTBOUND') => ({ uid, role, partnerCohortId: cohort });

describe('who appears on the Staff page', () => {
  it('is open to Super Admin, Admin, Trainer and Partner Supervisor, and in their menu; never Agents', () => {
    expect(PERMISSIONS['staff.view'].roles).toEqual(['SUPER_ADMIN', 'ADMIN', 'TRAINER', 'PARTNER_SUPERVISOR']);
    for (const role of ['SUPER_ADMIN', 'ADMIN', 'TRAINER', 'PARTNER_SUPERVISOR'] as const) {
      expect(NAV_BY_ROLE[role].map((item) => item.label)).toContain('Staff');
    }
    expect(NAV_BY_ROLE.AGENT.map((item) => item.label)).not.toContain('Staff');
  });

  it('shows supervisors only the agents in their own Cohort (including deactivated ones)', () => {
    const sup = p('sup', 'PARTNER_SUPERVISOR');
    expect(canSeeOnStaffPage(sup, p('a', 'AGENT'))).toBe(true);
    expect(canSeeOnStaffPage(sup, p('b', 'AGENT', 'OTHER'))).toBe(false);
    expect(canSeeOnStaffPage(sup, p('s2', 'PARTNER_SUPERVISOR'))).toBe(false);
    expect(canSeeOnStaffPage(sup, sup)).toBe(false);
  });

  it('shows Trainers and Admins every role below theirs in any Cohort; Super Admins see everyone but themselves', () => {
    const trainer = p('t', 'TRAINER', 'LOGICALL_INTERNAL');
    expect(canSeeOnStaffPage(trainer, p('a', 'AGENT', 'ANY'))).toBe(true);
    expect(canSeeOnStaffPage(trainer, p('s', 'PARTNER_SUPERVISOR', 'ANY'))).toBe(true);
    expect(canSeeOnStaffPage(trainer, p('t2', 'TRAINER'))).toBe(false);
    const adminUser = p('ad', 'ADMIN');
    expect(canSeeOnStaffPage(adminUser, p('t2', 'TRAINER'))).toBe(true);
    expect(canSeeOnStaffPage(adminUser, p('ad2', 'ADMIN'))).toBe(false);
    const superAdmin = p('sa', 'SUPER_ADMIN');
    expect(canSeeOnStaffPage(superAdmin, p('sa2', 'SUPER_ADMIN'))).toBe(true);
    expect(canSeeOnStaffPage(superAdmin, superAdmin)).toBe(false);
    expect(canSeeOnStaffPage(p('ag', 'AGENT'), p('a', 'AGENT'))).toBe(false);
  });
});

describe('Staff filters', () => {
  const base = { active: true, practiceCounted: 0, practiceLimit: 15, now: NOW };

  it('flags the practice limit', () => {
    expect(staffFlags({ ...base, trainings: [], practiceCounted: 15 }).atLimit).toBe(true);
    expect(staffFlags({ ...base, trainings: [], practiceCounted: 14 }).atLimit).toBe(false);
  });

  it('flags stuck after 3 days without progress on a started, uncertified training', () => {
    expect(staffFlags({ ...base, trainings: [{ stage: 'learning', lastActivityAt: NOW - 3 * DAY }] }).stuck).toBe(true);
    expect(staffFlags({ ...base, trainings: [{ stage: 'checkpoints_done', lastActivityAt: NOW - 4 * DAY }] }).stuck).toBe(true);
    expect(staffFlags({ ...base, trainings: [{ stage: 'learning', lastActivityAt: NOW - 2 * DAY }] }).stuck).toBe(false);
    expect(staffFlags({ ...base, trainings: [{ stage: 'certified', lastActivityAt: NOW - 30 * DAY }] }).stuck).toBe(false);
  });

  it('flags not started only when every assigned training is unopened', () => {
    expect(staffFlags({ ...base, trainings: [{ stage: 'not_started', lastActivityAt: null }] }).notStarted).toBe(true);
    expect(staffFlags({ ...base, trainings: [{ stage: 'not_started', lastActivityAt: null }, { stage: 'learning', lastActivityAt: NOW }] }).notStarted).toBe(false);
    expect(staffFlags({ ...base, trainings: [] }).notStarted).toBe(false);
  });

  it('never flags deactivated people', () => {
    expect(staffFlags({ ...base, active: false, practiceCounted: 99, trainings: [{ stage: 'not_started', lastActivityAt: null }] })).toEqual({
      atLimit: false,
      stuck: false,
      notStarted: false,
    });
  });

  it('matches filters, search and URL values', () => {
    const flags = { atLimit: true, stuck: false, notStarted: false };
    expect(matchesStaffFilter(flags, 'limit')).toBe(true);
    expect(matchesStaffFilter(flags, 'stuck')).toBe(false);
    expect(matchesStaffFilter(flags, 'all')).toBe(true);
    expect(parseStaffFilter('limit')).toBe('limit');
    expect(parseStaffFilter('nonsense')).toBe('all');
    const person = { displayName: 'Jordan Espinoza', email: 'jordan@logicall.io', lcNumber: 'LC-1042', cohortLabel: 'Telehealth' };
    expect(matchesStaffSearch(person, 'espin')).toBe(true);
    expect(matchesStaffSearch(person, 'lc-1042')).toBe(true);
    expect(matchesStaffSearch(person, 'julio')).toBe(false);
    expect(visibleEmail('lc-1042@roster.logicall.internal')).toBeNull();
    expect(visibleEmail('jordan@logicall.io')).toBe('jordan@logicall.io');
  });
});
