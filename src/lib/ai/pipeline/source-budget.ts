import type {
  OperationalAsset,
  SharedRulePack,
  SourceExcerptRef,
  SourcePageEvidence,
} from '@/lib/schemas/source-truth';
import { verifySourceExcerpt } from '@/lib/services/source-evidence';

export interface SourceReviewPromptContext {
  pages: SourcePageEvidence[];
  rulePacks: SharedRulePack[];
  assets: OperationalAsset[];
}

export interface SourceInputRef {
  documentId: string;
  revisionId: string;
  pageNumber: number;
}

export interface SourceExcerptInputRef extends SourceInputRef {
  exactText: string;
  fromApprovedTranscription: boolean;
}

export interface SourceBudgetReport {
  stage: string;
  charBudget: number;
  usedChars: number;
  includedPages: SourceInputRef[];
  omittedPages: Array<SourceInputRef & { critical: boolean; reason: string }>;
  includedExcerpts: SourceExcerptInputRef[];
  omittedExcerpts: Array<SourceExcerptInputRef & { reason: string }>;
}

export interface BudgetedSourcePage {
  documentId: string;
  revisionId: string;
  pageNumber: number;
  text: string;
  extractionFlags: SourcePageEvidence['extractionFlags'];
  approvedExcerpts: SourceExcerptRef[];
  hasApprovedTranscription: boolean;
}

export interface SourceBudgetResult {
  pages: BudgetedSourcePage[];
  report: SourceBudgetReport;
}

export class CriticalSourceInputError extends Error {
  readonly code = 'CRITICAL_SOURCE_INPUT_OMITTED';

  constructor(
    message: string,
    readonly report: SourceBudgetReport,
  ) {
    super(message);
    this.name = 'CriticalSourceInputError';
  }
}

const CRITICAL_PAGE_PATTERNS: Array<{ reason: string; pattern: RegExp }> = [
  { reason: 'compliance', pattern: /\bcompliance\b|recording disclosure|opt[- ]out|do not call|self[- ]identif/i },
  { reason: 'pricing', pattern: /\bpricing\b|\bprice\b|discount|payment plan|funnel[- ]stage/i },
  { reason: 'link', pattern: /\b(?:link|url)\b|https?:\/\//i },
  { reason: 'disposition', pattern: /\bdisposition\b|\brecovered\b|\bnot interested\b/i },
  { reason: 'privacy', pattern: /\bprivacy\b|\bphi\b|third[- ]party disclosure/i },
  { reason: 'payment', pattern: /\bpayment\b|\bpci\b|card(?:holder)? data|cvv\b/i },
  { reason: 'escalation', pattern: /\bescalat(?:e|ion)\b|\bemergency\b/i },
  { reason: 'medical_boundary', pattern: /medical boundar|prohibited medical|clinical boundar|diagnos(?:e|is)|side[- ]effect/i },
];

export function sourcePageRef(page: SourceInputRef): string {
  return `${page.documentId}@${page.revisionId}#${page.pageNumber}`;
}

function excerptRef(excerpt: SourceExcerptRef): SourceExcerptInputRef {
  return {
    documentId: excerpt.documentId,
    revisionId: excerpt.revisionId,
    pageNumber: excerpt.pageNumber,
    exactText: excerpt.exactText,
    fromApprovedTranscription: excerpt.fromApprovedTranscription,
  };
}

function sameExcerpt(left: SourceExcerptRef, right: SourceExcerptRef): boolean {
  return (
    left.documentId === right.documentId &&
    left.revisionId === right.revisionId &&
    left.pageNumber === right.pageNumber &&
    left.exactText === right.exactText &&
    left.fromApprovedTranscription === right.fromApprovedTranscription
  );
}

function pageText(page: SourcePageEvidence): string {
  return [page.normalizedText, page.transcription?.text ?? ''].filter(Boolean).join('\n');
}

function criticalReasons(page: SourcePageEvidence): string[] {
  const text = pageText(page);
  return CRITICAL_PAGE_PATTERNS.filter(({ pattern }) => pattern.test(text)).map(({ reason }) => reason);
}

/**
 * Select source text without truncating critical pages or approved excerpts. Critical inputs are
 * planned first; if they cannot fit or their source page is missing, generation fails closed.
 */
export function planSourceBudget(input: {
  stage: string;
  pages: SourcePageEvidence[];
  charBudget: number;
  selectedPageNumbers?: number[];
  preferredPageOrder?: number[];
  rulePacks?: SharedRulePack[];
  assets?: OperationalAsset[];
}): SourceBudgetResult {
  const report: SourceBudgetReport = {
    stage: input.stage,
    charBudget: input.charBudget,
    usedChars: 0,
    includedPages: [],
    omittedPages: [],
    includedExcerpts: [],
    omittedExcerpts: [],
  };
  const selected = input.selectedPageNumbers ? new Set(input.selectedPageNumbers) : null;
  const requiredReasons = new Map<string, Set<string>>();
  const requiredExcerpts: SourceExcerptRef[] = [];
  const byRef = new Map(input.pages.map((page) => [sourcePageRef(page), page]));

  const requirePage = (ref: SourceInputRef, reason: string) => {
    const key = sourcePageRef(ref);
    const reasons = requiredReasons.get(key) ?? new Set<string>();
    reasons.add(reason);
    requiredReasons.set(key, reasons);
  };
  const requireExcerpt = (excerpt: SourceExcerptRef, reason: string) => {
    requirePage(excerpt, reason);
    if (!requiredExcerpts.some((existing) => sameExcerpt(existing, excerpt))) requiredExcerpts.push(excerpt);
  };

  for (const page of input.pages) {
    for (const reason of criticalReasons(page)) requirePage(page, reason);
    for (const excerpt of page.approvedExcerpts) requireExcerpt(excerpt, 'approved_excerpt');
  }
  for (const pack of input.rulePacks ?? []) {
    for (const rule of pack.rules) {
      for (const excerpt of rule.evidence.excerpts) requireExcerpt(excerpt, `shared_rule:${rule.id}`);
    }
  }
  for (const asset of input.assets ?? []) {
    if (asset.status !== 'approved') continue;
    for (const ref of asset.sourceRefs) requireExcerpt(ref, `approved_asset:${asset.id}`);
  }

  for (const excerpt of requiredExcerpts) {
    const page = byRef.get(sourcePageRef(excerpt));
    const verification = page ? verifySourceExcerpt(excerpt, input.pages, { critical: true }) : null;
    if (!page || !verification?.matched) {
      report.omittedExcerpts.push({ ...excerptRef(excerpt), reason: verification?.reason ?? 'page_missing' });
    }
  }

  const criticalPages = input.pages.filter((page) => requiredReasons.has(sourcePageRef(page)));
  for (const page of criticalPages) {
    if (page.extractionFlags.includes('manual_transcription_required') && !page.transcription) {
      report.omittedPages.push({
        documentId: page.documentId,
        revisionId: page.revisionId,
        pageNumber: page.pageNumber,
        critical: true,
        reason: 'transcription_required',
      });
    }
  }

  const preferred = new Map((input.preferredPageOrder ?? []).map((pageNumber, index) => [pageNumber, index]));
  const optionalPages = input.pages
    .filter((page) => !requiredReasons.has(sourcePageRef(page)) && (!selected || selected.has(page.pageNumber)))
    .sort((left, right) => (preferred.get(left.pageNumber) ?? 9999) - (preferred.get(right.pageNumber) ?? 9999) || left.pageNumber - right.pageNumber);
  const ordered = [...criticalPages, ...optionalPages];
  const included: BudgetedSourcePage[] = [];
  const includedKeys = new Set<string>();
  const omittedCriticalKeys = new Set(report.omittedPages.map((page) => sourcePageRef(page)));

  for (const page of ordered) {
    const key = sourcePageRef(page);
    if (omittedCriticalKeys.has(key)) continue;
    const critical = requiredReasons.has(key);
    const text = pageText(page);
    if (report.usedChars + text.length > input.charBudget) {
      report.omittedPages.push({
        documentId: page.documentId,
        revisionId: page.revisionId,
        pageNumber: page.pageNumber,
        critical,
        reason: critical ? 'critical_input_exceeds_budget' : 'prompt_budget',
      });
      if (critical) omittedCriticalKeys.add(key);
      continue;
    }
    report.usedChars += text.length;
    report.includedPages.push({ documentId: page.documentId, revisionId: page.revisionId, pageNumber: page.pageNumber });
    includedKeys.add(key);
    included.push({
      documentId: page.documentId,
      revisionId: page.revisionId,
      pageNumber: page.pageNumber,
      text,
      extractionFlags: page.extractionFlags,
      approvedExcerpts: page.approvedExcerpts,
      hasApprovedTranscription: page.transcription !== null,
    });
  }

  for (const excerpt of requiredExcerpts) {
    if (includedKeys.has(sourcePageRef(excerpt)) && !report.omittedExcerpts.some((item) => sameExcerpt(item, excerpt))) {
      report.includedExcerpts.push(excerptRef(excerpt));
    } else if (!report.omittedExcerpts.some((item) => sameExcerpt(item, excerpt))) {
      report.omittedExcerpts.push({ ...excerptRef(excerpt), reason: 'page_omitted' });
    }
  }

  const criticalOmissions = report.omittedPages.filter((page) => page.critical);
  if (criticalOmissions.length > 0 || report.omittedExcerpts.length > 0) {
    const missing = [
      ...criticalOmissions.map((page) => `${sourcePageRef(page)} (${page.reason})`),
      ...report.omittedExcerpts.map((excerpt) => `${sourcePageRef(excerpt)} excerpt (${excerpt.reason})`),
    ];
    throw new CriticalSourceInputError(`Required critical source input was not available for ${input.stage}: ${missing.join('; ')}.`, report);
  }
  return { pages: included, report };
}

/** Explicit document/revision/page labels let models construct verifiable excerpt references. */
export function formatBudgetedSourcePages(pages: BudgetedSourcePage[]): string {
  return pages
    .map((page) => {
      const excerpts = page.approvedExcerpts.length
        ? `\nAPPROVED EXCERPTS (copy exactText verbatim):\n${page.approvedExcerpts
            .map((excerpt) => `- fromApprovedTranscription=${excerpt.fromApprovedTranscription}: ${excerpt.exactText}`)
            .join('\n')}`
        : '';
      return `=== SOURCE DOCUMENT ${page.documentId} | REVISION ${page.revisionId} | PAGE ${page.pageNumber} ===\n${page.text}${excerpts}`;
    })
    .join('\n\n');
}

/** Approved shared rules are inherited inputs, never track-specific text for the model to reinvent. */
export function formatSharedRulePacks(packs: SharedRulePack[]): string {
  if (packs.length === 0) return '(none)';
  return packs
    .map((pack) => {
      const rules = pack.rules
        .map(
          (rule) =>
            `- ruleId=${rule.id}; severity=${rule.severity}; statement=${rule.statement}; evidence=${rule.evidence.excerpts
              .map((excerpt) => `${sourcePageRef(excerpt)}`)
              .join(', ')}`,
        )
        .join('\n');
      return `SHARED RULE PACK ${pack.id} | REVISION ${pack.revision}\n${rules}`;
    })
    .join('\n\n');
}

export function formatApprovedAssets(assets: OperationalAsset[]): string {
  const approved = assets.filter((asset) => asset.status === 'approved');
  return approved.length > 0 ? JSON.stringify(approved, null, 2) : '(none)';
}

export const EXACT_EVIDENCE_RULE = [
  'Every BriefingCard, Drill, and rubric criterion must include "evidence" with at least one claim object.',
  'Each evidence excerpt must copy a continuous, exact supporting passage from the identified documentId, revisionId, and pageNumber. A page number alone is not evidence.',
  'Set fromApprovedTranscription=true only when copying the approved transcription. Do not infer screenshot/interface steps from a caption.',
  'Generated evidence is an AI proposal: use support="unsupported", approvalStatus="draft", reviewerUid=null, and reviewedAt=null. The server recomputes support and a trainer must approve it.',
  'When a claim implements a shared rule, include that stable rule ID in ruleIds; do not rewrite or re-invent the shared rule.',
].join('\n');
