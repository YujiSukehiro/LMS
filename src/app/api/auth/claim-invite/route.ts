import { NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminAuth, adminDb, firebaseErrorCode } from '@/lib/firebase/admin';
import { jsonError } from '@/lib/firebase/auth-guard';
import { lcNumberToEmail, normalizeLcNumber } from '@/lib/firebase/lc-id';
import { buildNewUserDoc, claimsForUser } from '@/lib/firebase/users';
import { ClaimInviteRequestSchema } from '@/lib/schemas/api';
import { CohortDocSchema } from '@/lib/schemas/domain';
import { clientKey, joinCodeLimiter } from '@/lib/services/attempt-limiter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

class LcNumberInUseError extends Error {}

export async function POST(req: Request): Promise<NextResponse> {
  const client = clientKey(req);
  if (!joinCodeLimiter.allowed(client)) {
    const response = jsonError(429, 'RATE_LIMITED', 'Too many wrong join codes. Wait a few minutes, then try again or ask your supervisor for the code.');
    response.headers.set('Retry-After', String(joinCodeLimiter.retryAfterSeconds(client)));
    return response;
  }
  const body: unknown = await req.json().catch(() => null);
  const parsed = ClaimInviteRequestSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return jsonError(400, 'VALIDATION_FAILED', first ? first.message : 'The request is not valid.');
  }

  const joinCode = parsed.data.joinCode.trim().toUpperCase();
  const lcNumber = normalizeLcNumber(parsed.data.lcNumber);
  const displayName = parsed.data.displayName.trim();
  if (!displayName) return jsonError(400, 'VALIDATION_FAILED', 'Type your full name.');
  const email = lcNumberToEmail(lcNumber);

  // 1. Find the Cohort that owns this join code.
  const cohortQuery = await adminDb.collection('cohorts').where('joinCode', '==', joinCode).limit(1).get();
  const cohortSnap = cohortQuery.docs[0];
  const cohortParsed = cohortSnap ? CohortDocSchema.safeParse({ id: cohortSnap.id, ...cohortSnap.data() }) : null;
  if (!cohortSnap || !cohortParsed?.success || !cohortParsed.data.joinCodeEnabled) {
    joinCodeLimiter.recordFailure(client);
    return jsonError(
      404,
      'INVALID_JOIN_CODE',
      'This join code is not valid or is no longer active. Ask your supervisor for the current code.',
    );
  }
  const cohort = cohortParsed.data;

  // 2. Reject an LC Number that is already in use.
  const lcInUse = await adminDb.collection('users').where('lcNumber', '==', lcNumber).limit(1).get();
  if (!lcInUse.empty) {
    return jsonError(409, 'LC_NUMBER_IN_USE', 'An account already uses this LC Number. Sign in instead, or contact your supervisor.');
  }

  // 3. Create the Auth account.
  let uid: string;
  try {
    const record = await adminAuth.createUser({ email, password: parsed.data.password, displayName, emailVerified: false });
    uid = record.uid;
  } catch (error) {
    const code = firebaseErrorCode(error);
    if (code === 'auth/email-already-exists') {
      return jsonError(409, 'LC_NUMBER_IN_USE', 'An account already uses this LC Number. Sign in instead, or contact your supervisor.');
    }
    if (code === 'auth/invalid-password') {
      return jsonError(400, 'VALIDATION_FAILED', 'Use a stronger password (8 characters or more).');
    }
    console.error('[auth/claim-invite] createUser failed', error);
    return jsonError(500, 'CLAIM_FAILED', 'Your account could not be created. Try again.');
  }

  // 4. Claims + users doc + Cohort counter. Remove the new Auth account if any step fails.
  try {
    const userDoc = buildNewUserDoc({
      uid,
      email,
      authMethod: 'LC_ID_PASSWORD',
      lcNumber,
      displayName,
      role: 'AGENT',
      partnerCohortId: cohort.id,
      divisionIds: cohort.defaultDivisionIds,
    });
    await adminAuth.setCustomUserClaims(uid, claimsForUser(userDoc, true));

    const userRef = adminDb.collection('users').doc(uid);
    await adminDb.runTransaction(async (tx) => {
      const duplicate = await tx.get(adminDb.collection('users').where('lcNumber', '==', lcNumber).limit(1));
      if (!duplicate.empty) throw new LcNumberInUseError();
      tx.create(userRef, userDoc);
      tx.update(cohortSnap.ref, { activeAgentCount: FieldValue.increment(1), updatedAt: Date.now() });
    });
  } catch (error) {
    await adminAuth.deleteUser(uid).catch((cleanupError: unknown) => {
      console.error('[auth/claim-invite] cleanup of new Auth account failed', cleanupError);
    });
    if (error instanceof LcNumberInUseError) {
      return jsonError(409, 'LC_NUMBER_IN_USE', 'An account already uses this LC Number. Sign in instead, or contact your supervisor.');
    }
    console.error('[auth/claim-invite] provisioning failed', error);
    return jsonError(500, 'CLAIM_FAILED', 'Your account could not be created. Try again.');
  }

  return NextResponse.json({ emailForSignIn: email }, { headers: { 'Cache-Control': 'no-store' } });
}
