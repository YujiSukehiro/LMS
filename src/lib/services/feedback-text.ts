/**
 * Pure helpers that keep Verbal Practice feedback honest (QA M6). Safe for client and server.
 */

/** Lowercase, unify quotes and dashes, drop punctuation, collapse spaces. */
export function normalizeFeedbackText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * True when a "Try saying" suggestion just repeats what the agent said: the same words after normalizing case,
 * spacing and punctuation, or one wholly inside the other with nearly the same length.
 */
export function isEchoOf(suggestion: string | null | undefined, agentQuote: string | null | undefined): boolean {
  const a = normalizeFeedbackText(suggestion ?? '');
  const b = normalizeFeedbackText(agentQuote ?? '');
  if (!a || !b) return false;
  if (a === b) return true;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  return longer.includes(shorter) && shorter.length / longer.length >= 0.85;
}

/** Quoted fragments ("…" or “…”) of at least three words inside a feedback line. */
export function quotedFragments(text: string): string[] {
  const fragments: string[] = [];
  const pattern = /["“]([^"”]{3,})["”]/g;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    const fragment = match[1].trim();
    if (fragment.split(/\s+/).length >= 3) fragments.push(fragment);
  }
  return fragments;
}
