import { describe, expect, it } from 'vitest';
import {
  CriticalSourceInputError,
  planSourceBudget,
  sourcePageRef,
} from '@/lib/ai/pipeline/source-budget';
import { buildBlueprintUserPrompt } from '@/lib/ai/prompts/blueprint';
import { buildUnitUserPrompt } from '@/lib/ai/prompts/unit-builder';
import { buildSimUserPrompt } from '@/lib/ai/prompts/sim-builder';
import {
  SharedRulePackSchema,
  SourcePageEvidenceSchema,
  type SourcePageEvidence,
} from '@/lib/schemas/source-truth';

const HASH = `sha256:${'a'.repeat(64)}`;

function page(documentId: string, pageNumber: number, text: string): SourcePageEvidence {
  return SourcePageEvidenceSchema.parse({
    id: `${documentId}-${pageNumber}`,
    documentId,
    revisionId: `${documentId}-rev1`,
    pageNumber,
    rawText: text,
    normalizedText: text,
    contentHash: HASH,
    characterCount: text.length,
    extractionFlags: [],
    transcription: null,
    approvedExcerpts: [],
  });
}

const sharedText = 'Compliance: Agents must self-identify and honor opt-out requests immediately.';
const sharedPage = page('shared-foundation', 14, sharedText);
const sharedPack = SharedRulePackSchema.parse({
  id: 'standard-meds-shared',
  revision: 'rules-rev1',
  title: 'Standard Meds shared foundation',
  sourceDocumentIds: ['shared-foundation'],
  approvalStatus: 'approved',
  createdAt: 1,
  updatedAt: 1,
  rules: [
    {
      id: 'shared-identity-optout',
      packId: 'standard-meds-shared',
      title: 'Identity and opt out',
      statement: 'Self-identify and immediately honor opt-out requests.',
      severity: 'critical',
      applicableTrackIds: ['ED', 'NeuroCalmRx', 'LiftRx'],
      channels: ['voice'],
      stages: ['opening', 'closing'],
      requiredKnowledge: true,
      requiredScenarioCoverage: true,
      sourceRevision: 'shared-foundation-rev1',
      approvalStatus: 'approved',
      approvedByUid: 'trainer-1',
      approvedAt: 1,
      evidence: {
        id: 'shared-identity-optout-evidence',
        claim: 'Agents must self-identify and honor opt-out requests.',
        ruleIds: ['shared-identity-optout'],
        support: 'supported',
        approvalStatus: 'approved',
        reviewerUid: 'trainer-1',
        reviewedAt: 1,
        critical: true,
        excerpts: [
          {
            documentId: 'shared-foundation',
            revisionId: 'shared-foundation-rev1',
            pageNumber: 14,
            exactText: sharedText,
            fromApprovedTranscription: false,
          },
        ],
      },
    },
  ],
});

const pillars = [
  { id: 'pillar_compliance_boundaries', key: 'compliance_boundaries', label: 'Compliance', description: 'Follow approved compliance rules.' },
];
const outline = {
  id: 'u1',
  orderIndex: 0,
  title: 'ED opening',
  summary: 'Open an ED recovery call compliantly.',
  focus: 'Identity and opt-out handling.',
  sourcePages: [1],
  pillarIds: ['pillar_compliance_boundaries'],
};

describe('critical source prompt budgeting', () => {
  it('supplies ED and inherited shared-foundation inputs to every applicable generation stage', () => {
    const edPage = page('ED', 1, 'ED recovery calls discuss the approved account status.');
    const sourceReview = { pages: [edPage, sharedPage], rulePacks: [sharedPack], assets: [] };
    const budget = planSourceBudget({
      stage: 'unit:u1',
      pages: sourceReview.pages,
      rulePacks: sourceReview.rulePacks,
      selectedPageNumbers: [1],
      preferredPageOrder: [1],
      charBudget: 5000,
    });

    expect(budget.report.includedPages.map(sourcePageRef)).toContain('shared-foundation@shared-foundation-rev1#14');
    expect(budget.report.includedExcerpts.map((excerpt) => excerpt.exactText)).toContain(sharedText);

    const unitPrompt = buildUnitUserPrompt({
      trackTitle: 'ED', campaignCode: 'ED', divisionId: 'OUTBOUND', globalSummary: 'ED recovery.',
      pillars, outline, pages: [{ pageNumber: 1, text: edPage.normalizedText }], otherUnitTitles: [], sourceReview,
    });
    const blueprintPrompt = buildBlueprintUserPrompt({
      trackTitle: 'ED', campaignCode: 'ED', divisionId: 'OUTBOUND', pages: [{ pageNumber: 1, text: edPage.normalizedText }], sourceReview,
    });
    const simPrompt = buildSimUserPrompt({
      trackTitle: 'ED', campaignCode: 'ED', divisionId: 'OUTBOUND', globalSummary: 'ED recovery.',
      pillars, unitTitles: ['ED opening'], pages: [{ pageNumber: 1, text: edPage.normalizedText }],
      preferredPageOrder: [1], sourceReview,
    });

    for (const prompt of [unitPrompt, blueprintPrompt, simPrompt]) {
      expect(prompt).toContain('ruleId=shared-identity-optout');
      expect(prompt).toContain('(document shared-foundation, page 14)');
      expect(prompt).toContain(sharedText);
    }
  });

  it('keeps critical inputs ahead of citation frequency and reports omitted optional pages', () => {
    const optional = page('ED', 8, 'Optional product history. '.repeat(20));
    const result = planSourceBudget({
      stage: 'simulations',
      pages: [optional, sharedPage],
      rulePacks: [sharedPack],
      preferredPageOrder: [8, 14],
      charBudget: sharedText.length + 20,
    });

    expect(result.pages.map((page) => sourcePageRef({ ...page, pageNumber: page.sourcePageNumber }))).toEqual(['shared-foundation@shared-foundation-rev1#14']);
    expect(result.report.omittedPages).toContainEqual(expect.objectContaining({ documentId: 'ED', pageNumber: 8, critical: false, reason: 'prompt_budget' }));
    expect(result.report.omittedExcerpts).toEqual([]);
  });

  it('fails closed when a required critical source page is missing', () => {
    expect(() => planSourceBudget({
      stage: 'unit:u1', pages: [], rulePacks: [sharedPack], charBudget: 5000,
    })).toThrowError(CriticalSourceInputError);

    try {
      planSourceBudget({ stage: 'unit:u1', pages: [], rulePacks: [sharedPack], charBudget: 5000 });
    } catch (error) {
      expect(error).toBeInstanceOf(CriticalSourceInputError);
      const report = (error as CriticalSourceInputError).report;
      expect(report.omittedExcerpts).toContainEqual(expect.objectContaining({ documentId: 'shared-foundation', pageNumber: 14, reason: 'page_missing' }));
    }
  });

  it('fails closed rather than truncating a critical page to fit the prompt', () => {
    expect(() => planSourceBudget({
      stage: 'blueprint', pages: [sharedPage], rulePacks: [sharedPack], charBudget: 20,
    })).toThrow(/critical_input_exceeds_budget/);
  });
});
