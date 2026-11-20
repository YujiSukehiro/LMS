import { NextResponse } from 'next/server';
import { adminAuth, adminDb, firebaseErrorCode } from '@/lib/firebase/admin';
import { jsonError, requireAuth } from '@/lib/firebase/auth-guard';
import { generateTemporaryPassword, parseStoredUserDoc } from '@/lib/firebase/users';
import { RosterResetPasswordRequestSchema, RosterResetPasswordResponseSchema } from '@/lib/schemas/api';
import { ROSTER_ADMIN_ROLES } from '@/lib/schemas/constants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ uid: string }> }): Promise<NextResponse> {
  const auth = await requireAuth(req, ROSTER_ADMIN_ROLES);
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

  if (user.role === 'SUPER_ADMIN' && actor.role !== 'SUPER_ADMIN') {
    return jsonError(403, 'FORBIDDEN', 'Only a Super Admin can reset a Super Admin password.');
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
    await adminAuth.revokeRefreshTokens(uid);
    await userRef.update({ updatedAt: Date.now() });
  } catch (error) {
    if (firebaseErrorCode(error) === 'auth/user-not-found') {
      return jsonError(404, 'AUTH_USER_NOT_FOUND', 'No Firebase Auth sign-in record was found for this user.');
    }
    console.error('[roster/reset-password] password update failed', error);
    return jsonError(500, 'RESET_FAILED', 'The temporary password could not be set. Try again.');
  }

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
