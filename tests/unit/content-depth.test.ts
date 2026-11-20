import { describe, expect, it } from 'vitest';
import {
  DEFAULT_UNIT_CONTENT_PLAN,
  DEPTH_LIMITS,
  measurePage,
  measureSourceDepth,
  planForRuleSignals,
  planUnitContent,
  unitRangeForTarget,
  estimateTrackMinutes,
} from '@/lib/ai/pipeline/content-depth';
import { buildBlueprintSchema, buildBlueprintUserPrompt, finalizeBlueprint } from '@/lib/ai/prompts/blueprint';
import { buildUnitGenerationSchema, buildUnitUserPrompt } from '@/lib/ai/prompts/unit-builder';

const RULE_PAGE = [
  'REFUND POLICY',
  '- Agents must verify the order number before any refund.',
  '- Never promise a refund over $50 without a supervisor.',
  '- Refunds are processed within 5 business days.',
  '1. Confirm the caller name.',
  '2. Confirm the shipping address.',
  'If the caller asks to cancel, transfer to the retention queue.',
  'Always read the compliance disclosure word for word.',
].join('\n');

function pages(count: number, text = RULE_PAGE) {
  return Array.from({ length: count }, (_, i) => ({ pageNumber: i + 1, text }));
}

describe('content depth', () => {
  it('counts rule statements and headings on a page', () => {
    const page = measurePage(1, RULE_PAGE);
    expect(page.headings).toBe(1);
    expect(page.ruleSignals).toBe(7);
  });

  it('ignores prose with no rules', () => {
    const page = measurePage(1, 'Welcome to the team. We are glad you are here with us today.');
    expect(page.ruleSignals).toBe(0);
  });

  it('gives a short flyer fewer Units than a long SOP', () => {
    const short = measureSourceDepth(pages(1));
    const long = measureSourceDepth(pages(20));
    expect(short.units.target).toBe(DEPTH_LIMITS.minUnits);
    expect(long.units.target).toBeGreaterThan(short.units.target + 4);
    expect(long.units.max).toBeLessThanOrEqual(DEPTH_LIMITS.maxUnits);
    expect(long.units.min).toBeLessThanOrEqual(long.units.target);
  });

  it('sizes cards and drills to rule density inside the limits', () => {
    const light = planForRuleSignals(2);
    const dense = planForRuleSignals(30);
    expect(light.cards.target).toBe(DEPTH_LIMITS.minCards);
    expect(light.drills.target).toBe(DEPTH_LIMITS.minDrills);
    expect(dense.cards.target).toBe(DEPTH_LIMITS.maxCards);
    expect(dense.drills.target).toBe(DEPTH_LIMITS.maxDrills);
  });

  it('splits a shared page between the Units that cite it', () => {
    const depth = measureSourceDepth(pages(2));
    const [alone] = planUnitContent(depth, [[1]]);
    const [sharedA, sharedB] = planUnitContent(depth, [[1], [1]]);
    expect(sharedA.ruleSignals).toBeCloseTo(alone.ruleSignals / 2);
    expect(sharedB.ruleSignals).toBeCloseTo(sharedA.ruleSignals);
  });

  it('enforces the measured Unit range in the blueprint schema and prompt', () => {
    const schema = buildBlueprintSchema(4, { min: 3, max: 4 });
    const unit = { title: 'Unit title', summary: 'Summary text', focus: 'Focus on the rules', sourcePages: [1], pillarKeys: ['compliance_boundaries'] };
    const base = {
      campaignCode: 'TEST',
      globalSummary: 'x'.repeat(100),
      competencyPillars: ['compliance_boundaries', 'workflow_execution', 'retention_objection', 'empathy_communication'].map((key) => ({
        key,
        label: `Pillar ${key}`,
        description: 'What the agent must do well.',
      })),
    };
    expect(schema.safeParse({ ...base, units: [unit, unit] }).success).toBe(false);
    const prompt = buildBlueprintUserPrompt({
      trackTitle: 'Test',
      campaignCode: '',
      divisionId: 'TELEHEALTH',
      pages: pages(4),
      unitRange: { min: 3, target: 4, max: 4 },
    });
    expect(prompt).toContain('UNIT COUNT: plan 3 to 4 Units (aim for 4)');
  });

  it('attaches a per-Unit plan in finalizeBlueprint and uses it in the Unit schema and prompt', () => {
    const generated = {
      campaignCode: 'TEST',
      globalSummary: 'x'.repeat(100),
      competencyPillars: ['compliance_boundaries', 'workflow_execution', 'retention_objection', 'empathy_communication'].map((key) => ({
        key: key as 'compliance_boundaries',
        label: `Pillar ${key}`,
        description: 'What the agent must do well.',
      })),
      units: [
        { title: 'Light', summary: 'Summary text', focus: 'Focus', sourcePages: [1], pillarKeys: ['compliance_boundaries' as const] },
        { title: 'Dense', summary: 'Summary text', focus: 'Focus', sourcePages: [2, 3, 4, 5], pillarKeys: ['compliance_boundaries' as const] },
      ],
    };
    const blueprint = finalizeBlueprint(generated, 5, '', pages(5));
    const [light, dense] = blueprint.units;
    expect(dense.contentPlan!.cards.target).toBeGreaterThan(light.contentPlan!.cards.target);

    const withoutPages = finalizeBlueprint(generated, 5, '');
    expect(withoutPages.units[0].contentPlan).toEqual(DEFAULT_UNIT_CONTENT_PLAN);

    const schema = buildUnitGenerationSchema({ pillarIds: ['pillar_compliance_boundaries'], allowedPages: [2, 3, 4, 5], contentPlan: dense.contentPlan });
    const tooFew = schema.safeParse({ briefingCards: [], drills: [] });
    expect(tooFew.success).toBe(false);
    if (!tooFew.success) {
      const cardIssue = tooFew.error.issues.find((issue) => issue.path[0] === 'briefingCards');
      expect(cardIssue && 'minimum' in cardIssue ? cardIssue.minimum : null).toBe(dense.contentPlan!.cards.min);
    }
    const prompt = buildUnitUserPrompt({
      trackTitle: 'Test',
      campaignCode: '',
      divisionId: 'TELEHEALTH',
      globalSummary: 'Summary',
      pillars: blueprint.competencyPillars,
      outline: dense,
      pages: pages(5).slice(1),
      otherUnitTitles: [],
    });
    expect(prompt).toContain(`CONTENT SIZE`);
    expect(prompt).toContain(`aim for ${dense.contentPlan!.cards.target}`);
  });

  it('builds a ±1 range around a trainer target and keeps it inside the limits', () => {
    expect(unitRangeForTarget(6)).toEqual({ min: 5, target: 6, max: 7 });
    expect(unitRangeForTarget(2)).toEqual({ min: 2, target: 2, max: 3 });
    expect(unitRangeForTarget(40).max).toBe(DEPTH_LIMITS.maxUnits);
    expect(estimateTrackMinutes(9, 104)).toBeGreaterThan(estimateTrackMinutes(3, 20));
  });
});
