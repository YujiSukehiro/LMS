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
 * spacing and punctuation; a suggestion that is only a piece of the agent's own turn (the QA case: the last two
 * sentences of the agent's reply, offered back as the better response); or the agent's words with almost nothing added.
 */
export function isEchoOf(suggestion: string | null | undefined, agentQuote: string | null | undefined): boolean {
  const said = normalizeFeedbackText(suggestion ?? '');
  const quote = normalizeFeedbackText(agentQuote ?? '');
  if (!said || !quote) return false;
  if (said === quote) return true;
  // A suggestion copied out of the agent's turn adds nothing. Very short overlaps ("thank you") are not echoes.
  if (quote.includes(said)) return said.split(' ').length >= 4;
  return said.includes(quote) && quote.length / said.length >= 0.85;
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
