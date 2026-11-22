/**
 * Edge middleware: cookie presence check only (no firebase-admin on the Edge runtime).
 * Full verification happens in `requirePageUser()` / `requireAuth()`.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE_NAME } from '@/lib/schemas/constants';

const PUBLIC_PREFIXES = ['/login', '/join/', '/invite/'];

function isPublicPath(pathname: string): boolean {
  return pathname === '/join' || PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix));
}

export function middleware(req: NextRequest): NextResponse {
  const { pathname, search } = req.nextUrl;
  const hasSession = Boolean(req.cookies.get(SESSION_COOKIE_NAME)?.value);

  // `reason` is set after a stale cookie was cleared; never bounce that request.
  if (pathname === '/login' && hasSession && !req.nextUrl.searchParams.has('reason')) {
    const url = req.nextUrl.clone();
    url.pathname = '/';
    url.search = '';
    return NextResponse.redirect(url);
  }

  if (!hasSession && !isPublicPath(pathname)) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    if (pathname !== '/') url.searchParams.set('next', `${pathname}${search}`);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api/|_next/|favicon\\.ico|robots\\.txt|sitemap\\.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map|txt|woff2?)$).*)'],
};
