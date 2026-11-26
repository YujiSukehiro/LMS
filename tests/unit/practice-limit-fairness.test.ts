import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PERMISSIONS, canManageUser } from '@/lib/auth/rbac';
import { buildNewUserDoc } from '@/lib/firebase/users';
import type { SimEvaluation } from '@/lib/schemas/analytics';
import type { SessionUser, UserRole } from '@/lib/schemas/domain';
import {
  dailyWindowStart,
  repeatMissHint,
  startOfUtcDayMs,
  summarizeDailySimUsage,
  uncountedRunCap,
} from '@/lib/services/sim-session-limits';

const h = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  users: new Map<string, Record<string, unknown>>(),
  resetSet: vi.fn(),
  audit: vi.fn(),
}));
vi.mock('@/lib/firebase/auth-guard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/firebase/auth-guard')>()),
  requireAuth: h.requireAuth,
}));
vi.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (name: string) => ({
      doc: (id: string) => ({
        get: async () => {
          const data = name === 'users' ? h.users.get(id) : undefined;
          return { exists: data !== undefined, data: () => data, get: (field: string) => data?.[field] };
        },
      }),
    }),
  },
}));
vi.mock('@/lib/services/simulation-engine', () => ({
  simLimitResetsCollection: () => ({ doc: (id: string) => ({ set: (data: unknown) => h.resetSet(id, data) }) }),
}));
vi.mock('@/lib/services/audit', () => ({ recordAuditEvent: h.audit }));

const { POST: resetPOST } = await import('@/app/api/roster/[uid]/reset-practice-limit/route');

const NOW = Date.UTC(2026, 10, 25, 21, 50);

describe('daily count: calls with fewer than 2 replies do not count', () => {
  it("counts Jordan's Nov 25 day as 13, not 15 (two one-reply runs excluded)", () => {
    const turns = [8, 6, 4, 4, 7, 8, 2, 3, 2, 1, 2, 2, 1, 3, 2];
    const docs = turns.map((turnCount, i) => ({ userId: 'jordan', status: 'EVALUATED', turnCount, startedAt: NOW - (15 - i) * 60_000 }));
    expect(summarizeDailySimUsage(docs, 'jordan', startOfUtcDayMs(NOW), null)).toEqual({ counted: 13, withDialogue: 15, resetAt: null });
  });

  it('ignores other users and runs before the window', () => {
    const docs = [
      { userId: 'a', status: 'EVALUATED', turnCount: 3, startedAt: NOW - 1 },
      { userId: 'b', status: 'EVALUATED', turnCount: 3, startedAt: NOW - 1 },
      { userId: 'a', status: 'EVALUATED', turnCount: 3, startedAt: NOW - 10_000 },
    ];
    expect(summarizeDailySimUsage(docs, 'a', NOW - 5_000, NOW - 5_000).counted).toBe(1);
  });

  it('caps uncounted runs at 3x the limit', () => {
    expect(uncountedRunCap(15)).toBe(45);
  });
});

describe('staff reset window', () => {
  it('starts the count at a reset made today, and ignores resets from earlier days or the future', () => {
    const day = startOfUtcDayMs(NOW);
    expect(dailyWindowStart(NOW, null)).toBe(day);
    expect(dailyWindowStart(NOW, NOW - 1_000)).toBe(NOW - 1_000);
    expect(dailyWindowStart(NOW, day - 1)).toBe(day);
    expect(dailyWindowStart(NOW, NOW + 1_000)).toBe(day);
  });
});

function evaluation(passed: boolean, scores: Record<string, number>, patch: Partial<SimEvaluation> = {}): SimEvaluation {
  return {
    overallScorePct: passed ? 100 : 75,
    passed,
    autoFailedReason: null,
    dispositionCorrect: true,
    summaryFeedback: '',
    strengthsHighlighted: [],
    coachingImprovements: [],
    criterionResults: Object.entries(scores).map(([id, score]) => ({
      criterionId: id,
      competencyPillarId: 'p',
      criterionLabel: `Label ${id}`,
      score,
      agentQuoteEvidence: '',
      coachingNote: score < 100 ? `Note ${id}` : '',
      betterResponseExample: score < 100 ? `Example ${id}` : null,
    })),
    evaluatedAt: 1,
    ...patch,
  };
}

describe('hint after 3 failed tries on the same practice', () => {
  it('names the criterion missed most often across the last 3 fails', () => {
    const hint = repeatMissHint([
      evaluation(false, { r1: 50, r2: 100, r3: 100 }),
      evaluation(false, { r1: 50, r2: 50, r3: 100 }),
      evaluation(false, { r1: 50, r2: 100, r3: 100 }),
    ]);
    expect(hint).toEqual({ failedTries: 3, criterionLabel: 'Label r1', coachingNote: 'Note r1', betterResponseExample: 'Example r1' });
  });

  it('never points at a rule the learner got right on the latest try', () => {
    const hint = repeatMissHint([
      evaluation(false, { r1: 100, r2: 50 }),
      evaluation(false, { r1: 50, r2: 100 }),
      evaluation(false, { r1: 50, r2: 100 }),
    ]);
    expect(hint?.criterionLabel).toBe('Label r2');
  });

  it('shows nothing before the third fail in a row, or when a pass breaks the streak', () => {
    expect(repeatMissHint([evaluation(false, { r1: 50 }), evaluation(false, { r1: 50 })])).toBeNull();
    expect(repeatMissHint([evaluation(false, { r1: 50 }), evaluation(false, { r1: 50 }), evaluation(true, { r1: 100 }), evaluation(false, { r1: 50 })])).toBeNull();
    expect(repeatMissHint([evaluation(true, { r1: 100 }), evaluation(false, { r1: 50 }), evaluation(false, { r1: 50 }), evaluation(false, { r1: 50 })])).toBeNull();
  });

  it('reports the full streak length and falls back to the eligibility reason when every criterion was met', () => {
    const tooShort = evaluation(false, { r1: 100 }, {
      assessmentEligibility: { eligible: false, reasons: ['Send at least 2 verbal replies before grading.'], minimumEvidenceMet: false, dispositionValid: true, deterministicCriticalFailure: false },
    });
    const hint = repeatMissHint([tooShort, tooShort, tooShort, tooShort]);
    expect(hint).toEqual({ failedTries: 4, criterionLabel: null, coachingNote: 'Send at least 2 verbal replies before grading.', betterResponseExample: null });
  });
});

describe('reset permission (RBAC matrix)', () => {
  const user = (uid: string, role: UserRole, cohort = 'TELEHEALTH_OUTBOUND', active = true) => ({ uid, role, partnerCohortId: cohort, active });

  it('is granted to Super Admin, Admin, Trainer and Partner Supervisor, never Agents', () => {
    expect(PERMISSIONS['sims.resetDailyLimit'].roles).toEqual(['SUPER_ADMIN', 'ADMIN', 'TRAINER', 'PARTNER_SUPERVISOR']);
  });

  it('limits supervisors to active agents in their own Cohort, and Trainers to roles below them', () => {
    const sup = user('sup', 'PARTNER_SUPERVISOR');
    expect(canManageUser(sup, user('a', 'AGENT'), 'sims.resetDailyLimit')).toBe(true);
    expect(canManageUser(sup, user('a', 'AGENT', 'OTHER'), 'sims.resetDailyLimit')).toBe(false);
    expect(canManageUser(sup, user('a', 'AGENT', 'TELEHEALTH_OUTBOUND', false), 'sims.resetDailyLimit')).toBe(false);
    expect(canManageUser(sup, user('s2', 'PARTNER_SUPERVISOR'), 'sims.resetDailyLimit')).toBe(false);
    const trainer = user('t', 'TRAINER', 'LOGICALL_INTERNAL');
    expect(canManageUser(trainer, user('a', 'AGENT', 'ANY'), 'sims.resetDailyLimit')).toBe(true);
    expect(canManageUser(trainer, user('s', 'PARTNER_SUPERVISOR', 'ANY'), 'sims.resetDailyLimit')).toBe(true);
    expect(canManageUser(trainer, user('t2', 'TRAINER', 'LOGICALL_INTERNAL'), 'sims.resetDailyLimit')).toBe(false);
    expect(canManageUser(user('agent', 'AGENT'), user('a', 'AGENT'), 'sims.resetDailyLimit')).toBe(false);
  });
});

describe('POST /api/roster/[uid]/reset-practice-limit', () => {
  const actor = (role: UserRole, cohort = 'TELEHEALTH_OUTBOUND'): SessionUser =>
    ({ uid: `actor-${role}`, role, partnerCohortId: cohort, email: 'x@logicall.io', displayName: 'Actor', divisionIds: ['TELEHEALTH'] }) as unknown as SessionUser;
  const call = (uid: string) => resetPOST(new Request(`http://localhost/api/roster/${uid}/reset-practice-limit`, { method: 'POST' }), { params: Promise.resolve({ uid }) });
  const seed = (uid: string, role: UserRole, cohort: string, active = true) => {
    const doc = buildNewUserDoc({ uid, email: `${uid}@logicall.io`, authMethod: 'EMAIL_PASSWORD', lcNumber: null, displayName: uid, role, partnerCohortId: cohort, divisionIds: ['TELEHEALTH'], nowMs: 1 });
    h.users.set(uid, { ...doc, active });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    h.users.clear();
    h.audit.mockResolvedValue(undefined);
    seed('agent-1', 'AGENT', 'TELEHEALTH_OUTBOUND');
    seed('agent-other', 'AGENT', 'OTHER_COHORT');
  });

  it("lets a supervisor reset an agent in their own Cohort: writes the reset marker and an audit event, nothing else", async () => {
    h.requireAuth.mockResolvedValue({ ok: true, user: actor('PARTNER_SUPERVISOR') });
    const response = await call('agent-1');
    expect(response.status).toBe(200);
    expect(h.resetSet).toHaveBeenCalledWith('agent-1', expect.objectContaining({ resetAt: expect.any(Number), byRole: 'PARTNER_SUPERVISOR' }));
    expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({ type: 'sims.daily_limit_reset_by_staff', targetUid: 'agent-1' }));
  });

  it("refuses a supervisor for another Cohort's agent", async () => {
    h.requireAuth.mockResolvedValue({ ok: true, user: actor('PARTNER_SUPERVISOR') });
    const response = await call('agent-other');
    expect(response.status).toBe(403);
    expect(h.resetSet).not.toHaveBeenCalled();
  });

  it('lets a Trainer reset an agent in any Cohort', async () => {
    h.requireAuth.mockResolvedValue({ ok: true, user: actor('TRAINER', 'LOGICALL_INTERNAL') });
    expect((await call('agent-other')).status).toBe(200);
  });

  it('returns 404 for an unknown user and passes through an auth refusal', async () => {
    h.requireAuth.mockResolvedValue({ ok: true, user: actor('TRAINER', 'LOGICALL_INTERNAL') });
    expect((await call('nobody')).status).toBe(404);
    h.requireAuth.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) });
    expect((await call('agent-1')).status).toBe(403);
    expect(h.resetSet).not.toHaveBeenCalled();
  });
});
