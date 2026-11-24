import { describe, expect, it } from 'vitest';
import { isTrackAssignedToUser } from '@/lib/services/track-loader';
import { normalizeExtraCohorts } from '@/lib/services/memberships';
import { PublishTrackRequestSchema } from '@/lib/schemas/api';

describe('Track assignment to Cohorts and people (2026-11-24)', () => {
  const track = { assignedCohortIds: ['THS'], assignedUserIds: ['u-named'] };

  it('reaches the home Cohort, an extra Cohort, or a named person', () => {
    expect(isTrackAssignedToUser(track, { partnerCohortId: 'THS', uid: 'a' })).toBe(true);
    expect(isTrackAssignedToUser(track, { partnerCohortId: 'DOZ', uid: 'b', cohortIds: ['THS'] })).toBe(true);
    expect(isTrackAssignedToUser(track, { partnerCohortId: 'DOZ', uid: 'u-named' })).toBe(true);
    expect(isTrackAssignedToUser(track, { partnerCohortId: 'DOZ', uid: 'c', cohortIds: ['NGA'] })).toBe(false);
    expect(isTrackAssignedToUser({ assignedCohortIds: ['ALL'] }, { partnerCohortId: 'DOZ' })).toBe(true);
  });

  it('keeps extra Cohorts unique and never the home Cohort', () => {
    expect(normalizeExtraCohorts(['THS', ' DOZ ', 'THS', 'INTERNAL'], 'INTERNAL')).toEqual(['THS', 'DOZ']);
  });

  it('publishes to people only, Cohorts only, or both, but not to nobody', () => {
    expect(PublishTrackRequestSchema.safeParse({ assignedUserIds: ['u1'] }).success).toBe(true);
    expect(PublishTrackRequestSchema.safeParse({ assignedCohortIds: ['THS'] }).success).toBe(true);
    expect(PublishTrackRequestSchema.safeParse({ assignedCohortIds: [], assignedUserIds: [] }).success).toBe(false);
  });
});
