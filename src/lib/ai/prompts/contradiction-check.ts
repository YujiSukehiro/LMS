/**
 * PDF self-contradiction check: one model call over all source pages, run before the trainer approves a source.
 * It looks for a "Never / Do not / Always / Only" rule that a script, example or step elsewhere breaks
 * (for example: "Never trigger a link send to voicemail" vs. a voicemail script that says "I'll send you a text").
 * The server keeps only items whose two quotes match the page text exactly (see source-contradictions.ts).
 */
import { z } from 'zod';
import type { SourceConflict, SourcePageEvidence } from '@/lib/schemas/source-truth';
import { labelSourcePages } from '@/lib/ai/prompts/evidence';

export const CONTRADICTION_CHECK_SCHEMA_NAME = 'SourceContradictions';
export const MAX_CONTRADICTIONS = 8;
export const CONTRADICTION_CHECK_MAX_OUTPUT_TOKENS = 3000;
/** Hosted models read the whole Playbook; very large bundles are cut per page so one call stays bounded. */
export const CONTRADICTION_CHECK_CHAR_BUDGET = 120_000;

const QuoteSchema = z.object({
  page: z.number().int().positive(),
  quote: z.string().min(8).max(300),
});

export const ContradictionCheckOutputSchema = z.object({
  contradictions: z
    .array(
      z.object({
        rule: QuoteSchema.describe('The "Never / Do not / Always / Only" rule, quoted exactly'),
        conflicting: QuoteSchema.describe('The script, example or step that breaks the rule, quoted exactly'),
        summary: z.string().min(10).max(300),
        severity: z.enum(['critical', 'major', 'coaching']),
      }),
    )
    .max(MAX_CONTRADICTIONS),
});
export type ContradictionCheckOutput = z.infer<typeof ContradictionCheckOutputSchema>;

export function buildContradictionSystemPrompt(): string {
  return [
    'You check a call-center training Playbook for places where it contradicts itself, before trainers build training from it.',
    'Report ONLY real contradictions where following one passage would break another:',
    '- a rule that says Never / Do not / Always / Only / Must, and',
    '- a script, example, step, template or other rule elsewhere that tells the agent to do the opposite.',
    'Example: page 11 says "Never trigger a link send to voicemail" while the voicemail script on page 7 says "I\'ll send you a text with your link".',
    'Do NOT report: the same rule said twice, a general rule and a narrower exception the Playbook itself explains, different prices for different plans, or style differences.',
    'Quote both passages EXACTLY as they appear on the page (copy the words, 8 to 300 characters, no ellipsis, no paraphrase). Use the PAGE number shown above each page.',
    '"summary": one plain sentence that says what contradicts what.',
    '"severity": critical when it touches compliance, consent, medical claims, legal or safety; major when it changes what the agent does on a call; coaching otherwise.',
    `Return at most ${MAX_CONTRADICTIONS} items, most serious first. Return {"contradictions": []} when there are none. Most Playbooks have 0 to 2.`,
  ].join('\n');
}

export function buildContradictionUserPrompt(pages: readonly SourcePageEvidence[], charBudget = CONTRADICTION_CHECK_CHAR_BUDGET): string {
  const labeled = labelSourcePages(pages);
  const perPage = Math.max(1_500, Math.floor(charBudget / Math.max(1, labeled.length)));
  const blocks = labeled.map(({ label, page }) => {
    const text = page.transcription?.text ?? page.normalizedText;
    return `=== PAGE ${label} ===\n${text.length > perPage ? `${text.slice(0, perPage)}\n[page cut for length]` : text}`;
  });
  return ['PLAYBOOK PAGES:', ...blocks, '', 'List the contradictions as JSON.'].join('\n');
}

/** Prompt lines for the Unit builder: the trainer's decisions on PDF contradictions (decided ones only). */
export function formatConflictDecisions(conflicts: readonly SourceConflict[] | undefined): string {
  const decided = (conflicts ?? []).filter((conflict) => conflict.status === 'resolved' || conflict.status === 'accepted_context_difference');
  if (decided.length === 0) return '';
  return decided
    .map((conflict) => {
      const [a, b] = conflict.sourceRefs;
      return `- Page ${a.pageNumber} "${a.exactText}" vs page ${b.pageNumber} "${b.exactText}". Trainer decision: ${conflict.decision ?? '(none)'}`;
    })
    .join('\n');
}
