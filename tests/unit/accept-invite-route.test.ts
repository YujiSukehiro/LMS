import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashInviteToken, newInviteToken } from '@/lib/services/invite-token';

const { store, mockCreateUser, mockSetClaims, mockDeleteUser } = vi.hoisted(() => ({
  store: new Map<string, Record<string, unknown>>(),
  mockCreateUser: vi.fn(),
  mockSetClaims: vi.fn(async () => undefined),
  mockDeleteUser: vi.fn(async () => undefined),
}));

vi.mock('firebase-admin/firestore', () => ({ FieldValue: { increment: (n: number) => ({ __increment: n }) } }));

vi.mock('@/lib/firebase/admin', () => {
  const ref = (path: string) => ({
    id: path.split('/').pop()!,
    path,
    get: async () => ({ id: path.split('/').pop()!, exists: store.has(path), data: () => store.get(path), get: (f: string) => store.get(path)?.[f] }),
  });
  const collection = (name: string) => ({
    doc: (id: string) => ref(`${name}/${id}`),
    where: (field: string, _op: string, value: unknown) => ({
      limit: () => ({
        get: async () => {
          const docs = [...store.entries()]
            .filter(([path, data]) => path.startsWith(`${name}/`) && data[field] === value)
            .map(([path, data]) => ({ id: path.split('/').pop()!, data: () => data, ref: ref(path) }));
          return { docs, empty: docs.length === 0 };
        },
      }),
    }),
  });
  const apply = (path: string, patch: Record<string, unknown>) => {
    const next = { ...(store.get(path) ?? {}) };
    for (const [k, v] of Object.entries(patch)) {
      next[k] = typeof v === 'object' && v && '__increment' in v ? Number(next[k] ?? 0) + (v as { __increment: number }).__increment : v;
    }
    store.set(path, next);
  };
  return {
    adminDb: {
      collection,
      runTransaction: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          get: (r: { get: () => unknown }) => r.get(),
          create: (r: { path: string }, data: Record<string, unknown>) => {
            if (store.has(r.path)) throw new Error('exists');
            store.set(r.path, data);
          },
          update: (r: { path: string }, patch: Record<string, unknown>) => apply(r.path, patch),
        }),
    },
    adminAuth: { createUser: mockCreateUser, setCustomUserClaims: mockSetClaims, deleteUser: mockDeleteUser },
    firebaseErrorCode: (error: unknown) => (error as { code?: string })?.code,
  };
});

import { POST } from '@/app/api/auth/accept-invite/route';

function seedInvite(token: string, overrides: Record<string, unknown> = {}) {
  store.set('rosterInvites/inv-1', {
    email: 'partner@example.com', lcNumber: null, displayName: 'Pat Partner', role: 'PARTNER_SUPERVISOR', partnerCohortId: 'THS',
    divisionIds: ['INBOUND'], status: 'PENDING', createdByUid: 'admin', claimedByUid: null, setupTokenHash: hashInviteToken(token),
    expiresAt: Date.now() + 86_400_000, createdAt: 1, updatedAt: 1, ...overrides,
  });
}

const accept = (token: string, password = 'a-strong-pass') =>
  POST(new Request('http://localhost/api/auth/accept-invite', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.0.0.${Math.floor(Math.random() * 250)}` },
    body: JSON.stringify({ token, password }),
  }));

describe('POST /api/auth/accept-invite', () => {
  beforeEach(() => {
    store.clear();
    vi.clearAllMocks();
    mockCreateUser.mockResolvedValue({ uid: 'new-uid' });
    store.set('cohorts/THS', { activeAgentCount: 2 });
  });

  it('creates the account with exactly the invited role and consumes the invite', async () => {
    const { token } = newInviteToken();
    seedInvite(token);
    const response = await accept(token);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, emailForSignIn: 'partner@example.com' });
    expect(mockCreateUser).toHaveBeenCalledWith(expect.objectContaining({ email: 'partner@example.com', emailVerified: true }));
    expect(store.get('users/new-uid')).toMatchObject({ role: 'PARTNER_SUPERVISOR', partnerCohortId: 'THS' });
    expect(store.get('rosterInvites/inv-1')).toMatchObject({ status: 'CLAIMED', claimedByUid: 'new-uid', setupTokenHash: null });
    expect(store.get('cohorts/THS')?.activeAgentCount).toBe(2);
  });

  it('refuses a wrong, used, revoked or expired link without creating an account', async () => {
    const { token } = newInviteToken();
    expect((await accept(token)).status).toBe(404);
    seedInvite(token, { status: 'CLAIMED' });
    expect((await accept(token)).status).toBe(410);
    seedInvite(token, { status: 'REVOKED' });
    expect((await accept(token)).status).toBe(410);
    seedInvite(token, { expiresAt: Date.now() - 1 });
    expect((await accept(token)).status).toBe(410);
    expect((await accept('short')).status).toBe(400);
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it('tells an existing account to sign in instead', async () => {
    const { token } = newInviteToken();
    seedInvite(token);
    mockCreateUser.mockRejectedValue({ code: 'auth/email-already-exists' });
    const response = await accept(token);
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe('ACCOUNT_EXISTS');
  });

  it('counts an invited Agent in the Cohort', async () => {
    const { token } = newInviteToken();
    seedInvite(token, { role: 'AGENT' });
    expect((await accept(token)).status).toBe(200);
    expect(store.get('cohorts/THS')?.activeAgentCount).toBe(3);
  });
});
