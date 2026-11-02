/**
 * Pass 1 (Blueprint): 4 CompetencyPillars + 3-6 Unit outlines + campaign code + global campaign summary.
 */
import { z } from 'zod';
import { CanonicalPillarKeySchema, type CompetencyPillar } from '@/lib/schemas/curriculum';
import type { DivisionId } from '@/lib/schemas/domain';
import { PDF_LIMITS } from '@/lib/schemas/constants';
import { formatSourcePages, type ExtractedPage } from '@/lib/ai/pdf-extractor';
import {
  formatApprovedAssets,
  formatBudgetedSourcePages,
  formatSharedRulePacks,
  planSourceBudget,
  type SourceReviewPromptContext,
} from '@/lib/ai/pipeline/source-budget';
import {
  CITATION_RULE,
  DIVISION_PROFILES,
  GROUNDING_RULE,
  LANGUAGE_RULE,
  canonicalPillarList,
  clampText,
  clampWords,
  countWords,
  divisionLabel,
  invalidPages,
  pillarIdForKey,
  sanitizePages,
} from '@/lib/ai/pipeline/shared';

export const BLUEPRINT_SCHEMA_NAME = 'TrackBlueprint';
export const BLUEPRINT_PILLAR_COUNT = 4;
export const BLUEPRINT_MIN_UNITS = 3;
export const BLUEPRINT_MAX_UNITS = 6;
export const GLOBAL_SUMMARY_MAX_WORDS = 500;
/** Characters kept per page when the Playbook is longer than the condensed-blueprint threshold. */
export const CONDENSED_PAGE_CHARS = 600;

/** Zod output schema for Pass 1. `pageCount` bounds every cited page number. */
export function buildBlueprintSchema(pageCount: number) {
  const pageNumber = z.number().int().min(1).max(pageCount);
  return z
    .object({
      campaignCode: z
        .string()
        .max(32)
        .describe('Short campaign code in capitals, for example "MVP" or "TH-INTAKE". Use the code from the Playbook when it states one.'),
      globalSummary: z
        .string()
        .min(80)
        .max(4000)
        .describe('Global campaign summary of at most 500 words: offer, call flow, key policy rules, and escalation rules.'),
      competencyPillars: z
        .array(
          z.object({
            key: CanonicalPillarKeySchema,
            label: z.string().min(3).max(60).describe('Campaign-specific CompetencyPillar label'),
            description: z.string().min(10).max(240).describe('One sentence: what the agent must do well for this CompetencyPillar'),
          }),
        )
        .length(BLUEPRINT_PILLAR_COUNT),
      units: z
        .array(
          z.object({
            title: z.string().min(3).max(80),
            summary: z.string().min(10).max(180),
            focus: z.string().min(10).max(400).describe('The exact rules and skills this Unit must teach'),
            sourcePages: z.array(pageNumber).min(1).max(20),
            pillarKeys: z.array(CanonicalPillarKeySchema).min(1).max(BLUEPRINT_PILLAR_COUNT),
          }),
        )
        .min(BLUEPRINT_MIN_UNITS)
        .max(BLUEPRINT_MAX_UNITS),
    })
    .superRefine((value, ctx) => {
      const keys = value.competencyPillars.map((pillar) => pillar.key);
      if (new Set(keys).size !== keys.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['competencyPillars'],
          message: 'Each of the 4 CompetencyPillars must use a different canonical "key".',
        });
      }
      const chosen = new Set(keys);
      const allowedPages = new Set(Array.from({ length: pageCount }, (_, i) => i + 1));
      value.units.forEach((unit, unitIndex) => {
        unit.pillarKeys.forEach((key, keyIndex) => {
          if (!chosen.has(key)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['units', unitIndex, 'pillarKeys', keyIndex],
              message: `"${key}" is not one of the 4 chosen CompetencyPillar keys (${keys.join(', ')}).`,
            });
          }
        });
        const outside = invalidPages(unit.sourcePages, allowedPages);
        if (outside.length > 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['units', unitIndex, 'sourcePages'],
            message: `Pages ${outside.join(', ')} do not exist. Use pages 1-${pageCount}.`,
          });
        }
      });
      const words = countWords(value.globalSummary);
      if (words > GLOBAL_SUMMARY_MAX_WORDS + 50) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['globalSummary'],
          message: `The summary has ${words} words. Use at most ${GLOBAL_SUMMARY_MAX_WORDS} words.`,
        });
      }
    });
}

export type BlueprintGeneration = z.infer<ReturnType<typeof buildBlueprintSchema>>;

export interface UnitOutline {
  id: string;
  orderIndex: number;
  title: string;
  summary: string;
  focus: string;
  sourcePages: number[];
  pillarIds: string[];
}

export interface TrackBlueprint {
  campaignCode: string;
  globalSummary: string;
  competencyPillars: CompetencyPillar[];
  units: UnitOutline[];
}

export function buildBlueprintSystemPrompt(divisionId: DivisionId): string {
  const profile = DIVISION_PROFILES[divisionId];
  const defaults = profile.defaultPillars
    .map((label, index) => `${index + 1}. ${label} (suggested key: ${profile.defaultPillarKeys[index]})`)
    .join('\n');
  return [
    `You are the curriculum architect for LogiCall Pulse, a training platform for ${divisionLabel(divisionId)} call-center agents (${profile.traineeDescription}).`,
    `You read one campaign Playbook (${profile.playbookTypes}) and plan a Track: 4 CompetencyPillars and 3 to 6 Units.`,
    '',
    'GROUNDING RULES:',
    GROUNDING_RULE,
    'Use only facts that the SOURCE PAGES state. If the Playbook does not state a detail, do not add it.',
    CITATION_RULE,
    LANGUAGE_RULE,
    '',
    'COMPETENCYPILLARS:',
    'Choose exactly 4 CompetencyPillars that this Playbook trains. Give each one a campaign-specific "label", a one-sentence "description", and one canonical "key" from this list (each key at most once):',
    canonicalPillarList(),
    `Default CompetencyPillars for the ${divisionLabel(divisionId)} Division (use them when the Playbook supports them, and adapt the labels to the campaign):`,
    defaults,
    '',
    'UNITS:',
    '- Plan 3 to 6 Units in the order a new agent must learn them (usually the call flow order).',
    '- Each Unit covers one coherent group of rules. Do not repeat the same rules in two Units.',
    '- "title": at most 80 characters. "summary": one sentence, at most 180 characters. "focus": the exact rules and decisions the Unit must teach.',
    '- "sourcePages": the page numbers that contain the rules for this Unit. Together, the Units must cover every page with operational rules.',
    '- "pillarKeys": the CompetencyPillar keys (from your 4 chosen keys) that this Unit trains. Use each chosen key in at least one Unit.',
    '',
    'CAMPAIGN CODE AND SUMMARY:',
    '- "campaignCode": the short campaign code from the Playbook (capital letters, digits, and hyphens, at most 32 characters). If the trainer supplied a code, use it.',
    `- "globalSummary": at most ${GLOBAL_SUMMARY_MAX_WORDS} words. State the campaign offer, the call flow, the most important policy rules with their exact values, and the escalation rules. Other build steps use this summary as context.`,
    '',
    'Return one JSON object that matches the schema. No markdown, no comments.',
  ].join('\n');
}

/** Condensed page view for long Playbooks: the first ~600 characters of each page. */
export function condensePages(pages: ExtractedPage[], charsPerPage = CONDENSED_PAGE_CHARS): ExtractedPage[] {
  return pages.map((page) => {
    if (page.text.length <= charsPerPage) return page;
    const cut = page.text.slice(0, charsPerPage);
    const lastBreak = Math.max(cut.lastIndexOf('\n'), cut.lastIndexOf('. '));
    const text = lastBreak > charsPerPage * 0.5 ? cut.slice(0, lastBreak + 1) : cut;
    return { pageNumber: page.pageNumber, text: `${text.trimEnd()} [page condensed]` };
  });
}

export function buildBlueprintUserPrompt(input: {
  trackTitle: string;
  campaignCode: string;
  divisionId: DivisionId;
  pages: ExtractedPage[];
  sourceReview?: SourceReviewPromptContext;
}): string {
  const condensed = !input.sourceReview && input.pages.length > PDF_LIMITS.condensedBlueprintPageThreshold;
  const budget = input.sourceReview
    ? planSourceBudget({
        stage: 'blueprint',
        pages: input.sourceReview.pages,
        rulePacks: input.sourceReview.rulePacks,
        assets: input.sourceReview.assets,
        charBudget: 48000,
      })
    : null;
  const pageText = budget
    ? formatBudgetedSourcePages(budget.pages)
    : formatSourcePages(condensed ? condensePages(input.pages) : input.pages);
  return [
    `Track title: ${input.trackTitle}`,
    `Division: ${divisionLabel(input.divisionId)}`,
    `Campaign code supplied by the trainer: ${input.campaignCode.trim() || '(none, suggest one)'}`,
    `Playbook page count: ${input.pages.length} (valid page numbers: 1-${input.pages.length})`,
    condensed
      ? 'The Playbook is long, so each SOURCE PAGE below shows only its first part. Use the headings and opening text to map the pages to Units.'
      : 'Each SOURCE PAGE below shows the full page text approved for this stage.',
    ...(input.sourceReview
      ? [
          '',
          'APPROVED SHARED RULES (inherit these exact rule IDs and statements in later stages):',
          formatSharedRulePacks(input.sourceReview.rulePacks),
          '',
          'APPROVED OPERATIONAL ASSETS (use these exact values in their declared context):',
          formatApprovedAssets(input.sourceReview.assets),
        ]
      : []),
    '',
    pageText,
    '',
    'Make the TrackBlueprint JSON now.',
  ].join('\n');
}

function normalizeCampaignCode(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32);
}

/** Deterministic post-processing: stable ids (`pillar_<key>`, `u1`..), clamped lengths, valid pages. */
export function finalizeBlueprint(generated: BlueprintGeneration, pageCount: number, trainerCampaignCode = ''): TrackBlueprint {
  const allPages = Array.from({ length: pageCount }, (_, i) => i + 1);
  const allowed = new Set(allPages);
  const competencyPillars: CompetencyPillar[] = generated.competencyPillars.map((pillar) => ({
    id: pillarIdForKey(pillar.key),
    key: pillar.key,
    label: clampText(pillar.label, 60),
    description: clampText(pillar.description, 240),
  }));
  const pillarIds = new Set(competencyPillars.map((pillar) => pillar.id));
  const units: UnitOutline[] = generated.units.slice(0, BLUEPRINT_MAX_UNITS).map((unit, index) => {
    const ids = [...new Set(unit.pillarKeys.map(pillarIdForKey))].filter((id) => pillarIds.has(id));
    return {
      id: `u${index + 1}`,
      orderIndex: index,
      title: clampText(unit.title, 80),
      summary: clampText(unit.summary, 180),
      focus: clampText(unit.focus, 400),
      sourcePages: sanitizePages(unit.sourcePages, allowed, allPages),
      pillarIds: ids.length > 0 ? ids : [competencyPillars[0].id],
    };
  });
  const campaignCode = normalizeCampaignCode(trainerCampaignCode) || normalizeCampaignCode(generated.campaignCode);
  return {
    campaignCode,
    globalSummary: clampWords(generated.globalSummary, GLOBAL_SUMMARY_MAX_WORDS),
    competencyPillars,
    units,
  };
}
