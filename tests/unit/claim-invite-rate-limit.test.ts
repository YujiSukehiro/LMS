import { beforeEach, describe, expect, it, vi } from 'vitest';

const { cohorts } = vi.hoisted(() => ({ cohorts: [] as Array<{ id: string; data: Record<string, unknown> }> }));

vi.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (name: string) => ({
      where: (_field: string, _op: string, value: unknown) => ({
        limit: () => ({
          get: async () => ({
            docs: name === 'cohorts' ? cohorts.filter((c) => c.data.joinCode === value).map((c) => ({ id: c.id, data: () => c.data, ref: {} })) : [],
            empty: true,
          }),
        }),
      }),
    }),
  },
  adminAuth: { createUser: vi.fn() },
  firebaseErrorCode: () => undefined,
}));

import { POST } from '@/app/api/auth/claim-invite/route';
import { AttemptLimiter, clientKey, joinCodeLimiter } from '@/lib/services/attempt-limiter';

function claim(joinCode: string, ip = '203.0.113.7'): Request {
  return new Request('http://localhost/api/auth/claim-invite', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `198.18.0.1, ${ip}, 130.211.0.1` },
    body: JSON.stringify({ joinCode, lcNumber: 'LC-9901', displayName: 'Probe Agent', password: 'Probe-Pass-123' }),
  });
}

describe('POST /api/auth/claim-invite join-code guessing', () => {
  beforeEach(() => {
    (joinCodeLimiter as unknown as { failures: Map<string, number[]> }).failures.clear();
  });

  it('answers 429 with Retry-After after 10 wrong codes from one client, before touching the database', async () => {
    for (let index = 0; index < 10; index++) expect((await POST(claim(`THS-${1000 + index}`))).status).toBe(404);
    const limited = await POST(claim('THS-7842'));
    expect(limited.status).toBe(429);
    expect((await limited.json()).error).toBe('RATE_LIMITED');
    expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(0);
  });

  it('counts each client separately', async () => {
    for (let index = 0; index < 10; index++) await POST(claim(`THS-${2000 + index}`, '198.51.100.1'));
    expect((await POST(claim('THS-0000', '198.51.100.2'))).status).toBe(404);
  });

  it('does not reset the limit when the client rotates a spoofed X-Forwarded-For entry', async () => {
    const spoofed = (joinCode: string, fake: string) => new Request('http://localhost/api/auth/claim-invite', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': `${fake}, 203.0.113.50, 130.211.0.1` },
      body: JSON.stringify({ joinCode, lcNumber: 'LC-9901', displayName: 'Probe Agent', password: 'Probe-Pass-123' }),
    });
    for (let index = 0; index < 10; index++) await POST(spoofed(`THS-${4000 + index}`, `10.9.9.${index}`));
    expect((await POST(spoofed('THS-4999', '10.9.9.200'))).status).toBe(429);
  });
});

describe('AttemptLimiter', () => {
  it('forgets failures once the window passes', () => {
    const limiter = new AttemptLimiter({ maxFailures: 2, windowMs: 1000 });
    limiter.recordFailure('k', 0);
    limiter.recordFailure('k', 10);
    expect(limiter.allowed('k', 500)).toBe(false);
    expect(limiter.retryAfterSeconds('k', 500)).toBe(1);
    expect(limiter.allowed('k', 1_011)).toBe(true);
  });

  it('keys clients by the hop the trusted proxy appended, so a spoofed left-most entry is ignored', () => {
    // Default (GCLB): "<spoofed...>, <client-ip>, <lb-ip>" -> second from the right.
    expect(clientKey(new Request('http://x', { headers: { 'x-forwarded-for': 'spoofed-1, 5.6.7.8, 130.211.0.1' } }))).toBe('5.6.7.8');
    expect(clientKey(new Request('http://x', { headers: { 'x-forwarded-for': 'spoofed-2, 5.6.7.8, 130.211.0.1' } }))).toBe('5.6.7.8');
    // One trusted proxy: the right-most entry.
    expect(clientKey(new Request('http://x', { headers: { 'x-forwarded-for': 'spoofed, 9.9.9.1' } }), 1)).toBe('9.9.9.1');
    // Fewer entries than trusted hops (direct to the server): the left-most one.
    expect(clientKey(new Request('http://x', { headers: { 'x-forwarded-for': '9.9.9.2' } }))).toBe('9.9.9.2');
    expect(clientKey(new Request('http://x', { headers: { 'x-real-ip': '9.9.9.9' } }))).toBe('9.9.9.9');
    expect(clientKey(new Request('http://x'))).toBe('unknown-client');
  });
});
