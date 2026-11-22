/**
 * One-time invite setup links. The raw token only ever lives in the link the admin sends;
 * Firestore stores its SHA-256 hash, so reading rosterInvites never reveals a usable link.
 * Server only.
 */
import { createHash, randomBytes } from 'node:crypto';

export function newInviteToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashInviteToken(token) };
}

export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function inviteSetupPath(token: string): string {
  return `/invite/${token}`;
}

/** Shape check before any lookup, so junk paths never hit Firestore. */
export function isWellFormedInviteToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{40,64}$/.test(token);
}
