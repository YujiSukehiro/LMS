import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStreamWatchdog } from '@/lib/services/stream-watchdog';
import { voiceErrorMessage } from '@/components/simulation/voice-errors';

describe('createStreamWatchdog', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('fires after the idle window when no chunk arrives', () => {
    const onTimeout = vi.fn();
    const watchdog = createStreamWatchdog({ idleMs: 1000, totalMs: 10_000, onTimeout });
    vi.advanceTimersByTime(999);
    expect(onTimeout).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(watchdog.timedOut).toBe(true);
  });

  it('resets the idle window on every chunk but still enforces the total cap', () => {
    const onTimeout = vi.fn();
    const watchdog = createStreamWatchdog({ idleMs: 1000, totalMs: 3500, onTimeout });
    for (let i = 0; i < 3; i += 1) {
      vi.advanceTimersByTime(900);
      watchdog.touch();
    }
    expect(onTimeout).not.toHaveBeenCalled();
    vi.advanceTimersByTime(800);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('never fires after stop()', () => {
    const onTimeout = vi.fn();
    const watchdog = createStreamWatchdog({ idleMs: 100, totalMs: 200, onTimeout });
    watchdog.stop();
    vi.advanceTimersByTime(1000);
    expect(onTimeout).not.toHaveBeenCalled();
    expect(watchdog.timedOut).toBe(false);
  });
});

describe('voiceErrorMessage', () => {
  it('explains a blocked microphone in plain language', () => {
    expect(voiceErrorMessage('not-allowed')).toMatch(/Microphone access is blocked/);
    expect(voiceErrorMessage('service-not-allowed')).toMatch(/Microphone access is blocked/);
  });
  it('stays silent for a user or programmatic abort', () => {
    expect(voiceErrorMessage('aborted')).toBeNull();
    expect(voiceErrorMessage(undefined)).toBeNull();
  });
  it('gives a fallback for unknown codes', () => {
    expect(voiceErrorMessage('bad-grammar')).toMatch(/Voice dictation stopped/);
  });
});
