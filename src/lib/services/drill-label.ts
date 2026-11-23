/**
 * A short, specific label for a Drill in "most missed" lists (QA M7). Generic prompts such as
 * "Complete the Playbook rule." tell a trainer nothing, so those show the Drill's own content instead.
 */
import type { DrillItem } from '@/lib/schemas/curriculum';

const LABEL_MAX = 80;
const GENERIC_PROMPT = /^(complete|fill in|finish|choose|select|pick|match|put|order|answer)\b[^.?!]{0,40}(rule|blank|sentence|word|statement|steps?|pairs?|items?|question|answer|order)\b[^.?!]*[.?!]?$/i;

function clip(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > LABEL_MAX ? `${flat.slice(0, LABEL_MAX - 1).trimEnd()}…` : flat;
}

/** "Does this agent action follow the Playbook?" and similar: the question is the same for every Drill of its kind. */
const GENERIC_QUESTION = /^(does|is|do) (this|the) (agent|action|statement|response|reply|step)\b[^.?!]{0,60}\?$/i;

export function isGenericDrillPrompt(prompt: string): boolean {
  const flat = prompt.trim();
  return flat.length < 12 || GENERIC_PROMPT.test(flat) || GENERIC_QUESTION.test(flat);
}

export function drillLabel(drill: DrillItem): string {
  if (!isGenericDrillPrompt(drill.prompt)) return clip(drill.prompt);
  switch (drill.kind) {
    case 'FILL_BLANK_CHOICE':
      return clip(drill.sentenceTemplate.replace(/\{\{BLANK\}\}/g, '___'));
    case 'TRUE_FALSE_SPOT':
      return clip(drill.statement);
    case 'MATCH_PAIRS':
      return clip(`${drill.prompt.replace(/[.?!]$/, '')}: ${drill.pairs.map((pair) => pair.leftPrompt).join(', ')}`);
    case 'SEQUENCE_ORDER':
      return clip(`${drill.prompt.replace(/[.?!]$/, '')}: ${drill.orderedSteps[0]?.text ?? ''}…`);
    default:
      return clip(drill.prompt);
  }
}
