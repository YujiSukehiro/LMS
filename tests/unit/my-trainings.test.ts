import { describe, expect, it } from 'vitest';
import { isTrackOnMyTrainings } from '@/lib/services/track-loader';
import { isNavActive } from '@/components/layout/NavLink';

const published = {
  status: 'PUBLISHED' as const,
  publishedVersionId: 'v1',
  assignedCohortIds: ['ALL'],
  assignedUserIds: [] as string[],
  divisionId: 'TELEHEALTH' as const,
};

describe('My Trainings list (every role takes assigned trainings)', () => {
  it('lists an Every Cohort Track for staff even without the Track Division', () => {
    for (const role of ['TRAINER', 'ADMIN', 'SUPER_ADMIN'] as const) {
      expect(isTrackOnMyTrainings(published, { role, uid: 's', partnerCohortId: 'INTERNAL', divisionIds: [] })).toBe(true);
    }
  });

  it('keeps the Division gate for agents and supervisors', () => {
    for (const role of ['AGENT', 'PARTNER_SUPERVISOR'] as const) {
      expect(isTrackOnMyTrainings(published, { role, uid: 'a', partnerCohortId: 'THS', divisionIds: ['TELEHEALTH'] })).toBe(true);
      expect(isTrackOnMyTrainings(published, { role, uid: 'a', partnerCohortId: 'THS', divisionIds: ['INBOUND'] })).toBe(false);
    }
  });

  it('lists only assigned, published Tracks', () => {
    const internalOnly = { ...published, assignedCohortIds: ['THS'] };
    expect(isTrackOnMyTrainings(internalOnly, { role: 'TRAINER', uid: 't', partnerCohortId: 'INTERNAL' })).toBe(false);
    expect(
      isTrackOnMyTrainings({ ...internalOnly, assignedUserIds: ['t'] }, { role: 'TRAINER', uid: 't', partnerCohortId: 'INTERNAL' }),
    ).toBe(true);
    expect(
      isTrackOnMyTrainings({ ...published, assignedCohortIds: ['INTERNAL'] }, { role: 'ADMIN', uid: 'x', partnerCohortId: 'INTERNAL' }),
    ).toBe(true);
    expect(isTrackOnMyTrainings({ ...published, status: 'DRAFT' }, { role: 'ADMIN', uid: 'x', partnerCohortId: 'INTERNAL' })).toBe(false);
  });

  it('lights My Trainings on Track pages but not on the Retention page', () => {
    expect(isNavActive('/learn', '/learn')).toBe(true);
    expect(isNavActive('/learn/abc', '/learn')).toBe(true);
    expect(isNavActive('/learn/review', '/learn')).toBe(false);
    expect(isNavActive('/learn/review', '/learn/review')).toBe(true);
  });
});
