import { describe, expect, it } from 'vitest';
import { normalizeRubricWeights, salvageScenarios } from '@/lib/ai/prompts/sim-builder';
import { bestSupportingSentence, groundOrFlagEvidence } from '@/lib/ai/prompts/evidence';
import { SourcePageEvidenceSchema } from '@/lib/schemas/source-truth';

const text = 'Welcome to the campaign.\nAgents must offer the 3-month bundle before any single-month option. Never promise a cure.';
const page = SourcePageEvidenceSchema.parse({
  id: 'd-p2', documentId: 'd', revisionId: 'd-rev', pageNumber: 2, rawText: text, normalizedText: text,
  contentHash: `sha256:${'e'.repeat(64)}`, characterCount: text.length, extractionFlags: [], transcription: null, approvedExcerpts: [],
});
const source = { pages: [page], conflicts: [] };

function scenario(weights: unknown[]) {
  return {
    publicScenario: {
      title: 'Price objection', difficulty: 'standard', counterpartyRoleLabel: 'Lead', contextTicketSummary: 'Abandoned checkout.',
      openingMessage: 'It costs too much.', dispositionOptions: ['Recovered', 'Not interested', 'Callback scheduled'], maxTurns: '8', passScoreThreshold: 80,
    },
    secretConfig: {
      personaName: 'Sam', personaBackstoryAndMood: 'Skeptical.', hiddenFactsToRevealOnlyWhenAsked: 'Has a budget.',
      conditionalBehaviors: ['Agrees if the bundle is explained.'], expectedDisposition: 'recovered', autoFailTriggers: ['Promises a cure.'],
      rubricCriteria: weights.map((weight, index) => ({
        competencyPillarId: 'pillar_product_offer_terms', criterionLabel: `Criterion ${index + 1}`,
        evaluationRule: 'The agent offers the 3-month bundle before any single-month option.', weight, sourcePages: [2],
      })),
    },
  };
}

const ctx = { pillarIds: ['pillar_product_offer_terms'], allowedPages: [2], requireEvidence: true };

describe('sim salvage', () => {
  it('rescales rubric weights to exactly 100 inside 10-50, keeping relative importance', () => {
    expect(normalizeRubricWeights([40, 40, 40])).toEqual([34, 33, 33]);
    expect(normalizeRubricWeights([60, 20, 20])?.reduce((sum, weight) => sum + weight, 0)).toBe(100);
    expect(normalizeRubricWeights([50, 50])).toEqual([50, 50]);
    expect(normalizeRubricWeights([30])).toBeNull();
  });

  it('keeps valid scenarios without evidence, rescales weights, and drops the invalid one', () => {
    const raw = JSON.stringify({ scenarios: [scenario([40, 40, '40']), scenario([50, 50])] });
    const result = salvageScenarios(raw, ctx, (index) => `s${index + 1}`);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].secretConfig.rubricCriteria.map((criterion) => criterion.weight)).toEqual([34, 33, 33]);
    expect(result.items[0].secretConfig.expectedDisposition).toBe('Recovered');
    expect(result.dropped[0]).toMatch(/scenarios\.1\.secretConfig\.rubricCriteria/);
  });

  it('accepts a single scenario object and unreadable output safely', () => {
    expect(salvageScenarios(JSON.stringify(scenario([40, 30, 30])), ctx, () => 's1').items).toHaveLength(1);
    expect(salvageScenarios('no json here', ctx, () => 's1').items).toHaveLength(0);
  });

  it('grounds a rule in a verbatim source sentence or flags it as unsupported draft evidence', () => {
    expect(bestSupportingSentence('Offer the 3-month bundle before a single-month option.', [2], source)?.sentence)
      .toBe('Agents must offer the 3-month bundle before any single-month option.');
    const grounded = groundOrFlagEvidence({ ownerId: 's1-r1', claim: 'Offer the 3-month bundle before the single-month option.', citedLabels: [2], source });
    expect(grounded[0]).toMatchObject({ id: 's1-r1-e1', support: 'supported', approvalStatus: 'draft', excerpts: [{ documentId: 'd', revisionId: 'd-rev', pageNumber: 2 }] });
    const flagged = groundOrFlagEvidence({ ownerId: 's1-r2', claim: 'Mention the weather forecast politely.', citedLabels: [2], source });
    expect(flagged[0]).toMatchObject({ support: 'unsupported', approvalStatus: 'draft', reviewerUid: null });
  });
});
