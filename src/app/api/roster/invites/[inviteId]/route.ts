import { NextResponse } from 'next/server';
import { canManageRole, manageDeniedReason, rolesWith } from '@/lib/auth/rbac';
import { adminDb } from '@/lib/firebase/admin';
import { jsonError, requireAuth } from '@/lib/firebase/auth-guard';
import { RosterRevokeInviteRequestSchema, RosterRevokeInviteResponseSchema } from '@/lib/schemas/api';
import { RosterInviteDocSchema } from '@/lib/schemas/domain';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, { params }: { params: Promise<{ inviteId: string }> }): Promise<NextResponse> {
  const auth = await requireAuth(req, rolesWith('users.invite'));
  if (!auth.ok) return auth.response;
  const actor = auth.user;
  const { inviteId } = await params;

  const body: unknown = await req.json().catch(() => null);
  const parsed = RosterRevokeInviteRequestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, 'VALIDATION_FAILED', 'Send { "status": "REVOKED" }.');
  }

  const ref = adminDb.collection('rosterInvites').doc(inviteId);
  const snap = await ref.get();
  if (!snap.exists) return jsonError(404, 'NOT_FOUND', 'This invite does not exist.');

  const invite = RosterInviteDocSchema.safeParse({ id: snap.id, ...snap.data() });
  if (!invite.success) return jsonError(404, 'NOT_FOUND', 'This invite record is not valid.');

  if (!canManageRole(actor.role, invite.data.role)) {
    return jsonError(403, 'FORBIDDEN', manageDeniedReason(actor.role, invite.data.role));
  }
  if (invite.data.status !== 'PENDING') {
    return jsonError(409, 'ALREADY_FINALIZED', 'Only pending invites can be revoked.');
  }

  await ref.update({ status: 'REVOKED', updatedAt: Date.now() });

  return NextResponse.json(
    RosterRevokeInviteResponseSchema.parse({ ok: true, inviteId, status: 'REVOKED' }),
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
