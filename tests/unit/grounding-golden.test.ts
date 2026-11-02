import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TrackVersionDocSchema } from '@/lib/schemas/curriculum';
import type {
  ClaimEvidence,
  DispositionAsset,
  LinkAsset,
  OfferAsset,
  SharedRule,
  SharedRulePack,
  SourceBundle,
  SourceConflict,
  SourceExcerptRef,
  SourcePageEvidence,
} from '@/lib/schemas/source-truth';
import {
  calculateOfferAmountCents,
  evaluatePublicationGates,
  offerCalculation,
  selectApprovedAssets,
  validateLinkAction,
  verifyClaimEvidence,
  verifySourceExcerpt,
} from '@/lib/services/source-evidence';

const NOW = 1_700_000_000_000;
const HASH = `sha256:${'c'.repeat(64)}`;
const DOC = 'doc-synthetic';
const REV = 'revision-synthetic-1';
const BUNDLE = 'bundle-synthetic';

function ref(exactText: string, pageNumber = 1, fromApprovedTranscription = false): SourceExcerptRef {
  return { documentId: DOC, revisionId: REV, pageNumber, exactText, fromApprovedTranscription };
}

function page(text: string, pageNumber = 1, flags: SourcePageEvidence['extractionFlags'] = [], transcription: SourcePageEvidence['transcription'] = null): SourcePageEvidence {
  return {
    id: `page-${pageNumber}`,
    documentId: DOC,
    revisionId: REV,
    pageNumber,
    rawText: text,
    normalizedText: text,
    contentHash: HASH,
    characterCount: text.length,
    extractionFlags: flags,
    transcription,
    approvedExcerpts: [],
  };
}

function approvedEvidence(id: string, text: string, ruleIds: string[] = []): ClaimEvidence {
  return {
    id,
    claim: text,
    ruleIds,
    excerpts: [ref(text)],
    support: 'supported',
    approvalStatus: 'approved',
    critical: true,
    requiresInterfaceDetails: false,
    reviewerUid: 'trainer-synthetic',
    reviewedAt: NOW,
  };
}

function link(overrides: Partial<LinkAsset> = {}): LinkAsset {
  return {
    id: 'link-synthetic',
    trackId: 'track-synthetic',
    product: 'SyntheticProduct',
    context: 'recovery',
    stage: 'score',
    sourceRefs: [ref('Synthetic link evidence.')],
    effectiveFrom: null,
    effectiveTo: null,
    status: 'approved',
    approvedByUid: 'trainer-synthetic',
    approvedAt: NOW,
    kind: 'link',
    linkType: 'results',
    host: 'synthetic.invalid',
    url: 'https://synthetic.invalid/results/synthetic-lead',
    personalized: true,
    permittedActions: ['display', 'fake_sms'],
    ...overrides,
  };
}

function offer(overrides: Partial<OfferAsset> = {}): OfferAsset {
  return {
    id: 'offer-synthetic',
    trackId: 'track-support',
    product: 'SyntheticProduct',
    context: 'existing_patient_cancellation',
    stage: 'first_cancellation',
    sourceRefs: [ref('Synthetic affordability evidence.')],
    effectiveFrom: null,
    effectiveTo: null,
    status: 'approved',
    approvedByUid: 'trainer-synthetic',
    approvedAt: NOW,
    kind: 'offer',
    label: '25% off the next synthetic order',
    amountCents: 7_425,
    comparisonAmountCents: 9_900,
    recurringInterval: null,
    duration: 'next_order_only',
    discountBasisPoints: 2_500,
    calculation: '9900 * 0.75 = 7425 exact cents',
    sequence: 1,
    prerequisites: [],
    ...overrides,
  };
}

describe('golden grounding — shared inheritance and exact evidence', () => {
  const sharedStatements: Array<[string, string]> = [
    ['shared-identity', 'Self-identify as a Standard Meds caller and not a doctor.'],
    ['shared-local-window', 'Call only 09:00–21:00 in the lead’s local timezone.'],
    ['shared-recording', 'Disclose recording where required.'],
    ['shared-opt-out', 'Honor clear opt-out immediately and flag permanent suppression.'],
    ['shared-approval', 'Do not claim approval before physician review.'],
  ];
  const sourceText = sharedStatements.map(([, statement]) => statement).join('\n');
  const sharedRules: SharedRule[] = sharedStatements.map(([id, statement]) => ({
    id,
    packId: 'shared-foundation',
    title: id,
    statement,
    severity: 'critical',
    applicableTrackIds: ['track-ed'],
    channels: ['voice'],
    stages: ['all'],
    evidence: approvedEvidence(`evidence-${id}`, statement, [id]),
    requiredKnowledge: false,
    requiredScenarioCoverage: true,
    sourceRevision: HASH,
    approvalStatus: 'approved',
    approvedByUid: 'trainer-synthetic',
    approvedAt: NOW,
  }));
  const pack: SharedRulePack = {
    id: 'shared-foundation',
    revision: 'shared-revision-1',
    title: 'Synthetic Standard Meds shared foundation',
    sourceDocumentIds: [DOC],
    rules: sharedRules,
    approvalStatus: 'approved',
    createdAt: NOW,
    updatedAt: NOW,
  };
  const bundle: SourceBundle = {
    schemaVersion: 1,
    id: BUNDLE,
    trackId: 'track-ed',
    documents: [{
      id: DOC,
      revisionId: REV,
      bundleId: BUNDLE,
      trackId: 'track-ed',
      role: 'shared_foundation',
      fileName: 'synthetic-ed.pdf',
      storagePath: 'synthetic/ed.pdf',
      sourceVersion: 'synthetic-v1',
      effectiveDate: null,
      uploadedAt: NOW,
      uploadedByUid: 'trainer-synthetic',
      contentHash: HASH,
      pageCount: 1,
      inheritanceOrder: 0,
      excluded: false,
      exclusionReason: null,
    }],
    sharedRulePackIds: [pack.id],
    precedencePolicyId: 'standard-meds-precedence-v1',
    conflictIds: [],
    status: 'approved',
    revisionHash: HASH,
    approvedSourceRevision: HASH,
    approvedByUid: 'trainer-synthetic',
    approvedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
  };
  const edDraft = TrackVersionDocSchema.parse({
    versionId: 'draft',
    trackId: 'track-ed',
    versionNumber: 1,
    competencyPillars: [],
    units: [],
    simScenarios: [],
    sourceBundleId: BUNDLE,
    sourceRevision: HASH,
    requiredRuleIds: sharedRules.map((rule) => rule.id),
    publishedAt: null,
    createdAt: NOW,
  });

  it('ED inherits identity, local-window, recording, opt-out, and approval rules from the approved shared pack', () => {
    const report = evaluatePublicationGates({ draft: edDraft, bundle, pages: [page(sourceText)], rulePacks: [pack], assets: [], conflicts: [], now: NOW });
    expect(report.eligible).toBe(true);
    expect(edDraft.requiredRuleIds).toEqual(expect.arrayContaining(sharedStatements.map(([id]) => id)));
  });

  it('fails closed when ED names inherited rules but the shared pack is absent or its knowledge coverage is omitted', () => {
    const missingPack = evaluatePublicationGates({ draft: edDraft, bundle, pages: [page(sourceText)], rulePacks: [], assets: [], conflicts: [], now: NOW });
    expect(missingPack.issues).toContainEqual(expect.objectContaining({ code: 'RULE_PACK_MISSING', blocking: true }));

    const uncoveredPack = { ...pack, rules: pack.rules.map((rule) => ({ ...rule, requiredKnowledge: true })) };
    const omittedCoverage = evaluatePublicationGates({ draft: edDraft, bundle, pages: [page(sourceText)], rulePacks: [uncoveredPack], assets: [], conflicts: [], now: NOW });
    expect(omittedCoverage.issues).toContainEqual(expect.objectContaining({ code: 'RULE_COVERAGE_MISSING', affectedId: 'shared-local-window' }));
  });

  it('rejects a wrong-page citation even when the cited page exists', () => {
    const pages = [page('The approved price is 99 synthetic dollars.', 3), page('Unrelated product timeline.', 4)];
    const claim = { ...approvedEvidence('claim-wrong-page', 'The approved price is 99 synthetic dollars.'), excerpts: [ref('The approved price is 99 synthetic dollars.', 4)], approvalStatus: 'approved' as const };
    expect(verifySourceExcerpt(claim.excerpts[0], pages)).toMatchObject({ matched: false, reason: 'text_mismatch' });
    expect(verifyClaimEvidence(claim, pages)).toMatchObject({ support: 'unsupported', approvalStatus: 'draft' });
  });

  it('does not treat an image caption as evidence for detailed interface steps without an approved transcription', () => {
    const caption = 'Screenshot of the synthetic secure payment form.';
    const captionPage = page(caption, 9, ['low_text_density', 'manual_transcription_required']);
    const claim = { ...approvedEvidence('claim-interface', 'Synthetic interface steps'), requiresInterfaceDetails: true, excerpts: [ref(caption, 9)] };
    expect(verifySourceExcerpt(claim.excerpts[0], [captionPage], { critical: true, requiresInterfaceDetails: true })).toMatchObject({ matched: false, reason: 'transcription_required' });

    const detailed = 'Select Update card. Enter only the designated fake token. Select Confirm update.';
    const transcribed = { ...captionPage, transcription: { text: detailed, approvedByUid: 'trainer-synthetic', approvedAt: NOW } };
    const exactStep = ref('Select Update card. Enter only the designated fake token.', 9, true);
    expect(verifySourceExcerpt(exactStep, [transcribed], { critical: true, requiresInterfaceDetails: true })).toMatchObject({ matched: true });
  });
});

describe('golden grounding — operational assets and conflict scope', () => {
  it('calculates $99 × 0.75 as exactly $74.25 and preserves next-order-only duration', () => {
    const affordability = offer();
    expect(calculateOfferAmountCents(9_900, 2_500)).toBe(7_425);
    expect(offerCalculation(affordability, 9_900)).toBe(7_425);
    expect(affordability.duration).toBe('next_order_only');
    expect(affordability.amountCents).toBe(7_425);
  });

  it('selects no offer for the repeat-cancellation branch', () => {
    const firstCancelOnly = offer({ stage: 'first_cancellation' });
    const selected = selectApprovedAssets([firstCancelOnly], {
      trackId: 'track-support',
      product: 'SyntheticProduct',
      context: 'existing_patient_cancellation',
      stage: 'repeat_cancellation',
      at: new Date('2026-01-15T12:00:00Z'),
    });
    expect(selected).toEqual([]);
  });

  it('keeps NAD+ Score pricing-passive and requires a personalized results asset', () => {
    const genericResults = link({ product: 'NAD+', personalized: false });
    expect(validateLinkAction(genericResults, 'fake_sms', { stage: 'Score', product: 'NAD+' })).toMatchObject({ allowed: false, reasons: expect.arrayContaining(['personalized_results_required']) });
    const personalizedResults = link({ product: 'NAD+', personalized: true });
    expect(validateLinkAction(personalizedResults, 'fake_sms', { stage: 'Score', product: 'NAD+' }).allowed).toBe(true);
    const checkout = link({ product: 'NAD+', linkType: 'checkout', url: 'https://synthetic.invalid/checkout' });
    expect(validateLinkAction(checkout, 'fake_sms', { stage: 'Score', product: 'NAD+' }).reasons).toContain('checkout_not_allowed_at_stage');
  });

  it('selects the approved ZoliraRx fungus checkout host and rejects the generic host', () => {
    const fungus = link({
      product: 'ZoliraRx',
      stage: 'checkout',
      linkType: 'checkout',
      host: 'fungus.standardmeds.example',
      url: 'https://synthetic.invalid/zolira/checkout',
    });
    expect(validateLinkAction(fungus, 'fake_sms', { stage: 'Checkout', product: 'ZoliraRx' }).allowed).toBe(true);
    expect(validateLinkAction({ ...fungus, host: 'generic.standardmeds.example' }, 'fake_sms', { stage: 'Checkout', product: 'ZoliraRx' }).reasons).toContain('approved_fungus_host_required');
  });

  it('an unresolved critical price conflict blocks only its affected offer/track selection', () => {
    const neuro = offer({ id: 'offer-neuro', trackId: 'track-neuro', context: 'recovery', stage: 'checkout' });
    const lift = offer({ id: 'offer-lift', trackId: 'track-lift', context: 'recovery', stage: 'checkout' });
    const conflict: SourceConflict = {
      id: 'DEMO-UNRESOLVED-PRICE',
      trackId: 'track-neuro',
      sourceRefs: [ref('Synthetic recovery price is 9900 cents.'), ref('Synthetic renewal price is 10900 cents.')],
      affectedProducts: ['SyntheticProduct'],
      affectedContexts: ['recovery'],
      affectedStages: ['checkout'],
      affectedAssetIds: [neuro.id],
      affectedRuleIds: [],
      detectedValues: ['9900', '10900'],
      severity: 'critical',
      status: 'open',
      decision: null,
      decisionOwnerUid: null,
      decidedAt: null,
      effectiveFrom: null,
      effectiveTo: null,
      downstreamInvalidationStatus: 'required',
    };
    const selection = { product: 'SyntheticProduct', context: 'recovery', stage: 'checkout', at: new Date('2026-01-15T12:00:00Z') };
    expect(selectApprovedAssets([neuro, lift], { ...selection, trackId: 'track-neuro' }, [conflict])).toEqual([]);
    expect(selectApprovedAssets([neuro, lift], { ...selection, trackId: 'track-lift' }, [conflict]).map((asset) => asset.id)).toEqual([lift.id]);
    expect(conflict.decision).toBeNull();
  });

  it('Renewals Recovered requires confirmation evidence and rejects a promise-only state', () => {
    const recovered: DispositionAsset = {
      id: 'renewals-recovered',
      trackId: 'track-renewals',
      product: 'SyntheticProduct',
      context: 'failed_payment',
      stage: 'wrap_up',
      sourceRefs: [ref('Recovered requires a confirmed synthetic card update.')],
      effectiveFrom: null,
      effectiveTo: null,
      status: 'approved',
      approvedByUid: 'trainer-synthetic',
      approvedAt: NOW,
      kind: 'disposition',
      label: 'Recovered',
      requiredEvidence: ['payment_update_confirmation'],
      forbiddenEvidence: ['verbal_promise_only'],
    };
    const eligible = (observed: string[]) => recovered.requiredEvidence.every((item) => observed.includes(item)) && !recovered.forbiddenEvidence.some((item) => observed.includes(item));
    expect(eligible(['verbal_promise_only'])).toBe(false);
    expect(eligible(['payment_update_confirmation'])).toBe(true);
    expect(recovered.requiredEvidence).toContain('payment_update_confirmation');
  });

  it('voicemail cannot invoke even an otherwise approved SMS link action', () => {
    const dosage = link({ linkType: 'dosage', stage: 'dosage', url: 'https://synthetic.invalid/dosage' });
    expect(validateLinkAction(dosage, 'fake_sms', { stage: 'Dosage', callOutcome: 'voicemail', product: 'SyntheticProduct' })).toMatchObject({ allowed: false, reasons: ['voicemail_sms_prohibited'] });
  });
});

describe('golden grounding — demo citation drift', () => {
  it('repairs known demo page mappings and detects a wrong-page mutation with exact source text', () => {
    const demo = JSON.parse(readFileSync(new URL('../../demo-replay/demo.json', import.meta.url), 'utf8')) as {
      TrackUnitContent: Array<{ briefingCards: Array<{ headline: string; sourcePages: number[] }> }>;
    };
    const source = JSON.parse(readFileSync(new URL('../../review/training-text/Standard Meds - 01 Neuropathy - NeuroCalmRx.json', import.meta.url), 'utf8')) as {
      data: { pages: Array<{ page: number; text: string }> };
    };
    const compliance = demo.TrackUnitContent[3].briefingCards;
    expect(compliance[0].sourcePages).toEqual([14]);
    expect(compliance[1].sourcePages).toEqual([3, 14, 15]);
    expect(compliance[2].sourcePages).toEqual([11, 14, 15]);

    const pages: SourcePageEvidence[] = source.data.pages.map((item) => page(item.text, item.page));
    const exact = '9:00am – 9:00pm in the lead\'s local timezone.';
    const grounded = ref(exact, 14);
    expect(verifySourceExcerpt(grounded, pages)).toMatchObject({ matched: true });
    const drifted = { ...grounded, pageNumber: 11 };
    expect(verifySourceExcerpt(drifted, pages)).toMatchObject({ matched: false, reason: 'text_mismatch' });
  });
});
