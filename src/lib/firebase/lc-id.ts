/**
 * Pure LC-ID helpers (no browser or server side effects), safe to import from anywhere.
 */
import { LC_ID_EMAIL_DOMAIN, LC_ID_PATTERN } from '@/lib/schemas/constants';

/** true when the value looks like a LogiCall Staff ID (LC-1042). */
export function isLcNumber(value: string): boolean {
  return LC_ID_PATTERN.test(value.trim());
}

/** "lc-1042" -> "LC-1042". */
export function normalizeLcNumber(value: string): string {
  return value.trim().toUpperCase();
}

/** LC-1042 -> lc-1042@roster.logicall.internal. */
export function lcNumberToEmail(lcNumber: string): string {
  return `${lcNumber.trim().toLowerCase()}@${LC_ID_EMAIL_DOMAIN}`;
}

/** LC-1042 -> lc-1042@roster.logicall.internal, else the trimmed lowercase email. */
export function identifierToEmail(identifier: string): string {
  const trimmed = identifier.trim();
  if (isLcNumber(trimmed)) return lcNumberToEmail(trimmed);
  return trimmed.toLowerCase();
}

/** true when the email is a synthetic LC-ID sign-in address. */
export function isSyntheticLcEmail(email: string): boolean {
  return email.trim().toLowerCase().endsWith(`@${LC_ID_EMAIL_DOMAIN}`);
}

/** lc-1042@roster.logicall.internal -> LC-1042, else null. */
export function emailToLcNumber(email: string): string | null {
  if (!isSyntheticLcEmail(email)) return null;
  const local = email.trim().split('@')[0] ?? '';
  return isLcNumber(local) ? normalizeLcNumber(local) : null;
}
