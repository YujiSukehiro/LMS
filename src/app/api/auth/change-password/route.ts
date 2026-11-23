/**
 * POST /api/auth/change-password — the signed-in user sets their own password (after a temporary one).
 * Clears the must-change-password claim and revokes other sessions; the browser then signs in again with the new
 * password to get a fresh session. Body: { newPassword }.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { adminAuth, adminDb } from '@/lib/firebase/admin';
import { jsonError, requireAuth } from '@/lib/firebase/auth-guard';
import { setMustChangePassword } from '@/lib/firebase/users';
import { recordAuditEvent } from '@/lib/services/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NEW_PASSWORD_MIN = 10;

const BodySchema = z
  .object({
    newPassword: z
      .string()
      .min(NEW_PASSWORD_MIN, `Use at least ${NEW_PASSWORD_MIN} characters.`)
      .max(128, 'Use 128 characters or fewer.'),
  })
  .strict();

export async function POST(req: Request): Promise<NextResponse> {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const user = auth.user;
  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, 'VALIDATION_FAILED', parsed.error.issues[0]?.message ?? 'The password is not valid.');

  try {
    await adminAuth.updateUser(user.uid, { password: parsed.data.newPassword });
    await setMustChangePassword(user.uid, false);
    await adminAuth.revokeRefreshTokens(user.uid);
    await adminDb.collection('users').doc(user.uid).update({ updatedAt: Date.now() });
  } catch (error) {
    console.error('[auth/change-password] update failed', error);
    return jsonError(500, 'CHANGE_FAILED', 'The new password could not be saved. Try again.');
  }
  await recordAuditEvent({
    type: 'password.changed_by_user',
    actorUid: user.uid,
    actorRole: user.role,
    targetUid: user.uid,
    partnerCohortId: user.partnerCohortId,
  }).catch((error) => console.error('[auth/change-password] audit write failed', error));
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}
