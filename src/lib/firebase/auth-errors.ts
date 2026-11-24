/**
 * Plain-English sign-in error messages (pure, safe for client and server).
 */
import { PASSWORD_MIN_LENGTH } from '@/lib/schemas/constants';

function readCode(error: unknown): string | null {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return null;
}

const MESSAGES: Record<string, string> = {
  'auth/invalid-credential': 'The LC Number, email, or password is not correct.',
  // Same message as invalid-credential, so the sign-in page never confirms which LC Numbers exist (QA L16).
  'auth/wrong-password': 'The LC Number, email, or password is not correct.',
  'auth/user-not-found': 'The LC Number, email, or password is not correct.',
  'auth/invalid-email': 'Type a valid LC Number (for example LC-1042) or an email address.',
  'auth/missing-password': 'Type your password.',
  'auth/user-disabled': 'This account is deactivated. Contact your LogiCall administrator.',
  'auth/too-many-requests': 'Too many sign-in attempts. Wait a few minutes and try again.',
  'auth/network-request-failed': 'The network connection failed. Check your connection and try again.',
  'auth/popup-closed-by-user': 'The Google sign-in window closed before sign-in was complete.',
  'auth/cancelled-popup-request': 'The Google sign-in window closed before sign-in was complete.',
  'auth/popup-blocked': 'Your browser blocked the Google sign-in window. Allow pop-ups for this site and try again.',
  'auth/email-already-in-use': 'An account already uses this LC Number.',
  'auth/weak-password': `Use a stronger password (${PASSWORD_MIN_LENGTH} characters or more).`,
  ACCOUNT_DEACTIVATED: 'This account is deactivated. Contact your LogiCall administrator.',
  DOMAIN_NOT_ALLOWED:
    'This Google account is not on an approved LogiCall domain. Use your @logicall.io account, or ask an administrator for an invite.',
  INVALID_ID_TOKEN: 'Your sign-in expired. Try again.',
  RECENT_SIGN_IN_REQUIRED: 'Your sign-in expired. Try again.',
  CLAIMS_NOT_REFRESHED: 'Your access settings are still updating. Wait a few seconds and sign in again.',
  INVALID_JOIN_CODE: 'This join code is not valid or is no longer active. Ask your supervisor for the current code.',
  LC_NUMBER_IN_USE: 'An account already uses this LC Number. Sign in instead, or contact your supervisor.',
};

/** Error codes for which the user did nothing wrong and no message is necessary. */
const SILENT_CODES = new Set(['auth/popup-closed-by-user', 'auth/cancelled-popup-request']);

export function isSilentAuthError(error: unknown): boolean {
  const code = readCode(error);
  return code !== null && SILENT_CODES.has(code);
}

export function describeAuthError(error: unknown): string {
  const code = readCode(error);
  if (code && MESSAGES[code]) return MESSAGES[code];
  if (error instanceof Error && error.message && !error.message.startsWith('Firebase:')) return error.message;
  return 'Sign-in failed. Try again, or contact your LogiCall administrator.';
}
