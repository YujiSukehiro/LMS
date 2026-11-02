import { z } from 'zod';
import {
  ClaimEvidenceSchema,
  EvidenceSupportSchema,
  ReviewStatusSchema,
  SourceExcerptRefSchema,
  type ClaimEvidence,
} from '@/lib/schemas/source-truth';

/** Model-facing evidence has no Zod defaults, keeping manual JSON Schema exchange acyclic. */
export const ClaimEvidenceProposalSchema = ClaimEvidenceSchema.extend({
  ruleIds: z.array(z.string().min(1)).optional(),
  excerpts: z
    .array(SourceExcerptRefSchema.extend({ fromApprovedTranscription: z.boolean().optional() }))
    .min(1)
    .max(12),
  support: EvidenceSupportSchema.optional(),
  approvalStatus: ReviewStatusSchema.optional(),
  critical: z.boolean().optional(),
  requiresInterfaceDetails: z.boolean().optional(),
  reviewerUid: z.string().nullable().optional(),
  reviewedAt: z.number().nullable().optional(),
});

export type ClaimEvidenceProposal = z.infer<typeof ClaimEvidenceProposalSchema>;

/** Model evidence is always an unapproved proposal, regardless of labels in generated JSON. */
export function finalizeEvidenceProposals(
  evidence: ClaimEvidenceProposal[] | undefined,
  ownerId: string,
): ClaimEvidence[] | undefined {
  return evidence?.map((proposal, index) =>
    ClaimEvidenceSchema.parse({
      ...proposal,
      id: `${ownerId}-e${index + 1}`,
      support: 'unsupported',
      approvalStatus: 'draft',
      reviewerUid: null,
      reviewedAt: null,
    }),
  );
}
