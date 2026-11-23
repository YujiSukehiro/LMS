/** POST /api/roster/invites/[inviteId]/link — issue a fresh one-time setup link (the old link stops working). */
import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase/admin';
import { jsonError, requireAuth } from '@/lib/firebase/auth-guard';
import { invitableRoles, manageDeniedReason, rolesWith } from '@/lib/auth/rbac';
import { RosterInviteLinkRequestSchema, RosterInviteLinkResponseSchema } from '@/lib/schemas/api';
import { deliverInviteEmail } from '@/lib/email/invite-delivery';
import { RosterInviteDocSchema } from '@/lib/schemas/domain';
import { inviteSetupPath, newInviteToken } from '@/lib/services/invite-token';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ inviteId: string }> }): Promise<NextResponse> {
  const auth = await requireAuth(req, rolesWith('users.invite'));
  if (!auth.ok) return auth.response;
  const { inviteId } = await params;
  if (!inviteId || inviteId.includes('/')) return jsonError(404, 'NOT_FOUND', 'This invite does not exist.');

  const ref = adminDb.collection('rosterInvites').doc(inviteId);
  const snap = await ref.get();
  if (!snap.exists) return jsonError(404, 'NOT_FOUND', 'This invite does not exist.');
  const invite = RosterInviteDocSchema.safeParse({ id: snap.id, ...snap.data() });
  if (!invite.success) return jsonError(404, 'NOT_FOUND', 'This invite record is not valid.');
  if (!invitableRoles(auth.user.role).includes(invite.data.role)) {
    return jsonError(403, 'FORBIDDEN', manageDeniedReason(auth.user.role, invite.data.role));
  }
  if (invite.data.status !== 'PENDING') return jsonError(409, 'ALREADY_FINALIZED', 'Only pending invites have a setup link.');
  if (invite.data.expiresAt !== null && invite.data.expiresAt <= Date.now()) {
    return jsonError(410, 'INVITE_EXPIRED', 'This invite has expired. Create a new invite.');
  }

  const body = RosterInviteLinkRequestSchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) return jsonError(400, 'VALIDATION_FAILED', 'Send {} or { "sendEmail": true }.');

  const { token, tokenHash } = newInviteToken();
  await ref.update({ setupTokenHash: tokenHash, updatedAt: Date.now() });
  const emailStatus = body.data.sendEmail
    ? (await deliverInviteEmail({ req, invite: invite.data, token, inviterName: auth.user.displayName })).status
    : 'skipped';
  return NextResponse.json(RosterInviteLinkResponseSchema.parse({ ok: true, setupPath: inviteSetupPath(token), emailStatus }), {
    headers: { 'Cache-Control': 'no-store' },
  });
}
