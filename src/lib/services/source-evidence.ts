import type { TrackVersionDoc } from '@/lib/schemas/curriculum';
import {
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
  now?: number;
}

/** Fail closed on unsupported evidence, missing approvals, omitted inherited rules, and affected open conflicts. */
export function evaluatePublicationGates(input: PublicationGateInput): PublicationGateReport {
  const issues: PublicationGateIssue[] = [];
  const { draft, bundle, pages, rulePacks, assets, conflicts } = input;
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

  const openConflicts = conflicts.filter((conflict) => conflict.status === 'open' || conflict.status === 'sme_review');
  for (const conflict of openConflicts) {
    if (conflict.severity === 'critical') {
      issues.push(issue('SME_DECISION_REQUIRED', `Conflict ${conflict.id} requires an SME decision for its affected items.`, 'conflict', conflict.id));
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
      if (rule.requiredKnowledge && !coveredRuleIds.has(rule.id)) {
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

/** Utility for targeted fixture tests and trainers reviewing a proposed offer. */
export function offerCalculation(offer: OfferAsset, baseAmountCents: number): number | null {
  return offer.discountBasisPoints === null ? offer.amountCents : calculateOfferAmountCents(baseAmountCents, offer.discountBasisPoints);
}
