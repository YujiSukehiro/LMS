/**
 * Streaming filter for Simulation Actor replies.
 * It removes the `<SIM_END>` sentinel from a token stream and holds back any partial text
 * that could be the start of the sentinel, so the sentinel never reaches the browser.
 * Pure module (no I/O) so unit tests can import it.
 */

const FULL_SENTINEL = /<\s*SIM_END\s*>/gi;
/** A string that could still grow into `<SIM_END>` (whitespace inside the brackets is tolerated). */
const PARTIAL_SENTINEL = /^<\s*(?:S(?:I(?:M(?:_(?:E(?:N(?:D\s*)?)?)?)?)?)?)?$/i;
/** A held-back tail at end of stream that is clearly a cut-off sentinel (for example `<SIM_EN`). */
const TRUNCATED_SENTINEL = /^<\s*SIM/i;

export interface SimEndStreamFilter {
  /** Add raw model text. Returns the text that is safe to send to the browser now (can be ''). */
  push(chunk: string): string;
  /** Call once at end of stream. Returns any remaining safe text. */
  flush(): string;
  /** True when a sentinel (complete, or cut off at the end of the stream) was found. */
  readonly simEnded: boolean;
}

export function createSimEndStreamFilter(): SimEndStreamFilter {
  let pending = '';
  let ended = false;

  const removeCompleteSentinels = () => {
    const replaced = pending.replace(FULL_SENTINEL, () => {
      ended = true;
      return '';
    });
    pending = replaced;
  };

  return {
    push(chunk: string): string {
      if (!chunk) return '';
      pending += chunk;
      removeCompleteSentinels();

      const lastOpen = pending.lastIndexOf('<');
      if (lastOpen !== -1 && PARTIAL_SENTINEL.test(pending.slice(lastOpen))) {
        const safe = pending.slice(0, lastOpen);
        pending = pending.slice(lastOpen);
        return safe;
      }
      const safe = pending;
      pending = '';
      return safe;
    },
    flush(): string {
      removeCompleteSentinels();
      const rest = pending;
      pending = '';
      if (rest && TRUNCATED_SENTINEL.test(rest)) {
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
