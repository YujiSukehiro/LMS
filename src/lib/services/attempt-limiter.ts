/**
 * Small in-process limiter for failed guesses (for example join codes). It slows brute force on one
 * server instance; it is not a substitute for an edge or App Check rate limit across instances.
 */
export interface AttemptLimiterOptions {
  maxFailures: number;
  windowMs: number;
}

export class AttemptLimiter {
  private readonly failures = new Map<string, number[]>();

  constructor(private readonly options: AttemptLimiterOptions) {}

  private recent(key: string, now: number): number[] {
    const kept = (this.failures.get(key) ?? []).filter((at) => now - at < this.options.windowMs);
    if (kept.length > 0) this.failures.set(key, kept);
    else this.failures.delete(key);
    return kept;
  }

  /** True while this key still has failures left in the window. */
  allowed(key: string, now: number = Date.now()): boolean {
    return this.recent(key, now).length < this.options.maxFailures;
  }

  recordFailure(key: string, now: number = Date.now()): void {
    this.failures.set(key, [...this.recent(key, now), now]);
    // Bound memory: drop the oldest keys when many distinct clients fail.
    if (this.failures.size > 10_000) this.failures.delete(this.failures.keys().next().value!);
  }

  /** Seconds until the oldest counted failure leaves the window. */
  retryAfterSeconds(key: string, now: number = Date.now()): number {
    const oldest = this.recent(key, now)[0];
    return oldest === undefined ? 0 : Math.max(1, Math.ceil((oldest + this.options.windowMs - now) / 1000));
  }
}

/**
 * Client key for rate limiting. X-Forwarded-For is appended to by each proxy, so only the right-most
 * entries were written by infrastructure we trust; anything to their left came from the client and can be
 * spoofed. TRUSTED_PROXY_HOPS is how many right-most entries trusted infrastructure appends. On Google Cloud
 * Load Balancing (App Hosting) the LB appends "<client-ip>, <lb-ip>", so the default of 2 picks the second entry
 * from the right. Without the header: X-Real-IP (set by the platform), else one shared key.
 */
export function clientKey(req: Request, trustedHops: number = trustedProxyHops()): string {
  const hops = req.headers.get('x-forwarded-for')?.split(',').map((part) => part.trim()).filter(Boolean) ?? [];
  if (hops.length > 0) return hops[Math.max(0, hops.length - trustedHops)]!;
  return req.headers.get('x-real-ip')?.trim() || 'unknown-client';
}

function trustedProxyHops(): number {
  const value = Number.parseInt(process.env.TRUSTED_PROXY_HOPS ?? '', 10);
  return Number.isFinite(value) && value >= 1 ? value : 2;
}

/** Join codes are short (e.g. THS-7842): cap wrong-code guesses per client so they cannot be enumerated. */
export const joinCodeLimiter = new AttemptLimiter({ maxFailures: 10, windowMs: 15 * 60 * 1000 });
