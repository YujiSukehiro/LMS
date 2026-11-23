/** QA L16: sign-in errors never reveal whether an LC Number or email has an account. */
import { describe, expect, it } from 'vitest';
import { describeAuthError } from '@/lib/firebase/auth-errors';

describe('describeAuthError', () => {
  it('gives the same message for an unknown account and a wrong password', () => {
    const combined = describeAuthError({ code: 'auth/invalid-credential' });
    expect(describeAuthError({ code: 'auth/user-not-found' })).toBe(combined);
    expect(describeAuthError({ code: 'auth/wrong-password' })).toBe(combined);
  });
});
