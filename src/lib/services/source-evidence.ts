import type { PublicSimScenario, SecretSimScenarioConfig, TrackVersionDoc } from '@/lib/schemas/curriculum';
import type { ScenarioQAFixture } from '@/lib/schemas/simulation-state';
import {
  CanonicalDispositionSchema,
  ClaimEvidenceSchema,
  PublicationGateReportSchema,
  type ClaimEvidence,
  type LinkAsset,
  type OfferAsset,
  type OperationalAsset,
  type PublicationGateIssue,
  type PublicationGateReport,
  type SharedRulePack,
  type SourceBundle,
  type SourceConflict,
  type SourceExcerptRef,
  type SourcePageEvidence,
} from '@/lib/schemas/source-truth';
import { thinUnitProblems } from '@/lib/ai/pipeline/content-depth';

/** Exact matching after only Unicode and whitespace normalization; wording and punctuation remain significant. */
export function normalizeSourceText(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim();
}

export function extractionQualityFlags(rawText: string): SourcePageEvidence['extractionFlags'] {
  const flags = new Set<SourcePageEvidence['extractionFlags'][number]>();
  const normalized = normalizeSourceText(rawText);
  if (normalized.length < 180) flags.add('low_text_density');
  const lines = rawText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.filter((line) => /\s{2,}|\t/.test(line)).length >= 3) flags.add('possible_table_fragmentation');
  if (/https?\s*:\s*\/\s*\/|www\.\S+\s+\S+\.(?:com|io|co)\b/i.test(rawText)) flags.add('possible_url_fragmentation');
  if (lines.length >= 8 && lines.filter((line) => line.length <= 3).length >= 4) flags.add('possible_reading_order_issue');
  return [...flags];
}

function pageForExcerpt(pages: SourcePageEvidence[], excerpt: SourceExcerptRef): SourcePageEvidence | undefined {
  return pages.find(
    (page) =>
      page.documentId === excerpt.documentId &&
      page.revisionId === excerpt.revisionId &&
      page.pageNumber === excerpt.pageNumber,
  );
}

export interface ExcerptVerification {
  excerpt: SourceExcerptRef;
  matched: boolean;
  reason: 'matched' | 'page_missing' | 'text_mismatch' | 'transcription_required' | 'transcription_not_approved';
}

export function verifySourceExcerpt(
  excerpt: SourceExcerptRef,
  pages: SourcePageEvidence[],
  options: { critical?: boolean; requiresInterfaceDetails?: boolean } = {},
): ExcerptVerification {
  const page = pageForExcerpt(pages, excerpt);
  if (!page) return { excerpt, matched: false, reason: 'page_missing' };
  const needsTranscription =
    page.extractionFlags.includes('manual_transcription_required') &&
    (options.critical === true || options.requiresInterfaceDetails === true);
  if (needsTranscription && !page.transcription) {
    return { excerpt, matched: false, reason: 'transcription_required' };
  }
  if (excerpt.fromApprovedTranscription && !page.transcription) {
    return { excerpt, matched: false, reason: 'transcription_not_approved' };
  }
  if (options.requiresInterfaceDetails && page.extractionFlags.includes('low_text_density') && !page.transcription) {
    return { excerpt, matched: false, reason: 'transcription_required' };
  }
  const source = excerpt.fromApprovedTranscription || page.transcription
    ? page.transcription?.text ?? page.normalizedText
    : page.normalizedText;
  const matched = normalizeSourceText(source).includes(normalizeSourceText(excerpt.exactText));
  return { excerpt, matched, reason: matched ? 'matched' : 'text_mismatch' };
}

/** Recompute support from persisted source evidence; never trust a model- or client-supplied support label. */
export function verifyClaimEvidence(
  evidence: ClaimEvidence,
  pages: SourcePageEvidence[],
  conflicts: SourceConflict[] = [],
): ClaimEvidence {
  const results = evidence.excerpts.map((excerpt) =>
    verifySourceExcerpt(excerpt, pages, {
      critical: evidence.critical,
      requiresInterfaceDetails: evidence.requiresInterfaceDetails,
    }),
  );
  const matched = results.filter((result) => result.matched).length;
  const affected = conflicts.some(
    (conflict) =>
      (conflict.status === 'open' || conflict.status === 'sme_review') &&
      (conflict.affectedRuleIds.some((id) => evidence.ruleIds.includes(id)) ||
        conflict.sourceRefs.some((ref) =>
          evidence.excerpts.some(
            (excerpt) =>
              excerpt.documentId === ref.documentId &&
              excerpt.revisionId === ref.revisionId &&
              excerpt.pageNumber === ref.pageNumber,
          ),
        )),
  );
  const support = affected
    ? 'conflicted'
    : matched === evidence.excerpts.length
      ? 'supported'
      : matched > 0
        ? 'partially_supported'
        : 'unsupported';
  return ClaimEvidenceSchema.parse({
    ...evidence,
    support,
    approvalStatus: support === 'supported' ? evidence.approvalStatus : 'draft',
    reviewerUid: support === 'supported' ? evidence.reviewerUid : null,
    reviewedAt: support === 'supported' ? evidence.reviewedAt : null,
  });
}

/** Exact integer arithmetic; basis points avoid floating-point discount fields. */
export function calculateOfferAmountCents(baseAmountCents: number, discountBasisPoints: number): number {
  if (!Number.isSafeInteger(baseAmountCents) || baseAmountCents < 0) throw new Error('Base amount must be nonnegative integer cents.');
  if (!Number.isSafeInteger(discountBasisPoints) || discountBasisPoints < 0 || discountBasisPoints > 10_000) {
    throw new Error('Discount must be integer basis points from 0 through 10000.');
  }
  const numerator = baseAmountCents * (10_000 - discountBasisPoints);
  if (numerator % 10_000 !== 0) throw new Error('Offer arithmetic does not produce exact cents; define an approved rounding rule.');
  return numerator / 10_000;
}

export function isAssetEffective(asset: OperationalAsset, at = new Date()): boolean {
  const date = at.toISOString().slice(0, 10);
  return (!asset.effectiveFrom || asset.effectiveFrom <= date) && (!asset.effectiveTo || asset.effectiveTo >= date);
}

export interface AssetSelection {
  trackId: string;
  product: string;
  context: string;
  stage: string;
  at?: Date;
}

export function selectApprovedAssets<T extends OperationalAsset>(
  assets: T[],
  selection: AssetSelection,
  conflicts: SourceConflict[] = [],
): T[] {
  const blockedIds = new Set(
    conflicts
      .filter((conflict) => conflict.status === 'open' || conflict.status === 'sme_review')
      .flatMap((conflict) => conflict.affectedAssetIds),
  );
  return assets
    .filter(
      (asset) =>
        asset.trackId === selection.trackId &&
        asset.product === selection.product &&
        asset.context === selection.context &&
        asset.stage === selection.stage &&
        asset.status === 'approved' &&
        asset.approvedByUid &&
        isAssetEffective(asset, selection.at) &&
        !blockedIds.has(asset.id),
    )
    .sort((left, right) => {
      const leftSequence = left.kind === 'offer' ? left.sequence : 0;
      const rightSequence = right.kind === 'offer' ? right.sequence : 0;
      return leftSequence - rightSequence || left.id.localeCompare(right.id);
    });
}

export interface LinkActionValidation {
  allowed: boolean;
  reasons: string[];
}

export function validateLinkAction(
  asset: LinkAsset,
  action: 'display' | 'fake_sms' | 'fake_portal_open',
  context: { stage: string; callOutcome?: 'live_answer' | 'voicemail'; product: string },
): LinkActionValidation {
  const reasons: string[] = [];
  const stage = context.stage.toLowerCase();
  if (!asset.permittedActions.includes(action)) reasons.push('action_not_permitted');
  if ((stage.includes('dosage') || stage.includes('score')) && asset.linkType === 'checkout') reasons.push('checkout_not_allowed_at_stage');
  if (asset.product === 'NAD+' && stage.includes('score') && asset.linkType === 'results' && !asset.personalized) {
    reasons.push('personalized_results_required');
  }
  if (asset.product === 'ZoliraRx' && stage.includes('checkout') && asset.linkType === 'checkout' && asset.host !== 'fungus.standardmeds.example') {
    reasons.push('approved_fungus_host_required');
  }
  if (context.callOutcome === 'voicemail' && action === 'fake_sms') reasons.push('voicemail_sms_prohibited');
  return { allowed: reasons.length === 0, reasons };
}

function issue(
  code: string,
  message: string,
  affectedType: PublicationGateIssue['affectedType'],
  affectedId: string,
  severity: PublicationGateIssue['severity'] = 'critical',
): PublicationGateIssue {
  return { code, message, severity, affectedType, affectedId, blocking: true };
}

export interface PublicationGateInput {
  draft: TrackVersionDoc;
  bundle: SourceBundle | null;
  pages: SourcePageEvidence[];
  rulePacks: SharedRulePack[];
  assets: OperationalAsset[];
  conflicts: SourceConflict[];
  secrets?: SecretSimScenarioConfig[];
  /** Server-only deterministic execution; browser previews validate fixture presence without importing Node crypto. */
  runScenarioQAFixture?: (scenario: PublicSimScenario, fixture: ScenarioQAFixture) => {
    passed: boolean;
    errors: string[];
    eligibility: { reasons: string[] };
  };
  now?: number;
}

/** Fail closed on unsupported evidence, missing approvals, omitted inherited rules, and affected open conflicts. */
export function evaluatePublicationGates(input: PublicationGateInput): PublicationGateReport {
  const issues: PublicationGateIssue[] = [];
  const { draft, bundle, pages, assets, conflicts } = input;
  // Only packs the trainer selected for this bundle participate. Unselected packs in the subcollection cannot be
  // approved (source review rejects them) and generation filters them out, so gating on them would block forever.
  const selectedPackIds = bundle ? new Set(bundle.sharedRulePackIds) : null;
  const rulePacks = selectedPackIds ? input.rulePacks.filter((pack) => selectedPackIds.has(pack.id)) : input.rulePacks;
  const sourceRevision = draft.sourceRevision ?? 'legacy_unknown';
  if (!bundle || draft.sourceBundleId !== bundle.id || draft.sourceRevision !== bundle.revisionHash) {
    issues.push(issue('SOURCE_REVISION_MISSING', 'Select the exact approved source bundle revision used by this draft.', 'source', draft.sourceBundleId ?? 'legacy_unknown'));
  } else if (
    (bundle.status !== 'approved' && bundle.status !== 'published') ||
    bundle.approvedSourceRevision !== bundle.revisionHash ||
    !bundle.approvedByUid ||
    !bundle.approvedAt
  ) {
    issues.push(issue('SOURCE_NOT_APPROVED', 'A trainer must approve this exact source bundle revision with approver identity before publication.', 'source', bundle.id));
  }

  for (const decisionId of bundle?.unresolvedSmeDecisionIds ?? []) {
    issues.push(issue('SME_DECISION_REQUIRED', `Standard Meds decision ${decisionId} requires an explicit SME resolution before publication.`, 'source', decisionId));
  }
  const openConflicts = conflicts.filter((conflict) => conflict.status === 'open' || conflict.status === 'sme_review');
  for (const conflict of openConflicts) {
    issues.push(issue('SME_DECISION_REQUIRED', `Conflict ${conflict.id} requires an SME decision for its affected items.`, 'conflict', conflict.id, conflict.severity));
  }

  // Learners only ever get complete Checkpoints: a Unit a local build could only partly fill (it carries
  // reviewNotes) stays blocked until it meets the curriculum minimums (DEPTH_LIMITS in content-depth.ts).
  for (const unit of draft.units) {
    for (const problem of thinUnitProblems([unit])) {
      issues.push(issue('UNIT_CONTENT_INCOMPLETE', `Add content before publishing: ${problem}`, 'unit', unit.id, 'major'));
    }
  }

  const claims: Array<{ ownerId: string; evidence: ClaimEvidence }> = [];
  for (const unit of draft.units) {
    for (const card of unit.briefingCards) {
      if (!card.evidence?.length) issues.push(issue('CLAIM_EVIDENCE_MISSING', `Briefing Card ${card.id} needs exact source evidence.`, 'claim', card.id, 'major'));
      for (const evidence of card.evidence ?? []) claims.push({ ownerId: card.id, evidence });
    }
    for (const drill of unit.drills) {
      if (!drill.evidence?.length) issues.push(issue('CLAIM_EVIDENCE_MISSING', `Drill ${drill.id} needs exact source evidence.`, 'claim', drill.id, 'major'));
      for (const evidence of drill.evidence ?? []) claims.push({ ownerId: drill.id, evidence });
    }
  }
  const coveredRuleIds = new Set<string>();
  for (const { ownerId, evidence: original } of claims) {
    const evidence = verifyClaimEvidence(original, pages, conflicts);
    evidence.ruleIds.forEach((id) => coveredRuleIds.add(id));
    if (evidence.support !== 'supported') {
      issues.push(issue('CLAIM_UNSUPPORTED', `${ownerId} has ${evidence.support.replaceAll('_', ' ')} evidence.`, 'claim', evidence.id, evidence.critical ? 'critical' : 'major'));
    }
    if (evidence.approvalStatus !== 'approved' || !evidence.reviewerUid || !evidence.reviewedAt) {
      issues.push(issue('TRAINER_APPROVAL_REQUIRED', `${ownerId} requires trainer evidence approval.`, 'claim', evidence.id, evidence.critical ? 'critical' : 'major'));
    }
  }

  const requiredRuleIds = new Set(draft.requiredRuleIds ?? rulePacks.flatMap((pack) => pack.rules.map((rule) => rule.id)));
  const loadedRuleIds = new Set(rulePacks.flatMap((pack) => pack.rules.map((rule) => rule.id)));
  for (const ruleId of requiredRuleIds) {
    if (!loadedRuleIds.has(ruleId)) {
      issues.push(issue('RULE_PACK_MISSING', `Required inherited rule ${ruleId} is absent because its shared rule pack was not loaded.`, 'rule', ruleId));
    }
  }
  for (const pack of rulePacks) {
    if (pack.approvalStatus !== 'approved') issues.push(issue('RULE_PACK_NOT_APPROVED', `Rule pack ${pack.id} requires trainer approval.`, 'rule', pack.id));
    for (const rule of pack.rules) {
      if (!requiredRuleIds.has(rule.id)) continue;
      const evidence = verifyClaimEvidence(rule.evidence, pages, conflicts);
      if (rule.approvalStatus !== 'approved' || evidence.approvalStatus !== 'approved' || evidence.support !== 'supported') {
        issues.push(issue('RULE_NOT_GROUNDED', `Required rule ${rule.id} lacks approved exact evidence.`, 'rule', rule.id));
      }
    }
  }

  for (const scenario of draft.simScenarios) {
    if (!scenario.context || !scenario.evidenceRequirements) {
      issues.push(issue('SCENARIO_CONTEXT_REQUIRED', `Scenario ${scenario.id} needs explicit context and evidence requirements.`, 'scenario', scenario.id));
      continue;
    }
    if (scenario.context.sourceRevision !== sourceRevision) {
      issues.push(issue('SCENARIO_SOURCE_REVISION_MISMATCH', `Scenario ${scenario.id} is bound to a different source revision.`, 'scenario', scenario.id));
    }
    for (const gateId of scenario.evidenceRequirements.requiredGateIds) {
      const refs = scenario.evidenceRequirements.gateSourceRefs[gateId] ?? [];
      if (refs.length === 0) {
        issues.push(issue('SCENARIO_GATE_SOURCE_REQUIRED', `Scenario ${scenario.id} gate ${gateId} needs approved source references.`, 'scenario', scenario.id));
      }
      for (const ref of refs) {
        const result = verifySourceExcerpt(ref, pages, { critical: true });
        if (!result.matched) issues.push(issue('SCENARIO_GATE_SOURCE_INVALID', `Scenario ${scenario.id} gate ${gateId} has invalid source evidence (${result.reason}).`, 'scenario', scenario.id));
      }
    }
    const secret = input.secrets?.find((config) => config.scenarioId === scenario.id);
    if (!secret) {
      issues.push(issue('SCENARIO_SECRET_REQUIRED', `Scenario ${scenario.id} needs its trainer-only rubric and QA fixtures.`, 'scenario', scenario.id));
      continue;
    }
    if (!CanonicalDispositionSchema.safeParse(secret.expectedDisposition).success) {
      issues.push(issue('SCENARIO_DISPOSITION_INVALID', `Scenario ${scenario.id} must use a canonical expected disposition.`, 'scenario', scenario.id));
    }
    // Every learner-visible option must be canonical, or the Sim offers choices the wrap-up will reject.
    const nonCanonicalOptions = scenario.dispositionOptions.filter((option) => !CanonicalDispositionSchema.safeParse(option).success);
    if (nonCanonicalOptions.length > 0) {
      issues.push(issue(
        'SCENARIO_DISPOSITION_OPTION_INVALID',
        `Scenario ${scenario.id} offers disposition options that are not canonical (${nonCanonicalOptions.map((option) => `"${option}"`).join(', ')}). Change each option to one of: ${CanonicalDispositionSchema.options.join(', ')}.`,
        'scenario',
        scenario.id,
      ));
    }
    for (const criterion of secret.rubricCriteria) {
      if (!criterion.evidence?.length) issues.push(issue('CLAIM_EVIDENCE_MISSING', `Scenario rubric ${criterion.id} needs exact source evidence.`, 'claim', criterion.id, 'major'));
      for (const original of criterion.evidence ?? []) {
        const evidence = verifyClaimEvidence(original, pages, conflicts);
        evidence.ruleIds.forEach((id) => coveredRuleIds.add(id));
        if (evidence.support !== 'supported' || evidence.approvalStatus !== 'approved' || !evidence.reviewerUid || !evidence.reviewedAt) {
          issues.push(issue('CLAIM_UNSUPPORTED', `Scenario rubric ${criterion.id} lacks approved exact supporting evidence.`, 'claim', evidence.id, evidence.critical ? 'critical' : 'major'));
        }
      }
    }
    const fixtures = secret.qaFixtures ?? [];
    if (!fixtures.some((fixture) => fixture.kind === 'golden_pass')) {
      issues.push(issue('SCENARIO_GOLDEN_PASS_REQUIRED', `Scenario ${scenario.id} needs a scripted golden pass.`, 'scenario', scenario.id));
    }
    if (!fixtures.some((fixture) => fixture.kind === 'golden_critical_fail')) {
      issues.push(issue('SCENARIO_GOLDEN_FAIL_REQUIRED', `Scenario ${scenario.id} needs a scripted critical-fail path.`, 'scenario', scenario.id));
    }
    if (input.runScenarioQAFixture) {
      for (const fixture of fixtures) {
        const result = input.runScenarioQAFixture(scenario, fixture);
        if (!result.passed || result.errors.length > 0) {
          issues.push(issue('SCENARIO_QA_FAILED', `Scenario ${scenario.id} fixture ${fixture.id} failed or is unreachable: ${[...result.errors, ...result.eligibility.reasons].join(' ') || 'Expected gate result did not match.'}`, 'scenario', scenario.id));
        }
      }
    }
  }

  // Coverage runs after the scenario loop so rules grounded only by Sim rubric evidence count as covered.
  for (const pack of rulePacks) {
    for (const rule of pack.rules) {
      if (requiredRuleIds.has(rule.id) && rule.requiredKnowledge && !coveredRuleIds.has(rule.id)) {
        issues.push(issue('RULE_COVERAGE_MISSING', `Required rule ${rule.id} is not covered by curriculum evidence.`, 'rule', rule.id));
      }
    }
  }

  for (const asset of assets) {
    if (asset.status === 'approved' && (!asset.approvedByUid || !asset.approvedAt)) {
      issues.push(issue('ASSET_APPROVAL_INVALID', `Operational asset ${asset.id} lacks approver identity.`, 'asset', asset.id));
    }
    for (const ref of asset.sourceRefs) {
      const result = verifySourceExcerpt(ref, pages, { critical: true, requiresInterfaceDetails: asset.kind === 'workflow' && asset.requiresInterfaceDetails });
      if (!result.matched) issues.push(issue('ASSET_EVIDENCE_INVALID', `Operational asset ${asset.id} has invalid source evidence (${result.reason}).`, 'asset', asset.id));
    }
  }

  return PublicationGateReportSchema.parse({
    eligible: issues.length === 0,
    issues,
    checkedSourceRevision: sourceRevision,
    checkedAt: input.now ?? Date.now(),
  });
}

export interface RebindExcerptProblem {
  ownerType: 'briefing_card' | 'drill' | 'rubric' | 'scenario_gate' | 'asset';
  ownerId: string;
  /** Claim evidence id, or the gate id for scenario gate references. */
  evidenceId: string | null;
  excerpt: SourceExcerptRef;
  reason: ExcerptVerification['reason'];
}

export type DraftRebindResult =
  | {
      ok: true;
      draft: TrackVersionDoc;
      previousSourceRevision: string | null;
      sourceRevision: string;
      /** Unapproved evidence that does not match the new pages. It stays blocked by the publication gates. */
      warnings: RebindExcerptProblem[];
    }
  | {
      ok: false;
      code: 'SOURCE_BUNDLE_MISMATCH' | 'SOURCE_NOT_APPROVED' | 'ALREADY_BOUND' | 'REBIND_EXCERPT_MISMATCH';
      message: string;
      mismatches: RebindExcerptProblem[];
      warnings: RebindExcerptProblem[];
    };

export interface DraftRebindInput {
  draft: TrackVersionDoc;
  bundle: SourceBundle;
  pages: SourcePageEvidence[];
  assets: OperationalAsset[];
  secrets: SecretSimScenarioConfig[];
}

/**
 * Plan "rebind draft to current approved revision" after a source revision changed (for example a
 * re-approved transcription). Only when the bundle is approved at its current hash, and every approved
 * claim/rubric excerpt, every scenario gate reference and every approved asset reference still matches
 * the current pages exactly (`verifySourceExcerpt`), does it return the draft with `sourceRevision` and
 * each `scenario.context.sourceRevision` rewritten. Nothing else changes, so the publication gates still
 * re-check all evidence, approvals and conflicts afterwards. Unapproved evidence is reported as warnings:
 * it was never trusted and remains blocked by CLAIM_UNSUPPORTED / TRAINER_APPROVAL_REQUIRED.
 */
export function planDraftRebind(input: DraftRebindInput): DraftRebindResult {
  const { draft, bundle, pages, assets, secrets } = input;
  const mismatches: RebindExcerptProblem[] = [];
  const warnings: RebindExcerptProblem[] = [];
  const fail = (code: Exclude<DraftRebindResult, { ok: true }>['code'], message: string): DraftRebindResult =>
    ({ ok: false, code, message, mismatches, warnings });

  if (draft.sourceBundleId !== bundle.id) {
    return fail('SOURCE_BUNDLE_MISMATCH', 'This draft was built from a different source bundle. Build a new draft from this bundle instead.');
  }
  if (
    (bundle.status !== 'approved' && bundle.status !== 'published') ||
    bundle.approvedSourceRevision !== bundle.revisionHash ||
    !bundle.approvedByUid ||
    !bundle.approvedAt
  ) {
    return fail('SOURCE_NOT_APPROVED', 'Approve the current source bundle revision before rebinding the draft to it.');
  }
  const scenariosBound = draft.simScenarios.every((scenario) => !scenario.context || scenario.context.sourceRevision === bundle.revisionHash);
  if (draft.sourceRevision === bundle.revisionHash && scenariosBound) {
    return fail('ALREADY_BOUND', 'The draft is already bound to the current approved source revision.');
  }

  const checkEvidence = (ownerType: RebindExcerptProblem['ownerType'], ownerId: string, evidence: ClaimEvidence[] | undefined) => {
    for (const item of evidence ?? []) {
      for (const excerpt of item.excerpts) {
        const result = verifySourceExcerpt(excerpt, pages, { critical: item.critical, requiresInterfaceDetails: item.requiresInterfaceDetails });
        if (result.matched) continue;
        (item.approvalStatus === 'approved' ? mismatches : warnings).push({ ownerType, ownerId, evidenceId: item.id, excerpt, reason: result.reason });
      }
    }
  };
  for (const unit of draft.units) {
    for (const card of unit.briefingCards) checkEvidence('briefing_card', card.id, card.evidence);
    for (const drill of unit.drills) checkEvidence('drill', drill.id, drill.evidence);
  }
  for (const config of secrets) {
    for (const criterion of config.rubricCriteria) checkEvidence('rubric', criterion.id, criterion.evidence);
  }
  for (const scenario of draft.simScenarios) {
    for (const [gateId, refs] of Object.entries(scenario.evidenceRequirements?.gateSourceRefs ?? {})) {
      for (const excerpt of refs) {
        const result = verifySourceExcerpt(excerpt, pages, { critical: true });
        if (!result.matched) mismatches.push({ ownerType: 'scenario_gate', ownerId: scenario.id, evidenceId: gateId, excerpt, reason: result.reason });
      }
    }
  }
  for (const asset of assets) {
    for (const excerpt of asset.sourceRefs) {
      const result = verifySourceExcerpt(excerpt, pages, {
        critical: true,
        requiresInterfaceDetails: asset.kind === 'workflow' && asset.requiresInterfaceDetails,
      });
      if (!result.matched) {
        (asset.status === 'approved' ? mismatches : warnings).push({ ownerType: 'asset', ownerId: asset.id, evidenceId: null, excerpt, reason: result.reason });
      }
    }
  }
  if (mismatches.length > 0) {
    return fail(
      'REBIND_EXCERPT_MISMATCH',
      `${mismatches.length} approved excerpt${mismatches.length === 1 ? ' no longer matches' : 's no longer match'} the current source pages. Fix or regenerate those items, or build a new draft.`,
    );
  }
  return {
    ok: true,
    previousSourceRevision: draft.sourceRevision ?? null,
    sourceRevision: bundle.revisionHash,
    warnings,
    draft: {
      ...draft,
      sourceRevision: bundle.revisionHash,
      simScenarios: draft.simScenarios.map((scenario) =>
        scenario.context ? { ...scenario, context: { ...scenario.context, sourceRevision: bundle.revisionHash } } : scenario,
      ),
    },
  };
}

/** Utility for targeted fixture tests and trainers reviewing a proposed offer. */
export function offerCalculation(offer: OfferAsset, baseAmountCents: number): number | null {
  return offer.discountBasisPoints === null ? offer.amountCents : calculateOfferAmountCents(baseAmountCents, offer.discountBasisPoints);
}
