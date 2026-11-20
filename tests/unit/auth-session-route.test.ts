import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildNewUserDoc, claimsForUser } from '@/lib/firebase/users';

const { store, invites, mockVerifyIdToken, mockCreateSessionCookie, mockGetUser, mockSetCustomUserClaims } = vi.hoisted(() => ({
  store: new Map<string, Record<string, unknown>>(),
  invites: [] as Array<{ id: string; data: Record<string, unknown> }>,
  mockVerifyIdToken: vi.fn(),
  mockCreateSessionCookie: vi.fn(),
  mockGetUser: vi.fn(),
  mockSetCustomUserClaims: vi.fn(),
}));

vi.mock('@/lib/firebase/admin', () => {
  const docRef = (collection: string, id: string) => ({
    id,
    path: `${collection}/${id}`,
    get: async () => ({ exists: store.has(`${collection}/${id}`), data: () => store.get(`${collection}/${id}`) }),
    update: async (patch: Record<string, unknown>) => {
      store.set(`${collection}/${id}`, { ...store.get(`${collection}/${id}`), ...patch });
    },
  });
  const collection = (name: string) => ({
    doc: (id: string) => docRef(name, id),
    where: (_field: string, _op: string, value: unknown) => ({
      limit: () => ({
        kind: 'query',
        docs: name === 'rosterInvites'
          ? invites.filter((invite) => invite.data.email === value).map((invite) => ({ id: invite.id, ref: docRef(name, invite.id), data: () => invite.data }))
          : [],
      }),
    }),
  });
  const adminDb = {
    collection,
    runTransaction: async (callback: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        get: async (target: { kind?: string; get?: () => Promise<unknown> }) => (target.kind === 'query' ? target : target.get!()),
        create: (ref: { path: string }, data: Record<string, unknown>) => store.set(ref.path, data),
        update: (ref: { path: string }, patch: Record<string, unknown>) => store.set(ref.path, { ...store.get(ref.path), ...patch }),
      };
      return callback(tx);
    },
  };
  return {
    adminDb,
    adminAuth: {
      verifyIdToken: mockVerifyIdToken,
      createSessionCookie: mockCreateSessionCookie,
      getUser: mockGetUser,
      setCustomUserClaims: mockSetCustomUserClaims,
      revokeRefreshTokens: vi.fn(),
    },
    firebaseErrorCode: () => undefined,
  };
});

import { POST } from '@/app/api/auth/session/route';

const NOW_SECONDS = 1_800_000_000;

function token(overrides: Record<string, unknown> = {}) {
  return {
    uid: 'uid-1',
    email: 'someone@example.com',
    auth_time: NOW_SECONDS - 10,
    firebase: { sign_in_provider: 'password' },
    ...overrides,
  };
}

function request(cookie?: string): Request {
  return new Request('http://localhost/api/auth/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ idToken: 'x'.repeat(40) }),
  });
}

function seedUser(uid: string, email: string, theme: 'light' | 'dark' = 'light') {
  const doc = buildNewUserDoc({
    uid,
    email,
    authMethod: 'EMAIL_PASSWORD',
    lcNumber: null,
    displayName: 'Seeded Trainer',
    role: 'TRAINER',
    partnerCohortId: 'INTERNAL',
    divisionIds: ['INBOUND'],
    nowMs: 1,
  });
  doc.preferences.theme = theme;
  store.set(`users/${uid}`, doc as unknown as Record<string, unknown>);
  return doc;
}

beforeEach(() => {
  store.clear();
  invites.length = 0;
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW_SECONDS * 1000));
  mockCreateSessionCookie.mockResolvedValue('session-cookie');
  mockGetUser.mockResolvedValue({ customClaims: {} });
  mockSetCustomUserClaims.mockResolvedValue(undefined);
  delete process.env.INITIAL_SUPER_ADMIN_EMAILS;
  process.env.ALLOWED_GOOGLE_WORKSPACE_DOMAINS = 'logicall.io';
});

afterEach(() => {
  vi.useRealTimers();
});

describe('POST /api/auth/session provisioning', () => {
  it('refuses an un-invited email/password account with INVITE_REQUIRED and writes no user', async () => {
    mockVerifyIdToken.mockResolvedValue(token());
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe('INVITE_REQUIRED');
    expect(store.has('users/uid-1')).toBe(false);
  });

  it('refuses an un-invited LC ID account', async () => {
    mockVerifyIdToken.mockResolvedValue(token({ email: 'lc-9999@roster.logicall.internal' }));
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe('INVITE_REQUIRED');
  });

  function pushInvite(email = 'someone@example.com') {
    invites.push({
      id: 'invite-1',
      data: {
        email, lcNumber: null, displayName: 'Invited Agent', role: 'AGENT', partnerCohortId: 'THS',
        divisionIds: ['INBOUND'], status: 'PENDING', createdByUid: 'admin', claimedByUid: null, expiresAt: null, createdAt: 1, updatedAt: 1,
      },
    });
  }

  it('still provisions an invited email/password account with a verified email', async () => {
    pushInvite();
    mockVerifyIdToken.mockResolvedValue(token({ email_verified: true }));
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(store.get('users/uid-1')).toMatchObject({ role: 'AGENT', partnerCohortId: 'THS' });
    expect(store.get('rosterInvites/invite-1')).toMatchObject({ status: 'CLAIMED', claimedByUid: 'uid-1' });
  });

  it('refuses an invite claim from an unverified email/password account and leaves the invite pending', async () => {
    pushInvite();
    mockVerifyIdToken.mockResolvedValue(token({ email_verified: false }));
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe('EMAIL_NOT_VERIFIED');
    expect(store.has('users/uid-1')).toBe(false);
    expect(store.has('rosterInvites/invite-1')).toBe(false);
  });

  it('refuses an invite claim when the token has no email_verified flag', async () => {
    pushInvite('lc-9999@roster.logicall.internal');
    mockVerifyIdToken.mockResolvedValue(token({ email: 'lc-9999@roster.logicall.internal' }));
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe('EMAIL_NOT_VERIFIED');
    expect(store.has('users/uid-1')).toBe(false);
  });

  it('lets Google SSO claim an invite', async () => {
    pushInvite('partner@example.com');
    mockVerifyIdToken.mockResolvedValue(token({ email: 'partner@example.com', firebase: { sign_in_provider: 'google.com' } }));
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(store.get('users/uid-1')).toMatchObject({ role: 'AGENT', partnerCohortId: 'THS', authMethod: 'GOOGLE_SSO' });
  });

  it('still bootstraps an INITIAL_SUPER_ADMIN_EMAILS password account with a verified email', async () => {
    process.env.INITIAL_SUPER_ADMIN_EMAILS = 'someone@example.com';
    mockVerifyIdToken.mockResolvedValue(token({ email_verified: true }));
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(store.get('users/uid-1')).toMatchObject({ role: 'SUPER_ADMIN' });
  });

  it('refuses to bootstrap an INITIAL_SUPER_ADMIN_EMAILS password account with an unverified email', async () => {
    process.env.INITIAL_SUPER_ADMIN_EMAILS = 'someone@example.com';
    mockVerifyIdToken.mockResolvedValue(token({ email_verified: false }));
    const response = await POST(request());
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toBe('EMAIL_NOT_VERIFIED');
    expect(body.message).toMatch(/not verified/);
    expect(store.has('users/uid-1')).toBe(false);
    expect(mockSetCustomUserClaims).not.toHaveBeenCalled();
    expect(mockCreateSessionCookie).not.toHaveBeenCalled();
  });

  it('bootstraps an INITIAL_SUPER_ADMIN_EMAILS Google SSO account even off the approved domains', async () => {
    process.env.INITIAL_SUPER_ADMIN_EMAILS = 'owner@example.com';
    mockVerifyIdToken.mockResolvedValue(token({ email: 'owner@example.com', firebase: { sign_in_provider: 'google.com' } }));
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(store.get('users/uid-1')).toMatchObject({ role: 'SUPER_ADMIN' });
  });

  it('still self-provisions approved-domain Google SSO as an agent', async () => {
    mockVerifyIdToken.mockResolvedValue(token({ email: 'new@logicall.io', firebase: { sign_in_provider: 'google.com' } }));
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(store.get('users/uid-1')).toMatchObject({ role: 'AGENT', partnerCohortId: 'INTERNAL' });
  });

  it('signs in a seeded password user that already has a users doc', async () => {
    const doc = seedUser('uid-1', 'trainer@logicall.io');
    mockVerifyIdToken.mockResolvedValue(token({ email: 'trainer@logicall.io', ...claimsForUser(doc, true) }));
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect((await response.json()).refreshClaimsRequired).toBe(false);
  });
});

describe('POST /api/auth/session existing users skip the email check', () => {
  it('signs in an unverified seeded/imported user whose users doc already exists, even if listed as a bootstrap admin', async () => {
    process.env.INITIAL_SUPER_ADMIN_EMAILS = 'trainer@logicall.io';
    const doc = seedUser('uid-1', 'trainer@logicall.io');
    mockVerifyIdToken.mockResolvedValue(token({ email: 'trainer@logicall.io', email_verified: false, ...claimsForUser(doc, true) }));
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(store.get('users/uid-1')).toMatchObject({ role: 'TRAINER' });
  });
});

describe('POST /api/auth/session theme cookie', () => {
  it('sets pulse-theme from the saved preference when the browser has none', async () => {
    const doc = seedUser('uid-1', 'trainer@logicall.io', 'dark');
    mockVerifyIdToken.mockResolvedValue(token({ email: 'trainer@logicall.io', ...claimsForUser(doc, true) }));
    const response = await POST(request());
    expect(response.headers.get('set-cookie')).toContain('pulse-theme=dark');
  });

  it('keeps an existing pulse-theme cookie', async () => {
    const doc = seedUser('uid-1', 'trainer@logicall.io', 'dark');
    mockVerifyIdToken.mockResolvedValue(token({ email: 'trainer@logicall.io', ...claimsForUser(doc, true) }));
    const response = await POST(request('pulse-theme=contrast'));
    expect(response.headers.get('set-cookie')).not.toContain('pulse-theme=');
  });
});
