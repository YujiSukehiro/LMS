import { NextResponse } from 'next/server';
import { canManageUser, manageDeniedReason, rolesWith } from '@/lib/auth/rbac';
import { adminDb } from '@/lib/firebase/admin';
import { jsonError, requireAuth } from '@/lib/firebase/auth-guard';
import { parseStoredUserDoc } from '@/lib/firebase/users';
import { recordAuditEvent } from '@/lib/services/audit';
import { simLimitResetsCollection } from '@/lib/services/simulation-engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Staff clear an agent's daily Verbal Practice count: runs started before now stop counting until midnight UTC.
 * Writes only `simLimitResets/{uid}` (server-only, deny-all rules) and an audit event; no session is changed.
 */
export async function POST(req: Request, { params }: { params: Promise<{ uid: string }> }): Promise<NextResponse> {
  const auth = await requireAuth(req, rolesWith('sims.resetDailyLimit'));
  if (!auth.ok) return auth.response;
  const actor = auth.user;
  const { uid } = await params;
  if (!uid || uid.includes('/')) return jsonError(404, 'NOT_FOUND', 'This user does not exist.');

  const snap = await adminDb.collection('users').doc(uid).get();
  if (!snap.exists) return jsonError(404, 'NOT_FOUND', 'This user does not exist.');
  const user = parseStoredUserDoc(uid, snap.data() ?? {});

  if (!canManageUser(actor, { uid, role: user.role, partnerCohortId: user.partnerCohortId, active: user.active }, 'sims.resetDailyLimit')) {
    const reason =
      uid === actor.uid
        ? 'You cannot reset your own practice count.'
        : actor.role === 'PARTNER_SUPERVISOR'
          ? 'You can reset practice counts only for active agents in your own Cohort.'
          : manageDeniedReason(actor.role, user.role);
    return jsonError(403, 'FORBIDDEN', reason);
  }

  const resetAt = Date.now();
  await simLimitResetsCollection().doc(uid).set({ resetAt, byUid: actor.uid, byRole: actor.role, partnerCohortId: user.partnerCohortId });
  await recordAuditEvent({
    type: 'sims.daily_limit_reset_by_staff',
    actorUid: actor.uid,
    actorRole: actor.role,
    targetUid: uid,
    partnerCohortId: user.partnerCohortId,
    at: resetAt,
  }).catch((error) => console.error('[roster/reset-practice-limit] audit write failed', error));

  return NextResponse.json({ ok: true, uid, resetAt }, { headers: { 'Cache-Control': 'no-store' } });
}
