/**
 * Server-only session verification and role / Cohort boundary helpers.
 */
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { NextResponse } from 'next/server';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { adminAuth, firebaseErrorCode } from './admin';
import { PulseCustomClaimsSchema, type SessionUser, type UserRole } from '@/lib/schemas/domain';
import type { ApiErrorBody } from '@/lib/schemas/api';
import { INTERNAL_OPS_ROLES, SESSION_COOKIE_NAME } from '@/lib/schemas/constants';

export type AuthResult = { ok: true; user: SessionUser } | { ok: false; response: NextResponse };

type VerifyOutcome =
  | { kind: 'ok'; user: SessionUser }
  | { kind: 'unauthenticated' }
  | { kind: 'inactive' };

export function jsonError(status: number, error: string, message?: string): NextResponse {
  const body: ApiErrorBody = message ? { error, message } : { error };
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

export function isInternalOps(user: Pick<SessionUser, 'role'>): boolean {
  return INTERNAL_OPS_ROLES.includes(user.role);
}

/** true if the user may see data that belongs to `partnerCohortId`. */
export function canAccessCohort(user: SessionUser, partnerCohortId: string): boolean {
  if (isInternalOps(user)) return true;
  return user.partnerCohortId === partnerCohortId;
}

/** Turn verified session cookie claims into a SessionUser. */
export function sessionUserFromClaims(decoded: DecodedIdToken): VerifyOutcome {
  if (decoded.active !== true) return { kind: 'inactive' };
  const parsed = PulseCustomClaimsSchema.safeParse({
    role: decoded.role,
    partnerCohortId: decoded.partnerCohortId,
    divisionIds: decoded.divisionIds,
    active: decoded.active,
  });
  if (!parsed.success) return { kind: 'unauthenticated' };
  const email = typeof decoded.email === 'string' ? decoded.email : '';
  const name = typeof decoded.name === 'string' && decoded.name.trim().length > 0 ? decoded.name : email;
  return {
    kind: 'ok',
    user: {
      uid: decoded.uid,
      email,
      displayName: name,
      role: parsed.data.role,
      partnerCohortId: parsed.data.partnerCohortId,
      divisionIds: parsed.data.divisionIds,
      active: true,
      ...(decoded.mustChangePassword === true ? { mustChangePassword: true } : {}),
    },
  };
}

async function verifySessionValue(cookieValue: string | undefined): Promise<VerifyOutcome> {
  if (!cookieValue) return { kind: 'unauthenticated' };
  try {
    const decoded = await adminAuth.verifySessionCookie(cookieValue, true);
    return sessionUserFromClaims(decoded);
  } catch (error) {
    // A disabled account is an offboarded account.
    if (firebaseErrorCode(error) === 'auth/user-disabled') return { kind: 'inactive' };
    return { kind: 'unauthenticated' };
  }
}

function readCookieFromHeader(req: Request, name: string): string | undefined {
  const header = req.headers.get('cookie');
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) {
      const raw = part.slice(index + 1).trim();
      try {
        return decodeURIComponent(raw);
      } catch {
        return raw;
      }
    }
  }
  return undefined;
}

/**
 * Route handlers: reads `__session`, verifySessionCookie(cookie, true), 401 if missing/invalid,
 * 403 ACCOUNT_DEACTIVATED if claims.active !== true, 403 FORBIDDEN if role not allowed.
 */
export async function requireAuth(req: Request, allowedRoles?: readonly UserRole[]): Promise<AuthResult> {
  const outcome = await verifySessionValue(readCookieFromHeader(req, SESSION_COOKIE_NAME));
  if (outcome.kind === 'unauthenticated') {
    return { ok: false, response: jsonError(401, 'UNAUTHENTICATED', 'Your session has ended. Sign in again.') };
  }
  if (outcome.kind === 'inactive') {
    return {
      ok: false,
      response: jsonError(403, 'ACCOUNT_DEACTIVATED', 'This account is deactivated. Contact your LogiCall administrator.'),
    };
  }
  if (allowedRoles && !allowedRoles.includes(outcome.user.role)) {
    return { ok: false, response: jsonError(403, 'FORBIDDEN', 'Your role does not have access to this action.') };
  }
  return { ok: true, user: outcome.user };
}

/** Server components / layouts: returns null when not signed in or inactive. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const outcome = await verifySessionValue(store.get(SESSION_COOKIE_NAME)?.value);
  return outcome.kind === 'ok' ? outcome.user : null;
}

/**
 * Server components: getSessionUser() or send the browser to /login; redirect('/') when the role is not allowed.
 * When a cookie exists but is invalid (expired, revoked, deactivated), the redirect passes through
 * `/api/auth/session-expired`, which clears the cookie first so the middleware does not loop.
 */
export async function requirePageUser(allowedRoles?: readonly UserRole[]): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) {
    const store = await cookies();
    redirect(store.has(SESSION_COOKIE_NAME) ? '/api/auth/session-expired' : '/login');
  }
  if (allowedRoles && !allowedRoles.includes(user.role)) redirect('/');
  return user;
}
