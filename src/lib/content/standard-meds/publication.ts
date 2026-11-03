import type { StandardMedsSourceCode } from './source-catalog';
import type { StandardMedsSourceRegistration } from './source-manifest-schema';

export const STANDARD_MEDS_SME_DECISION_IDS = ['SME-01', 'SME-02', 'SME-03', 'SME-04', 'SME-05', 'SME-06', 'SME-07', 'SME-08', 'SME-09', 'SME-10'] as const;
export type StandardMedsSmeDecisionId = (typeof STANDARD_MEDS_SME_DECISION_IDS)[number];

export interface StandardMedsSmeDecision {
  id: StandardMedsSmeDecisionId;
  issue: string;
  requiredDecision: string;
  status: 'open';
  decision: null;
  decisionOwnerUid: null;
  decidedAt: null;
}

/** Document-06 decision register. No model-selected resolution or approver identity is supplied. */
export const STANDARD_MEDS_SME_DECISIONS: readonly StandardMedsSmeDecision[] = [
  { id: 'SME-01', issue: 'Recovery prices differ from existing-patient prices.', requiredDecision: 'Approve context-scoped offer assets and effective dates; prevent cross-context reuse.', status: 'open', decision: null, decisionOwnerUid: null, decidedAt: null },
  { id: 'SME-02', issue: 'Cancellation affordability and general existing-patient discount ladders may conflict.', requiredDecision: 'Define entry intent, sequence, and the controlling ladder for each branch.', status: 'open', decision: null, decisionOwnerUid: null, decidedAt: null },
  { id: 'SME-03', issue: 'Voicemail scripts mention texting while shared rules prohibit a voicemail link-send.', requiredDecision: 'Decide the SMS policy; the sandbox continues to prohibit voicemail sends.', status: 'open', decision: null, decisionOwnerUid: null, decidedAt: null },
  { id: 'SME-04', issue: 'Quiz URLs differ across product and Customer Support sources.', requiredDecision: 'Approve current link assets and effective scope without guessing from live pages.', status: 'open', decision: null, decisionOwnerUid: null, decidedAt: null },
  { id: 'SME-05', issue: 'Statement descriptor extraction and wording differ.', requiredDecision: 'Approve exact customer-safe wording and manually transcribe the fragmented table.', status: 'open', decision: null, decisionOwnerUid: null, decidedAt: null },
  { id: 'SME-06', issue: 'Medical Chat vertical scope and its NAD+ tenant coverage are unclear.', requiredDecision: 'Confirm current vertical scope and whether NAD+ pending cases are included.', status: 'open', decision: null, decisionOwnerUid: null, decidedAt: null },
  { id: 'SME-07', issue: 'Routine portal wording differs from the exception identity-request workflow.', requiredDecision: 'Clarify routine login versus exception identity verification.', status: 'open', decision: null, decisionOwnerUid: null, decidedAt: null },
  { id: 'SME-08', issue: 'Offer and re-offer wording permits different count interpretations.', requiredDecision: 'Approve the exact countable offer/re-offer state machine.', status: 'open', decision: null, decisionOwnerUid: null, decidedAt: null },
  { id: 'SME-09', issue: 'Image-heavy operational screens lack complete extracted text.', requiredDecision: 'Provide trainer transcription or approved structured action assets.', status: 'open', decision: null, decisionOwnerUid: null, decidedAt: null },
  { id: 'SME-10', issue: 'Offers can rotate while live pages remain authoritative.', requiredDecision: 'Assign an owner, refresh cadence, effective dates, and deliberate asset expiry.', status: 'open', decision: null, decisionOwnerUid: null, decidedAt: null },
] as const;

export interface StandardMedsPublicationBlocker {
  code: 'EXACT_EXCERPT_APPROVAL_REQUIRED' | 'OPERATIONAL_ASSET_APPROVAL_REQUIRED' | 'SOURCE_TRANSCRIPTION_REQUIRED' | 'SME_DECISION_REQUIRED' | 'TRAINER_SIGNOFF_REQUIRED';
  message: string;
  sourceCode?: StandardMedsSourceCode;
  pageNumbers?: number[];
  smeDecisionIds?: StandardMedsSmeDecisionId[];
}

export function publicationBlockersFor(
  source: StandardMedsSourceRegistration,
  contentItemCount: number,
  assetIds: string[],
  smeDecisionIds: StandardMedsSmeDecisionId[],
): StandardMedsPublicationBlocker[] {
  const flaggedPages = source.pages.filter((page) => page.extractionFlags.includes('manual_transcription_required')).map((page) => page.pageNumber);
  const blockers: StandardMedsPublicationBlocker[] = [
    {
      code: 'EXACT_EXCERPT_APPROVAL_REQUIRED',
      message: `${contentItemCount} briefing, drill, and rubric items have document-06 page references only; attach matching exact excerpts and trainer approval before publication.`,
      sourceCode: source.code,
    },
    {
      code: 'OPERATIONAL_ASSET_APPROVAL_REQUIRED',
      message: `Synthetic draft assets (${assetIds.join(', ')}) require exact link/offer/disposition/workflow review, scope, and effective dates.`,
      sourceCode: source.code,
    },
  ];
  if (flaggedPages.length > 0) {
    blockers.push({
      code: 'SOURCE_TRANSCRIPTION_REQUIRED',
      message: `Extraction flags require trainer transcription or approved structured actions for the affected interface content on PDF pages ${flaggedPages.join(', ')}.`,
      sourceCode: source.code,
      pageNumbers: flaggedPages,
      smeDecisionIds: ['SME-09'],
    });
  }
  if (smeDecisionIds.length > 0) {
    blockers.push({
      code: 'SME_DECISION_REQUIRED',
      message: `Resolve ${smeDecisionIds.join(', ')} with an explicit owner, decision, and effective scope; no decision is inferred by this pack.`,
      sourceCode: source.code,
      smeDecisionIds,
    });
  }
  blockers.push({
    code: 'TRAINER_SIGNOFF_REQUIRED',
    message: `A trainer must approve exact source revision ${source.revisionId} and the complete curriculum version; this synthetic draft is not published.`,
    sourceCode: source.code,
  });
  return blockers;
}
