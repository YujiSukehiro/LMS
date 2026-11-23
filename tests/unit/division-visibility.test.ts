/** GATE-05 (QA H2): a Track shows only to learners whose Cohort is assigned AND whose Divisions include its Division. */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/firebase/admin', () => ({ adminDb: {} }));

const { isTrackAssignedToLearner, isTrackVisibleToLearner } = await import('@/lib/services/track-loader');
const { TRAINING_POLICY } = await import('@/lib/policy/training-policy');

const telehealthTrack = {
  status: 'PUBLISHED' as const,
  publishedVersionId: 'v1',
  assignedCohortIds: ['THS', 'DOZ'],
  divisionId: 'TELEHEALTH' as const,
};

describe('division visibility (GATE-05)', () => {
  it('is on', () => {
    expect(TRAINING_POLICY.enforceLearnerDivisionVisibility).toBe(true);
  });

  it('hides a Telehealth Track from an Inbound-only agent in an assigned Cohort', () => {
    expect(isTrackVisibleToLearner(telehealthTrack, { partnerCohortId: 'DOZ', divisionIds: ['INBOUND'] })).toBe(false);
    expect(isTrackAssignedToLearner(telehealthTrack, { partnerCohortId: 'DOZ', divisionIds: ['INBOUND'] })).toBe(false);
  });

  it('shows it to a Telehealth agent in an assigned Cohort, and not to one in another Cohort', () => {
    expect(isTrackVisibleToLearner(telehealthTrack, { partnerCohortId: 'THS', divisionIds: ['TELEHEALTH', 'INBOUND'] })).toBe(true);
    expect(isTrackVisibleToLearner(telehealthTrack, { partnerCohortId: 'NGA', divisionIds: ['TELEHEALTH'] })).toBe(false);
  });

  it('fails closed when a learner record has no divisionIds', () => {
    expect(isTrackVisibleToLearner(telehealthTrack, { partnerCohortId: 'THS' })).toBe(false);
  });

  it('never shows a draft Track', () => {
    expect(isTrackVisibleToLearner({ ...telehealthTrack, status: 'DRAFT' as const }, { partnerCohortId: 'THS', divisionIds: ['TELEHEALTH'] })).toBe(false);
  });
});
