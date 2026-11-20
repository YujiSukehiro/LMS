/**
 * Stall guard for streamed AI replies. Without it a hung model runtime keeps the learner's
 * "caller is replying…" state open until the platform request timeout (up to an hour on Cloud Run).
 */
export interface StreamWatchdog {
  /** Call on every received chunk to reset the idle timer. */
  touch: () => void;
  /** Clear both timers. Safe to call more than once. */
  stop: () => void;
  readonly timedOut: boolean;
}

export function createStreamWatchdog(args: {
  /** Max silence between chunks (including time to the first chunk). */
  idleMs: number;
  /** Max total stream time. */
  totalMs: number;
  onTimeout: () => void;
}): StreamWatchdog {
  let timedOut = false;
  let stopped = false;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  const fire = () => {
    if (stopped || timedOut) return;
    timedOut = true;
    stop();
    args.onTimeout();
  };
  const totalTimer: ReturnType<typeof setTimeout> = setTimeout(fire, args.totalMs);
  const armIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(fire, args.idleMs);
  };
  function stop() {
    stopped = true;
    clearTimeout(totalTimer);
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
  }
  armIdle();
  return {
    touch: () => {
      if (!stopped) armIdle();
    },
    stop,
    get timedOut() {
      return timedOut;
    },
  };
}
