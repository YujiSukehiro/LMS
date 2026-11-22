/** Find the pending, unexpired invite a setup-link token belongs to. Server only. */
import { adminDb } from '@/lib/firebase/admin';
import { RosterInviteDocSchema, type RosterInviteDoc } from '@/lib/schemas/domain';
import { hashInviteToken, isWellFormedInviteToken } from './invite-token';

export type InviteLookup =
  | { ok: true; invite: RosterInviteDoc }
  | { ok: false; reason: 'invalid' | 'used' | 'revoked' | 'expired' };

export async function findInviteByToken(token: string, now = Date.now()): Promise<InviteLookup> {
  if (!isWellFormedInviteToken(token)) return { ok: false, reason: 'invalid' };
  const snap = await adminDb.collection('rosterInvites').where('setupTokenHash', '==', hashInviteToken(token)).limit(1).get();
  const doc = snap.docs[0];
  if (!doc) return { ok: false, reason: 'invalid' };
  const parsed = RosterInviteDocSchema.safeParse({ id: doc.id, ...doc.data() });
  if (!parsed.success) return { ok: false, reason: 'invalid' };
  const invite = parsed.data;
  if (invite.status === 'CLAIMED') return { ok: false, reason: 'used' };
  if (invite.status === 'REVOKED') return { ok: false, reason: 'revoked' };
  if (invite.expiresAt !== null && invite.expiresAt <= now) return { ok: false, reason: 'expired' };
  return { ok: true, invite };
}

export const INVITE_LOOKUP_MESSAGES: Record<Exclude<InviteLookup, { ok: true }>['reason'], string> = {
  invalid: 'This invite link is not valid. Ask your LogiCall administrator for a new one.',
  used: 'This invite has already been used. Sign in with the account you created.',
  revoked: 'This invite was cancelled. Ask your LogiCall administrator for a new one.',
  expired: 'This invite has expired. Ask your LogiCall administrator for a new one.',
};
