import { NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminAuth, adminDb, firebaseErrorCode } from '@/lib/firebase/admin';
import { jsonError, requireAuth } from '@/lib/firebase/auth-guard';
import { claimsForUser, parseStoredUserDoc, writeCustomClaims } from '@/lib/firebase/users';
import { RosterStatusRequestSchema } from '@/lib/schemas/api';
import { ROSTER_ADMIN_ROLES } from '@/lib/schemas/constants';
import type { UserDoc } from '@/lib/schemas/domain';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

class StatusError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ uid: string }> }): Promise<NextResponse> {
  const auth = await requireAuth(req, ROSTER_ADMIN_ROLES);
  if (!auth.ok) return auth.response;
  const actor = auth.user;
  const { uid } = await params;

  const body: unknown = await req.json().catch(() => null);
  const parsed = RosterStatusRequestSchema.safeParse(body);
  if (!parsed.success) return jsonError(400, 'VALIDATION_FAILED', 'Send { "active": true } or { "active": false }.');
  const { active } = parsed.data;

  if (uid === actor.uid) {
    return jsonError(400, 'CANNOT_CHANGE_SELF', 'You cannot change the status of your own account.');
  }

  // 1. Firestore is the source of truth: update the users doc and the Cohort counter atomically.
  let target: UserDoc;
  try {
    target = await adminDb.runTransaction(async (tx) => {
      const userRef = adminDb.collection('users').doc(uid);
      const snap = await tx.get(userRef);
      if (!snap.exists) throw new StatusError(404, 'NOT_FOUND', 'This user does not exist.');
      const user = parseStoredUserDoc(uid, snap.data() ?? {});
      if (user.role === 'SUPER_ADMIN' && actor.role !== 'SUPER_ADMIN') {
        throw new StatusError(403, 'FORBIDDEN', 'Only a Super Admin can change the status of a Super Admin.');
      }
      if (user.active === active) return user;

      const now = Date.now();
      const cohortRef = adminDb.collection('cohorts').doc(user.partnerCohortId);
      const cohortSnap = user.role === 'AGENT' ? await tx.get(cohortRef) : null;

      tx.update(userRef, { active, deactivatedAt: active ? null : now, updatedAt: now });
      if (cohortSnap?.exists) {
        const current = cohortSnap.get('activeAgentCount');
        const count = typeof current === 'number' ? current : 0;
        // Never let the counter go below zero.
        const delta = active ? 1 : count > 0 ? -1 : 0;
        if (delta !== 0) tx.update(cohortRef, { activeAgentCount: FieldValue.increment(delta), updatedAt: now });
      }
      return { ...user, active, deactivatedAt: active ? null : now, updatedAt: now };
    });
  } catch (error) {
    if (error instanceof StatusError) return jsonError(error.status, error.code, error.message);
    console.error('[roster/status] Firestore update failed', error);
    return jsonError(500, 'STATUS_UPDATE_FAILED', 'The status could not be changed. Try again.');
  }

  // 2. Sync Firebase Auth (idempotent, also repairs a partly applied earlier request).
  try {
    await writeCustomClaims(uid, claimsForUser(target, active));
    await adminAuth.updateUser(uid, { disabled: !active });
    if (!active) await adminAuth.revokeRefreshTokens(uid);
  } catch (error) {
    if (firebaseErrorCode(error) === 'auth/user-not-found') {
      // The Auth account no longer exists; the users doc already carries the correct status.
      return NextResponse.json({ ok: true, uid, active });
    }
    console.error('[roster/status] Auth sync failed', error);
    return jsonError(
      500,
      'AUTH_SYNC_FAILED',
      'The roster status changed, but sign-in access did not update. Send the same change again.',
    );
  }

  return NextResponse.json({ ok: true, uid, active }, { headers: { 'Cache-Control': 'no-store' } });
}
