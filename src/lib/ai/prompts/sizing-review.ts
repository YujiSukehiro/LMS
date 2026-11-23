/**
 * Track sizing review (Connor 2026-11-23): before a build, the planning model reads the whole Playbook and says how
 * many Checkpoints and how many learner minutes it honestly deserves, judging distinct rules, repetition and
 * density rather than page or sentence counts. The trainer sees the recommendation and can change both numbers.
 */
import { z } from 'zod';
import { DEPTH_LIMITS } from '@/lib/ai/pipeline/content-depth';

export const SIZING_REVIEW_SCHEMA_NAME = 'TrackSizingReview';
export const SIZING_REVIEW_MAX_OUTPUT_TOKENS = 1024;
export const SIZING_MIN_MINUTES = 15;
export const SIZING_MAX_MINUTES = 120;
const SIZING_CHAR_BUDGET = 90_000;

const toInt = (value: unknown) => (typeof value === 'string' && value.trim() !== '' ? Number(value) : value);

export const SizingReviewOutputSchema = z.object({
  checkpoints: z.preprocess(toInt, z.number().int().min(DEPTH_LIMITS.minUnits).max(DEPTH_LIMITS.maxUnits)),
  learnerMinutes: z.preprocess(toInt, z.number().int().min(SIZING_MIN_MINUTES).max(SIZING_MAX_MINUTES)),
  reason: z.string().min(1).transform((text) => (text.length > 400 ? `${text.slice(0, 399).trimEnd()}…` : text)),
});
export type SizingReviewOutput = z.output<typeof SizingReviewOutputSchema>;

export function buildSizingSystemPrompt(): string {
  return [
    'You are a senior instructional designer for call-center training. Read the whole Playbook and decide how big its training Track should be.',
    'The Track is a series of Checkpoints. Each Checkpoint has short Briefing Cards (about 40 seconds each) and quiz Drills (about 45 seconds each). Practice calls are separate and not part of your minutes.',
    'Judge honestly:',
    '- Count the DISTINCT things an agent must know or do on a call. A rule that the Playbook repeats on several pages counts once.',
    '- Background, history, marketing copy, penalty amounts and legal trivia add no time.',
    '- Dense procedures, scripts, objection handling and compliance boundaries earn time; light or repetitive material does not.',
    '- Prefer the shortest Track that still teaches every distinct rule well. Padding and retesting the same rule make training worse.',
    `"checkpoints": ${DEPTH_LIMITS.minUnits} to ${DEPTH_LIMITS.maxUnits}, one per coherent topic an agent would study in one sitting.`,
    `"learnerMinutes": ${SIZING_MIN_MINUTES} to ${SIZING_MAX_MINUTES}, total minutes of cards and Drills for the whole Track.`,
    '"reason": one or two plain sentences a trainer will read, naming what drives the size (for example "8 pages, but pages 3 and 6 repeat the verification rules").',
    'Return the JSON object only.',
  ].join('\n');
}

export function buildSizingUserPrompt(pages: ReadonlyArray<{ pageNumber: number; text: string }>): string {
  const perPage = Math.max(1_500, Math.floor(SIZING_CHAR_BUDGET / Math.max(1, pages.length)));
  const blocks = pages.map((page) => `=== PAGE ${page.pageNumber} ===\n${page.text.length > perPage ? `${page.text.slice(0, perPage)}\n[page cut for length]` : page.text}`);
  return ['PLAYBOOK PAGES:', ...blocks, '', 'Recommend the Track size as JSON.'].join('\n');
}
