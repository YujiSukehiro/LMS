import type {
  OperationalAsset,
  SharedRulePack,
  SourceExcerptRef,
  SourcePageEvidence,
} from '@/lib/schemas/source-truth';
import { verifySourceExcerpt } from '@/lib/services/source-evidence';
import { labelSourcePages } from '@/lib/ai/prompts/evidence';

/** Context window assumed for local providers (Ollama num_ctx; MLX is budgeted the same way). */
export const LOCAL_CONTEXT_TOKENS = 16_384;
/** Conservative characters per token for English Playbook text (prompt budgeting only). */
export const CHARS_PER_TOKEN = 3.2;

/**
 * Characters of SOURCE text that fit one local prompt: the context window minus the planned output,
 * room for one repair turn (the previous answer is resent), and the fixed prompt/schema overhead.
 */
export function localSourceCharBudget(input: { plannedOutputTokens: number; overheadTokens?: number; contextTokens?: number }): number {
  const context = input.contextTokens ?? LOCAL_CONTEXT_TOKENS;
  const overhead = input.overheadTokens ?? 2_500;
  const tokens = context - 2 * input.plannedOutputTokens - overhead;
  return Math.max(6_000, Math.floor(tokens * CHARS_PER_TOKEN));
}

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
  /** PAGE label shown to the model (equals the document page number for single-document bundles). */
  pageNumber: number;
  /** Page number within its own document. */
  sourcePageNumber: number;
  text: string;
  /** True when only the opening of the page is shown (overview mode). */
  condensed?: boolean;
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
 * Select source text without truncating critical pages or approved excerpts.
 *
 * `evidence` mode (Unit and Sim stages, the default): pages that inherited shared rules or approved
 * assets cite are required, as are critical-topic pages inside `selectedPageNumbers`. They are planned
 * first; if one cannot fit or its source page is missing, generation fails closed. Without a
 * selection, critical-topic pages are only prioritized (the stage sees the whole bundle, so a
 * keyword match on every page must not make the bundle unbuildable).
 *
 * `overview` mode (Blueprint): the stage only maps pages to Units and quotes nothing, so every page is
 * included, condensed to an equal share when the full text does not fit.
 *
 * `selectedPageNumbers` and `preferredPageOrder` use PAGE labels (see `labelSourcePages`).
 */
export function planSourceBudget(input: {
  stage: string;
  pages: SourcePageEvidence[];
  charBudget: number;
  selectedPageNumbers?: number[];
  preferredPageOrder?: number[];
  rulePacks?: SharedRulePack[];
  assets?: OperationalAsset[];
  mode?: 'evidence' | 'overview';
}): SourceBudgetResult {
  if (input.mode === 'overview') return planOverviewBudget(input);
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
  const priorityKeys = new Set<string>();
  const requiredExcerpts: SourceExcerptRef[] = [];
  const byRef = new Map(input.pages.map((page) => [sourcePageRef(page), page]));
  const labelByRef = new Map(labelSourcePages(input.pages).map(({ label, page }) => [sourcePageRef(page), label]));
  const labelOf = (page: SourceInputRef) => labelByRef.get(sourcePageRef(page)) ?? page.pageNumber;

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
    const inSelection = !selected || selected.has(labelOf(page));
    const reasons = criticalReasons(page);
    // Critical-topic keywords fail closed only for pages this stage was asked to teach from.
    if (selected && inSelection) for (const reason of reasons) requirePage(page, reason);
    else if (reasons.length > 0 && inSelection) priorityKeys.add(sourcePageRef(page));
    if (inSelection) for (const excerpt of page.approvedExcerpts) requireExcerpt(excerpt, 'approved_excerpt');
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
    .filter((page) => !requiredReasons.has(sourcePageRef(page)) && (!selected || selected.has(labelOf(page))))
    .sort(
      (left, right) =>
        Number(priorityKeys.has(sourcePageRef(right))) - Number(priorityKeys.has(sourcePageRef(left))) ||
        (preferred.get(labelOf(left)) ?? 9999) - (preferred.get(labelOf(right)) ?? 9999) ||
        labelOf(left) - labelOf(right),
    );
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
        critical: critical || priorityKeys.has(key),
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
      pageNumber: labelOf(page),
      sourcePageNumber: page.pageNumber,
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

  const criticalOmissions = report.omittedPages.filter((page) => requiredReasons.has(sourcePageRef(page)));
  if (criticalOmissions.length > 0 || report.omittedExcerpts.length > 0) {
    const missing = [
      ...criticalOmissions.map((page) => `${sourcePageRef(page)} (${page.reason})`),
      ...report.omittedExcerpts.map((excerpt) => `${sourcePageRef(excerpt)} excerpt (${excerpt.reason})`),
    ];
    throw new CriticalSourceInputError(`Required critical source input was not available for ${input.stage}: ${missing.join('; ')}.`, report);
  }
  included.sort((left, right) => left.pageNumber - right.pageNumber);
  return { pages: included, report };
}

function condensePageText(text: string, chars: number): string {
  if (text.length <= chars) return text;
  const cut = text.slice(0, chars);
  const lastBreak = Math.max(cut.lastIndexOf('\n'), cut.lastIndexOf('. '));
  return `${(lastBreak > chars * 0.5 ? cut.slice(0, lastBreak + 1) : cut).trimEnd()} [page condensed]`;
}

/** Every page, in full when it fits, otherwise each page cut to an equal share (never omitted). */
function planOverviewBudget(input: Parameters<typeof planSourceBudget>[0]): SourceBudgetResult {
  const labeled = labelSourcePages(input.pages);
  const total = labeled.reduce((sum, { page }) => sum + pageText(page).length, 0);
  const share = Math.max(300, Math.floor(input.charBudget / Math.max(1, labeled.length)) - 20);
  const report: SourceBudgetReport = {
    stage: input.stage,
    charBudget: input.charBudget,
    usedChars: 0,
    includedPages: [],
    omittedPages: [],
    includedExcerpts: [],
    omittedExcerpts: [],
  };
  const pages = labeled.map(({ label, page }): BudgetedSourcePage => {
    const full = pageText(page);
    const text = total <= input.charBudget ? full : condensePageText(full, share);
    report.usedChars += text.length;
    report.includedPages.push({ documentId: page.documentId, revisionId: page.revisionId, pageNumber: page.pageNumber });
    return {
      documentId: page.documentId,
      revisionId: page.revisionId,
      pageNumber: label,
      sourcePageNumber: page.pageNumber,
      text,
      condensed: text !== full,
      extractionFlags: page.extractionFlags,
      approvedExcerpts: [],
      hasApprovedTranscription: page.transcription !== null,
    };
  });
  return { pages, report };
}

/**
 * Short PAGE labels: the model cites `pageNumber` only, and the server fills document and revision
 * identity. Multi-document bundles also name the document so the model can tell sources apart.
 */
export function formatBudgetedSourcePages(pages: BudgetedSourcePage[]): string {
  const documents = new Set(pages.map((page) => page.documentId));
  return pages
    .map((page) => {
      const excerpts = page.approvedExcerpts.length
        ? `\nAPPROVED EXCERPTS (copy exactText verbatim):\n${page.approvedExcerpts.map((excerpt) => `- ${excerpt.exactText}`).join('\n')}`
        : '';
      const origin = documents.size > 1 || page.pageNumber !== page.sourcePageNumber
        ? ` (document ${page.documentId}, page ${page.sourcePageNumber})`
        : '';
      return `=== SOURCE PAGE ${page.pageNumber}${origin} ===\n${page.text}${excerpts}`;
    })
    .join('\n\n');
}

/** Approved shared rules are inherited inputs, never track-specific text for the model to reinvent. */
function labelFor(excerpt: SourceInputRef, pages: SourcePageEvidence[]): number {
  return labelSourcePages(pages).find(({ page }) => sourcePageRef(page) === sourcePageRef(excerpt))?.label ?? excerpt.pageNumber;
}

export function formatSharedRulePacks(packs: SharedRulePack[], pages?: SourcePageEvidence[]): string {
  if (packs.length === 0) return '(none)';
  return packs
    .map((pack) => {
      const rules = pack.rules
        .map(
          (rule) =>
            `- ruleId=${rule.id}; severity=${rule.severity}; statement=${rule.statement}; evidence=${rule.evidence.excerpts
              .map((excerpt) => (pages ? `PAGE ${labelFor(excerpt, pages)}` : sourcePageRef(excerpt)))
              .join(', ')}`,
        )
        .join('\n');
      return `SHARED RULE PACK ${pack.id} | REVISION ${pack.revision}\n${rules}`;
    })
    .join('\n\n');
}

/** Compact one-line JSON per approved asset, without reviewer bookkeeping the model does not need. */
export function formatApprovedAssets(assets: OperationalAsset[]): string {
  const approved = assets.filter((asset) => asset.status === 'approved');
  if (approved.length === 0) return '(none)';
  return approved
    .map((asset) => {
      const rest: Record<string, unknown> = { ...asset };
      for (const key of ['approvedByUid', 'approvedAt', 'createdAt', 'updatedAt', 'trackId', 'status', 'sourceRefs']) delete rest[key];
      return JSON.stringify(rest);
    })
    .join('\n');
}

export const EXACT_EVIDENCE_RULE = [
  'Every BriefingCard, Drill, and rubric criterion must include "evidence" with one claim object: {"claim", "excerpts": [{"pageNumber", "exactText"}]}.',
  '"pageNumber" is the number in the "=== SOURCE PAGE N ===" header. "exactText" copies one sentence (at most 400 characters) word for word from that page. Do not paraphrase, summarize, or join sentences. A page number alone is not evidence.',
  'Do not write document ids, revision ids, support, or approval fields: the server fills them, and a trainer approves every claim.',
  'Do not infer screenshot/interface steps from a caption.',
  'When a claim implements a shared rule, include that stable rule ID in ruleIds; do not rewrite or re-invent the shared rule.',
].join('\n');

/** Fixed prompt overhead (system prompt + JSON Schema + labels), in tokens, per stage. */
export const BLUEPRINT_OVERHEAD_TOKENS = 2_000;
export const UNIT_OVERHEAD_TOKENS = 3_000;
