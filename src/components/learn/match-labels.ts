/**
 * Column headings for a Match Pairs Drill, read from its prompt (QA L9: Atlas note fields were headed "Trigger").
 * "Match each Atlas note field to the correct content." -> "Atlas note field" / "Correct content".
 */
const MATCH_PROMPT = /^match\s+(?:each|every|the)\s+(.+?)\s+(?:to|with)\s+(?:the\s+|its\s+|a\s+)?(.+?)[.?!]?$/i;

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function matchColumnLabels(prompt: string): { left: string; right: string } {
  const match = MATCH_PROMPT.exec(prompt.trim());
  if (!match) return { left: 'Item', right: 'Goes with' };
  const left = match[1].trim();
  const right = match[2].trim();
  if (left.length > 40 || right.length > 40) return { left: 'Item', right: 'Goes with' };
  return { left: capitalize(left), right: capitalize(right) };
}
