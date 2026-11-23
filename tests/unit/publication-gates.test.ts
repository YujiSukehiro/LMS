import { describe, expect, it } from 'vitest';
import { TrackVersionDocSchema, type TrackVersionDoc } from '@/lib/schemas/curriculum';
import {
  type ClaimEvidence,
  type OperationalAsset,
  type SharedRulePack,
  type SourceBundle,
  type SourceConflict,
  type SourcePageEvidence,
} from '@/lib/schemas/source-truth';
import { evaluatePublicationGates, planDraftRebind } from '@/lib/services/source-evidence';
import { pillars, scenario as baseScenario, secret as baseSecret, unit } from './helpers/fixtures';
import type { PublicSimScenario, SecretSimScenarioConfig } from '@/lib/schemas/curriculum';

const TRACK_ID = 'track-ed-synthetic';
const BUNDLE_ID = 'bundle-ed-synthetic';
const DOCUMENT_ID = 'doc-neuro-shared-synthetic';
const DOCUMENT_REVISION = 'doc-revision-1';
const SOURCE_REVISION = `sha256:${'a'.repeat(64)}`;
const RULE_ID = 'shared-local-calling-window';
const EXACT_TEXT = 'Call only 09:00–21:00 in the lead’s local timezone.';

function excerpt(exactText = EXACT_TEXT) {
  return {
    documentId: DOCUMENT_ID,
    revisionId: DOCUMENT_REVISION,
    pageNumber: 14,
    exactText,
    fromApprovedTranscription: false,
  };
}

function evidence(id: string, ruleIds = [RULE_ID]): ClaimEvidence {
  return {
    id,
    claim: 'Calls use the lead-local calling window.',
    ruleIds,
    excerpts: [excerpt()],
    support: 'supported',
    approvalStatus: 'approved',
    critical: true,
    requiresInterfaceDetails: false,
    reviewerUid: 'trainer-synthetic',
    reviewedAt: 1_700_000_000_000,
  };
}

function draft(): TrackVersionDoc {
  const sourceUnit = unit('unit-ed', 0);
  const groundedUnit = {
    ...sourceUnit,
    briefingCards: sourceUnit.briefingCards.map((card) => ({ ...card, evidence: [evidence(`evidence-${card.id}`)] })),
    drills: sourceUnit.drills.map((drill) => ({ ...drill, evidence: [evidence(`evidence-${drill.id}`)] })),
  };
  return TrackVersionDocSchema.parse({
    versionId: 'draft',
    trackId: TRACK_ID,
    versionNumber: 1,
    competencyPillars: pillars,
    units: [groundedUnit],
    simScenarios: [],
    sourceBundleId: BUNDLE_ID,
    sourceRevision: SOURCE_REVISION,
    requiredRuleIds: [RULE_ID],
    publishedAt: null,
    createdAt: 1_700_000_000_000,
  });
}

function bundle(): SourceBundle {
  return {
    schemaVersion: 1,
    id: BUNDLE_ID,
    trackId: TRACK_ID,
    documents: [{
      id: DOCUMENT_ID,
      revisionId: DOCUMENT_REVISION,
      bundleId: BUNDLE_ID,
      trackId: TRACK_ID,
      role: 'shared_foundation',
      fileName: 'synthetic-shared-rules.pdf',
      storagePath: 'synthetic/shared-rules.pdf',
      sourceVersion: 'synthetic-v1',
      effectiveDate: null,
      uploadedAt: 1_700_000_000_000,
      uploadedByUid: 'trainer-synthetic',
      contentHash: SOURCE_REVISION,
      pageCount: 15,
      inheritanceOrder: 0,
      excluded: false,
      exclusionReason: null,
    }],
    sharedRulePackIds: ['shared-pack'],
    precedencePolicyId: 'standard-meds-precedence-v1',
    conflictIds: [],
    unresolvedSmeDecisionIds: [],
    status: 'approved',
    revisionHash: SOURCE_REVISION,
    approvedSourceRevision: SOURCE_REVISION,
    approvedByUid: 'trainer-synthetic',
    approvedAt: 1_700_000_000_000,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
  };
}

function pages(): SourcePageEvidence[] {
  return [{
    id: 'page-shared-14',
    documentId: DOCUMENT_ID,
    revisionId: DOCUMENT_REVISION,
    pageNumber: 14,
    rawText: `Compliance. ${EXACT_TEXT}`,
    normalizedText: `Compliance. ${EXACT_TEXT}`,
    contentHash: `sha256:${'b'.repeat(64)}`,
    characterCount: EXACT_TEXT.length + 12,
    extractionFlags: [],
    transcription: null,
    approvedExcerpts: [excerpt()],
  }];
}

function rulePacks(): SharedRulePack[] {
  return [{
    id: 'shared-pack',
    revision: 'shared-revision-1',
    title: 'Synthetic shared foundation',
    sourceDocumentIds: [DOCUMENT_ID],
    rules: [{
      id: RULE_ID,
      packId: 'shared-pack',
      title: 'Lead-local calling window',
      statement: EXACT_TEXT,
      severity: 'critical',
      applicableTrackIds: [TRACK_ID],
      channels: ['voice'],
      stages: ['all'],
      evidence: evidence('evidence-shared-rule'),
      requiredKnowledge: true,
      requiredScenarioCoverage: true,
      sourceRevision: SOURCE_REVISION,
      approvalStatus: 'approved',
      approvedByUid: 'trainer-synthetic',
      approvedAt: 1_700_000_000_000,
    }],
    approvalStatus: 'approved',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
  }];
}

function conflict(status: SourceConflict['status'] = 'open'): SourceConflict {
  return {
    id: 'DEMO-PRICE-CONFLICT-OPEN',
    trackId: TRACK_ID,
    sourceRefs: [excerpt(), { ...excerpt(), pageNumber: 14, exactText: 'A conflicting synthetic price excerpt.' }],
    affectedProducts: ['SyntheticProduct'],
    affectedContexts: ['recovery'],
    affectedStages: ['checkout'],
    affectedAssetIds: ['offer-synthetic'],
    affectedRuleIds: [],
    detectedValues: ['$99 synthetic', '$109 synthetic'],
    severity: 'critical',
    status,
    decision: status === 'resolved' ? 'Synthetic trainer-owned decision for a test fixture.' : null,
    decisionOwnerUid: status === 'resolved' ? 'sme-synthetic' : null,
    decidedAt: status === 'resolved' ? 1_700_000_000_000 : null,
    effectiveFrom: null,
    effectiveTo: null,
    downstreamInvalidationStatus: 'not_required',
  };
}

function input(overrides: Partial<Parameters<typeof evaluatePublicationGates>[0]> = {}) {
  return {
    draft: draft(),
    bundle: bundle(),
    pages: pages(),
    rulePacks: rulePacks(),
    assets: [] as OperationalAsset[],
    conflicts: [] as SourceConflict[],
    now: 1_700_000_000_000,
    ...overrides,
  };
}

describe('publication gates', () => {
  it('passes a fully grounded, approved source revision', () => {
    const report = evaluatePublicationGates(input());
    expect(report).toMatchObject({ eligible: true, issues: [], checkedSourceRevision: SOURCE_REVISION });
  });

  it('fails closed as legacy_unknown when no source revision or bundle exists', () => {
    const legacy = TrackVersionDocSchema.parse({
      ...draft(),
      sourceBundleId: undefined,
      sourceRevision: undefined,
      requiredRuleIds: undefined,
    });
    const report = evaluatePublicationGates(input({ draft: legacy, bundle: null, pages: [], rulePacks: [] }));
    expect(report.eligible).toBe(false);
    expect(report.checkedSourceRevision).toBe('legacy_unknown');
    expect(report.issues).toContainEqual(expect.objectContaining({ code: 'SOURCE_REVISION_MISSING', blocking: true }));
  });

  it('requires trainer approval of the exact source revision, not only an approved bundle label', () => {
    const unapprovedRevision = { ...bundle(), approvedSourceRevision: null };
    const report = evaluatePublicationGates(input({ bundle: unapprovedRevision }));
    expect(report.issues).toContainEqual(expect.objectContaining({ code: 'SOURCE_NOT_APPROVED', affectedId: BUNDLE_ID }));
  });

  it('blocks unsupported exact evidence and missing trainer approval separately', () => {
    const current = draft();
    const firstCard = current.units[0].briefingCards[0];
    firstCard.evidence = [{ ...firstCard.evidence![0], excerpts: [excerpt('This exact sentence is absent from the source page.')], approvalStatus: 'draft', reviewerUid: null, reviewedAt: null }];
    const report = evaluatePublicationGates(input({ draft: current }));
    expect(report.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'CLAIM_UNSUPPORTED', affectedId: `evidence-${firstCard.id}` }),
      expect.objectContaining({ code: 'TRAINER_APPROVAL_REQUIRED', affectedId: `evidence-${firstCard.id}` }),
    ]));
  });

  it('lets an exact, unapproved quote publish with a non-blocking approval suggestion (Connor 2026-11-23)', () => {
    const current = draft();
    const firstCard = current.units[0].briefingCards[0];
    firstCard.evidence = [{ ...firstCard.evidence![0], approvalStatus: 'draft', reviewerUid: null, reviewedAt: null }];
    const report = evaluatePublicationGates(input({ draft: current }));
    expect(report.issues).toContainEqual(expect.objectContaining({ code: 'TRAINER_APPROVAL_REQUIRED', blocking: false }));
    expect(report.issues.filter((entry) => entry.blocking)).toEqual([]);
    expect(report.eligible).toBe(true);
  });

  it('blocks critical omissions of inherited shared-rule knowledge coverage', () => {
    const current = draft();
    current.units[0].briefingCards = current.units[0].briefingCards.map((card) => ({
      ...card,
      evidence: card.evidence?.map((item) => ({ ...item, ruleIds: [] })),
    }));
    current.units[0].drills = current.units[0].drills.map((drill) => ({
      ...drill,
      evidence: drill.evidence?.map((item) => ({ ...item, ruleIds: [] })),
    }));
    const report = evaluatePublicationGates(input({ draft: current }));
    expect(report.issues).toContainEqual(expect.objectContaining({ code: 'RULE_COVERAGE_MISSING', affectedId: RULE_ID, blocking: true }));
  });

  it('blocks a persisted pack-level SME register even when every other publication input is eligible', () => {
    const report = evaluatePublicationGates(input({
      bundle: { ...bundle(), status: 'approved', unresolvedSmeDecisionIds: ['SME-01', 'SME-10'] },
    }));
    expect(report.eligible).toBe(false);
    expect(report.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'SME_DECISION_REQUIRED', affectedType: 'source', affectedId: 'SME-01', blocking: true }),
      expect.objectContaining({ code: 'SME_DECISION_REQUIRED', affectedType: 'source', affectedId: 'SME-10', blocking: true }),
    ]));
  });

  it.each(['critical', 'major', 'coaching'] as const)('blocks an open %s SME conflict', (severity) => {
    const blocked = evaluatePublicationGates(input({ conflicts: [{ ...conflict(), severity }] }));
    expect(blocked.eligible).toBe(false);
    expect(blocked.issues).toContainEqual(expect.objectContaining({
      code: 'SME_DECISION_REQUIRED', affectedId: 'DEMO-PRICE-CONFLICT-OPEN', severity, blocking: true,
    }));
  });

  it('accepts an explicit recorded SME resolution', () => {
    // Keep resolved evidence on a different page so the test isolates conflict status rather than excerpt scope.
    const resolvedPages = [...pages(), { ...pages()[0], id: 'page-shared-15', pageNumber: 15, normalizedText: 'A conflicting synthetic price excerpt.' }];
    const resolved = evaluatePublicationGates(input({ pages: resolvedPages, conflicts: [conflict('resolved')] }));
    expect(resolved.issues).not.toContainEqual(expect.objectContaining({ code: 'SME_DECISION_REQUIRED' }));
  });

  it('requires approved operational-asset evidence and approver identity', () => {
    const base = draft();
    const asset: OperationalAsset = {
      id: 'link-synthetic',
      trackId: TRACK_ID,
      product: 'SyntheticProduct',
      context: 'recovery',
      stage: 'dosage',
      sourceRefs: [excerpt('Missing asset excerpt.')],
      effectiveFrom: null,
      effectiveTo: null,
      status: 'approved',
      approvedByUid: null,
      approvedAt: null,
      kind: 'link',
      linkType: 'dosage',
      host: 'synthetic.invalid',
      url: 'https://synthetic.invalid/dosage',
      personalized: false,
      permittedActions: ['display'],
    };
    const report = evaluatePublicationGates(input({ draft: base, assets: [asset] }));
    expect(report.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'ASSET_APPROVAL_INVALID', affectedId: asset.id }),
      expect.objectContaining({ code: 'ASSET_EVIDENCE_INVALID', affectedId: asset.id }),
    ]));
  });

  describe('review regressions', () => {
    function simScenario(options: string[] = ['Recovered', 'Lost', 'Organic']): PublicSimScenario {
      return {
        ...baseScenario,
        dispositionOptions: options,
        context: {
          direction: 'outbound',
          queue: 'recovery',
          product: 'SyntheticProduct',
          stage: 'dosage',
          contactState: 'lead',
          pricingPosture: 'passive',
          caseBranch: 'default',
          syntheticTimezone: 'America/New_York',
          syntheticNow: '2026-01-01T15:00:00.000Z',
          sourceRevision: SOURCE_REVISION,
          curriculumVersion: 'draft',
        },
        evidenceRequirements: {
          minimumLearnerTurns: 2,
          requiredInspections: [],
          requiredWorkflowActions: [],
          requiredWrapUpEvidence: [],
          requiredGateIds: [],
          requiredCustomerConcerns: [],
          expectedDurationMinutes: null,
          gateSourceRefs: {},
          maximumCriticalFailures: 0,
          maximumMajorFailures: 0,
        },
      };
    }
    function simSecret(): SecretSimScenarioConfig {
      return {
        ...baseSecret,
        expectedDisposition: 'Recovered',
        rubricCriteria: baseSecret.rubricCriteria.map((criterion) => ({ ...criterion, evidence: [evidence(`evidence-${criterion.id}`)] })),
      };
    }
    function ungroundedCurriculum(): TrackVersionDoc {
      const current = draft();
      current.units[0].briefingCards = current.units[0].briefingCards.map((card) => ({
        ...card, evidence: card.evidence?.map((item) => ({ ...item, ruleIds: [] })),
      }));
      current.units[0].drills = current.units[0].drills.map((drill) => ({
        ...drill, evidence: drill.evidence?.map((item) => ({ ...item, ruleIds: [] })),
      }));
      return current;
    }

    it('counts a required rule grounded only by Sim rubric evidence as covered', () => {
      const current = ungroundedCurriculum();
      current.simScenarios = [simScenario()];
      const report = evaluatePublicationGates(input({ draft: current, secrets: [simSecret()] }));
      expect(report.issues).not.toContainEqual(expect.objectContaining({ code: 'RULE_COVERAGE_MISSING' }));
    });

    it('still blocks coverage when neither curriculum nor rubric evidence references the rule', () => {
      const current = ungroundedCurriculum();
      current.simScenarios = [simScenario()];
      const secret = simSecret();
      secret.rubricCriteria = secret.rubricCriteria.map((criterion) => ({
        ...criterion, evidence: criterion.evidence?.map((item) => ({ ...item, ruleIds: [] })),
      }));
      const report = evaluatePublicationGates(input({ draft: current, secrets: [secret] }));
      expect(report.issues).toContainEqual(expect.objectContaining({ code: 'RULE_COVERAGE_MISSING', affectedId: RULE_ID }));
    });

    it('ignores unapproved rule packs that the bundle did not select', () => {
      const unselected: SharedRulePack = { ...rulePacks()[0], id: 'unselected-pack', approvalStatus: 'draft', rules: [] };
      const report = evaluatePublicationGates(input({ rulePacks: [...rulePacks(), unselected] }));
      expect(report.issues).not.toContainEqual(expect.objectContaining({ code: 'RULE_PACK_NOT_APPROVED', affectedId: 'unselected-pack' }));
      expect(report.eligible).toBe(true);
    });

    it('still blocks an unapproved pack the bundle selected', () => {
      const pack = { ...rulePacks()[0], approvalStatus: 'draft' as const };
      const report = evaluatePublicationGates(input({ rulePacks: [pack] }));
      expect(report.issues).toContainEqual(expect.objectContaining({ code: 'RULE_PACK_NOT_APPROVED', affectedId: 'shared-pack' }));
    });

    it('blocks Sims whose learner-visible disposition options are not canonical', () => {
      const current = draft();
      current.simScenarios = [simScenario(['Recovered', 'Refund - Medical', 'Lost'])];
      const report = evaluatePublicationGates(input({ draft: current, secrets: [simSecret()] }));
      const optionIssue = report.issues.find((item) => item.code === 'SCENARIO_DISPOSITION_OPTION_INVALID');
      expect(optionIssue).toMatchObject({ affectedType: 'scenario', affectedId: baseScenario.id, blocking: true });
      expect(optionIssue?.message).toContain('"Refund - Medical"');
      expect(optionIssue?.message).toContain('Callback scheduled');
    });

    it('accepts Sims whose disposition options are all canonical', () => {
      const current = draft();
      current.simScenarios = [simScenario()];
      const report = evaluatePublicationGates(input({ draft: current, secrets: [simSecret()] }));
      expect(report.issues).not.toContainEqual(expect.objectContaining({ code: 'SCENARIO_DISPOSITION_OPTION_INVALID' }));
    });

    it('reports a thin Checkpoint as UNIT_CONTENT_INCOMPLETE (the same check the publish route enforces)', () => {
      const current = draft();
      current.units[0] = { ...current.units[0], drills: current.units[0].drills.slice(0, 1), reviewNotes: ['Needs more Drills: 1 written, 4 planned at minimum.'] };
      const report = evaluatePublicationGates(input({ draft: current }));
      expect(report.eligible).toBe(false);
      expect(report.issues).toContainEqual(expect.objectContaining({
        code: 'UNIT_CONTENT_INCOMPLETE',
        affectedType: 'unit',
        affectedId: current.units[0].id,
        blocking: true,
        message: expect.stringContaining('1 of 4 Drills'),
      }));
      expect(evaluatePublicationGates(input()).issues).not.toContainEqual(expect.objectContaining({ code: 'UNIT_CONTENT_INCOMPLETE' }));
    });

    describe('rebind draft to the current approved revision', () => {
      const NEW_REVISION = `sha256:${'c'.repeat(64)}`;
      function changedSource() {
        const current = draft();
        current.simScenarios = [{
          ...simScenario(),
          evidenceRequirements: { ...simScenario().evidenceRequirements!, requiredGateIds: ['g1'], gateSourceRefs: { g1: [excerpt()] } },
        }];
        const nextBundle = { ...bundle(), revisionHash: NEW_REVISION, approvedSourceRevision: NEW_REVISION };
        return { current, nextBundle };
      }

      it('shows the revision gate before and rewrites draft + scenario revisions only after exact re-verification', () => {
        const { current, nextBundle } = changedSource();
        const before = evaluatePublicationGates(input({ draft: current, bundle: nextBundle, secrets: [simSecret()] }));
        expect(before.issues).toContainEqual(expect.objectContaining({ code: 'SOURCE_REVISION_MISSING' }));

        const plan = planDraftRebind({ draft: current, bundle: nextBundle, pages: pages(), assets: [], secrets: [simSecret()] });
        expect(plan.ok).toBe(true);
        if (!plan.ok) return;
        expect(plan.previousSourceRevision).toBe(SOURCE_REVISION);
        expect(plan.draft.sourceRevision).toBe(NEW_REVISION);
        expect(plan.draft.simScenarios[0].context?.sourceRevision).toBe(NEW_REVISION);
        // Content, evidence and approvals are untouched.
        expect(plan.draft.units).toEqual(current.units);

        const after = evaluatePublicationGates(input({ draft: plan.draft, bundle: nextBundle, secrets: [simSecret()] }));
        expect(after.issues).not.toContainEqual(expect.objectContaining({ code: 'SOURCE_REVISION_MISSING' }));
        expect(after.issues).not.toContainEqual(expect.objectContaining({ code: 'SCENARIO_SOURCE_REVISION_MISMATCH' }));
      });

      it('refuses when the bundle is not approved at its current hash', () => {
        const { current, nextBundle } = changedSource();
        const plan = planDraftRebind({
          draft: current,
          bundle: { ...nextBundle, status: 'draft', approvedSourceRevision: null, approvedByUid: null, approvedAt: null },
          pages: pages(), assets: [], secrets: [simSecret()],
        });
        expect(plan).toMatchObject({ ok: false, code: 'SOURCE_NOT_APPROVED' });
      });

      it('returns every approved excerpt that no longer matches and does not rebind', () => {
        const { current, nextBundle } = changedSource();
        const changedPages = pages().map((page) => ({ ...page, transcription: { text: 'Compliance. Call only 08:00-20:00.', approvedByUid: 'trainer-synthetic', approvedAt: 2 } }));
        const plan = planDraftRebind({ draft: current, bundle: nextBundle, pages: changedPages, assets: [], secrets: [simSecret()] });
        expect(plan.ok).toBe(false);
        if (plan.ok) return;
        expect(plan.code).toBe('REBIND_EXCERPT_MISMATCH');
        const owners = plan.mismatches.map((item) => item.ownerType);
        expect(owners).toEqual(expect.arrayContaining(['briefing_card', 'drill', 'rubric', 'scenario_gate']));
        expect(plan.mismatches.every((item) => item.reason === 'text_mismatch')).toBe(true);
      });

      it('reports unapproved non-matching evidence as warnings (still gated) and rebinds', () => {
        const { current, nextBundle } = changedSource();
        current.units[0].drills[0] = {
          ...current.units[0].drills[0],
          evidence: [{ ...evidence('evidence-unapproved'), approvalStatus: 'draft', reviewerUid: null, reviewedAt: null, support: 'unsupported', excerpts: [excerpt('Text that is not on the page.')] }],
        };
        const plan = planDraftRebind({ draft: current, bundle: nextBundle, pages: pages(), assets: [], secrets: [simSecret()] });
        expect(plan.ok).toBe(true);
        if (!plan.ok) return;
        expect(plan.warnings).toEqual([expect.objectContaining({ ownerType: 'drill', evidenceId: 'evidence-unapproved' })]);
        const after = evaluatePublicationGates(input({ draft: plan.draft, bundle: nextBundle, secrets: [simSecret()] }));
        expect(after.issues).toContainEqual(expect.objectContaining({ code: 'CLAIM_UNSUPPORTED', affectedId: 'evidence-unapproved' }));
      });

      it('says when the draft is already bound', () => {
        const plan = planDraftRebind({ draft: draft(), bundle: bundle(), pages: pages(), assets: [], secrets: [] });
        expect(plan).toMatchObject({ ok: false, code: 'ALREADY_BOUND' });
      });
    });
  });
});
