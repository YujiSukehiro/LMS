import type { AttemptLimiter } from '@/lib/services/attempt-limiter';

export type CohortLookup = { status: 'found'; cohortName: string } | { status: 'invalid' } | { status: 'unknown' };

export type JoinPageState = CohortLookup | { status: 'rate_limited'; retryAfterSeconds: number };

/** Normalise the `[code]` route segment the same way the claim API does. */
export function normalizeJoinCode(code: string): string {
  try {
    return decodeURIComponent(code).trim().toUpperCase();
  } catch {
    return code.trim().toUpperCase();
  }
}

/**
 * The public join page is a code oracle (valid or not, plus the Cohort name), so it shares the claim API's
 * join-code limiter: a client over the limit gets no lookup at all, and every invalid code counts as a failure.
 */
export async function resolveJoinPage(input: {
  joinCode: string;
  client: string;
  limiter: Pick<AttemptLimiter, 'allowed' | 'recordFailure' | 'retryAfterSeconds'>;
  lookup: (joinCode: string) => Promise<CohortLookup>;
  now?: number;
}): Promise<JoinPageState> {
  const { joinCode, client, limiter, lookup, now = Date.now() } = input;
  if (!limiter.allowed(client, now)) {
    return { status: 'rate_limited', retryAfterSeconds: limiter.retryAfterSeconds(client, now) };
  }
  const result = await lookup(joinCode);
  if (result.status === 'invalid') limiter.recordFailure(client, now);
  return result;
}
