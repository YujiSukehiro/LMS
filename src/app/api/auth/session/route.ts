import { NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { adminAuth, adminDb, firebaseErrorCode } from '@/lib/firebase/admin';
import { jsonError } from '@/lib/firebase/auth-guard';
import { isSyntheticLcEmail, emailToLcNumber } from '@/lib/firebase/lc-id';
import {
  buildNewUserDoc,
  claimsForUser,
  claimsMatch,
  envList,
  parseStoredUserDoc,
  writeCustomClaims,
  type AuthMethod,
} from '@/lib/firebase/users';
import { CreateSessionRequestSchema, type CreateSessionResponse } from '@/lib/schemas/api';
import { RosterInviteDocSchema, type UserDoc } from '@/lib/schemas/domain';
import { SESSION_COOKIE_MAX_AGE_MS, SESSION_COOKIE_NAME } from '@/lib/schemas/constants';
import { ensureDefaultCohortsSeeded } from '@/lib/services/cohort-bootstrap';
import { THEME_COOKIE, THEME_COOKIE_MAX_AGE, isThemeId } from '@/lib/theme/themes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Firebase only mints a session cookie from a sign-in that is less than 5 minutes old. */
const MAX_SIGN_IN_AGE_SECONDS = 5 * 60;
const ALL_DIVISIONS: UserDoc['divisionIds'] = ['TELEHEALTH', 'INBOUND', 'OUTBOUND'];

class DomainNotAllowedError extends Error {}
/** A password account with no users/{uid} doc and no pending invite: never self-provision it. */
class InviteRequiredError extends Error {}
/** A role-granting branch (super-admin bootstrap or invite) reached by an address the user has not proven they own. */
class EmailNotVerifiedError extends Error {}

/**
 * Anyone can create a Firebase email/password account for any address with the public web API key, so the
 * address alone proves nothing. Only Google SSO or a verified email may claim a role tied to that address.
 */
function ownsEmail(decoded: DecodedIdToken, authMethod: AuthMethod): boolean {
  return authMethod === 'GOOGLE_SSO' || decoded.email_verified === true;
}

function hasCookie(req: Request, name: string): boolean {
  const header = req.headers.get('cookie');
  if (!header) return false;
  return header.split(';').some((part) => part.trim().startsWith(`${name}=`));
}

function detectAuthMethod(decoded: DecodedIdToken, email: string): AuthMethod {
  if (decoded.firebase.sign_in_provider === 'google.com') return 'GOOGLE_SSO';
  if (isSyntheticLcEmail(email)) return 'LC_ID_PASSWORD';
  return 'EMAIL_PASSWORD';
}

function emailDomain(email: string): string {
  return email.split('@')[1]?.toLowerCase() ?? '';
}

/** Create `users/{uid}` for a first sign-in, inside one transaction (claims a pending invite atomically). */
async function provisionUser(decoded: DecodedIdToken, email: string, authMethod: AuthMethod): Promise<UserDoc> {
  const userRef = adminDb.collection('users').doc(decoded.uid);
  const superAdminEmails = envList(process.env.INITIAL_SUPER_ADMIN_EMAILS);
  const allowedDomains = envList(process.env.ALLOWED_GOOGLE_WORKSPACE_DOMAINS);
  const displayNameFromToken =
    typeof decoded.name === 'string' && decoded.name.trim().length > 0 ? decoded.name.trim() : email.split('@')[0];

  return adminDb.runTransaction(async (tx) => {
    const existing = await tx.get(userRef);
    if (existing.exists) return parseStoredUserDoc(decoded.uid, existing.data() ?? {});

    const now = Date.now();
    const inviteSnap = await tx.get(adminDb.collection('rosterInvites').where('email', '==', email).limit(20));
    const pendingInvite = inviteSnap.docs
      .map((doc) => ({ ref: doc.ref, parsed: RosterInviteDocSchema.safeParse({ id: doc.id, ...doc.data() }) }))
      .find(
        (entry) =>
          entry.parsed.success &&
          entry.parsed.data.status === 'PENDING' &&
          (entry.parsed.data.expiresAt === null || entry.parsed.data.expiresAt > now),
      );

    const isBootstrapAdmin = superAdminEmails.includes(email);
    if ((isBootstrapAdmin || pendingInvite) && !ownsEmail(decoded, authMethod)) throw new EmailNotVerifiedError();

    let userDoc: UserDoc;
    if (isBootstrapAdmin) {
      userDoc = buildNewUserDoc({
        uid: decoded.uid,
        email,
        authMethod,
        lcNumber: emailToLcNumber(email),
        displayName: displayNameFromToken,
        role: 'SUPER_ADMIN',
        partnerCohortId: 'INTERNAL',
        divisionIds: ALL_DIVISIONS,
        nowMs: now,
      });
    } else if (pendingInvite && pendingInvite.parsed.success) {
      const invite = pendingInvite.parsed.data;
      userDoc = buildNewUserDoc({
        uid: decoded.uid,
        email,
        authMethod,
        lcNumber: invite.lcNumber ?? emailToLcNumber(email),
        displayName: invite.displayName || displayNameFromToken,
        role: invite.role,
        partnerCohortId: invite.partnerCohortId,
        divisionIds: invite.divisionIds,
        nowMs: now,
      });
    } else {
      // Only approved-domain Google SSO may self-provision. Email/password and LC ID accounts are created by
      // roster import, join-code claim, or the seed script, all of which write users/{uid} first.
      if (authMethod !== 'GOOGLE_SSO') throw new InviteRequiredError();
      if (!allowedDomains.includes(emailDomain(email))) {
        throw new DomainNotAllowedError();
      }
      userDoc = buildNewUserDoc({
        uid: decoded.uid,
        email,
        authMethod,
        lcNumber: emailToLcNumber(email),
        displayName: displayNameFromToken,
        role: 'AGENT',
        partnerCohortId: 'INTERNAL',
        divisionIds: ALL_DIVISIONS,
        nowMs: now,
      });
    }

    const cohortRef = adminDb.collection('cohorts').doc(userDoc.partnerCohortId);
    const cohortSnap = userDoc.role === 'AGENT' ? await tx.get(cohortRef) : null;

    tx.create(userRef, userDoc);
    if (pendingInvite) {
      tx.update(pendingInvite.ref, { status: 'CLAIMED', claimedByUid: decoded.uid, updatedAt: now });
    }
    if (cohortSnap?.exists) {
      tx.update(cohortRef, { activeAgentCount: FieldValue.increment(1), updatedAt: now });
    }
    return userDoc;
  });
}

export async function POST(req: Request): Promise<NextResponse> {
  const body: unknown = await req.json().catch(() => null);
  const parsed = CreateSessionRequestSchema.safeParse(body);
  if (!parsed.success) return jsonError(400, 'VALIDATION_FAILED', 'The sign-in request is not valid.');
  const { idToken } = parsed.data;

  let decoded: DecodedIdToken;
  try {
    decoded = await adminAuth.verifyIdToken(idToken, true);
  } catch (error) {
    if (firebaseErrorCode(error) === 'auth/user-disabled') {
      return jsonError(403, 'ACCOUNT_DEACTIVATED', 'This account is deactivated. Contact your LogiCall administrator.');
    }
    return jsonError(401, 'INVALID_ID_TOKEN', 'Your sign-in expired. Try again.');
  }

  const email = typeof decoded.email === 'string' ? decoded.email.trim().toLowerCase() : '';
  if (!email) return jsonError(400, 'EMAIL_REQUIRED', 'This sign-in method does not supply an email address.');
  const authMethod = detectAuthMethod(decoded, email);

  let userDoc: UserDoc;
  let wasNewUser = false;
  try {
    const snap = await adminDb.collection('users').doc(decoded.uid).get();
    if (snap.exists) {
      userDoc = parseStoredUserDoc(decoded.uid, snap.data() ?? {});
    } else {
      wasNewUser = true;
      userDoc = await provisionUser(decoded, email, authMethod);
    }
  } catch (error) {
    if (error instanceof DomainNotAllowedError) {
      return jsonError(
        403,
        'DOMAIN_NOT_ALLOWED',
        'This Google account is not on an approved LogiCall domain. Use your @logicall.io account, or ask an administrator for an invite.',
      );
    }
    if (error instanceof EmailNotVerifiedError) {
      return jsonError(
        403,
        'EMAIL_NOT_VERIFIED',
        'This email address is not verified, so it cannot claim an invite or administrator access. Sign in with Google, or ask your LogiCall administrator for help.',
      );
    }
    if (error instanceof InviteRequiredError) {
      return jsonError(
        403,
        'INVITE_REQUIRED',
        'This account has not been invited to LogiCall Pulse. Ask your supervisor for an invite or a join code.',
      );
    }
    console.error('[auth/session] user provisioning failed', error);
    return jsonError(500, 'PROVISIONING_FAILED', 'Your account could not be prepared. Try again in a minute.');
  }

  if (wasNewUser && userDoc.role === 'SUPER_ADMIN') {
    await ensureDefaultCohortsSeeded().catch((error: unknown) => {
      console.error('[auth/session] default cohort bootstrap skipped', error);
    });
  }

  // Deactivation gate: revoke every token and refuse the session.
  if (!userDoc.active) {
    await adminAuth.revokeRefreshTokens(decoded.uid).catch((error: unknown) => {
      console.error('[auth/session] revokeRefreshTokens failed', error);
    });
    return jsonError(403, 'ACCOUNT_DEACTIVATED', 'This account is deactivated. Contact your LogiCall administrator.');
  }

  // Keep the stored sign-in method current (for example after an imported email account first uses Google).
  if (userDoc.authMethod !== authMethod) {
    const now = Date.now();
    await adminDb.collection('users').doc(decoded.uid).update({ authMethod, updatedAt: now });
    userDoc = { ...userDoc, authMethod, updatedAt: now };
  }

  const expectedClaims = claimsForUser(userDoc, true);
  if (!claimsMatch(decoded as unknown as Record<string, unknown>, expectedClaims)) {
    try {
      await writeCustomClaims(decoded.uid, expectedClaims);
    } catch (error) {
      console.error('[auth/session] setCustomUserClaims failed', error);
      return jsonError(500, 'CLAIMS_SYNC_FAILED', 'Your access settings could not be updated. Try again.');
    }
    const response: CreateSessionResponse = { user: userDoc, refreshClaimsRequired: true };
    return NextResponse.json(response, { headers: { 'Cache-Control': 'no-store' } });
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (nowSeconds - decoded.auth_time > MAX_SIGN_IN_AGE_SECONDS) {
    return jsonError(401, 'RECENT_SIGN_IN_REQUIRED', 'Your sign-in expired. Sign in again.');
  }

  let sessionCookie: string;
  try {
    sessionCookie = await adminAuth.createSessionCookie(idToken, { expiresIn: SESSION_COOKIE_MAX_AGE_MS });
  } catch (error) {
    console.error('[auth/session] createSessionCookie failed', error);
    return jsonError(401, 'INVALID_ID_TOKEN', 'Your sign-in expired. Try again.');
  }

  const response: CreateSessionResponse = { user: userDoc, refreshClaimsRequired: false };
  const res = NextResponse.json(response, { headers: { 'Cache-Control': 'no-store' } });
  res.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: sessionCookie,
    maxAge: Math.floor(SESSION_COOKIE_MAX_AGE_MS / 1000),
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  });
  // A new browser has no theme cookie, so the server would render light. Seed it from the saved preference;
  // an existing cookie (for example a choice made on the sign-in page) wins.
  const savedTheme = userDoc.preferences?.theme;
  if (isThemeId(savedTheme) && !hasCookie(req, THEME_COOKIE)) {
    res.cookies.set({
      name: THEME_COOKIE,
      value: savedTheme,
      maxAge: THEME_COOKIE_MAX_AGE,
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
    });
  }
  return res;
}

export async function DELETE(): Promise<NextResponse> {
  const res = NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  res.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: '',
    maxAge: 0,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  });
  return res;
}
