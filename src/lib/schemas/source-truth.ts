import { z } from 'zod';

export const SOURCE_TRUTH_SCHEMA_VERSION = 1 as const;
export const SourceDocumentRoleSchema = z.enum([
  'shared_foundation',
  'product',
  'support',
  'medical_chat',
  'renewals',
  'reference',
]);
export const ExtractionQualityFlagSchema = z.enum([
  'low_text_density',
  'possible_table_fragmentation',
  'possible_url_fragmentation',
  'possible_reading_order_issue',
  'manual_transcription_required',
]);
export const EvidenceSupportSchema = z.enum(['supported', 'partially_supported', 'unsupported', 'conflicted']);
export const ReviewStatusSchema = z.enum(['draft', 'approved', 'rejected']);
export const AssetStatusSchema = z.enum(['draft', 'approved', 'retired']);
export const SeveritySchema = z.enum(['critical', 'major', 'coaching']);

export const SourceExcerptRefSchema = z.object({
  documentId: z.string().min(1),
  revisionId: z.string().min(1),
  pageNumber: z.number().int().positive(),
  exactText: z.string().min(1).max(12_000),
  fromApprovedTranscription: z.boolean().default(false),
});
export type SourceExcerptRef = z.infer<typeof SourceExcerptRefSchema>;

export const ClaimEvidenceSchema = z.object({
  id: z.string().min(1),
  claim: z.string().min(1).max(2_000),
  ruleIds: z.array(z.string().min(1)).default([]),
  excerpts: z.array(SourceExcerptRefSchema).min(1).max(12),
  support: EvidenceSupportSchema.default('unsupported'),
  approvalStatus: ReviewStatusSchema.default('draft'),
  critical: z.boolean().default(false),
  requiresInterfaceDetails: z.boolean().default(false),
  reviewerUid: z.string().nullable().default(null),
  reviewedAt: z.number().nullable().default(null),
});
export type ClaimEvidence = z.infer<typeof ClaimEvidenceSchema>;

export const ApprovedTranscriptionSchema = z.object({
  text: z.string().min(1).max(100_000),
  approvedByUid: z.string().min(1),
  approvedAt: z.number().int().positive(),
});

export const SourcePageEvidenceSchema = z.object({
  id: z.string().min(1),
  documentId: z.string().min(1),
  revisionId: z.string().min(1),
  pageNumber: z.number().int().positive(),
  rawText: z.string().max(150_000),
  normalizedText: z.string().max(150_000),
  contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  characterCount: z.number().int().nonnegative(),
  extractionFlags: z.array(ExtractionQualityFlagSchema),
  transcription: ApprovedTranscriptionSchema.nullable().default(null),
  approvedExcerpts: z.array(SourceExcerptRefSchema).default([]),
});
export type SourcePageEvidence = z.infer<typeof SourcePageEvidenceSchema>;

export const SourceDocumentRefSchema = z.object({
  id: z.string().min(1),
  revisionId: z.string().min(1),
  bundleId: z.string().min(1),
  trackId: z.string().min(1),
  role: SourceDocumentRoleSchema,
  fileName: z.string().min(1),
  storagePath: z.string().min(1),
  sourceVersion: z.string().min(1),
  effectiveDate: z.string().nullable().default(null),
  uploadedAt: z.number().int().positive(),
  uploadedByUid: z.string().min(1),
  contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  pageCount: z.number().int().positive(),
  inheritanceOrder: z.number().int().nonnegative(),
  excluded: z.boolean().default(false),
  exclusionReason: z.string().nullable().default(null),
});
export type SourceDocumentRef = z.infer<typeof SourceDocumentRefSchema>;

export const SourceBundleSchema = z.object({
  schemaVersion: z.literal(SOURCE_TRUTH_SCHEMA_VERSION).default(SOURCE_TRUTH_SCHEMA_VERSION),
  id: z.string().min(1),
  trackId: z.string().min(1),
  documents: z.array(SourceDocumentRefSchema).min(1),
  sharedRulePackIds: z.array(z.string().min(1)),
  precedencePolicyId: z.string().min(1).default('standard-meds-precedence-v1'),
  conflictIds: z.array(z.string().min(1)).default([]),
  /** Pack-level decisions still awaiting an explicit SME resolution; separate from excerpt-backed conflicts. */
  unresolvedSmeDecisionIds: z.array(z.string().min(1)).default([]),
  status: z.enum(['draft', 'needs_sme', 'approved', 'published']),
  revisionHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  approvedSourceRevision: z.string().nullable().default(null),
  approvedByUid: z.string().nullable().default(null),
  approvedAt: z.number().nullable().default(null),
  createdAt: z.number().int().positive(),
  updatedAt: z.number().int().positive(),
});
export type SourceBundle = z.infer<typeof SourceBundleSchema>;

export const SharedRuleSchema = z.object({
  id: z.string().min(1),
  packId: z.string().min(1),
  title: z.string().min(1).max(160),
  statement: z.string().min(1).max(2_000),
  severity: SeveritySchema,
  applicableTrackIds: z.array(z.string().min(1)),
  channels: z.array(z.string().min(1)),
  stages: z.array(z.string().min(1)),
  evidence: ClaimEvidenceSchema,
  requiredKnowledge: z.boolean().default(true),
  requiredScenarioCoverage: z.boolean().default(true),
  sourceRevision: z.string().min(1),
  approvalStatus: ReviewStatusSchema.default('draft'),
  approvedByUid: z.string().nullable().default(null),
  approvedAt: z.number().nullable().default(null),
});
export type SharedRule = z.infer<typeof SharedRuleSchema>;

export const SharedRulePackSchema = z.object({
  id: z.string().min(1),
  revision: z.string().min(1),
  title: z.string().min(1),
  sourceDocumentIds: z.array(z.string().min(1)).min(1),
  rules: z.array(SharedRuleSchema).min(1),
  approvalStatus: ReviewStatusSchema.default('draft'),
  createdAt: z.number().int().positive(),
  updatedAt: z.number().int().positive(),
});
export type SharedRulePack = z.infer<typeof SharedRulePackSchema>;

const AssetScopeFields = {
  id: z.string().min(1),
  trackId: z.string().min(1),
  product: z.string().min(1),
  context: z.string().min(1),
  stage: z.string().min(1),
  sourceRefs: z.array(SourceExcerptRefSchema).min(1),
  effectiveFrom: z.string().nullable().default(null),
  effectiveTo: z.string().nullable().default(null),
  status: AssetStatusSchema.default('draft'),
  approvedByUid: z.string().nullable().default(null),
  approvedAt: z.number().nullable().default(null),
};

export const OfferAssetSchema = z.object({
  ...AssetScopeFields,
  kind: z.literal('offer'),
  context: z.enum(['recovery', 'existing_patient_cancellation', 'existing_patient_discount']),
  label: z.string().min(1),
  amountCents: z.number().int().nonnegative().nullable().default(null),
  comparisonAmountCents: z.number().int().nonnegative().nullable().default(null),
  recurringInterval: z.string().nullable().default(null),
  duration: z.enum(['first_month', 'next_order_only', 'ongoing', 'plan_term']),
  discountBasisPoints: z.number().int().min(0).max(10_000).nullable().default(null),
  calculation: z.string().nullable().default(null),
  sequence: z.number().int().nonnegative(),
  prerequisites: z.array(z.string()),
});
export type OfferAsset = z.infer<typeof OfferAssetSchema>;

export const LinkAssetSchema = z.object({
  ...AssetScopeFields,
  kind: z.literal('link'),
  linkType: z.enum(['dosage', 'checkout', 'results', 'quiz', 'portal', 'support']),
  host: z.string().min(1),
  url: z.string().url().startsWith('https://synthetic.invalid/'),
  personalized: z.boolean().default(false),
  permittedActions: z.array(z.enum(['display', 'fake_sms', 'fake_portal_open'])).min(1),
});
export type LinkAsset = z.infer<typeof LinkAssetSchema>;

export const CanonicalDispositionSchema = z.enum([
  'Recovered',
  'Callback scheduled',
  "Didn't reply",
  'Not interested',
  'Organic',
  'Lost',
  // Service and compliance calls (review 2026-11-23: an emergency call had to end "Callback scheduled").
  'Resolved',
  'Escalated',
]);

/** Outcomes of a sales or recovery call. */
export const SALES_DISPOSITIONS = ['Recovered', 'Callback scheduled', "Didn't reply", 'Not interested', 'Organic', 'Lost'] as const;
/** Outcomes of a service, support or compliance call. */
export const SERVICE_DISPOSITIONS = ['Resolved', 'Escalated', 'Callback scheduled', "Didn't reply"] as const;

export const DispositionAssetSchema = z.object({
  ...AssetScopeFields,
  kind: z.literal('disposition'),
  label: CanonicalDispositionSchema,
  requiredEvidence: z.array(z.string().min(1)),
  forbiddenEvidence: z.array(z.string().min(1)).default([]),
});
export type DispositionAsset = z.infer<typeof DispositionAssetSchema>;

export const WorkflowAssetSchema = z.object({
  ...AssetScopeFields,
  kind: z.literal('workflow'),
  actionType: z.string().min(1),
  sequence: z.array(z.object({ order: z.number().int().positive(), action: z.string().min(1), screenLabel: z.string().nullable() })).min(1),
  requiresInterfaceDetails: z.boolean().default(false),
  allowedFields: z.array(z.string().min(1)),
});
export type WorkflowAsset = z.infer<typeof WorkflowAssetSchema>;

export const OperationalAssetSchema = z.discriminatedUnion('kind', [
  OfferAssetSchema,
  LinkAssetSchema,
  DispositionAssetSchema,
  WorkflowAssetSchema,
]);
export type OperationalAsset = z.infer<typeof OperationalAssetSchema>;

export const SourceConflictSchema = z.object({
  id: z.string().min(1),
  trackId: z.string().min(1),
  sourceRefs: z.array(SourceExcerptRefSchema).min(2),
  affectedProducts: z.array(z.string().min(1)),
  affectedContexts: z.array(z.string().min(1)),
  affectedStages: z.array(z.string().min(1)),
  affectedAssetIds: z.array(z.string().min(1)).default([]),
  affectedRuleIds: z.array(z.string().min(1)).default([]),
  detectedValues: z.array(z.string().min(1)).min(2),
  severity: SeveritySchema,
  status: z.enum(['open', 'sme_review', 'resolved', 'accepted_context_difference']),
  decision: z.string().nullable().default(null),
  decisionOwnerUid: z.string().nullable().default(null),
  decidedAt: z.number().nullable().default(null),
  effectiveFrom: z.string().nullable().default(null),
  effectiveTo: z.string().nullable().default(null),
  downstreamInvalidationStatus: z.enum(['not_required', 'required', 'completed']).default('not_required'),
  /** One plain sentence on what contradicts what (automatic contradiction check). */
  summary: z.string().max(400).optional(),
  /** Who proposed the conflict: an SME register entry, or the automatic PDF contradiction check. */
  origin: z.enum(['sme', 'contradiction_check']).optional(),
});
export type SourceConflict = z.infer<typeof SourceConflictSchema>;

export const PublicationGateIssueSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  severity: SeveritySchema,
  affectedType: z.enum(['track', 'unit', 'claim', 'scenario', 'asset', 'rule', 'conflict', 'source']),
  affectedId: z.string().min(1),
  blocking: z.boolean(),
});

export const PublicationGateReportSchema = z.object({
  eligible: z.boolean(),
  issues: z.array(PublicationGateIssueSchema),
  checkedSourceRevision: z.string(),
  checkedAt: z.number().int().positive(),
});
export type PublicationGateReport = z.infer<typeof PublicationGateReportSchema>;
export type PublicationGateIssue = z.infer<typeof PublicationGateIssueSchema>;
