/**
 * Pass 1 (Blueprint): 4 CompetencyPillars + Unit outlines + campaign code + global campaign summary.
 * The Unit count comes from the measured source depth (see content-depth.ts), not a fixed range.
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
import {
  DEFAULT_UNIT_CONTENT_PLAN,
  DEPTH_LIMITS,
  describeRange,
  measureSourceDepth,
  planUnitContent,
  type CountRange,
  type DepthLimits,
  type UnitContentPlan,
} from '@/lib/ai/pipeline/content-depth';

export const BLUEPRINT_SCHEMA_NAME = 'TrackBlueprint';
export const BLUEPRINT_PILLAR_COUNT = 4;
/** Absolute Unit limits. The range for one Track comes from `measureSourceDepth`. */
export const BLUEPRINT_MIN_UNITS = DEPTH_LIMITS.minUnits;
export const BLUEPRINT_MAX_UNITS = DEPTH_LIMITS.maxUnits;
export const GLOBAL_SUMMARY_MAX_WORDS = 500;
/** Characters kept per page when the Playbook is longer than the condensed-blueprint threshold. */
export const CONDENSED_PAGE_CHARS = 600;
/** Default page-text budget for a hosted model. Local models pass a smaller `charBudget`. */
export const BLUEPRINT_SOURCE_CHAR_BUDGET = 48000;

/** Output tokens for one Blueprint: summary (~700) plus ~200 per Unit outline, with JSON overhead. */
export function blueprintMaxOutputTokens(maxUnits: number = BLUEPRINT_MAX_UNITS): number {
  return Math.min(8192, 1600 + 220 * maxUnits);
}

/** Unit range for a Track: measured from the pages, never outside the absolute limits. */
export function blueprintUnitRange(pages: ReadonlyArray<{ pageNumber: number; text: string }>): CountRange {
  return measureSourceDepth(pages).units;
}

/**
 * Zod output schema for Pass 1. `pageCount` bounds every cited page number.
 * `unitRange` is the measured Unit range for this source; omit it to allow the absolute limits.
 */
export function buildBlueprintSchema(pageCount: number, unitRange?: Pick<CountRange, 'min' | 'max'>) {
  const minUnits = Math.max(BLUEPRINT_MIN_UNITS, unitRange?.min ?? BLUEPRINT_MIN_UNITS);
  const maxUnits = Math.min(BLUEPRINT_MAX_UNITS, unitRange?.max ?? BLUEPRINT_MAX_UNITS);
  const pageNumber = z.number().int().min(1).max(pageCount);
  return z
    .object({
      // Model-facing text has no .max(): finalizeBlueprint clamps lengths, so a slightly long
      // label never forces a full regeneration. The limits stay in the descriptions as guidance.
      campaignCode: z
        .string()
        .describe('Short campaign code in capitals (at most 32 characters), for example "MVP" or "TH-INTAKE". Use the code from the Playbook when it states one.'),
      globalSummary: z
        .string()
        .min(80)
        .describe('Global campaign summary of at most 500 words: offer, call flow, key policy rules, and escalation rules.'),
      competencyPillars: z
        .array(
          z.object({
            key: CanonicalPillarKeySchema,
            label: z.string().min(3).describe('Campaign-specific CompetencyPillar label (at most 60 characters)'),
            description: z.string().min(10).describe('One sentence (at most 240 characters): what the agent must do well for this CompetencyPillar'),
          }),
        )
        .length(BLUEPRINT_PILLAR_COUNT),
      units: z
        .array(
          z.object({
            title: z.string().min(3).describe('At most 80 characters'),
            summary: z.string().min(10).describe('One sentence, at most 180 characters'),
            focus: z.string().min(10).describe('The exact rules and skills this Unit must teach (at most 400 characters)'),
            sourcePages: z.array(pageNumber).min(1).describe('Page numbers with this Unit\'s rules (at most 20)'),
            pillarKeys: z.array(CanonicalPillarKeySchema).min(1),
          }),
        )
        .min(minUnits)
        .max(maxUnits),
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
      // Small slips are repaired in finalizeBlueprint (unknown pillar keys are dropped with a fallback,
      // out-of-range pages are removed). Only ask the model to retry when nothing usable is left.
      // A Unit with no chosen pillar key is not worth failing the build over (a 7B model missed one Unit in three
      // attempts on the live R2c build): finalizeBlueprint assigns the first pillar. Only a blueprint where no
      // Unit uses a chosen key is sent back.
      if (!value.units.some((unit) => unit.pillarKeys.some((key) => chosen.has(key)))) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['units', 0, 'pillarKeys'],
          message: `Use at least one of the 4 chosen CompetencyPillar keys (${keys.join(', ')}) in every Unit.`,
        });
      }
      value.units.forEach((unit, unitIndex) => {
        const outside = invalidPages(unit.sourcePages, allowedPages);
        if (outside.length === unit.sourcePages.length) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['units', unitIndex, 'sourcePages'],
            message: `Pages ${outside.join(', ')} do not exist. Use pages 1-${pageCount}.`,
          });
        }
      });
      const words = countWords(value.globalSummary);
      // Far over the limit means the model ignored the instruction; a little over is clamped.
      if (words > GLOBAL_SUMMARY_MAX_WORDS * 2) {
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
  /** BriefingCard and Drill counts sized to the rules on this Unit's pages. */
  contentPlan?: UnitContentPlan;
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
    `You read one campaign Playbook (${profile.playbookTypes}) and plan a Track: 4 CompetencyPillars and the number of Units given in the request.`,
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
    '- Plan the number of Units given in the request (UNIT COUNT). It was measured from how many rules the Playbook holds. Put the Units in the order a new agent must learn them (usually the call flow order).',
    '- A dense section with many rules gets its own Unit. Short sections with few rules can share one Unit.',
    '- Each Unit covers one coherent group of rules. Do not repeat the same rules in two Units.',
    '- "title": at most 80 characters. "summary": one sentence, at most 180 characters. "focus": the exact rules and decisions the Unit must teach.',
    '- "sourcePages": the page numbers that contain the rules for this Unit. Together, the Units must cover every page with operational rules.',
    '- "pillarKeys": the CompetencyPillar keys (from your 4 chosen keys) that this Unit trains. Use each chosen key in at least one Unit.',
    '',
    'CAMPAIGN CODE AND SUMMARY:',
    '- "campaignCode": the short campaign code from the Playbook (capital letters, digits, and hyphens, at most 32 characters). If the trainer supplied a code, use it.',
    `- "globalSummary": at most ${GLOBAL_SUMMARY_MAX_WORDS} words. State the campaign offer, the call flow, the most important policy rules with their exact values, the escalation rules, and every "Never" / "Do not" compliance rule. Other build steps use this summary as context, and its "Never" rules win over any script.`,
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
  /** Measured Unit range that the schema enforces. Without it the prompt allows the absolute limits. */
  unitRange?: CountRange;
  /** Characters of page text that fit this stage (smaller for local models). Default 48000. */
  charBudget?: number;
}): string {
  const depth = measureSourceDepth(input.pages);
  const unitRange: CountRange = input.unitRange ?? {
    min: BLUEPRINT_MIN_UNITS,
    target: depth.units.target,
    max: BLUEPRINT_MAX_UNITS,
  };
  const charBudget = input.charBudget ?? BLUEPRINT_SOURCE_CHAR_BUDGET;
  const legacyChars = input.pages.reduce((sum, page) => sum + page.text.length, 0);
  // Blueprint only maps pages to Units, so source mode condenses pages instead of failing closed.
  const budget = input.sourceReview
    ? planSourceBudget({
        stage: 'blueprint',
        pages: input.sourceReview.pages,
        rulePacks: input.sourceReview.rulePacks,
        assets: input.sourceReview.assets,
        charBudget,
        mode: 'overview',
      })
    : null;
  const condensed = budget
    ? budget.pages.some((page) => page.condensed)
    : input.pages.length > PDF_LIMITS.condensedBlueprintPageThreshold || legacyChars > charBudget;
  const legacyShare = Math.max(300, Math.min(CONDENSED_PAGE_CHARS, Math.floor(charBudget / Math.max(1, input.pages.length)) - 20));
  const pageText = budget
    ? formatBudgetedSourcePages(budget.pages)
    : formatSourcePages(condensed ? condensePages(input.pages, legacyChars > charBudget ? legacyShare : CONDENSED_PAGE_CHARS) : input.pages);
  return [
    `Track title: ${input.trackTitle}`,
    `Division: ${divisionLabel(input.divisionId)}`,
    `Campaign code supplied by the trainer: ${input.campaignCode.trim() || '(none, suggest one)'}`,
    `Playbook page count: ${input.pages.length} (valid page numbers: 1-${input.pages.length})`,
    `Measured content: about ${depth.ruleSignals} rule statements and ${depth.words} words on ${depth.operationalPages} pages with rules.`,
    `UNIT COUNT: plan ${describeRange(unitRange)} Units (aim for ${unitRange.target}).`,
    condensed
      ? 'The Playbook is long, so each SOURCE PAGE below shows only its first part. Use the headings and opening text to map the pages to Units.'
      : 'Each SOURCE PAGE below shows the full page text approved for this stage.',
    ...(input.sourceReview
      ? [
          '',
          'APPROVED SHARED RULES (inherit these exact rule IDs and statements in later stages):',
          formatSharedRulePacks(input.sourceReview.rulePacks, input.sourceReview.pages),
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
const MIN_DISTINCT_UNITS = 2;

/**
 * A 7B model pads a large Unit target by repeating outlines ("Dosage Abandon Call Flow" three times on the same
 * page). Repeats then write near-identical Drills. A later Unit with the same normalized title is merged into the
 * first one (its pages are added), as long as at least MIN_DISTINCT_UNITS Units remain.
 */
export function mergeRepeatedUnits<U extends { title: string; sourcePages: number[]; pillarKeys: string[] }>(units: readonly U[]): U[] {
  const norm = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const merged: U[] = [];
  for (const unit of units) {
    const first = merged.find((candidate) => norm(candidate.title) === norm(unit.title));
    const remaining = merged.length + (units.length - units.indexOf(unit) - 1);
    if (first && remaining >= MIN_DISTINCT_UNITS) {
      first.sourcePages = [...new Set([...first.sourcePages, ...unit.sourcePages])];
      first.pillarKeys = [...new Set([...first.pillarKeys, ...unit.pillarKeys])];
      continue;
    }
    merged.push({ ...unit, sourcePages: [...unit.sourcePages], pillarKeys: [...unit.pillarKeys] });
  }
  return merged;
}

export function finalizeBlueprint(
  generated: BlueprintGeneration,
  pageCount: number,
  trainerCampaignCode = '',
  pages?: ReadonlyArray<{ pageNumber: number; text: string }>,
  limits?: DepthLimits,
): TrackBlueprint {
  const allPages = Array.from({ length: pageCount }, (_, i) => i + 1);
  const allowed = new Set(allPages);
  const competencyPillars: CompetencyPillar[] = generated.competencyPillars.map((pillar) => ({
    id: pillarIdForKey(pillar.key),
    key: pillar.key,
    label: clampText(pillar.label, 60),
    description: clampText(pillar.description, 240),
  }));
  const pillarIds = new Set(competencyPillars.map((pillar) => pillar.id));
  const units: UnitOutline[] = mergeRepeatedUnits(generated.units.slice(0, BLUEPRINT_MAX_UNITS)).map((unit, index) => {
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
  const plans = pages ? planUnitContent(measureSourceDepth(pages), units.map((unit) => unit.sourcePages), limits) : null;
  units.forEach((unit, index) => {
    unit.contentPlan = plans?.[index] ?? DEFAULT_UNIT_CONTENT_PLAN;
  });
  const campaignCode = normalizeCampaignCode(trainerCampaignCode) || normalizeCampaignCode(generated.campaignCode);
  return {
    campaignCode,
    globalSummary: clampWords(generated.globalSummary, GLOBAL_SUMMARY_MAX_WORDS),
    competencyPillars,
    units,
  };
}
