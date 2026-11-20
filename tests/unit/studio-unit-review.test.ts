import { describe, expect, it } from 'vitest';
import { TrackUnitSchema, TrackVersionDocSchema, type TrackUnit, type TrackVersionDoc } from '@/lib/schemas/curriculum';
import type { ClaimEvidence } from '@/lib/schemas/source-truth';
import {
  itemNeedsEvidenceReview,
  MAX_UNIT_DRILLS,
  planAddedDrill,
  refreshUnitReviewNotes,
  trackAttention,
  unitAttention,
} from '@/components/studio/unit-review';
import { pillars, unit as fixtureUnit } from './helpers/fixtures';

function evidence(id: string, support: ClaimEvidence['support'] = 'supported'): ClaimEvidence {
  return {
    id,
    claim: 'Verify before refunds.',
    ruleIds: [],
    excerpts: [{ documentId: 'doc', revisionId: 'rev', pageNumber: 2, exactText: 'Verify before refunds.', fromApprovedTranscription: false }],
    support,
    approvalStatus: support === 'supported' ? 'approved' : 'draft',
    critical: false,
    requiresInterfaceDetails: false,
    reviewerUid: support === 'supported' ? 'trainer' : null,
    reviewedAt: support === 'supported' ? 1 : null,
  };
}

function grounded(id: string, index: number): TrackUnit {
  const base = fixtureUnit(id, index);
  return {
    ...base,
    briefingCards: base.briefingCards.map((card) => ({ ...card, evidence: [evidence(`${card.id}-e1`)] })),
    drills: base.drills.map((drill) => ({ ...drill, evidence: [evidence(`${drill.id}-e1`)] })),
  };
}

function thin(id: string, index: number): TrackUnit {
  const base = grounded(id, index);
  return { ...base, drills: base.drills.slice(0, 1), reviewNotes: ['Needs more Drills: 1 written, 4 planned at minimum.', 'Check page 4 wording.'] };
}

function draftOf(units: TrackUnit[]): TrackVersionDoc {
  return TrackVersionDocSchema.parse({
    versionId: 'draft', trackId: 't1', versionNumber: 1, competencyPillars: pillars, units, simScenarios: [], publishedAt: null, createdAt: 1,
  });
}

describe('unit review attention', () => {
  it('flags items with missing or not exactly supported evidence', () => {
    expect(itemNeedsEvidenceReview({ evidence: [evidence('a')] })).toBe(false);
    expect(itemNeedsEvidenceReview({ evidence: [evidence('a'), evidence('b', 'unsupported')] })).toBe(true);
    expect(itemNeedsEvidenceReview({ evidence: [] })).toBe(true);
    expect(itemNeedsEvidenceReview({})).toBe(true);
  });

  it('reports the live shortfall, build notes and flagged items for a thin Checkpoint', () => {
    const unit = thin('u1', 0);
    unit.drills[0] = { ...unit.drills[0], evidence: [evidence('x', 'partially_supported')] };
    const attention = unitAttention(unit, 1);
    expect(attention.shortfall).toBe('Checkpoint 1 (Unit 1) has only 1 of 4 Drills.');
    expect(attention.drillsNeeded).toBe(3);
    expect(attention.cardsNeeded).toBe(0);
    expect(attention.notes).toEqual(unit.reviewNotes);
    expect(attention.drillIdsNeedingEvidence).toEqual([unit.drills[0].id]);
  });

  it('summarizes only the Checkpoints that need attention', () => {
    const summary = trackAttention([grounded('u1', 0), thin('u2', 1)]);
    expect(summary.units.map((unit) => [unit.unitId, unit.unitNumber])).toEqual([['u2', 2]]);
    expect(summary.thinUnitCount).toBe(1);
    expect(summary.itemsNeedingEvidence).toBe(0);
  });

  it('drops a "Needs more Drills" note once the minimum is met and keeps other notes', () => {
    const unit = thin('u1', 0);
    expect(refreshUnitReviewNotes(unit)).toBe(unit);
    const filled = { ...unit, drills: grounded('u1', 0).drills.slice(0, 4) };
    expect(refreshUnitReviewNotes(filled).reviewNotes).toEqual(['Check page 4 wording.']);
    const onlyShortfall = { ...filled, reviewNotes: ['Needs more Drills: 1 written, 4 planned at minimum.'] };
    expect('reviewNotes' in refreshUnitReviewNotes(onlyShortfall)).toBe(false);
  });
});

describe('planAddedDrill', () => {
  it('appends a schema-valid placeholder with a new id and unapproved evidence', () => {
    const draft = draftOf([grounded('u1', 0), thin('u2', 1)]);
    const plan = planAddedDrill(draft, 'u2');
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const unit = plan.draft.units.find((candidate) => candidate.id === 'u2')!;
    expect(unit.drills).toHaveLength(2);
    expect(plan.placeholder.id).toBe('u2-d2');
    expect(new Set(plan.draft.units.flatMap((candidate) => candidate.drills.map((drill) => drill.id))).size)
      .toBe(plan.draft.units.reduce((sum, candidate) => sum + candidate.drills.length, 0));
    // The least-used kind in the thin Unit is chosen so the new Drill adds variety.
    expect(plan.placeholder.kind).not.toBe(thin('u2', 1).drills[0].kind);
    expect(plan.placeholder.evidence?.every((item) => item.approvalStatus === 'draft' && item.reviewerUid === null && item.id.startsWith('u2-d2-e'))).toBe(true);
    expect(TrackUnitSchema.safeParse(unit).success).toBe(true);
    expect(TrackVersionDocSchema.safeParse(plan.draft).success).toBe(true);
  });

  it('refuses a missing or full Checkpoint', () => {
    const full = grounded('u1', 0);
    const ten = { ...full, drills: Array.from({ length: MAX_UNIT_DRILLS }, (_, i) => ({ ...full.drills[i % full.drills.length], id: `u1-x${i}` })) };
    expect(planAddedDrill(draftOf([ten]), 'u1')).toMatchObject({ ok: false, code: 'UNIT_FULL' });
    expect(planAddedDrill(draftOf([full]), 'nope')).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });
});
