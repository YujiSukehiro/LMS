import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildNewUserDoc } from '@/lib/firebase/users';
import type { CohortDoc, SessionUser, UserDoc } from '@/lib/schemas/domain';

type DocData = Record<string, unknown>;

const { store, adminDb, activeActor, mockUpdateUser, mockRevokeRefreshTokens, mockWriteCustomClaims, mockSetMustChange, mockAudit } = vi.hoisted(() => {
  const store = new Map<string, DocData>();

  const applyPatch = (target: DocData, patch: DocData): DocData => {
    const next = structuredClone(target);
    for (const [key, value] of Object.entries(patch)) {
      if (typeof value === 'object' && value !== null && '__arrayRemove' in value) {
        const removed = (value as { __arrayRemove: unknown[] }).__arrayRemove;
        const prev = Array.isArray(next[key]) ? (next[key] as unknown[]) : [];
        next[key] = prev.filter((item) => !removed.includes(item));
      } else if (typeof value === 'object' && value !== null && '__increment' in value) {
        const delta = (value as { __increment: number }).__increment;
        const prev = typeof next[key] === 'number' ? (next[key] as number) : 0;
        next[key] = prev + delta;
      } else {
        next[key] = structuredClone(value);
      }
    }
    return next;
  };

  let autoId = 0;
  const makeRef = (path: string) => {
    const id = path.split('/').pop()!;
    const ref = {
      id,
      path,
      get: async () => {
        const data = store.get(path);
        return {
          id,
          ref,
          exists: data !== undefined,
          data: () => (data ? structuredClone(data) : undefined),
          get: (field: string) => (data ? data[field] : undefined),
        };
      },
      create: async (data: DocData) => {
        if (store.has(path)) throw new Error(`Already exists: ${path}`);
        store.set(path, structuredClone(data));
      },
      update: async (patch: DocData) => {
        const prev = store.get(path);
        if (!prev) throw new Error(`Missing: ${path}`);
        store.set(path, applyPatch(prev, patch));
      },
    };
    return ref;
  };

  type Filter = { field: string; op: string; value: unknown };
  const matches = (data: DocData, f: Filter) =>
    f.op === 'array-contains' ? Array.isArray(data[f.field]) && (data[f.field] as unknown[]).includes(f.value) : data[f.field] === f.value;
  const runQuery = (name: string, filters: Filter[]) => {
    const prefix = `${name}/`;
    const docs = [...store.entries()]
      .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
      .filter(([, data]) => filters.every((f) => matches(data, f)))
      .map(([path, data]) => {
        const ref = makeRef(path);
        return {
          id: ref.id,
          ref,
          exists: true,
          data: () => structuredClone(data),
          get: (field: string) => data[field],
        };
      });
    return { docs, empty: docs.length === 0, size: docs.length };
  };

  const adminDb = {
    collection: (name: string) => {
      const queryFor = (filters: Filter[]): Record<string, unknown> => ({
        where: (field: string, op: string, value: unknown) => queryFor([...filters, { field, op, value }]),
        limit: () => ({ get: async () => runQuery(name, filters) }),
        count: () => ({ get: async () => ({ data: () => ({ count: runQuery(name, filters).size }) }) }),
        get: async () => runQuery(name, filters),
      });
      return {
        doc: (id?: string) => makeRef(`${name}/${id ?? `auto_${++autoId}`}`),
        where: (field: string, op: string, value: unknown) => queryFor([{ field, op, value }]),
        get: async () => runQuery(name, []),
      };
    },
    batch: () => {
      const ops: Array<() => Promise<void>> = [];
      return {
        create: (ref: ReturnType<typeof makeRef>, data: DocData) => {
          ops.push(() => ref.create(data));
        },
        update: (ref: ReturnType<typeof makeRef>, patch: DocData) => {
          ops.push(() => ref.update(patch));
        },
        delete: (ref: ReturnType<typeof makeRef>) => {
          ops.push(async () => {
            store.delete(ref.path);
          });
        },
        commit: async () => {
          for (const op of ops) await op();
        },
      };
    },
    runTransaction: async <T>(fn: (tx: {
      get: (ref: ReturnType<typeof makeRef>) => ReturnType<ReturnType<typeof makeRef>['get']>;
      update: (ref: ReturnType<typeof makeRef>, patch: DocData) => void;
    }) => Promise<T>): Promise<T> => {
      const tx = {
        get: (ref: ReturnType<typeof makeRef>) => ref.get(),
        update: (ref: ReturnType<typeof makeRef>, patch: DocData) => {
          const prev = store.get(ref.path);
          if (!prev) throw new Error(`Missing: ${ref.path}`);
          store.set(ref.path, applyPatch(prev, patch));
        },
      };
      return fn(tx);
    },
  };

  return {
    store,
    adminDb,
    activeActor: {
      current: {
        uid: 'admin-1',
        email: 'ops.admin@logicall.io',
        displayName: 'Avery Collins',
        role: 'ADMIN',
        partnerCohortId: 'INTERNAL',
        divisionIds: ['TELEHEALTH', 'INBOUND'],
        active: true,
      } as SessionUser,
    },
    mockUpdateUser: vi.fn(async () => undefined),
    mockRevokeRefreshTokens: vi.fn(async () => undefined),
    mockWriteCustomClaims: vi.fn(async () => undefined),
    mockSetMustChange: vi.fn(async () => undefined),
    mockAudit: vi.fn(async () => undefined),
  };
});

vi.mock('@/lib/services/audit', () => ({ recordAuditEvent: mockAudit }));

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    increment: (n: number) => ({ __increment: n }),
    arrayRemove: (...items: unknown[]) => ({ __arrayRemove: items }),
  },
}));

vi.mock('@/lib/firebase/admin', () => ({
  adminDb,
  adminAuth: {
    updateUser: mockUpdateUser,
    revokeRefreshTokens: mockRevokeRefreshTokens,
  },
  firebaseErrorCode: () => undefined,
}));

vi.mock('@/lib/firebase/auth-guard', async () => {
  const actual = await vi.importActual<typeof import('@/lib/firebase/auth-guard')>('@/lib/firebase/auth-guard');
  return {
    ...actual,
    requireAuth: vi.fn(async (_req: Request, allowed?: readonly string[]) => {
      const user = activeActor.current;
      if (allowed && !allowed.includes(user.role)) {
        return { ok: false as const, response: actual.jsonError(403, 'FORBIDDEN', 'Denied.') };
      }
      return { ok: true as const, user };
    }),
  };
});

vi.mock('@/lib/firebase/users', async () => {
  const actual = await vi.importActual<typeof import('@/lib/firebase/users')>('@/lib/firebase/users');
  return {
    ...actual,
    writeCustomClaims: mockWriteCustomClaims,
    setMustChangePassword: mockSetMustChange,
  };
});

import { PATCH as patchPermissions } from '@/app/api/roster/[uid]/permissions/route';
import { POST as postResetPassword } from '@/app/api/roster/[uid]/reset-password/route';
import { POST as postCreateInvite } from '@/app/api/roster/invites/route';
import { PATCH as patchRevokeInvite } from '@/app/api/roster/invites/[inviteId]/route';
import { POST as postCreateCohort } from '@/app/api/roster/cohorts/route';
import { POST as postBootstrapCohorts } from '@/app/api/roster/cohorts/bootstrap/route';
import { DELETE as deleteCohort, PATCH as patchUpdateCohort } from '@/app/api/roster/cohorts/[cohortId]/route';
import { PATCH as patchStatus } from '@/app/api/roster/[uid]/status/route';

function seedCohort(id: string, name: string, overrides: Partial<CohortDoc> = {}) {
  const doc: CohortDoc = {
    id,
    name,
    isInternal: id === 'INTERNAL',
    defaultDivisionIds: ['TELEHEALTH'],
    activeAgentCount: 0,
    joinCode: id === 'INTERNAL' ? null : `${id}-1234`,
    joinCodeEnabled: id !== 'INTERNAL',
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
  store.set(`cohorts/${id}`, doc as unknown as DocData);
}

function seedUser(uid: string, overrides: Partial<UserDoc> = {}) {
  const doc = buildNewUserDoc({
    uid,
    email: overrides.email ?? `${uid}@example.com`,
    authMethod: overrides.authMethod ?? 'LC_ID_PASSWORD',
    lcNumber: overrides.lcNumber === undefined ? 'LC-1044' : overrides.lcNumber,
    displayName: overrides.displayName ?? 'Ana Ruiz',
    role: overrides.role ?? 'AGENT',
    partnerCohortId: overrides.partnerCohortId ?? 'THS',
    divisionIds: overrides.divisionIds ?? ['TELEHEALTH'],
    nowMs: 1000,
  });
  store.set(`users/${uid}`, { ...doc, ...overrides } as unknown as DocData);
}

describe('Roster RBAC & Cohort admin routes', () => {
  beforeEach(() => {
    store.clear();
    mockUpdateUser.mockClear();
    mockRevokeRefreshTokens.mockClear();
    mockWriteCustomClaims.mockClear();
    mockSetMustChange.mockClear();
    mockAudit.mockClear();
    activeActor.current = {
      uid: 'admin-1',
      email: 'ops.admin@logicall.io',
      displayName: 'Avery Collins',
      role: 'ADMIN',
      partnerCohortId: 'INTERNAL',
      divisionIds: ['TELEHEALTH', 'INBOUND'],
      active: true,
    };
    seedCohort('INTERNAL', 'LogiCall Internal', { defaultDivisionIds: ['TELEHEALTH', 'INBOUND', 'OUTBOUND'] });
    seedCohort('THS', 'THS (Nicaragua)', { activeAgentCount: 2 });
    seedCohort('DOZ', 'DOZ', { activeAgentCount: 1, defaultDivisionIds: ['INBOUND'] });
    seedUser('agent-1', { partnerCohortId: 'THS', role: 'AGENT', lcNumber: 'LC-1044' });
    seedUser('admin-1', {
      email: 'ops.admin@logicall.io',
      authMethod: 'GOOGLE_SSO',
      lcNumber: null,
      displayName: 'Avery Collins',
      role: 'ADMIN',
      partnerCohortId: 'INTERNAL',
    });
    seedUser('super-1', {
      email: 'connor@logicall.io',
      authMethod: 'GOOGLE_SSO',
      lcNumber: null,
      displayName: 'Connor',
      role: 'SUPER_ADMIN',
      partnerCohortId: 'INTERNAL',
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('promotes an Agent to Trainer, adjusts activeAgentCount, updates claims, and revokes sessions', async () => {
    const res = await patchPermissions(
      new Request('http://localhost/api/roster/agent-1/permissions', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          displayName: 'Ana Ruiz',
          role: 'TRAINER',
          partnerCohortId: 'INTERNAL',
          divisionIds: ['TELEHEALTH', 'INBOUND'],
        }),
      }),
      { params: Promise.resolve({ uid: 'agent-1' }) },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; sessionRevoked: boolean; user: UserDoc };
    expect(body.ok).toBe(true);
    expect(body.sessionRevoked).toBe(true);
    expect(body.user.role).toBe('TRAINER');
    expect(body.user.partnerCohortId).toBe('INTERNAL');
    expect(store.get('cohorts/THS')?.activeAgentCount).toBe(1);
    expect(store.get('cohorts/INTERNAL')?.activeAgentCount).toBe(0);
    expect(mockWriteCustomClaims).toHaveBeenCalledWith(
      'agent-1',
      expect.objectContaining({ role: 'TRAINER', partnerCohortId: 'INTERNAL', active: true }),
    );
    expect(mockRevokeRefreshTokens).toHaveBeenCalledWith('agent-1');
  });

  it('moves an active Agent between Cohorts and transfers activeAgentCount cleanly', async () => {
    const res = await patchPermissions(
      new Request('http://localhost/api/roster/agent-1/permissions', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          role: 'AGENT',
          partnerCohortId: 'DOZ',
          divisionIds: ['INBOUND'],
        }),
      }),
      { params: Promise.resolve({ uid: 'agent-1' }) },
    );

    expect(res.status).toBe(200);
    expect(store.get('cohorts/THS')?.activeAgentCount).toBe(1);
    expect(store.get('cohorts/DOZ')?.activeAgentCount).toBe(2);
  });

  it('blocks non-Super-Admin from elevating or editing a Super Admin and blocks self-role changes', async () => {
    const escalateRes = await patchPermissions(
      new Request('http://localhost/api/roster/agent-1/permissions', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          role: 'SUPER_ADMIN',
          partnerCohortId: 'INTERNAL',
          divisionIds: ['TELEHEALTH'],
        }),
      }),
      { params: Promise.resolve({ uid: 'agent-1' }) },
    );
    expect(escalateRes.status).toBe(403);

    const selfRes = await patchPermissions(
      new Request('http://localhost/api/roster/admin-1/permissions', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          role: 'TRAINER',
          partnerCohortId: 'INTERNAL',
          divisionIds: ['TELEHEALTH'],
        }),
      }),
      { params: Promise.resolve({ uid: 'admin-1' }) },
    );
    expect(selfRes.status).toBe(400);
  });

  it('resets temporary password for LC-ID accounts and rejects Google SSO accounts', async () => {
    const okRes = await postResetPassword(
      new Request('http://localhost/api/roster/agent-1/reset-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ uid: 'agent-1' }) },
    );
    expect(okRes.status).toBe(200);
    const body = (await okRes.json()) as { loginIdentifier: string; temporaryPassword: string };
    expect(body.loginIdentifier).toBe('LC-1044');
    expect(body.temporaryPassword.length).toBeGreaterThanOrEqual(8);
    expect(mockUpdateUser).toHaveBeenCalledWith('agent-1', { password: body.temporaryPassword });
    expect(mockRevokeRefreshTokens).toHaveBeenCalledWith('agent-1');

    const ssoRes = await postResetPassword(
      new Request('http://localhost/api/roster/super-1/reset-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ uid: 'super-1' }) },
    );
    expect(ssoRes.status).toBe(403);

    activeActor.current = { ...activeActor.current, uid: 'super-1', role: 'SUPER_ADMIN' };
    const ssoAsSuper = await postResetPassword(
      new Request('http://localhost/api/roster/admin-1/reset-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ uid: 'admin-1' }) },
    );
    expect(ssoAsSuper.status).toBe(400);
  });

  it('makes a reset agent choose a new password and records the reset (QA H3)', async () => {
    const res = await postResetPassword(
      new Request('http://localhost/api/roster/agent-1/reset-password', { method: 'POST', body: JSON.stringify({}) }),
      { params: Promise.resolve({ uid: 'agent-1' }) },
    );
    expect(res.status).toBe(200);
    expect(mockSetMustChange).toHaveBeenCalledWith('agent-1', true);
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'password.reset_by_staff', actorUid: 'admin-1', targetUid: 'agent-1', partnerCohortId: 'THS' }),
    );
  });

  it('lets a partner supervisor reset only active agents in their own Cohort (QA H3)', async () => {
    seedUser('agent-doz', { partnerCohortId: 'DOZ', role: 'AGENT', lcNumber: 'LC-1050' });
    seedUser('agent-off', { partnerCohortId: 'THS', role: 'AGENT', lcNumber: 'LC-1049', active: false });
    seedUser('sup-2', { partnerCohortId: 'THS', role: 'PARTNER_SUPERVISOR', lcNumber: 'LC-2009' });
    activeActor.current = { ...activeActor.current, uid: 'sup-ths', role: 'PARTNER_SUPERVISOR', partnerCohortId: 'THS' };
    const reset = (uid: string) =>
      postResetPassword(new Request(`http://localhost/api/roster/${uid}/reset-password`, { method: 'POST', body: JSON.stringify({}) }), {
        params: Promise.resolve({ uid }),
      });
    expect((await reset('agent-1')).status).toBe(200);
    expect((await reset('agent-doz')).status).toBe(403);
    expect((await reset('agent-off')).status).toBe(403);
    expect((await reset('sup-2')).status).toBe(403);
  });

  it('refuses Trainer, Admin or Super Admin outside the internal Cohort (QA M3)', async () => {
    const res = await patchPermissions(
      new Request('http://localhost/api/roster/agent-1/permissions', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ displayName: 'Ana Ruiz', role: 'TRAINER', partnerCohortId: 'DOZ', divisionIds: ['INBOUND'] }),
      }),
      { params: Promise.resolve({ uid: 'agent-1' }) },
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('ROLE_COHORT_MISMATCH');

    const invite = await postCreateInvite(
      new Request('http://localhost/api/roster/invites', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'new.trainer@partner.com', displayName: 'New Trainer', role: 'TRAINER', partnerCohortId: 'THS', divisionIds: ['TELEHEALTH'] }),
      }),
    );
    expect(invite.status).toBe(400);
    expect(((await invite.json()) as { error: string }).error).toBe('ROLE_COHORT_MISMATCH');
  });

  it('creates pending email invites, rejects duplicates, and revokes invites cleanly', async () => {
    const createRes = await postCreateInvite(
      new Request('http://localhost/api/roster/invites', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          displayName: 'QA Trainer',
          email: 'qa.trainer@logicall.io',
          role: 'TRAINER',
          partnerCohortId: 'INTERNAL',
          divisionIds: ['TELEHEALTH'],
          expiresInDays: 14,
        }),
      }),
    );
    expect(createRes.status).toBe(200);
    const created = (await createRes.json()) as { invite: { id: string; status: string } };
    expect(created.invite.status).toBe('PENDING');

    const duplicateUserRes = await postCreateInvite(
      new Request('http://localhost/api/roster/invites', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          displayName: 'Existing',
          email: 'ops.admin@logicall.io',
          role: 'TRAINER',
          partnerCohortId: 'INTERNAL',
          divisionIds: ['TELEHEALTH'],
        }),
      }),
    );
    expect(duplicateUserRes.status).toBe(409);

    const revokeRes = await patchRevokeInvite(
      new Request(`http://localhost/api/roster/invites/${created.invite.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'REVOKED' }),
      }),
      { params: Promise.resolve({ inviteId: created.invite.id }) },
    );
    expect(revokeRes.status).toBe(200);
    expect(store.get(`rosterInvites/${created.invite.id}`)?.status).toBe('REVOKED');
  });

  it('creates partner Cohorts, rotates join codes, toggles join codes, and blocks INTERNAL join codes', async () => {
    const createRes = await postCreateCohort(
      new Request('http://localhost/api/roster/cohorts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: 'BPO_EAST',
          name: 'BPO East',
          defaultDivisionIds: ['TELEHEALTH'],
          joinCodeEnabled: true,
        }),
      }),
    );
    expect(createRes.status).toBe(200);
    const created = (await createRes.json()) as { cohort: CohortDoc };
    expect(created.cohort.joinCode).toMatch(/^BPOEAST-[2-9A-Z]{4}-[2-9A-Z]{4}$/);

    const rotateRes = await patchUpdateCohort(
      new Request('http://localhost/api/roster/cohorts/BPO_EAST', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'rotate_join_code' }),
      }),
      { params: Promise.resolve({ cohortId: 'BPO_EAST' }) },
    );
    expect(rotateRes.status).toBe(200);
    const rotated = (await rotateRes.json()) as { cohort: CohortDoc };
    expect(rotated.cohort.joinCode).not.toBe(created.cohort.joinCode);

    const internalBlock = await patchUpdateCohort(
      new Request('http://localhost/api/roster/cohorts/INTERNAL', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'toggle_join_code', enabled: true }),
      }),
      { params: Promise.resolve({ cohortId: 'INTERNAL' }) },
    );
    expect(internalBlock.status).toBe(400);
  });

  it('bootstraps missing default Cohorts idempotently without overwriting existing ones', async () => {
    const res = await postBootstrapCohorts(
      new Request('http://localhost/api/roster/cohorts/bootstrap', { method: 'POST' }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; createdIds: string[]; existingIds: string[] };
    expect(body.ok).toBe(true);
    expect(body.existingIds).toEqual(expect.arrayContaining(['INTERNAL', 'THS', 'DOZ']));
    expect(body.createdIds).toEqual(expect.arrayContaining(['NGA', 'ZIM', 'MRR', 'CALL_CORE', 'LATAM_DIRECT']));
    expect(store.get('cohorts/THS')?.activeAgentCount).toBe(2);
    expect(store.get('cohorts/NGA')?.activeAgentCount).toBe(0);
    expect(String(store.get('cohorts/NGA')?.joinCode)).toMatch(/^NGA-[2-9A-Z]{4}-[2-9A-Z]{4}$/);
  });

  function asActor(role: SessionUser['role'], uid = role === 'SUPER_ADMIN' ? 'super-1' : 'admin-1') {
    activeActor.current = { ...activeActor.current, uid, role };
  }

  function accessRequest(uid: string, role: string, cohort = 'INTERNAL') {
    return patchPermissions(
      new Request(`http://localhost/api/roster/${uid}/permissions`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role, partnerCohortId: cohort, divisionIds: ['TELEHEALTH'] }),
      }),
      { params: Promise.resolve({ uid }) },
    );
  }

  it('enforces the role hierarchy: Admins cannot edit, promote to, reset or deactivate peers or higher roles', async () => {
    seedUser('admin-2', { email: 'peer.admin@logicall.io', authMethod: 'LC_ID_PASSWORD', lcNumber: 'LC-9002', role: 'ADMIN', partnerCohortId: 'INTERNAL' });
    seedUser('trainer-1', { email: 'trainer@logicall.io', authMethod: 'LC_ID_PASSWORD', lcNumber: 'LC-9003', role: 'TRAINER', partnerCohortId: 'INTERNAL' });

    expect((await accessRequest('admin-2', 'TRAINER')).status).toBe(403); // demote a peer
    expect((await accessRequest('trainer-1', 'ADMIN')).status).toBe(403); // promote to own level
    expect((await accessRequest('trainer-1', 'PARTNER_SUPERVISOR')).status).toBe(200); // below own level

    const resetPeer = await postResetPassword(
      new Request('http://localhost/api/roster/admin-2/reset-password', { method: 'POST', body: '{}' }),
      { params: Promise.resolve({ uid: 'admin-2' }) },
    );
    expect(resetPeer.status).toBe(403);

    const deactivatePeer = await patchStatus(
      new Request('http://localhost/api/roster/admin-2/status', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ active: false }),
      }),
      { params: Promise.resolve({ uid: 'admin-2' }) },
    );
    expect(deactivatePeer.status).toBe(403);
    expect(store.get('users/admin-2')?.active).toBe(true);

    const invitePeer = await postCreateInvite(
      new Request('http://localhost/api/roster/invites', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ displayName: 'Another Admin', email: 'another.admin@logicall.io', role: 'ADMIN', partnerCohortId: 'INTERNAL', divisionIds: ['TELEHEALTH'] }),
      }),
    );
    expect(invitePeer.status).toBe(403);

    asActor('SUPER_ADMIN');
    expect((await accessRequest('admin-2', 'TRAINER')).status).toBe(200);
  });

  it('keeps Trainers, Supervisors and Agents out of every roster mutation', async () => {
    for (const role of ['TRAINER', 'PARTNER_SUPERVISOR', 'AGENT'] as const) {
      asActor(role, `${role.toLowerCase()}-actor`);
      expect((await accessRequest('agent-1', 'AGENT', 'THS')).status).toBe(403);
      const del = await deleteCohort(new Request('http://localhost/api/roster/cohorts/DOZ', { method: 'DELETE' }), {
        params: Promise.resolve({ cohortId: 'DOZ' }),
      });
      expect(del.status).toBe(403);
    }
  });

  it('deletes only empty Cohorts and detaches them from multi-Cohort Tracks', async () => {
    const del = (id: string) =>
      deleteCohort(new Request(`http://localhost/api/roster/cohorts/${id}`, { method: 'DELETE' }), { params: Promise.resolve({ cohortId: id }) });

    expect((await del('INTERNAL')).status).toBe(400);
    expect((await del('NOPE')).status).toBe(404);

    const notEmpty = await del('THS'); // agent-1 belongs to THS
    expect(notEmpty.status).toBe(409);
    expect(((await notEmpty.json()) as { error: string }).error).toBe('COHORT_NOT_EMPTY');

    store.set('rosterInvites/inv-1', { id: 'inv-1', partnerCohortId: 'DOZ', status: 'PENDING' });
    expect(((await (await del('DOZ')).json()) as { error: string }).error).toBe('COHORT_HAS_INVITES');
    store.delete('rosterInvites/inv-1');

    store.set('tracks/solo', { id: 'solo', title: 'Solo Track', assignedCohortIds: ['DOZ'] });
    const solo = await del('DOZ');
    expect(solo.status).toBe(409);
    expect(((await solo.json()) as { error: string }).error).toBe('COHORT_ONLY_TRACK_ASSIGNMENT');

    store.set('tracks/solo', { id: 'solo', title: 'Solo Track', assignedCohortIds: ['DOZ', 'THS'] });
    const ok = await del('DOZ');
    expect(ok.status).toBe(200);
    expect(store.has('cohorts/DOZ')).toBe(false);
    expect(store.get('tracks/solo')?.assignedCohortIds).toEqual(['THS']);
  });
});
