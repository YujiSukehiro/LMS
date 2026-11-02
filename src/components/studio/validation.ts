import type { ZodIssue } from 'zod';
import {
  FILL_BLANK_TOKEN,
  PublicSimScenarioSchema,
  SecretSimScenarioConfigSchema,
  TrackUnitSchema,
  type CompetencyPillar,
  type PublicSimScenario,
  type SecretSimScenarioConfig,
  type TrackUnit,
} from '@/lib/schemas/curriculum';

export type StudioTarget = { kind: 'unit'; unitId: string } | { kind: 'scenario'; scenarioId: string } | { kind: 'track' };

export interface StudioIssue {
  target: StudioTarget;
  /** Plain-English location, e.g. "Checkpoint 2 › Drill 3 › Prompt". */
  where: string;
  message: string;
}

const FIELD_LABELS: Record<string, string> = {
  title: 'Title',
  summary: 'Summary',
  estimatedMinutes: 'Estimated minutes',
  orderIndex: 'Order',
  briefingCards: 'Briefing Cards',
  drills: 'Drills',
  headline: 'Headline',
  bodyMarkdown: 'Body',
  keyTakeaway: 'Key takeaway',
  doList: 'DO list',
  dontList: "DON'T list",
  sourcePages: 'Source pages',
  prompt: 'Prompt',
  explanation: 'Explanation',
  options: 'Options',
  text: 'Text',
  correctOptionId: 'Correct option',
  statement: 'Statement',
  isCompliant: 'Correct verdict',
  orderedSteps: 'Steps',
  pairs: 'Pairs',
  leftPrompt: 'Left side',
  rightMatch: 'Right side',
  sentenceTemplate: 'Sentence',
  wordBank: 'Word bank',
  correctWord: 'Correct word',
  competencyPillarId: 'CompetencyPillar',
  difficulty: 'Difficulty',
  counterpartyRoleLabel: 'Caller role label',
  contextTicketSummary: 'Context ticket',
  openingMessage: 'Opening message',
  dispositionOptions: 'Disposition options',
  maxTurns: 'Maximum turns',
  passScoreThreshold: 'Pass score',
  personaName: 'Persona name',
  personaBackstoryAndMood: 'Persona backstory and mood',
  hiddenFactsToRevealOnlyWhenAsked: 'Hidden facts',
  conditionalBehaviors: 'Caller behaviors',
  expectedDisposition: 'Expected disposition',
  autoFailTriggers: 'Auto-fail triggers',
  rubricCriteria: 'Rubric criteria',
  criterionLabel: 'Criterion',
  evaluationRule: 'Evaluation rule',
  weight: 'Weight',
};

const SINGULAR_LABELS: Record<string, string> = {
  briefingCards: 'Briefing Card',
  drills: 'Drill',
  doList: 'DO line',
  dontList: "DON'T line",
  sourcePages: 'Source page',
  options: 'Option',
  orderedSteps: 'Step',
  pairs: 'Pair',
  wordBank: 'Word',
  dispositionOptions: 'Disposition',
  hiddenFactsToRevealOnlyWhenAsked: 'Hidden fact',
  conditionalBehaviors: 'Caller behavior',
  autoFailTriggers: 'Auto-fail trigger',
  rubricCriteria: 'Criterion',
};

function pathToWords(path: Array<string | number>): string {
  const parts: string[] = [];
  let lastKey: string | null = null;
  for (const segment of path) {
    if (typeof segment === 'number') {
      const singular = lastKey ? SINGULAR_LABELS[lastKey] : undefined;
      if (singular) parts[parts.length - 1] = `${singular} ${segment + 1}`;
      else parts.push(`#${segment + 1}`);
    } else {
      parts.push(FIELD_LABELS[segment] ?? segment);
      lastKey = segment;
    }
  }
  return parts.join(' › ');
}

function issueToWords(issue: ZodIssue): string {
  switch (issue.code) {
    case 'too_big': {
      const max = Number(issue.maximum);
      if (issue.type === 'string') return `must be ${max} characters or fewer`;
      if (issue.type === 'array') return issue.exact ? `needs exactly ${max} items` : `can have ${max} items at most`;
      return `must be ${max} or less`;
    }
    case 'too_small': {
      const min = Number(issue.minimum);
      if (issue.type === 'string') return min <= 1 ? 'must not be empty' : `needs ${min} or more characters`;
      if (issue.type === 'array') return issue.exact ? `needs exactly ${min} items` : `needs ${min} or more items`;
      return `must be ${min} or more`;
    }
    case 'invalid_type':
      return issue.received === 'undefined' ? 'is required' : 'has a value that is not valid';
    case 'invalid_enum_value':
      return `must be one of: ${issue.options.join(', ')}`;
    default:
      return issue.message;
  }
}

function zodIssues(
  issues: ZodIssue[],
  target: StudioTarget,
  prefix: string,
): StudioIssue[] {
  return issues.map((issue) => {
    const where = pathToWords(issue.path);
    return { target, where: where ? `${prefix} › ${where}` : prefix, message: issueToWords(issue) };
  });
}

/** Strings must not be blank even when the schema only limits their length. */
function blank(value: string): boolean {
  return value.trim().length === 0;
}

export function validateStudioDraft(input: {
  title: string;
  units: TrackUnit[];
  simScenarios: PublicSimScenario[];
  secretScenarios: SecretSimScenarioConfig[];
  pillars: CompetencyPillar[];
}): StudioIssue[] {
  const issues: StudioIssue[] = [];
  const pillarIds = new Set(input.pillars.map((p) => p.id));
  const title = input.title.trim();
  if (title.length < 3 || title.length > 100) {
    issues.push({ target: { kind: 'track' }, where: 'Track title', message: 'must have 3 to 100 characters' });
  }
  if (input.units.length === 0) {
    issues.push({ target: { kind: 'track' }, where: 'Track', message: 'needs at least one Checkpoint' });
  }

  input.units.forEach((unit, unitIndex) => {
    const target: StudioTarget = { kind: 'unit', unitId: unit.id };
    const prefix = `Checkpoint ${unitIndex + 1}`;
    const parsed = TrackUnitSchema.safeParse(unit);
    if (!parsed.success) issues.push(...zodIssues(parsed.error.issues, target, prefix));
    if (blank(unit.title)) issues.push({ target, where: `${prefix} › Title`, message: 'must not be empty' });

    unit.briefingCards.forEach((card, i) => {
      const where = `${prefix} › Briefing Card ${i + 1}`;
      if (blank(card.headline)) issues.push({ target, where: `${where} › Headline`, message: 'must not be empty' });
      if (blank(card.bodyMarkdown)) issues.push({ target, where: `${where} › Body`, message: 'must not be empty' });
      if (card.doList.some(blank) || card.dontList.some(blank)) {
        issues.push({ target, where: `${where} › DO / DON'T`, message: 'has an empty line — type text or remove the line' });
      }
    });

    unit.drills.forEach((drill, i) => {
      const where = `${prefix} › Drill ${i + 1}`;
      if (blank(drill.prompt)) issues.push({ target, where: `${where} › Prompt`, message: 'must not be empty' });
      if (blank(drill.explanation)) issues.push({ target, where: `${where} › Explanation`, message: 'must not be empty' });
      if (!pillarIds.has(drill.competencyPillarId)) {
        issues.push({ target, where: `${where} › CompetencyPillar`, message: 'select a CompetencyPillar from the list' });
      }
      switch (drill.kind) {
        case 'MULTIPLE_CHOICE':
          if (!drill.options.some((o) => o.id === drill.correctOptionId)) {
            issues.push({ target, where: `${where} › Options`, message: 'select the correct option' });
          }
          if (drill.options.some((o) => blank(o.text))) {
            issues.push({ target, where: `${where} › Options`, message: 'every option needs text' });
          }
          break;
        case 'TRUE_FALSE_SPOT':
          if (blank(drill.statement)) issues.push({ target, where: `${where} › Statement`, message: 'must not be empty' });
          break;
        case 'SEQUENCE_ORDER':
          if (drill.orderedSteps.some((s) => blank(s.text))) {
            issues.push({ target, where: `${where} › Steps`, message: 'every step needs text' });
          }
          break;
        case 'MATCH_PAIRS':
          if (drill.pairs.some((p) => blank(p.leftPrompt) || blank(p.rightMatch))) {
            issues.push({ target, where: `${where} › Pairs`, message: 'every pair needs text on both sides' });
          }
          break;
        case 'FILL_BLANK_CHOICE': {
          const blanks = drill.sentenceTemplate.split(FILL_BLANK_TOKEN).length - 1;
          if (blanks !== 1) {
            issues.push({ target, where: `${where} › Sentence`, message: `must contain ${FILL_BLANK_TOKEN} exactly once` });
          }
          if (!drill.wordBank.includes(drill.correctWord) || blank(drill.correctWord)) {
            issues.push({ target, where: `${where} › Word bank`, message: 'select which word is correct' });
          }
          if (drill.wordBank.some(blank)) {
            issues.push({ target, where: `${where} › Word bank`, message: 'every word needs text' });
          }
          if (new Set(drill.wordBank.map((w) => w.trim().toLowerCase())).size !== drill.wordBank.length) {
            issues.push({ target, where: `${where} › Word bank`, message: 'the 4 words must all be different' });
          }
          break;
        }
      }
    });
  });

  input.simScenarios.forEach((scenario, i) => {
    const target: StudioTarget = { kind: 'scenario', scenarioId: scenario.id };
    const prefix = `Live Call Sim ${i + 1}`;
    const parsed = PublicSimScenarioSchema.safeParse(scenario);
    if (!parsed.success) issues.push(...zodIssues(parsed.error.issues, target, prefix));
    if (blank(scenario.title)) issues.push({ target, where: `${prefix} › Scenario title`, message: 'must not be empty' });
    if (blank(scenario.openingMessage)) issues.push({ target, where: `${prefix} › Opening message`, message: 'must not be empty' });
    if (scenario.dispositionOptions.some(blank)) {
      issues.push({ target, where: `${prefix} › Disposition options`, message: 'has an empty line — type text or remove the line' });
    }

    const secret = input.secretScenarios.find((s) => s.scenarioId === scenario.id);
    if (!secret) {
      issues.push({ target, where: `${prefix} › Hidden persona and rubric`, message: 'is missing' });
      return;
    }
    const secretPrefix = `${prefix} › Hidden persona`;
    const secretParsed = SecretSimScenarioConfigSchema.safeParse(secret);
    if (!secretParsed.success) issues.push(...zodIssues(secretParsed.error.issues, target, secretPrefix));
    if (blank(secret.personaName)) issues.push({ target, where: `${secretPrefix} › Persona name`, message: 'must not be empty' });
    if (!scenario.dispositionOptions.includes(secret.expectedDisposition)) {
      issues.push({ target, where: `${secretPrefix} › Expected disposition`, message: 'must be one of the disposition options' });
    }
    const total = secret.rubricCriteria.reduce((sum, c) => sum + (Number.isFinite(c.weight) ? c.weight : 0), 0);
    if (total !== 100) {
      issues.push({ target, where: `${secretPrefix} › Rubric criteria`, message: `weights must total 100 (now ${total})` });
    }
    secret.rubricCriteria.forEach((criterion, ci) => {
      const where = `${secretPrefix} › Criterion ${ci + 1}`;
      if (blank(criterion.criterionLabel)) issues.push({ target, where: `${where} › Criterion`, message: 'must not be empty' });
      if (blank(criterion.evaluationRule)) issues.push({ target, where: `${where} › Evaluation rule`, message: 'must not be empty' });
      if (!pillarIds.has(criterion.competencyPillarId)) {
        issues.push({ target, where: `${where} › CompetencyPillar`, message: 'select a CompetencyPillar from the list' });
      }
    });
    const emptyLists = [
      ...secret.hiddenFactsToRevealOnlyWhenAsked,
      ...secret.conditionalBehaviors,
      ...secret.autoFailTriggers,
    ].some(blank);
    if (emptyLists) {
      issues.push({ target, where: secretPrefix, message: 'has an empty line — type text or remove the line' });
    }
  });

  // Remove exact duplicates (zod and the plain-English checks can report the same field).
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.where}|${issue.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function issueTargetsKey(target: StudioTarget): string {
  return target.kind === 'unit' ? `unit:${target.unitId}` : target.kind === 'scenario' ? `scenario:${target.scenarioId}` : 'track';
}
