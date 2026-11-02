import { NextResponse } from 'next/server';
import { SESSION_COOKIE_NAME } from '@/lib/schemas/constants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Clears a stale or revoked `__session` cookie, then sends the browser to /login.
 * `requirePageUser()` redirects here so the middleware does not bounce /login back to / in a loop.
 */
export function GET(req: Request): NextResponse {
  const url = new URL('/login', req.url);
  url.searchParams.set('reason', 'session-ended');
  const res = NextResponse.redirect(url);
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
