/** Pure helpers for Verbal Practice voice: dictation text merging, restart rules, and caller voice selection. */

/** Join dictated text onto what is already in the composer, with one space between parts. */
export function appendSpoken(prev: string, spoken: string, maxLength: number): string {
  const text = spoken.trim();
  if (!text) return prev.slice(0, maxLength);
  return `${prev.trim() ? `${prev.trimEnd()} ` : ''}${text}`.slice(0, maxLength);
}

/** What the composer shows: the confirmed draft plus words still being recognised. */
export function composeWithInterim(draft: string, interim: string, maxLength: number): string {
  return interim.trim() ? appendSpoken(draft, interim, maxLength) : draft;
}

/** Errors that mean the mic cannot work right now, so dictation must not restart by itself. */
export function isFatalVoiceError(code: string | undefined): boolean {
  return code === 'not-allowed' || code === 'service-not-allowed' || code === 'audio-capture' || code === 'network';
}

export interface VoiceLike {
  name: string;
  lang: string;
  localService?: boolean;
  default?: boolean;
}

const PREFERRED_VOICE_NAMES = [/natural/i, /google us english/i, /\baria\b/i, /\bjenny\b/i, /samantha/i, /\bava\b/i, /\ballison\b/i];

/** Choose the most natural-sounding US English voice the browser offers, or null for the browser default. */
export function pickCallerVoice<T extends VoiceLike>(voices: readonly T[]): T | null {
  const english = voices.filter((v) => /^en[-_]?/i.test(v.lang));
  if (english.length === 0) return null;
  const us = english.filter((v) => /^en[-_]us$/i.test(v.lang));
  const pool = us.length > 0 ? us : english;
  for (const pattern of PREFERRED_VOICE_NAMES) {
    const match = pool.find((v) => pattern.test(v.name));
    if (match) return match;
  }
  return pool.find((v) => v.default) ?? pool[0] ?? null;
}

/** Strip formatting and stage directions so the caller voice reads only the spoken words. */
export function speakableText(content: string): string {
  return content
    .replace(/\[[^\]\n]{0,60}\]/g, ' ')
    .replace(/\*\([^)\n]{0,60}\)\*/g, ' ')
    .replace(/[*_`#>]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
