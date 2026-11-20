import { beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeJoinCode, resolveJoinPage, type CohortLookup } from '@/app/(auth)/join/[code]/join-lookup';
import { AttemptLimiter } from '@/lib/services/attempt-limiter';

const NOW = 1_800_000_000_000;

describe('join page lookup is rate limited', () => {
  let limiter: AttemptLimiter;
  const lookup = vi.fn(async (code: string): Promise<CohortLookup> =>
    code === 'THS-7842' ? { status: 'found', cohortName: 'Telehealth Spring' } : { status: 'invalid' },
  );

  beforeEach(() => {
    limiter = new AttemptLimiter({ maxFailures: 10, windowMs: 15 * 60 * 1000 });
    lookup.mockClear();
  });

  it('shows the Cohort name for a valid code within the limit and records no failure', async () => {
    const state = await resolveJoinPage({ joinCode: 'THS-7842', client: 'a', limiter, lookup, now: NOW });
    expect(state).toEqual({ status: 'found', cohortName: 'Telehealth Spring' });
    for (let i = 0; i < 9; i++) limiter.recordFailure('a', NOW);
    expect(limiter.allowed('a', NOW)).toBe(true);
  });

  it('records a failure for each invalid code, then refuses without a lookup or the Cohort name', async () => {
    for (let i = 0; i < 10; i++) {
      expect((await resolveJoinPage({ joinCode: `THS-${1000 + i}`, client: 'a', limiter, lookup, now: NOW })).status).toBe('invalid');
    }
    lookup.mockClear();
    const state = await resolveJoinPage({ joinCode: 'THS-7842', client: 'a', limiter, lookup, now: NOW });
    expect(state.status).toBe('rate_limited');
    expect(state).not.toHaveProperty('cohortName');
    expect(state.status === 'rate_limited' && state.retryAfterSeconds).toBeGreaterThan(0);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('counts clients separately and lets a client back in after the window', async () => {
    for (let i = 0; i < 10; i++) await resolveJoinPage({ joinCode: `X-${i}`, client: 'a', limiter, lookup, now: NOW });
    expect((await resolveJoinPage({ joinCode: 'THS-7842', client: 'b', limiter, lookup, now: NOW })).status).toBe('found');
    const later = NOW + 15 * 60 * 1000 + 1;
    expect((await resolveJoinPage({ joinCode: 'THS-7842', client: 'a', limiter, lookup, now: later })).status).toBe('found');
  });

  it('does not count a lookup outage as a wrong guess', async () => {
    const outage = vi.fn(async (): Promise<CohortLookup> => ({ status: 'unknown' }));
    for (let i = 0; i < 12; i++) {
      expect((await resolveJoinPage({ joinCode: 'THS-7842', client: 'a', limiter, lookup: outage, now: NOW })).status).toBe('unknown');
    }
  });

  it('shares its budget with the claim API limiter', async () => {
    for (let i = 0; i < 10; i++) limiter.recordFailure('a', NOW); // e.g. wrong codes posted to /api/auth/claim-invite
    expect((await resolveJoinPage({ joinCode: 'THS-7842', client: 'a', limiter, lookup, now: NOW })).status).toBe('rate_limited');
  });
});

describe('normalizeJoinCode', () => {
  it('decodes, trims and upper-cases the route segment', () => {
    expect(normalizeJoinCode('%20ths-7842 ')).toBe('THS-7842');
    expect(normalizeJoinCode('ths-%E0%A4%A')).toBe('THS-%E0%A4%A');
  });
});
