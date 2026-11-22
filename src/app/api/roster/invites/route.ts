import { NextResponse } from 'next/server';
import { assignableRoles, manageDeniedReason, rolesWith } from '@/lib/auth/rbac';
import { adminDb } from '@/lib/firebase/admin';
import { jsonError, requireAuth } from '@/lib/firebase/auth-guard';
import { isSyntheticLcEmail } from '@/lib/firebase/lc-id';
import { RosterCreateInviteRequestSchema, RosterCreateInviteResponseSchema } from '@/lib/schemas/api';
import { RosterInviteDocSchema } from '@/lib/schemas/domain';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<NextResponse> {
  const auth = await requireAuth(req, rolesWith('users.invite'));
  if (!auth.ok) return auth.response;
  const actor = auth.user;

  const body: unknown = await req.json().catch(() => null);
  const parsed = RosterCreateInviteRequestSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return jsonError(400, 'VALIDATION_FAILED', first ? first.message : 'Check the invite fields and try again.');
  }
  const input = parsed.data;

  if (!assignableRoles(actor.role).includes(input.role)) {
    return jsonError(403, 'FORBIDDEN', manageDeniedReason(actor.role, input.role));
  }
  if (isSyntheticLcEmail(input.email)) {
    return jsonError(
      400,
      'VALIDATION_FAILED',
      'Use Bulk Import or a Cohort join code for LC-ID accounts instead of an internal roster email.',
    );
  }

  const [cohortSnap, existingUsers] = await Promise.all([
    adminDb.collection('cohorts').doc(input.partnerCohortId).get(),
    adminDb.collection('users').where('email', '==', input.email).limit(1).get(),
  ]);

  if (!cohortSnap.exists) {
    return jsonError(400, 'INVALID_COHORT', `Cohort "${input.partnerCohortId}" does not exist.`);
  }
  if (!existingUsers.empty) {
    return jsonError(
      409,
      'USER_ALREADY_EXISTS',
      'An account with this email already exists. Use Edit access in the Users table to change their role.',
    );
  }

  const now = Date.now();
  const divisionIds = Array.from(new Set(input.divisionIds));
  const priorInvites = await adminDb.collection('rosterInvites').where('email', '==', input.email).limit(20).get();
  const inviteRef = adminDb.collection('rosterInvites').doc();
  const invite = RosterInviteDocSchema.parse({
    id: inviteRef.id,
    email: input.email,
    lcNumber: null,
    displayName: input.displayName,
    role: input.role,
    partnerCohortId: input.partnerCohortId,
    divisionIds,
    status: 'PENDING',
    createdByUid: actor.uid,
    claimedByUid: null,
    expiresAt: now + input.expiresInDays * 86_400_000,
    createdAt: now,
    updatedAt: now,
  });

  const batch = adminDb.batch();
  for (const doc of priorInvites.docs) {
    if (doc.get('status') === 'PENDING') {
      batch.update(doc.ref, { status: 'REVOKED', updatedAt: now });
    }
  }
  batch.create(inviteRef, invite);
  await batch.commit();

  return NextResponse.json(
    RosterCreateInviteResponseSchema.parse({ ok: true, invite }),
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
