/**
 * Streaming filter for Simulation Actor replies.
 * It removes the end-of-call sentinel from a token stream and holds back any partial text
 * that could be the start of the sentinel, so the sentinel never reaches the browser.
 *
 * Small local models rarely write `<SIM_END>` exactly, so every common variant is accepted:
 * `<SIM_END>`, `</SIM_END>`, `<SIM_END/>`, `[SIM_END]`, `<SIM-END>`, `**<SIM_END>**`, and a bare `SIM_END`.
 * Text after the sentinel is dropped (the caller has hung up).
 * Pure module (no I/O) so unit tests can import it.
 */

/** Any complete sentinel form, with optional surrounding markdown emphasis. */
const FULL_SENTINEL =
  /(?:\*{1,2}|_{1,2})?\s*(?:<\s*\/?\s*SIM[_\- ]?END\s*\/?\s*>|\[\s*\/?\s*SIM[_\- ]?END\s*\/?\s*\]|(?<![<[/]\s*)(?<!\w)SIM[_-]END(?!\w|\s*[>\]/]))\s*(?:\*{1,2}|_{1,2})?/i;
const FULL_SENTINEL_GLOBAL = new RegExp(FULL_SENTINEL.source, 'gi');

/** A trailing fragment that could still grow into a sentinel (bracketed or bare). */
const PARTIAL_BRACKETED = /(?:\*{1,2}\s*)?[<[]\s*\/?\s*(?:S(?:I(?:M(?:[_\- ](?:E(?:N(?:D\s*\/?\s*)?)?)?)?)?)?)?$/i;
const PARTIAL_BARE = /(?:^|[^A-Za-z0-9_])((?:\*{1,2}\s*)?S(?:I(?:M(?:[_-](?:E(?:N(?:D)?)?)?)?)?)?)$/i;
const PARTIAL_EMPHASIS = /\*{1,2}\s*$/;
/** A held-back tail at end of stream that is clearly a cut-off sentinel (for example `<SIM_EN` or `SIM_E`). */
const TRUNCATED_SENTINEL = /^(?:\*{1,2}\s*)?(?:[<[]\s*\/?\s*SIM|SIM[_-]E)/i;

export interface SimEndStreamFilter {
  /** Add raw model text. Returns the text that is safe to send to the browser now (can be ''). */
  push(chunk: string): string;
  /** Call once at end of stream. Returns any remaining safe text. */
  flush(): string;
  /** True when a sentinel (complete, or cut off at the end of the stream) was found. */
  readonly simEnded: boolean;
}

/** True when the text contains any complete sentinel form. */
export function containsSimEndSentinel(text: string): boolean {
  return FULL_SENTINEL.test(text);
}

/** Remove every complete sentinel form from finished text (non-streaming helper). */
export function stripSimEndSentinels(text: string): string {
  return text.replace(FULL_SENTINEL_GLOBAL, ' ').replace(/[ \t]{2,}/g, ' ').trim();
}

function heldBackStart(pending: string): number {
  const candidates: number[] = [];
  const bracketed = PARTIAL_BRACKETED.exec(pending);
  if (bracketed) candidates.push(bracketed.index);
  const bare = PARTIAL_BARE.exec(pending);
  if (bare) candidates.push(pending.length - bare[1]!.length);
  const emphasis = PARTIAL_EMPHASIS.exec(pending);
  if (emphasis) candidates.push(emphasis.index);
  return candidates.length > 0 ? Math.min(...candidates) : -1;
}

export function createSimEndStreamFilter(): SimEndStreamFilter {
  let pending = '';
  let ended = false;

  /** Cut at the first complete sentinel; returns true when one was found. */
  const cutAtSentinel = (): boolean => {
    const match = FULL_SENTINEL.exec(pending);
    if (!match) return false;
    ended = true;
    pending = pending.slice(0, match.index);
    return true;
  };

  return {
    push(chunk: string): string {
      if (!chunk || ended) return '';
      pending += chunk;
      if (cutAtSentinel()) {
        const safe = pending;
        pending = '';
        return safe;
      }
      const hold = heldBackStart(pending);
      if (hold !== -1) {
        const safe = pending.slice(0, hold);
        pending = pending.slice(hold);
        return safe;
      }
      const safe = pending;
      pending = '';
      return safe;
    },
    flush(): string {
      if (ended) {
        const rest = pending;
        pending = '';
        return rest;
      }
      cutAtSentinel();
      const rest = pending;
      pending = '';
      if (rest && !ended && TRUNCATED_SENTINEL.test(rest.trim())) {
        ended = true;
        return '';
      }
      return rest;
    },
    get simEnded() {
      return ended;
    },
  };
}
