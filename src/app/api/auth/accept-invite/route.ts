/**
 * POST /api/auth/accept-invite — first-time setup from a one-time invite link: create an email/password
 * account with exactly the role, Cohort and Divisions the admin chose, and consume the invite.
 * Public by design; the 256-bit link token is the proof the admin sent this person the invite.
 */
import { NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminAuth, adminDb, firebaseErrorCode } from '@/lib/firebase/admin';
import { jsonError } from '@/lib/firebase/auth-guard';
import { buildNewUserDoc, claimsForUser } from '@/lib/firebase/users';
import { AcceptInviteRequestSchema, AcceptInviteResponseSchema } from '@/lib/schemas/api';
import { RosterInviteDocSchema } from '@/lib/schemas/domain';
import { clientKey, joinCodeLimiter } from '@/lib/services/attempt-limiter';
import { findInviteByToken, INVITE_LOOKUP_MESSAGES } from '@/lib/services/invite-lookup';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

class InviteConsumedError extends Error {}

export async function POST(req: Request): Promise<NextResponse> {
  const client = clientKey(req);
  if (!joinCodeLimiter.allowed(client)) {
    const response = jsonError(429, 'RATE_LIMITED', 'Too many attempts. Wait a few minutes, then try again.');
    response.headers.set('Retry-After', String(joinCodeLimiter.retryAfterSeconds(client)));
    return response;
  }
  const parsed = AcceptInviteRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return jsonError(400, 'VALIDATION_FAILED', parsed.error.issues[0]?.message ?? 'The request is not valid.');
  }

  const lookup = await findInviteByToken(parsed.data.token);
  if (!lookup.ok) {
    if (lookup.reason === 'invalid') joinCodeLimiter.recordFailure(client);
    return jsonError(lookup.reason === 'invalid' ? 404 : 410, `INVITE_${lookup.reason.toUpperCase()}`, INVITE_LOOKUP_MESSAGES[lookup.reason]);
  }
  const invite = lookup.invite;
  if (!invite.email) return jsonError(400, 'INVITE_INVALID', INVITE_LOOKUP_MESSAGES.invalid);

  let uid: string;
  try {
    const record = await adminAuth.createUser({
      email: invite.email,
      password: parsed.data.password,
      displayName: invite.displayName,
      // Possession of the one-time link sent to this address is the ownership proof.
      emailVerified: true,
    });
    uid = record.uid;
  } catch (error) {
    const code = firebaseErrorCode(error);
    if (code === 'auth/email-already-exists') {
      return jsonError(409, 'ACCOUNT_EXISTS', 'An account already exists for this email. Use Sign In (or Continue with Google) instead.');
    }
    if (code === 'auth/invalid-password') return jsonError(400, 'VALIDATION_FAILED', 'Use a stronger password (8 characters or more).');
    console.error('[auth/accept-invite] createUser failed', error);
    return jsonError(500, 'ACCEPT_FAILED', 'Your account could not be created. Try again.');
  }

  try {
    const userDoc = buildNewUserDoc({
      uid,
      email: invite.email,
      authMethod: 'EMAIL_PASSWORD',
      lcNumber: invite.lcNumber,
      displayName: invite.displayName,
      role: invite.role,
      partnerCohortId: invite.partnerCohortId,
      divisionIds: invite.divisionIds,
    });
    await adminAuth.setCustomUserClaims(uid, claimsForUser(userDoc, true));
    const inviteRef = adminDb.collection('rosterInvites').doc(invite.id);
    await adminDb.runTransaction(async (tx) => {
      const fresh = await tx.get(inviteRef);
      const current = RosterInviteDocSchema.safeParse({ id: fresh.id, ...fresh.data() });
      if (!fresh.exists || !current.success || current.data.status !== 'PENDING' || current.data.setupTokenHash !== invite.setupTokenHash) {
        throw new InviteConsumedError();
      }
      tx.create(adminDb.collection('users').doc(uid), userDoc);
      tx.update(inviteRef, { status: 'CLAIMED', claimedByUid: uid, setupTokenHash: null, updatedAt: Date.now() });
      if (userDoc.role === 'AGENT') {
        tx.update(adminDb.collection('cohorts').doc(invite.partnerCohortId), {
          activeAgentCount: FieldValue.increment(1),
          updatedAt: Date.now(),
        });
      }
    });
  } catch (error) {
    await adminAuth.deleteUser(uid).catch((cleanupError: unknown) => {
      console.error('[auth/accept-invite] cleanup of new Auth account failed', cleanupError);
    });
    if (error instanceof InviteConsumedError) {
      return jsonError(410, 'INVITE_USED', INVITE_LOOKUP_MESSAGES.used);
    }
    console.error('[auth/accept-invite] provisioning failed', error);
    return jsonError(500, 'ACCEPT_FAILED', 'Your account could not be created. Try again.');
  }

  return NextResponse.json(AcceptInviteResponseSchema.parse({ ok: true, emailForSignIn: invite.email }), {
    headers: { 'Cache-Control': 'no-store' },
  });
}
