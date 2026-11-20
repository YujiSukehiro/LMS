const PARSE_BASE = 'http://pulse.invalid';

/**
 * Returns a same-origin relative path to redirect to after sign-in, or '/'.
 * Rejects protocol-relative (`//`), backslash (`/\evil.com`, which browsers treat as `//`), and control-character
 * tricks, then confirms by URL parsing that the target cannot leave this origin.
 */
export function safeNextPath(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return '/';
  if (/[\\\u0000-\u001f\u007f]/.test(raw)) return '/';
  let parsed: URL;
  try {
    parsed = new URL(raw, PARSE_BASE);
  } catch {
    return '/';
  }
  if (parsed.origin !== PARSE_BASE) return '/';
  const path = `${parsed.pathname}${parsed.search}${parsed.hash}`;
  if (path === '/login' || path.startsWith('/login/') || path.startsWith('/login?') || path.startsWith('/login#')) return '/';
  return path;
}
