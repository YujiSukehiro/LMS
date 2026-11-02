import { describe, expect, it } from 'vitest';
import {
  ClaimInviteRequestSchema,
  CompleteUnitRequestSchema,
  PublishTrackRequestSchema,
  RegenerateItemRequestSchema,
  RosterImportRequestSchema,
} from '@/lib/schemas/api';

describe('API request schemas', () => {
  it('requires an LC Number in claim-invite', () => {
    expect(
      ClaimInviteRequestSchema.safeParse({ joinCode: 'THS-7842', displayName: 'Ana', lcNumber: 'LC-1042', password: 'Secret123!' }).success,
    ).toBe(true);
    expect(
      ClaimInviteRequestSchema.safeParse({ joinCode: 'THS-7842', displayName: 'Ana', lcNumber: '1042', password: 'Secret123!' }).success,
    ).toBe(false);
  });

  it('requires an LC Number or email on every roster row', () => {
    const row = { displayName: 'Ana', role: 'AGENT', partnerCohortId: 'THS', divisionIds: ['INBOUND'] };
    expect(RosterImportRequestSchema.safeParse({ rows: [row] }).success).toBe(false);
    expect(RosterImportRequestSchema.safeParse({ rows: [{ ...row, lcNumber: 'LC-1042' }] }).success).toBe(true);
  });

  it('validates progress, publish and regenerate payloads', () => {
    expect(
      CompleteUnitRequestSchema.safeParse({ trackId: 't', versionId: 'v1', unitId: 'u1', drillResults: [] }).success,
    ).toBe(false);
    expect(PublishTrackRequestSchema.safeParse({ assignedCohortIds: [] }).success).toBe(false);
    expect(RegenerateItemRequestSchema.safeParse({ targetType: 'DRILL', unitId: 'u1', itemId: 'u1-d1' }).success).toBe(true);
    expect(RegenerateItemRequestSchema.safeParse({ targetType: 'QUESTION', itemId: 'x' }).success).toBe(false);
  });
});
