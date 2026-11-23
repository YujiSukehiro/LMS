import { NextResponse } from 'next/server';
import { canManageUser, manageDeniedReason, rolesWith } from '@/lib/auth/rbac';
import { adminAuth, adminDb, firebaseErrorCode } from '@/lib/firebase/admin';
import { jsonError, requireAuth } from '@/lib/firebase/auth-guard';
import { generateTemporaryPassword, parseStoredUserDoc, setMustChangePassword } from '@/lib/firebase/users';
import { recordAuditEvent } from '@/lib/services/audit';
import { RosterResetPasswordRequestSchema, RosterResetPasswordResponseSchema } from '@/lib/schemas/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ uid: string }> }): Promise<NextResponse> {
  const auth = await requireAuth(req, rolesWith('users.resetPassword'));
  if (!auth.ok) return auth.response;
  const actor = auth.user;
  const { uid } = await params;

  const rawBody: unknown = await req.json().catch(() => ({}));
  const parsed = RosterResetPasswordRequestSchema.safeParse(rawBody ?? {});
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return jsonError(400, 'VALIDATION_FAILED', first ? first.message : 'Password must be 8 to 128 characters.');
  }

  const userRef = adminDb.collection('users').doc(uid);
  const snap = await userRef.get();
  if (!snap.exists) return jsonError(404, 'NOT_FOUND', 'This user does not exist.');
  const user = parseStoredUserDoc(uid, snap.data() ?? {});

  if (!canManageUser(actor, { uid, role: user.role, partnerCohortId: user.partnerCohortId, active: user.active }, 'users.resetPassword')) {
    const reason =
      uid === actor.uid
        ? 'Change your own password from the sign-in page.'
        : actor.role === 'PARTNER_SUPERVISOR'
          ? 'You can reset passwords only for active agents in your own Cohort.'
          : manageDeniedReason(actor.role, user.role);
    return jsonError(403, 'FORBIDDEN', reason);
  }
  if (user.authMethod === 'GOOGLE_SSO') {
    return jsonError(
      400,
      'GOOGLE_SSO_ACCOUNT',
      'This user signs in with Google Workspace SSO and does not have a Pulse password.',
    );
  }

  const temporaryPassword = parsed.data.newPassword ?? generateTemporaryPassword();

  try {
    await adminAuth.updateUser(uid, { password: temporaryPassword });
    // The agent must choose their own password at the next sign-in (the claim sends them to /account/new-password).
    await setMustChangePassword(uid, true);
    await adminAuth.revokeRefreshTokens(uid);
    await userRef.update({ updatedAt: Date.now() });
  } catch (error) {
    if (firebaseErrorCode(error) === 'auth/user-not-found') {
      return jsonError(404, 'AUTH_USER_NOT_FOUND', 'No Firebase Auth sign-in record was found for this user.');
    }
    console.error('[roster/reset-password] password update failed', error);
    return jsonError(500, 'RESET_FAILED', 'The temporary password could not be set. Try again.');
  }
  await recordAuditEvent({
    type: 'password.reset_by_staff',
    actorUid: actor.uid,
    actorRole: actor.role,
    targetUid: uid,
    partnerCohortId: user.partnerCohortId,
  }).catch((error) => console.error('[roster/reset-password] audit write failed', error));

  return NextResponse.json(
    RosterResetPasswordResponseSchema.parse({
      ok: true,
      uid,
      loginIdentifier: user.lcNumber ?? user.email,
      temporaryPassword,
    }),
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
