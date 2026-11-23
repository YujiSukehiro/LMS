/**
 * What a trainer must look at in a draft Checkpoint before publishing: build review notes (a local
 * build that only partly filled a Unit), live shortfalls against the published minimums, and items
 * whose stored evidence the build could not match exactly ("needs evidence review").
 *
 * Pure functions: used by the Studio UI and by the add-Drill route option.
 */
import { DEPTH_LIMITS, thinUnitProblems } from '@/lib/ai/pipeline/content-depth';
import type { DrillItem, TrackUnit, TrackVersionDoc } from '@/lib/schemas/curriculum';
import type { ClaimEvidence } from '@/lib/schemas/source-truth';
import { crossUnitRepeatNotes, givesAwayWord, isConditionalStep, isPositionLabel } from '@/lib/services/drill-label';

/** Most Drills a Unit may hold (TrackUnitSchema). */
export const MAX_UNIT_DRILLS = 10;

export const ADD_DRILL_HINT =
  'Write a NEW Drill for this Checkpoint. Test a different rule or step than every existing Drill; do not reword the current one.';

const DRILL_NOTE = /^Needs more Drills\b/i;
const CARD_NOTE = /^Needs more Briefing Cards\b/i;

/** True when an item has no evidence, or any stored evidence is not exactly supported by the source. */
export function itemNeedsEvidenceReview(item: { evidence?: ClaimEvidence[] }): boolean {
  return !item.evidence?.length || item.evidence.some((evidence) => evidence.support !== 'supported');
}

/**
 * Drop shortfall notes the Unit no longer has (for example after Drills were added). Returns the same
 * object when nothing changed. Other notes are kept as written.
 */
export function refreshUnitReviewNotes(unit: TrackUnit): TrackUnit {
  if (!unit.reviewNotes?.length) return unit;
  const kept = unit.reviewNotes.filter((note) => {
    if (DRILL_NOTE.test(note)) return unit.drills.length < DEPTH_LIMITS.minDrills;
    if (CARD_NOTE.test(note)) return unit.briefingCards.length < DEPTH_LIMITS.minCards;
    return true;
  });
  if (kept.length === unit.reviewNotes.length) return unit;
  const { reviewNotes: _dropped, ...rest } = unit;
  void _dropped;
  return kept.length > 0 ? { ...rest, reviewNotes: kept } : rest;
}

const LONGEST_ANSWER_RATIO = 1.3;

/**
 * Drill problems a trainer should fix before learners see them (QA L10):
 * - a multiple-choice Drill whose right answer is clearly the longest option (learners guess it without reading);
 * - a Drill whose rules no Briefing Card in this Checkpoint teaches (compared by rule id from card evidence).
 * Pure; plain one-line notes.
 */
export function drillQualityNotes(unit: Pick<TrackUnit, 'drills' | 'briefingCards'>): string[] {
  const notes: string[] = [];
  // Rules the Briefing Cards teach, from their evidence. Without rule ids on both sides there is nothing to compare.
  const taughtRules = new Set(unit.briefingCards.flatMap((card) => (card.evidence ?? []).flatMap((evidence) => evidence.ruleIds)));
  unit.drills.forEach((drill, index) => {
    const label = `Drill ${index + 1}`;
    if (drill.kind === 'MULTIPLE_CHOICE') {
      const correct = drill.options.find((option) => option.id === drill.correctOptionId);
      const others = drill.options.filter((option) => option.id !== drill.correctOptionId).map((option) => option.text.trim().length);
      if (correct && others.length > 0 && correct.text.trim().length >= Math.max(...others) * LONGEST_ANSWER_RATIO) {
        notes.push(`${label}: the right answer is clearly the longest option. Shorten it or lengthen the others.`);
      }
    }
    if (drill.kind === 'SEQUENCE_ORDER' && drill.orderedSteps.some((step) => isConditionalStep(step.text))) {
      notes.push(`${label} asks for an order, but some steps are options for different situations. Rewrite it as one ordered procedure or change the Drill kind.`);
    }
    if (drill.kind === 'FILL_BLANK_CHOICE' && givesAwayWord(drill.prompt, drill.correctWord)) {
      notes.push(`${label}: the question names the answer ("${drill.correctWord}"). Reword the question.`);
    }
    if (drill.kind === 'MATCH_PAIRS' && drill.pairs.some((pair) => isPositionLabel(pair.leftPrompt))) {
      notes.push(`${label}: the left side is labelled by step number, so learners match numbers, not meaning. Remove the "Step N" labels.`);
    }
    const drillRules = drill.ruleIds ?? [];
    if (taughtRules.size > 0 && drillRules.length > 0 && !drillRules.some((ruleId) => taughtRules.has(ruleId))) {
      notes.push(`${label} tests a rule that no Briefing Card in this Checkpoint teaches.`);
    }
  });
  return notes;
}

export interface UnitAttention {
  unitId: string;
  /** Build notes still true for this Unit. */
  notes: string[];
  /** Live shortfall against the publish minimums (blocks publication as UNIT_CONTENT_INCOMPLETE). */
  shortfall: string | null;
  drillsNeeded: number;
  cardsNeeded: number;
  cardIdsNeedingEvidence: string[];
  drillIdsNeedingEvidence: string[];
}

export function unitAttention(unit: TrackUnit, unitNumber?: number): UnitAttention {
  const refreshed = refreshUnitReviewNotes(unit);
  const [shortfall] = thinUnitProblems([{ ...unit, orderIndex: unitNumber !== undefined ? unitNumber - 1 : unit.orderIndex }]);
  return {
    unitId: unit.id,
    notes: [...(refreshed.reviewNotes ?? []), ...drillQualityNotes(unit)],
    shortfall: shortfall ?? null,
    drillsNeeded: Math.max(0, DEPTH_LIMITS.minDrills - unit.drills.length),
    cardsNeeded: Math.max(0, DEPTH_LIMITS.minCards - unit.briefingCards.length),
    cardIdsNeedingEvidence: unit.briefingCards.filter(itemNeedsEvidenceReview).map((card) => card.id),
    drillIdsNeedingEvidence: unit.drills.filter(itemNeedsEvidenceReview).map((drill) => drill.id),
  };
}

export function unitNeedsAttention(attention: UnitAttention): boolean {
  return (
    attention.notes.length > 0 ||
    attention.shortfall !== null ||
    attention.cardIdsNeedingEvidence.length > 0 ||
    attention.drillIdsNeedingEvidence.length > 0
  );
}

export interface TrackAttention {
  units: Array<UnitAttention & { unitNumber: number; title: string }>;
  thinUnitCount: number;
  itemsNeedingEvidence: number;
}

/** Summary across the ordered Units (only Units that need attention are listed). */
export function trackAttention(units: TrackUnit[]): TrackAttention {
  const repeats = crossUnitRepeatNotes(units);
  const listed = units
    .map((unit, index) => {
      const attention = unitAttention(unit, index + 1);
      return { ...attention, notes: [...attention.notes, ...(repeats.get(index) ?? [])], unitNumber: index + 1, title: unit.title };
    })
    .filter(unitNeedsAttention);
  return {
    units: listed,
    thinUnitCount: listed.filter((unit) => unit.shortfall !== null).length,
    itemsNeedingEvidence: listed.reduce((sum, unit) => sum + unit.cardIdsNeedingEvidence.length + unit.drillIdsNeedingEvidence.length, 0),
  };
}

/** Above this, reviewers call a Track "too long" (review 2026-11-23: 6 Checkpoints, about 78 minutes). */
export const LONG_TRACK_MINUTES = 45;
/** One skill area holding more than this share of the Drills makes per-skill analytics lopsided. */
const PILLAR_SHARE_LIMIT = 0.4;

/**
 * Things worth a look before learners see the Track: every open Checkpoint note, plus length and skill-area
 * balance. Suggested, never required (Connor 2026-11-23). Pure; one line per item.
 */
export function publishReviewItems(units: TrackUnit[], pillarNames: Record<string, string> = {}): string[] {
  const items = trackAttention(units).units.flatMap((unit) => [
    ...unit.notes.map((note) => `Checkpoint ${unit.unitNumber}: ${note}`),
    ...(unit.shortfall ? [`Checkpoint ${unit.unitNumber}: ${unit.shortfall}`] : []),
  ]);
  const unapproved = units
    .flatMap((unit) => [...unit.briefingCards, ...unit.drills])
    .flatMap((item) => item.evidence ?? [])
    .filter((evidence) => evidence.approvalStatus !== 'approved').length;
  if (unapproved > 0) {
    items.push(`${unapproved} source quote${unapproved === 1 ? ' has' : 's have'} not been approved by a trainer in Source Review. Each quote matches the PDF, so this is optional.`);
  }
  const minutes = units.reduce((sum, unit) => sum + unit.estimatedMinutes, 0);
  const drills = units.reduce((sum, unit) => sum + unit.drills.length, 0);
  const cards = units.reduce((sum, unit) => sum + unit.briefingCards.length, 0);
  if (minutes > LONG_TRACK_MINUTES) {
    items.push(`The Track takes about ${minutes} minutes (${cards} cards, ${drills} Drills). Consider removing Drills that test the same rule.`);
  }
  if (drills >= 10) {
    const counts = new Map<string, number>();
    for (const unit of units) for (const drill of unit.drills) counts.set(drill.competencyPillarId, (counts.get(drill.competencyPillarId) ?? 0) + 1);
    const [pillarId, count] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? ['', 0];
    if (count / drills > PILLAR_SHARE_LIMIT) {
      items.push(`${count} of ${drills} Drills test one skill area (${pillarNames[pillarId] ?? pillarId}), so skill analytics will be lopsided.`);
    }
  }
  return items;
}

function nextDrillId(draft: TrackVersionDoc, unitId: string): string {
  const used = new Set(draft.units.flatMap((unit) => unit.drills.map((drill) => drill.id)));
  let index = 1;
  while (used.has(`${unitId}-d${index}`)) index += 1;
  return `${unitId}-d${index}`;
}

/** The Drill whose shape the new Drill copies: the least-used kind in the Unit, so new Drills add variety. */
function templateDrill(draft: TrackVersionDoc, unit: TrackUnit): DrillItem | undefined {
  const inUnit = new Map<string, number>();
  for (const drill of unit.drills) inUnit.set(drill.kind, (inUnit.get(drill.kind) ?? 0) + 1);
  const candidates = draft.units.flatMap((other) => other.drills);
  return [...candidates].sort((left, right) => (inUnit.get(left.kind) ?? 0) - (inUnit.get(right.kind) ?? 0))[0];
}

export type AddedDrillPlan =
  | { ok: true; draft: TrackVersionDoc; placeholder: DrillItem }
  | { ok: false; status: number; code: string; message: string };

/**
 * Append a placeholder Drill to one Unit: a copy of an existing Drill with a new id and its evidence
 * reset to unapproved drafts (so it can never pass the publication gates as written). The caller
 * regenerates the placeholder into a new source-grounded Drill.
 */
export function planAddedDrill(draft: TrackVersionDoc, unitId: string): AddedDrillPlan {
  const unit = draft.units.find((candidate) => candidate.id === unitId);
  if (!unit) return { ok: false, status: 404, code: 'NOT_FOUND', message: 'This Checkpoint does not exist in the draft.' };
  if (unit.drills.length >= MAX_UNIT_DRILLS) {
    return { ok: false, status: 409, code: 'UNIT_FULL', message: `This Checkpoint already has ${MAX_UNIT_DRILLS} Drills, the most a Checkpoint can hold.` };
  }
  const template = templateDrill(draft, unit);
  if (!template) return { ok: false, status: 409, code: 'NO_TEMPLATE', message: 'This draft has no Drill to start from. Rebuild the Track.' };
  const id = nextDrillId(draft, unitId);
  const placeholder: DrillItem = {
    ...template,
    id,
    variationOfDrillId: null,
    evidence: template.evidence?.map((evidence, index) => ({
      ...evidence,
      id: `${id}-e${index + 1}`,
      approvalStatus: 'draft',
      reviewerUid: null,
      reviewedAt: null,
    })),
  };
  return {
    ok: true,
    placeholder,
    draft: {
      ...draft,
      units: draft.units.map((candidate) => (candidate.id === unitId ? { ...candidate, drills: [...candidate.drills, placeholder] } : candidate)),
    },
  };
}

/** Add a server-written Drill to the local Unit without touching the trainer's other (possibly unsaved) edits. */
export function appendDrill<U extends { drills: Array<{ id: string }> }, D extends U['drills'][number]>(unit: U, drill: D): U {
  if (unit.drills.some((existing) => existing.id === drill.id)) {
    return { ...unit, drills: unit.drills.map((existing) => (existing.id === drill.id ? drill : existing)) };
  }
  return { ...unit, drills: [...unit.drills, drill] };
}
