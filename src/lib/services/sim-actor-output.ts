/**
 * Deterministic cleanup of a finished Simulation Actor reply before it is persisted.
 * Small local models often prefix a speaker label ("Caller:", the persona name), add stage
 * directions ("*sighs*"), keep writing the agent's next line ("\nAgent: ..."), or run long.
 * Pure module (no I/O) so unit tests can import it.
 */
import { stripSimEndSentinels } from './sim-end-filter';

export const ACTOR_MAX_SENTENCES = 3;
export const ACTOR_MAX_CHARS = 600;

const AGENT_LABELS = String.raw`(?:agent|you|trainee|rep|representative|logicall(?: agent)?|support agent|call center agent|customer service(?: agent)?)`;
/** The model starts writing the trainee's line: cut there. Line start, or right after a sentence end. */
const AGENT_TURN_CUT = new RegExp(String.raw`(?:^|\n|(?<=[.!?])\s+)\s*(?:\*\*|__)?\s*${AGENT_LABELS}\s*(?:\*\*|__)?\s*:`, 'i');

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function speakerLabelPattern(names: string[]): RegExp {
  const alternatives = [
    'caller',
    'customer',
    'patient',
    'lead',
    'buyer',
    'counterparty',
    'client',
    ...names.map((name) => escapeRegExp(name.trim())).filter(Boolean),
  ];
  return new RegExp(String.raw`^\s*(?:\*\*|__)?\s*(?:${alternatives.join('|')})(?:\s*\([^)]{0,40}\))?\s*(?:\*\*|__)?\s*:\s*`, 'i');
}

/** Stage directions: *sighs*, _pauses_, [laughs], (sighs heavily). Parentheticals only when they look like actions. */
const STAGE_ASTERISK = /\*[^*\n]{1,60}\*|(?<![A-Za-z0-9])_[^_\n]{1,60}_(?![A-Za-z0-9])/g;
const STAGE_BRACKET = /\[[^\]\n\d]{1,60}\]/g;
const STAGE_PAREN =
  /\((?:sighs?|pauses?|laughs?|chuckles?|groans?|clears (?:his|her|their|my) throat|hesitates?|frustrated|annoyed|angrily|nervously|quietly|softly|confused|worried|sarcastically|exhales?|mutters?|muttering|in a [a-z]+ (?:voice|tone))\b[^()\n\d]{0,30}\)/gi;

/** Split into sentences, keeping the terminal punctuation. */
function sentences(text: string): string[] {
  return text.match(/[^.!?]+(?:[.!?]+["'”’)]*|$)/g)?.map((part) => part.trim()).filter(Boolean) ?? [];
}

export interface CleanActorReplyOptions {
  personaName?: string;
  counterpartyRoleLabel?: string;
  maxSentences?: number;
  maxChars?: number;
}

/** Clean a finished actor reply. Returns '' when nothing speakable remains. */
export function cleanActorReply(raw: string, options: CleanActorReplyOptions = {}): string {
  const maxSentences = options.maxSentences ?? ACTOR_MAX_SENTENCES;
  const maxChars = options.maxChars ?? ACTOR_MAX_CHARS;
  const names: string[] = [];
  if (options.personaName) {
    names.push(options.personaName);
    const first = options.personaName.trim().split(/\s+/)[0];
    if (first && first.length > 1) names.push(first);
  }
  if (options.counterpartyRoleLabel) names.push(options.counterpartyRoleLabel);
  const label = speakerLabelPattern(names);

  let text = stripSimEndSentinels(raw).replace(/\r\n?/g, '\n');

  // Stop where the model begins the trainee's turn.
  const cut = AGENT_TURN_CUT.exec(text);
  if (cut) text = text.slice(0, cut.index);

  // Remove leading speaker labels (possibly repeated: "Caller: Jane Doe: Hi").
  for (let i = 0; i < 3; i += 1) {
    const next = text.replace(label, '');
    if (next === text) break;
    text = next;
  }

  text = text
    .replace(/\*\*|__|`/g, '')
    .replace(STAGE_ASTERISK, ' ')
    .replace(STAGE_BRACKET, ' ')
    .replace(STAGE_PAREN, ' ')
    .replace(/\*/g, '')
    .replace(/^\s*[-•>#]+\s*/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["“]+(.*?)["”]+$/s, '$1')
    .replace(/\s+([,.!?])/g, '$1')
    .trim();

  const parts = sentences(text);
  if (parts.length > maxSentences) text = parts.slice(0, maxSentences).join(' ');
  if (text.length > maxChars) {
    const clipped = text.slice(0, maxChars);
    const lastEnd = Math.max(clipped.lastIndexOf('.'), clipped.lastIndexOf('!'), clipped.lastIndexOf('?'));
    text = lastEnd > maxChars / 3 ? clipped.slice(0, lastEnd + 1) : `${clipped.replace(/\s+\S*$/, '')}…`;
  }
  return text.trim();
}
