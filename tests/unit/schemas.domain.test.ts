import { describe, expect, it } from 'vitest';
import {
  CohortDocSchema,
  DivisionIdSchema,
  PulseCustomClaimsSchema,
  SessionUserSchema,
  UserDocSchema,
  UserPreferencesSchema,
  UserRoleSchema,
} from '@/lib/schemas/domain';

const baseUser = {
  uid: 'u1',
  email: 'lc-1042@roster.logicall.internal',
  authMethod: 'LC_ID_PASSWORD' as const,
  lcNumber: 'LC-1042',
  displayName: 'Ana Morales',
  role: 'AGENT' as const,
  partnerCohortId: 'THS',
  divisionIds: ['INBOUND' as const],
  active: true,
  deactivatedAt: null,
  stats: {
    totalXp: 120,
    currentStreakDays: 3,
    lastActiveDateUtc: '2026-10-30',
    tracksCertifiedCount: 1,
    simulationsPassedCount: 1,
    overallReadinessScore: 82,
  },
  skillScoresByPillar: {
    verification_crm: { pillarKey: 'verification_crm', pillarLabel: 'Verification', attempts: 4, weightedScoreSum: 300, averageScore: 75 },
  },
  preferences: { soundEffects: true, compactMode: false, theme: 'dark' as const },
  createdAt: 1_760_000_000_000,
  updatedAt: { seconds: 1_760_000_000, nanoseconds: 0 },
};

describe('domain schemas', () => {
  it('accepts the 3 Divisions and 5 roles only', () => {
    expect(DivisionIdSchema.options).toEqual(['TELEHEALTH', 'INBOUND', 'OUTBOUND']);
    expect(UserRoleSchema.options).toEqual(['SUPER_ADMIN', 'ADMIN', 'TRAINER', 'PARTNER_SUPERVISOR', 'AGENT']);
    expect(DivisionIdSchema.safeParse('SALES').success).toBe(false);
    expect(UserRoleSchema.safeParse('OWNER').success).toBe(false);
  });

  it('validates a complete LC-ID user document with a Firestore timestamp', () => {
    expect(UserDocSchema.parse(baseUser).lcNumber).toBe('LC-1042');
  });

  it('rejects an invalid email and an out-of-range readiness score', () => {
    expect(UserDocSchema.safeParse({ ...baseUser, email: 'not-an-email' }).success).toBe(false);
    expect(
      UserDocSchema.safeParse({ ...baseUser, stats: { ...baseUser.stats, overallReadinessScore: 140 } }).success,
    ).toBe(false);
  });

  it('applies preference defaults', () => {
    expect(UserPreferencesSchema.parse({})).toEqual({ soundEffects: true, compactMode: false, theme: 'light' });
  });

  it('validates a Cohort document', () => {
    const cohort = {
      id: 'THS',
      name: 'THS (Nicaragua)',
      isInternal: false,
      defaultDivisionIds: ['TELEHEALTH', 'INBOUND'],
      activeAgentCount: 12,
      joinCode: 'THS-7842',
      joinCodeEnabled: true,
      createdAt: 1,
      updatedAt: 2,
    };
    expect(CohortDocSchema.parse(cohort).id).toBe('THS');
    expect(CohortDocSchema.safeParse({ ...cohort, id: 'T' }).success).toBe(false);
    expect(CohortDocSchema.safeParse({ ...cohort, activeAgentCount: -1 }).success).toBe(false);
  });

  it('validates custom claims and session users', () => {
    expect(
      PulseCustomClaimsSchema.parse({ role: 'TRAINER', partnerCohortId: 'INTERNAL', divisionIds: ['TELEHEALTH'], active: true }).role,
    ).toBe('TRAINER');
    expect(
      SessionUserSchema.safeParse({
        uid: 'u1',
        email: 'a@logicall.io',
        displayName: 'A',
        role: 'AGENT',
        partnerCohortId: 'INTERNAL',
        divisionIds: [],
        active: false,
      }).success,
    ).toBe(false);
  });
});
