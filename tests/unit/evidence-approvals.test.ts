import { describe, expect, it } from 'vitest';
import type { SecretSimScenarioConfig, TrackUnit } from '@/lib/schemas/curriculum';
import type { ClaimEvidence } from '@/lib/schemas/source-truth';
import {
  carryEvidenceApproval,
  findRubricEvidence,
  reconcileRubricEvidenceApprovals,
  reconcileUnitEvidenceApprovals,
  replaceRubricEvidence,
} from '@/lib/services/evidence-approvals';

function evidence(overrides: Partial<ClaimEvidence> = {}): ClaimEvidence {
  return {
    id: 'u1-c1-e1',
    claim: 'Anchor on the 3-month bundle when cost comes up.',
    ruleIds: [],
    excerpts: [{ documentId: 'doc', revisionId: 'rev', pageNumber: 3, exactText: 'Anchor on the 3-month bundle', fromApprovedTranscription: false }],
    support: 'supported',
    approvalStatus: 'draft',
    critical: false,
    requiresInterfaceDetails: false,
    reviewerUid: null,
    reviewedAt: null,
    ...overrides,
  };
}

const approved = evidence({ approvalStatus: 'approved', reviewerUid: 'trainer-1', reviewedAt: 1_700_000_000_000 });

describe('carryEvidenceApproval', () => {
  it('keeps the persisted approval when a stale browser copy of unchanged evidence is saved', () => {
    expect(carryEvidenceApproval(evidence(), approved)).toEqual(approved);
  });

  it('drops the approval when the claim or excerpt changed', () => {
    const edited = carryEvidenceApproval(evidence({ claim: 'Edited claim' }), approved);
    expect(edited.approvalStatus).toBe('draft');
    expect(edited.reviewerUid).toBeNull();
    const moved = carryEvidenceApproval(
      evidence({ excerpts: [{ ...approved.excerpts[0], exactText: 'Different text' }] }),
      approved,
    );
    expect(moved.approvalStatus).toBe('draft');
  });

  it('never accepts an approval written by the client', () => {
    const forged = carryEvidenceApproval(evidence({ approvalStatus: 'approved', reviewerUid: 'me', reviewedAt: 1 }), evidence());
    expect(forged).toMatchObject({ approvalStatus: 'draft', reviewerUid: null, reviewedAt: null });
    const unknown = carryEvidenceApproval(evidence({ id: 'new', approvalStatus: 'approved', reviewerUid: 'me', reviewedAt: 1 }), undefined);
    expect(unknown.approvalStatus).toBe('draft');
  });
});

describe('draft save reconciliation', () => {
  it('carries approvals across Briefing Cards and Drills by evidence id', () => {
    const persisted = [{
      id: 'u1', orderIndex: 0, title: 'U', summary: 'S', estimatedMinutes: 5,
      briefingCards: [{ id: 'u1-c1', evidence: [approved] }],
      drills: [{ id: 'u1-d1', evidence: [{ ...approved, id: 'u1-d1-e1' }] }],
    }] as unknown as TrackUnit[];
    const incoming = [{
      ...persisted[0],
      briefingCards: [{ id: 'u1-c1', evidence: [evidence()] }],
      drills: [{ id: 'u1-d1', evidence: [evidence({ id: 'u1-d1-e1', claim: 'changed' })] }],
    }] as unknown as TrackUnit[];
    const [unit] = reconcileUnitEvidenceApprovals(persisted, incoming);
    expect(unit.briefingCards[0].evidence?.[0].approvalStatus).toBe('approved');
    expect(unit.drills[0].evidence?.[0].approvalStatus).toBe('draft');
  });

  it('carries Sim rubric approvals and finds/replaces rubric evidence', () => {
    const secret = {
      scenarioId: 's1',
      rubricCriteria: [{ id: 's1-r1', evidence: [evidence({ id: 's1-r1-e1' })] }],
    } as unknown as SecretSimScenarioConfig;
    expect(findRubricEvidence([secret], 's1-r1-e1')?.id).toBe('s1-r1-e1');
    expect(findRubricEvidence([secret], 'missing')).toBeUndefined();
    const persisted = replaceRubricEvidence([secret], 's1-r1-e1', { ...approved, id: 's1-r1-e1' });
    expect(findRubricEvidence(persisted, 's1-r1-e1')?.approvalStatus).toBe('approved');
    const [saved] = reconcileRubricEvidenceApprovals(persisted, [secret]);
    expect(saved.rubricCriteria[0].evidence?.[0]).toMatchObject({ approvalStatus: 'approved', reviewerUid: 'trainer-1' });
  });
});
