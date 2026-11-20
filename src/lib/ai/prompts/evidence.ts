/**
 * Claim evidence: lenient model-facing proposals, strict stored evidence.
 *
 * The model cites a short PAGE label (`pageNumber`, the number shown in the "=== SOURCE PAGE N ==="
 * header) and copies a passage. The server, never the model, fills documentId/revisionId and
 * replaces the copied passage with the exact source substring it matches (quotes, dashes, case and
 * whitespace are normalized for matching only). Stored support is recomputed by
 * `verifyClaimEvidence`; approval always starts as an unapproved draft for a trainer to review.
 */
import { z } from 'zod';
import {
  ClaimEvidenceSchema,
  type ClaimEvidence,
  type SourceConflict,
  type SourceExcerptRef,
  type SourcePageEvidence,
} from '@/lib/schemas/source-truth';
import { verifyClaimEvidence } from '@/lib/services/source-evidence';

/** Longest stored excerpt. Longer exact matches are cut at a word boundary (a prefix is still exact). */
export const MAX_EXCERPT_CHARS = 400;
/** Excerpts kept per claim. */
export const MAX_EXCERPTS_PER_CLAIM = 3;
/** Shortest sentence fragment accepted when the model splices or paraphrases part of a quote. */
const MIN_FRAGMENT_CHARS = 24;
/** Placeholder identity for an excerpt that could not be resolved yet (never verifies as supported). */
export const UNRESOLVED_DOCUMENT_ID = 'unresolved';

const pageLabel = z.preprocess((value) => {
  if (typeof value === 'string') {
    const match = /\d+/.exec(value);
    return match ? Number(match[0]) : value;
  }
  return value;
}, z.number().int().positive());

/** One model-facing excerpt. No length limits: the server trims, so long text never forces a full retry. */
export const ExcerptProposalSchema = z.object({
  pageNumber: pageLabel.describe('The PAGE number from the "=== SOURCE PAGE N ===" header where the passage appears.'),
  exactText: z
    .string()
    .min(1)
    .describe(`One continuous passage copied word for word from that page (at most ${MAX_EXCERPT_CHARS} characters, usually one sentence).`),
  documentId: z.string().optional(),
  revisionId: z.string().optional(),
  fromApprovedTranscription: z.boolean().optional(),
});

/** Model-facing evidence has no Zod defaults, keeping manual JSON Schema exchange acyclic. */
export const ClaimEvidenceProposalSchema = z.object({
  id: z.string().optional(),
  claim: z.string().min(1).describe('The rule this item teaches or tests, in one short sentence.'),
  ruleIds: z.array(z.string().min(1)).optional().describe('Shared rule IDs this claim implements, if any.'),
  excerpts: z.array(ExcerptProposalSchema).min(1).describe(`1 to ${MAX_EXCERPTS_PER_CLAIM} supporting passages.`),
  critical: z.boolean().optional(),
  requiresInterfaceDetails: z.boolean().optional(),
});

export type ClaimEvidenceProposal = z.infer<typeof ClaimEvidenceProposalSchema>;
export type ExcerptProposal = z.infer<typeof ExcerptProposalSchema>;

/** Source pages addressed by the PAGE label the prompts show. */
export interface EvidenceSource {
  pages: SourcePageEvidence[];
  conflicts?: SourceConflict[];
}

// ---------- PAGE labels ----------

/**
 * PAGE label for every source page. A single-document bundle keeps its own page numbers; a
 * multi-document bundle numbers pages 1..N in document order, so every label names one page.
 */
export function labelSourcePages(pages: readonly SourcePageEvidence[]): Array<{ label: number; page: SourcePageEvidence }> {
  const documents = new Set(pages.map((page) => page.documentId));
  if (documents.size <= 1) return pages.map((page) => ({ label: page.pageNumber, page }));
  return pages.map((page, index) => ({ label: index + 1, page }));
}

export function pageLabelMap(pages: readonly SourcePageEvidence[]): Map<number, SourcePageEvidence> {
  return new Map(labelSourcePages(pages).map(({ label, page }) => [label, page]));
}

/** PAGE label of one source page within the bundle, or the page's own number when it is not listed. */
export function pageLabelOf(page: Pick<SourcePageEvidence, 'documentId' | 'revisionId' | 'pageNumber'>, pages: readonly SourcePageEvidence[]): number {
  const found = labelSourcePages(pages).find(
    ({ page: candidate }) =>
      candidate.documentId === page.documentId && candidate.revisionId === page.revisionId && candidate.pageNumber === page.pageNumber,
  );
  return found?.label ?? page.pageNumber;
}

/** All PAGE labels of the bundle, in order. */
export function sourcePageLabels(pages: readonly SourcePageEvidence[]): number[] {
  return labelSourcePages(pages).map(({ label }) => label);
}

// ---------- Fuzzy matching to an exact substring ----------

// Single and double quotes fold to one mark: inside a JSON string a small model swaps the source's "..." for
// '...' rather than escape it. Matching only; the stored excerpt is always the original source span.
const FOLD: Record<string, string> = {
  '‘': "'", '’': "'", '‚': "'", '‛': "'", '′': "'", '`': "'", '´': "'",
  '"': "'", '“': "'", '”': "'", '„': "'", '‟': "'", '″': "'", '«': "'", '»': "'",
  '‐': '-', '‑': '-', '‒': '-', '–': '-', '—': '-', '―': '-', '−': '-',
  '…': '...',
};
/** Formatting the model often adds or drops: markdown emphasis and bullet glyphs. */
const DROP = /[*_•●▪◦‣∙○■□➢►]/;

interface FoldedText {
  text: string;
  /** Original index for each folded character. */
  map: number[];
}

/** Fold for matching only: NFKC, quotes, dashes, case, whitespace, bullets and emphasis. */
function fold(source: string): FoldedText {
  let text = '';
  const map: number[] = [];
  let pendingSpace = false;
  for (let index = 0; index < source.length; index++) {
    const raw = source[index];
    let piece = (FOLD[raw] ?? raw.normalize('NFKC')).toLowerCase();
    if (DROP.test(piece)) continue;
    if (/^\s+$/.test(piece) || piece === '') {
      if (piece !== '') pendingSpace = text.length > 0;
      continue;
    }
    piece = piece.replace(/\s+/g, ' ');
    // Spacing around a dash is not significant: the PDF breaks "3-month" as "3-\nmonth", and a model writes
    // "one — was" for "one—was". Both sides fold the same way, so this only widens what matches.
    if (pendingSpace && (piece.startsWith('-') || text.endsWith('-'))) pendingSpace = false;
    if (pendingSpace) {
      text += ' ';
      map.push(index);
      pendingSpace = false;
    }
    for (const char of piece) {
      text += char;
      map.push(index);
    }
  }
  return { text, map };
}

function trimQuote(quote: string): string {
  return quote
    .trim()
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .replace(/^(?:\.\.\.|…)\s*|\s*(?:\.\.\.|…)$/g, '')
    .trim();
}

function spanFor(source: string, folded: FoldedText, needle: string): string | null {
  if (!needle) return null;
  const at = folded.text.indexOf(needle);
  if (at === -1) return null;
  const start = folded.map[at];
  const end = folded.map[at + needle.length - 1] + 1;
  return source.slice(start, end).trim() || null;
}

/** Cut a long exact passage at a word boundary. A prefix of an exact substring is still exact. */
export function capExcerpt(text: string, max = MAX_EXCERPT_CHARS): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const sentence = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('.\n'));
  if (sentence >= max * 0.5) return cut.slice(0, sentence + 1);
  const space = cut.search(/\s\S*$/);
  return (space > max * 0.5 ? cut.slice(0, space) : cut).trimEnd();
}

/**
 * The exact substring of `source` that the model's `quote` copies, or null. Tries the whole quote,
 * then the longest sentence fragment of it (for spliced or partly paraphrased quotes).
 */
export function findExactSourceSpan(source: string, quote: string): string | null {
  const folded = fold(source);
  const wanted = fold(trimQuote(quote)).text.trim();
  if (!wanted) return null;
  const whole = spanFor(source, folded, wanted);
  if (whole) return whole;
  const fragments = trimQuote(quote)
    // Sentences, ellipses, line breaks, and flow arrows / pipes (funnel maps like "Quiz ← contact info … ↓ Dosage").
    .split(/(?<=[.!?;:])\s+|\s*(?:\.\.\.|…)\s*|\n+|\s*[←→↑↓⇒⇐|]\s*/)
    .map((fragment) => fold(trimQuote(fragment)).text.trim().replace(/[.;:,]$/, ''))
    .filter((fragment) => fragment.length >= MIN_FRAGMENT_CHARS)
    .sort((left, right) => right.length - left.length);
  for (const fragment of fragments) {
    const span = spanFor(source, folded, fragment);
    if (span) return span;
  }
  return null;
}

/** Text that `verifySourceExcerpt` compares against: the approved transcription when one exists. */
function verifiableText(page: SourcePageEvidence): { text: string; fromApprovedTranscription: boolean } {
  return page.transcription
    ? { text: page.transcription.text, fromApprovedTranscription: true }
    : { text: page.normalizedText, fromApprovedTranscription: false };
}

export interface ResolvedExcerpt {
  excerpt: SourceExcerptRef;
  /** PAGE label the excerpt was found on. */
  label: number;
}

/**
 * Resolve one model excerpt to an exact, server-identified source excerpt. Searches the cited page
 * first, then the other `allowedLabels` (the passage may sit on a neighbouring page). Null when
 * the passage is not on any allowed page.
 */
export function resolveExcerpt(
  proposal: Pick<ExcerptProposal, 'pageNumber' | 'exactText'>,
  source: EvidenceSource,
  allowedLabels?: readonly number[],
): ResolvedExcerpt | null {
  const byLabel = pageLabelMap(source.pages);
  const allowed = allowedLabels ? new Set(allowedLabels) : null;
  const order = [proposal.pageNumber, ...[...byLabel.keys()].filter((label) => label !== proposal.pageNumber)];
  for (const label of order) {
    const page = byLabel.get(label);
    if (!page || (allowed && !allowed.has(label) && label !== proposal.pageNumber)) continue;
    const { text, fromApprovedTranscription } = verifiableText(page);
    const span = findExactSourceSpan(text, proposal.exactText);
    if (!span) continue;
    return {
      label,
      excerpt: {
        documentId: page.documentId,
        revisionId: page.revisionId,
        pageNumber: page.pageNumber,
        exactText: capExcerpt(span),
        fromApprovedTranscription,
      },
    };
  }
  return null;
}

/** Issue lines for the repair turn: one per claim whose excerpts are not on the cited pages. */
export function evidenceProblems(
  evidence: readonly ClaimEvidenceProposal[] | undefined,
  source: EvidenceSource,
  allowedLabels?: readonly number[],
): Array<{ path: (string | number)[]; message: string }> {
  const problems: Array<{ path: (string | number)[]; message: string }> = [];
  evidence?.forEach((claim, claimIndex) => {
    const resolved = claim.excerpts.some((excerpt) => resolveExcerpt(excerpt, source, allowedLabels));
    if (resolved) return;
    const first = claim.excerpts[0];
    // A 7B model re-paraphrases when only told "copy exactly"; show it the real sentences to choose from.
    const cited = first ? [first.pageNumber, ...(allowedLabels ?? [])] : [...(allowedLabels ?? [])];
    const candidates = rankSupportingSentences([claim.claim, ...claim.excerpts.map((excerpt) => excerpt.exactText)].join(' '), cited, source)
      .filter((candidate) => candidate.shared >= 2);
    const choices = candidates.length > 0
      ? ` Pick ONE of these exact source sentences and copy it character for character into "exactText" (with its PAGE in "pageNumber"), and make the claim match it; if none states the claim, rewrite the item around one of them: ${candidates.map((candidate) => `[PAGE ${candidate.label}] "${candidate.sentence}"`).join(' ')}`
      : ' Copy one sentence exactly as it is written on the SOURCE PAGE that states the rule, and put that PAGE number in "pageNumber".';
    problems.push({
      path: [claimIndex, 'excerpts', 0, 'exactText'],
      message: `This passage is not on PAGE ${first?.pageNumber ?? '?'} (it is paraphrased).${choices}`,
    });
  });
  return problems;
}

function unresolvedExcerpt(proposal: ExcerptProposal, source: EvidenceSource | undefined, fallbackLabel?: number): SourceExcerptRef {
  const byLabel = source ? pageLabelMap(source.pages) : null;
  const page = byLabel?.get(proposal.pageNumber) ?? (fallbackLabel !== undefined ? byLabel?.get(fallbackLabel) : undefined);
  return {
    documentId: page?.documentId ?? proposal.documentId ?? UNRESOLVED_DOCUMENT_ID,
    revisionId: page?.revisionId ?? proposal.revisionId ?? UNRESOLVED_DOCUMENT_ID,
    pageNumber: page?.pageNumber ?? proposal.pageNumber,
    exactText: capExcerpt(proposal.exactText.trim() || 'Evidence text missing.'),
    fromApprovedTranscription: proposal.fromApprovedTranscription ?? false,
  };
}

function strictGroundedExcerpt(proposal: ClaimEvidenceProposal, source: EvidenceSource): SourceExcerptRef | null {
  const labels = [...new Set(proposal.excerpts.map((excerpt) => excerpt.pageNumber))];
  const texts = [...proposal.excerpts.map((excerpt) => excerpt.exactText), proposal.claim];
  for (const text of texts) {
    const match = bestSupportingSentence(text, labels, source, STRICT_GROUNDING);
    if (!match) continue;
    const resolved = resolveExcerpt({ pageNumber: match.label, exactText: match.sentence }, source, [match.label]);
    if (resolved) return resolved.excerpt;
  }
  return null;
}

export interface FinalizeEvidenceOptions {
  /** Resolve excerpts against these pages (server-side identity and exact text). */
  source?: EvidenceSource;
  /** PAGE labels the item may cite. */
  allowedLabels?: readonly number[];
}

/**
 * Model evidence becomes stored evidence: stable ids, server-filled document identity, exact text,
 * recomputed support, and approval reset to an unapproved draft. Unresolvable excerpts are kept as
 * unsupported evidence (blocked at publication until a trainer fixes them), never silently dropped
 * when they are the only support for the claim.
 */
export function finalizeEvidenceProposals(
  evidence: readonly ClaimEvidenceProposal[] | undefined,
  ownerId: string,
  options: FinalizeEvidenceOptions = {},
): ClaimEvidence[] | undefined {
  return evidence?.map((proposal, index) => {
    const resolved = options.source
      ? proposal.excerpts.map((excerpt) => resolveExcerpt(excerpt, options.source!, options.allowedLabels))
      : [];
    const matched = resolved.filter((item): item is ResolvedExcerpt => item !== null).map((item) => item.excerpt);
    const unique = matched.filter(
      (excerpt, at) => matched.findIndex((other) => other.pageNumber === excerpt.pageNumber && other.documentId === excerpt.documentId && other.exactText === excerpt.exactText) === at,
    );
    // No quote matched: ground the claim in a verbatim sentence of its cited page(s) only when the match is
    // strong (STRICT_GROUNDING). The excerpt is still an unapproved draft the trainer reviews.
    const grounded = unique.length === 0 && options.source
      ? strictGroundedExcerpt(proposal, options.source)
      : null;
    const excerpts = (unique.length > 0
      ? unique
      : grounded
        ? [grounded]
        : proposal.excerpts.map((excerpt) => unresolvedExcerpt(excerpt, options.source, options.allowedLabels?.[0]))
    ).slice(0, MAX_EXCERPTS_PER_CLAIM);
    const stored = ClaimEvidenceSchema.parse({
      id: `${ownerId}-e${index + 1}`,
      claim: proposal.claim.trim().slice(0, 2_000) || 'Source-backed training requirement.',
      ruleIds: proposal.ruleIds ?? [],
      excerpts,
      support: 'unsupported',
      approvalStatus: 'draft',
      critical: proposal.critical ?? false,
      requiresInterfaceDetails: proposal.requiresInterfaceDetails ?? false,
      reviewerUid: null,
      reviewedAt: null,
    });
    if (!options.source) return stored;
    const verified = verifyClaimEvidence(stored, options.source.pages, options.source.conflicts ?? []);
    return { ...verified, approvalStatus: 'draft', reviewerUid: null, reviewedAt: null };
  });
}

/**
 * Re-ground stored evidence (for example rubric evidence a builder finalized without source pages):
 * excerpts whose identity or text the model got wrong are resolved again by PAGE label and text.
 */
export function regroundStoredEvidence(
  evidence: readonly ClaimEvidence[] | undefined,
  ownerId: string,
  source: EvidenceSource,
  allowedLabels?: readonly number[],
): ClaimEvidence[] | undefined {
  if (!evidence) return undefined;
  const proposals: ClaimEvidenceProposal[] = evidence.map((item) => ({
    claim: item.claim,
    ruleIds: item.ruleIds,
    critical: item.critical,
    requiresInterfaceDetails: item.requiresInterfaceDetails,
    excerpts: item.excerpts.map((excerpt) => ({
      // A wrong documentId is ignored; a known identity maps back to its PAGE label.
      pageNumber: source.pages.some((page) => page.documentId === excerpt.documentId && page.revisionId === excerpt.revisionId)
        ? pageLabelOf(excerpt, source.pages)
        : excerpt.pageNumber,
      exactText: excerpt.exactText,
      fromApprovedTranscription: excerpt.fromApprovedTranscription,
    })),
  }));
  return finalizeEvidenceProposals(proposals, ownerId, { source, allowedLabels });
}

/** Claims that are not exactly supported by the source: they need trainer review before publication. */
export function unsupportedEvidenceIds(evidence: readonly ClaimEvidence[] | undefined): string[] {
  return (evidence ?? []).filter((item) => item.support !== 'supported').map((item) => item.id);
}

// ---------- Grounding a claim the model left without usable evidence ----------

const STOP_WORDS = new Set(
  'a an and are as at be by for from has have in is it its of on or that the this to was were will with agent agents must should not do does the caller call calls'.split(' '),
);

function contentWords(text: string): string[] {
  return fold(text).text.split(/[^a-z0-9$%]+/).filter((word) => word.length > 2 && !STOP_WORDS.has(word));
}

/** Minimum shared content words, and share of the claim's words, for a sentence to count as its support. */
const MIN_SHARED_WORDS = 3;
const MIN_SHARED_SHARE = 0.4;
/**
 * Stricter bar for silently replacing a paraphrased excerpt during a build: the sentence must share most of
 * the claim's content words. Weaker matches are offered to the model (repair) or the trainer instead.
 */
export const STRICT_GROUNDING = { minShared: 4, minShare: 0.6 } as const;

export interface SentenceCandidate {
  label: number;
  sentence: string;
  /** Shared content words / content words of the claim. */
  score: number;
  shared: number;
}

/** Source sentences of the given PAGE labels ranked by how many of the claim's content words they share. */
export function rankSupportingSentences(
  claim: string,
  labels: readonly number[],
  source: EvidenceSource,
  limit = 3,
): SentenceCandidate[] {
  const wanted = new Set(contentWords(claim));
  if (wanted.size === 0) return [];
  const byLabel = pageLabelMap(source.pages);
  const ranked: SentenceCandidate[] = [];
  const seen = new Set<string>();
  for (const label of new Set(labels)) {
    const page = byLabel.get(label);
    if (!page) continue;
    const { text } = verifiableText(page);
    for (const sentence of text.split(/(?<=[.!?])\s+|\n+/).map((part) => part.trim()).filter((part) => part.length >= 20)) {
      const capped = capExcerpt(sentence);
      if (seen.has(capped)) continue;
      seen.add(capped);
      const words = new Set(contentWords(sentence));
      const shared = [...wanted].filter((word) => words.has(word)).length;
      if (shared === 0) continue;
      ranked.push({ label, sentence: capped, score: shared / wanted.size, shared });
    }
  }
  return ranked.sort((left, right) => right.score - left.score || right.shared - left.shared).slice(0, limit);
}

/**
 * Best exact source sentence for a claim on the given PAGE labels, by shared content words, or null
 * when no sentence clearly states it. Only ever returns verbatim source text.
 */
export function bestSupportingSentence(
  claim: string,
  labels: readonly number[],
  source: EvidenceSource,
  threshold: { minShared: number; minShare: number } = { minShared: MIN_SHARED_WORDS, minShare: MIN_SHARED_SHARE },
): { label: number; sentence: string } | null {
  const [best] = rankSupportingSentences(claim, labels, source, 1);
  if (!best || best.shared < threshold.minShared || best.score < threshold.minShare) return null;
  return { label: best.label, sentence: best.sentence };
}

/**
 * Evidence for an item whose model evidence is missing or does not match the source:
 * 1. re-resolve any model quotes (wrong ids, curly quotes) against the source;
 * 2. else ground the claim text in its cited pages (verbatim source sentence);
 * 3. else keep an unsupported draft claim, which the publication gate blocks until a trainer fixes it.
 * Approval always stays draft: a trainer approves every claim before publication.
 */
export function groundOrFlagEvidence(input: {
  ownerId: string;
  claim: string;
  evidence?: readonly ClaimEvidence[];
  citedLabels: readonly number[];
  source: EvidenceSource;
  allowedLabels?: readonly number[];
}): ClaimEvidence[] {
  const regrounded = input.evidence?.length
    ? regroundStoredEvidence(input.evidence, input.ownerId, input.source, input.allowedLabels) ?? []
    : [];
  if (regrounded.length > 0 && regrounded.every((item) => item.support === 'supported')) return regrounded;
  const labels = input.citedLabels.length > 0 ? input.citedLabels : (input.allowedLabels ?? []);
  const quotes = (input.evidence ?? []).flatMap((item) => item.excerpts.map((excerpt) => excerpt.exactText));
  const match = [input.claim, ...quotes].map((text) => bestSupportingSentence(text, labels, input.source)).find(Boolean) ?? null;
  const proposal: ClaimEvidenceProposal = {
    claim: input.claim,
    ruleIds: input.evidence?.flatMap((item) => item.ruleIds) ?? [],
    excerpts: [{ pageNumber: match?.label ?? labels[0] ?? 1, exactText: match?.sentence ?? input.claim }],
  };
  const grounded = finalizeEvidenceProposals([proposal], input.ownerId, { source: input.source, allowedLabels: input.allowedLabels }) ?? [];
  if (grounded[0]?.support === 'supported' || regrounded.length === 0) return grounded;
  return regrounded;
}
