/**
 * "New here? Read your guide" banner state. Kept in a cookie (like the theme cookie) so the server renders the right
 * state with no flash. The value is the uid of the user who dismissed it, so a different person signing in on the
 * same browser still sees it once.
 */
export const GUIDE_BANNER_COOKIE = 'pulse-guide-seen';
export const GUIDE_BANNER_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function shouldShowGuideBanner(cookieValue: string | undefined, uid: string): boolean {
  return !cookieValue || !cookieValue.split('|').includes(uid);
}

/** Cookie value after `uid` dismisses the banner (keeps the last few users of a shared browser). */
export function dismissedCookieValue(cookieValue: string | undefined, uid: string): string {
  const others = (cookieValue ?? '').split('|').filter((id) => id && id !== uid);
  return [...others.slice(-4), uid].join('|');
}

/** Browser only: remember that this user has seen the guide. */
export function markGuideSeen(uid: string): void {
  const current = document.cookie
    .split('; ')
    .find((row) => row.startsWith(`${GUIDE_BANNER_COOKIE}=`))
    ?.slice(GUIDE_BANNER_COOKIE.length + 1);
  const value = dismissedCookieValue(current ? decodeURIComponent(current) : undefined, uid);
  document.cookie = `${GUIDE_BANNER_COOKIE}=${encodeURIComponent(value)}; path=/; max-age=${GUIDE_BANNER_COOKIE_MAX_AGE}; samesite=lax`;
}
