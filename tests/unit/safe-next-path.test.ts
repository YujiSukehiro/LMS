import { describe, expect, it } from 'vitest';
import { safeNextPath } from '@/app/(auth)/login/safe-next-path';

describe('safeNextPath', () => {
  it.each([
    ['/learn', '/learn'],
    ['/tracks/abc?tab=units#top', '/tracks/abc?tab=units#top'],
    [['/progress', '/other'], '/progress'],
  ])('keeps same-origin path %j', (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });

  it.each([
    undefined,
    '',
    'https://evil.com',
    'evil.com',
    '//evil.com',
    '/\\evil.com',
    '/\\/evil.com',
    '\\\\evil.com',
    '/\t/evil.com',
    '/\n/evil.com',
    '/login',
    '/login?next=/x',
    'javascript:alert(1)',
  ])('falls back to / for %j', (input) => {
    expect(safeNextPath(input)).toBe('/');
  });
});
