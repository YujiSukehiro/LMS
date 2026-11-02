/** Trainer source review: exact evidence, transcription, asset/rule-pack/bundle approval, and SME decisions. */
import { NextResponse } from 'next/server';
import type { Transaction } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import { jsonError, requireAuth } from '@/lib/firebase/auth-guard';
import { INTERNAL_OPS_ROLES } from '@/lib/schemas/constants';
import { SourceReviewRequestSchema, type SourceReviewRequest } from '@/lib/schemas/api';
import {
  ClaimEvidenceSchema,
  OperationalAssetSchema,
  SharedRulePackSchema,
  SourceBundleSchema,
  SourceConflictSchema,
  SourcePageEvidenceSchema,
  type ClaimEvidence,
  type SourceBundle,
  type SourcePageEvidence,
} from '@/lib/schemas/source-truth';
import { DRAFT_VERSION_ID, TrackVersionDocSchema, type TrackVersionDoc } from '@/lib/schemas/curriculum';
import { draftRef, loadTrack, loadVersion } from '@/lib/ai/pipeline/track-store';
import {
  normalizeSourceText,
  verifyClaimEvidence,
  verifySourceExcerpt,
} from '@/lib/services/source-evidence';
import {
  computeSourceBundleRevisionHash,
  hashSourcePageContent,
  loadSourceReview,
  SourceBundleNotFoundError,
  sourceAssetRef,
  sourceBundleRef,
  sourceConflictRef,
  sourcePageEvidenceRef,
  sourceRulePackRef,
  withSourceRevision,
} from '@/lib/services/source-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ trackId: string }> };

class SourceReviewError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = 'SourceReviewError';
  }
}

function checkExpectedRevision(bundle: SourceBundle, request: SourceReviewRequest): void {
  if (request.expectedRevisionHash && request.expectedRevisionHash !== bundle.revisionHash) {
    throw new SourceReviewError(409, 'SOURCE_REVISION_CONFLICT', 'The source changed. Reload the review before approving it.');
  }
}

function pageFor(pages: SourcePageEvidence[], input: { documentId: string; revisionId: string; pageNumber: number }): SourcePageEvidence {
  const page = pages.find(
    (candidate) =>
      candidate.documentId === input.documentId &&
      candidate.revisionId === input.revisionId &&
      candidate.pageNumber === input.pageNumber,
  );
  if (!page) throw new SourceReviewError(404, 'SOURCE_PAGE_NOT_FOUND', 'The requested source page does not exist in this bundle.');
  return page;
}

function excerptKey(excerpt: { documentId: string; revisionId: string; pageNumber: number; exactText: string; fromApprovedTranscription: boolean }): string {
  return JSON.stringify([excerpt.documentId, excerpt.revisionId, excerpt.pageNumber, excerpt.exactText, excerpt.fromApprovedTranscription]);
}

function draftEvidence(draft: TrackVersionDoc, evidenceId: string): ClaimEvidence {
  for (const unit of draft.units) {
    for (const item of [...unit.briefingCards, ...unit.drills]) {
      const evidence = item.evidence?.find((candidate) => candidate.id === evidenceId);
      if (evidence) return evidence;
    }
  }
  throw new SourceReviewError(404, 'CLAIM_EVIDENCE_NOT_FOUND', 'This claim evidence does not exist in the editable draft.');
}

function approveDraftEvidence(draft: TrackVersionDoc, evidenceId: string, approved: ClaimEvidence): TrackVersionDoc {
  const update = (items: Array<{ evidence?: ClaimEvidence[] }>) => items.map((item) => ({
    ...item,
    evidence: item.evidence?.map((candidate) => candidate.id === evidenceId ? approved : candidate),
  }));
  return TrackVersionDocSchema.parse({
    ...draft,
    units: draft.units.map((unit) => ({
      ...unit,
      briefingCards: update(unit.briefingCards),
      drills: update(unit.drills),
    })),
  });
}

export async function GET(req: Request, { params }: RouteContext): Promise<NextResponse> {
  const auth = await requireAuth(req, INTERNAL_OPS_ROLES);
  if (!auth.ok) return auth.response;
  const { trackId } = await params;
  const track = await loadTrack(trackId);
  if (!track) return jsonError(404, 'NOT_FOUND', 'This Track does not exist.');
  const bundleId = new URL(req.url).searchParams.get('bundleId') || track.activeSourceBundleId;
  if (!bundleId) return jsonError(404, 'NO_ACTIVE_SOURCE_BUNDLE', 'This Track has no active source bundle.');
  try {
    const review = await loadSourceReview(trackId, bundleId);
    return NextResponse.json(review, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof SourceBundleNotFoundError) return jsonError(404, 'NOT_FOUND', 'This source bundle does not exist.');
    throw error;
  }
}

async function applyReviewCommand(
  trackId: string,
  request: SourceReviewRequest,
  reviewerUid: string,
  tx: Transaction,
): Promise<Record<string, unknown>> {
  const review = await loadSourceReview(trackId, request.bundleId, tx);
  const bundle = review.bundle;
  if (bundle.trackId !== trackId) throw new SourceReviewError(404, 'NOT_FOUND', 'This source bundle does not exist.');
  checkExpectedRevision(bundle, request);
  const now = Date.now();

  switch (request.action) {
    case 'approve_excerpt': {
      let draft: TrackVersionDoc | null = null;
      if (request.evidenceId) {
        draft = await loadVersion(trackId, DRAFT_VERSION_ID, tx);
        if (!draft) throw new SourceReviewError(409, 'NO_DRAFT', 'Build the Track before approving generated claim evidence.');
      }
      const original = request.evidenceId
        ? draftEvidence(draft!, request.evidenceId)
        : request.evidence;
      if (!original) throw new SourceReviewError(400, 'VALIDATION_FAILED', 'Provide evidence or a persisted draft evidenceId.');
      const verified = verifyClaimEvidence(
        { ...original, approvalStatus: 'draft', reviewerUid: null, reviewedAt: null },
        review.pages,
        review.conflicts,
      );
      if (verified.support !== 'supported') {
        throw new SourceReviewError(422, 'EVIDENCE_NOT_SUPPORTED', `Exact source verification returned ${verified.support}; approval was not recorded.`);
      }
      const evidence = ClaimEvidenceSchema.parse({
        ...verified,
        approvalStatus: 'approved',
        reviewerUid,
        reviewedAt: now,
      });
      for (const excerpt of evidence.excerpts) {
        const page = pageFor(review.pages, excerpt);
        const keys = new Set(page.approvedExcerpts.map(excerptKey));
        if (keys.has(excerptKey(excerpt))) continue;
        const nextPage = SourcePageEvidenceSchema.parse({
          ...page,
          approvedExcerpts: [...page.approvedExcerpts, excerpt],
        });
        tx.set(sourcePageEvidenceRef(trackId, bundle.id, page.id), nextPage);
      }
      if (draft && request.evidenceId) {
        tx.set(draftRef(trackId), approveDraftEvidence(draft, request.evidenceId, evidence));
      }
      return { ok: true, action: request.action, evidence, sourceRevision: bundle.revisionHash };
    }

    case 'approve_transcription': {
      if (!normalizeSourceText(request.text)) {
        throw new SourceReviewError(400, 'VALIDATION_FAILED', 'Transcription text cannot be blank.');
      }
      const page = request.pageId
        ? review.pages.find((candidate) => candidate.id === request.pageId)
        : request.documentId && request.revisionId && request.pageNumber
          ? pageFor(review.pages, { documentId: request.documentId, revisionId: request.revisionId, pageNumber: request.pageNumber })
          : undefined;
      if (!page) throw new SourceReviewError(404, 'SOURCE_PAGE_NOT_FOUND', 'Select a persisted source page for transcription.');
      const transcriptionChanged = page.transcription?.text !== request.text;
      const nextPage = SourcePageEvidenceSchema.parse({
        ...page,
        transcription: { text: request.text, approvedByUid: reviewerUid, approvedAt: now },
        // Replacing transcription invalidates excerpts approved against its previous wording.
        approvedExcerpts: transcriptionChanged
          ? page.approvedExcerpts.filter((excerpt) => !excerpt.fromApprovedTranscription)
          : page.approvedExcerpts,
      });
      const nextPages = review.pages.map((candidate) => candidate.id === page.id ? nextPage : candidate);
      const nextBundle = withSourceRevision(bundle, nextPages, now);
      tx.set(sourcePageEvidenceRef(trackId, bundle.id, page.id), nextPage);
      tx.set(sourceBundleRef(trackId, bundle.id), nextBundle);
      return { ok: true, action: request.action, page: nextPage, bundle: nextBundle, sourceRevision: nextBundle.revisionHash };
    }

    case 'approve_asset': {
      const asset = review.assets.find((candidate) => candidate.id === request.assetId);
      if (!asset || asset.trackId !== trackId) throw new SourceReviewError(404, 'ASSET_NOT_FOUND', 'This operational asset does not exist in the bundle.');
      const affectedConflict = review.conflicts.find(
        (conflict) =>
          (conflict.status === 'open' || conflict.status === 'sme_review') && conflict.affectedAssetIds.includes(asset.id),
      );
      if (affectedConflict) {
        throw new SourceReviewError(409, 'SME_DECISION_REQUIRED', `Resolve conflict ${affectedConflict.id} before approving this asset.`);
      }
      for (const ref of asset.sourceRefs) {
        const result = verifySourceExcerpt(ref, review.pages, {
          critical: true,
          requiresInterfaceDetails: asset.kind === 'workflow' && asset.requiresInterfaceDetails,
        });
        if (!result.matched) {
          throw new SourceReviewError(422, 'ASSET_EVIDENCE_INVALID', `Asset evidence failed exact verification (${result.reason}).`);
        }
      }
      const approved = OperationalAssetSchema.parse({ ...asset, status: 'approved', approvedByUid: reviewerUid, approvedAt: now });
      tx.set(sourceAssetRef(trackId, bundle.id, asset.id), approved);
      return { ok: true, action: request.action, asset: approved, sourceRevision: bundle.revisionHash };
    }

    case 'approve_rule_pack': {
      if (!bundle.sharedRulePackIds.includes(request.rulePackId)) {
        throw new SourceReviewError(409, 'RULE_PACK_NOT_INHERITED', 'Select this rule pack in the bundle before approving it.');
      }
      const pack = review.rulePacks.find((candidate) => candidate.id === request.rulePackId);
      if (!pack) throw new SourceReviewError(404, 'RULE_PACK_NOT_FOUND', 'This shared rule pack does not exist in the bundle.');
      const documentIds = new Set(bundle.documents.map((document) => document.id));
      if (pack.sourceDocumentIds.some((id) => !documentIds.has(id))) {
        throw new SourceReviewError(409, 'RULE_PACK_SOURCE_MISSING', 'The rule pack references a document outside this bundle.');
      }
      if (request.ruleId && !pack.rules.some((rule) => rule.id === request.ruleId)) {
        throw new SourceReviewError(404, 'RULE_NOT_FOUND', 'This rule does not exist in the selected pack.');
      }
      const rules = pack.rules.map((rule) => {
        if (request.ruleId && rule.id !== request.ruleId) return rule;
        if (rule.sourceRevision !== bundle.revisionHash) {
          throw new SourceReviewError(409, 'RULE_PACK_REVISION_STALE', `Rule ${rule.id} was proposed against a different source revision.`);
        }
        const evidence = verifyClaimEvidence(
          { ...rule.evidence, approvalStatus: 'draft', reviewerUid: null, reviewedAt: null },
          review.pages,
          review.conflicts,
        );
        if (evidence.support !== 'supported') {
          throw new SourceReviewError(422, 'RULE_EVIDENCE_INVALID', `Rule ${rule.id} has ${evidence.support} evidence.`);
        }
        return {
          ...rule,
          approvalStatus: 'approved' as const,
          approvedByUid: reviewerUid,
          approvedAt: now,
          evidence: ClaimEvidenceSchema.parse({
            ...evidence,
            approvalStatus: 'approved',
            reviewerUid,
            reviewedAt: now,
          }),
        };
      });
      const approvalStatus = request.ruleId
        ? rules.every((rule) => rule.approvalStatus === 'approved') ? 'approved' as const : 'draft' as const
        : 'approved' as const;
      const approved = SharedRulePackSchema.parse({ ...pack, rules, approvalStatus, updatedAt: now });
      tx.set(sourceRulePackRef(trackId, bundle.id, pack.id), approved);
      return { ok: true, action: request.action, rulePack: approved, sourceRevision: bundle.revisionHash };
    }

    case 'approve_bundle': {
      if (review.pages.some((page) => page.contentHash !== hashSourcePageContent(page.rawText))) {
        throw new SourceReviewError(409, 'SOURCE_PAGE_HASH_MISMATCH', 'A source page hash does not match its persisted content.');
      }
      if (computeSourceBundleRevisionHash(bundle, review.pages) !== bundle.revisionHash) {
        throw new SourceReviewError(409, 'SOURCE_REVISION_STALE', 'The bundle revision does not match its persisted documents and page evidence.');
      }
      const requiredDocuments = bundle.documents.filter((document) => !document.excluded);
      for (const document of bundle.documents) {
        if (document.excluded && !document.exclusionReason?.trim()) {
          throw new SourceReviewError(422, 'SOURCE_EXCLUSION_REASON_REQUIRED', `Document ${document.id} needs an exclusion reason.`);
        }
      }
      for (const document of requiredDocuments) {
        const pages = review.pages.filter(
          (page) => page.documentId === document.id && page.revisionId === document.revisionId,
        );
        if (pages.length !== document.pageCount || new Set(pages.map((page) => page.pageNumber)).size !== document.pageCount) {
          throw new SourceReviewError(422, 'SOURCE_PAGE_EVIDENCE_INCOMPLETE', `Document ${document.id} does not have complete page evidence.`);
        }
        const missingTranscription = pages.find(
          (page) => page.extractionFlags.includes('manual_transcription_required') && !page.transcription,
        );
        if (missingTranscription) {
          throw new SourceReviewError(
            422,
            'TRANSCRIPTION_REQUIRED',
            `Document ${document.id}, page ${missingTranscription.pageNumber} requires approved transcription before bundle approval.`,
          );
        }
      }
      const openCritical = review.conflicts.find(
        (conflict) => conflict.severity === 'critical' && (conflict.status === 'open' || conflict.status === 'sme_review'),
      );
      if (openCritical) throw new SourceReviewError(409, 'SME_DECISION_REQUIRED', `Resolve critical conflict ${openCritical.id} before bundle approval.`);
      const approved = SourceBundleSchema.parse({
        ...bundle,
        status: 'approved',
        approvedSourceRevision: bundle.revisionHash,
        approvedByUid: reviewerUid,
        approvedAt: now,
        updatedAt: now,
      });
      tx.set(sourceBundleRef(trackId, bundle.id), approved);
      return { ok: true, action: request.action, bundle: approved, sourceRevision: bundle.revisionHash };
    }

    case 'assign_conflict': {
      const conflict = review.conflicts.find((candidate) => candidate.id === request.conflictId);
      if (!conflict || conflict.trackId !== trackId) throw new SourceReviewError(404, 'CONFLICT_NOT_FOUND', 'This source conflict does not exist in the bundle.');
      const assigned = SourceConflictSchema.parse({
        ...conflict,
        status: 'sme_review',
        decision: null,
        decisionOwnerUid: null,
        decidedAt: null,
      });
      tx.set(sourceConflictRef(trackId, bundle.id, conflict.id), assigned);
      return { ok: true, action: request.action, conflict: assigned, sourceRevision: bundle.revisionHash };
    }

    case 'record_conflict_decision': {
      if (!normalizeSourceText(request.decision)) throw new SourceReviewError(400, 'VALIDATION_FAILED', 'The SME decision cannot be blank.');
      const conflict = review.conflicts.find((candidate) => candidate.id === request.conflictId);
      if (!conflict || conflict.trackId !== trackId) throw new SourceReviewError(404, 'CONFLICT_NOT_FOUND', 'This source conflict does not exist in the bundle.');
      for (const ref of conflict.sourceRefs) {
        const result = verifySourceExcerpt(ref, review.pages, { critical: conflict.severity === 'critical' });
        if (!result.matched) throw new SourceReviewError(422, 'CONFLICT_EVIDENCE_INVALID', `Conflict evidence failed exact verification (${result.reason}).`);
      }
      const effectiveFrom = request.effectiveFrom === undefined ? conflict.effectiveFrom : request.effectiveFrom;
      const effectiveTo = request.effectiveTo === undefined ? conflict.effectiveTo : request.effectiveTo;
      if (effectiveFrom && effectiveTo && effectiveFrom > effectiveTo) {
        throw new SourceReviewError(400, 'VALIDATION_FAILED', 'effectiveFrom must not be later than effectiveTo.');
      }
      const decided = SourceConflictSchema.parse({
        ...conflict,
        status: request.status,
        decision: request.decision,
        decisionOwnerUid: reviewerUid,
        decidedAt: now,
        effectiveFrom,
        effectiveTo,
        downstreamInvalidationStatus: request.status === 'resolved' ? 'required' : 'not_required',
      });
      tx.set(sourceConflictRef(trackId, bundle.id, conflict.id), decided);
      return { ok: true, action: request.action, conflict: decided, sourceRevision: bundle.revisionHash };
    }
  }
}

export async function POST(req: Request, { params }: RouteContext): Promise<NextResponse> {
  const auth = await requireAuth(req, INTERNAL_OPS_ROLES);
  if (!auth.ok) return auth.response;
  const { trackId } = await params;
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return jsonError(400, 'VALIDATION_FAILED', 'The request body must be JSON.');
  }
  const parsed = SourceReviewRequestSchema.safeParse(json);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return jsonError(400, 'VALIDATION_FAILED', `Check "${first?.path.join('.') || 'body'}": ${first?.message ?? 'invalid value'}.`);
  }

  try {
    const result = await adminDb.runTransaction((tx) => applyReviewCommand(trackId, parsed.data, auth.user.uid, tx));
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof SourceReviewError) return jsonError(error.status, error.code, error.message);
    if (error instanceof SourceBundleNotFoundError) return jsonError(404, 'NOT_FOUND', 'This source bundle does not exist.');
    return jsonError(500, 'SOURCE_REVIEW_FAILED', 'The source review change could not be completed. Reload and try again.');
  }
}
