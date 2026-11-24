/**
 * POST { uid, member } -> add or remove an extra Cohort membership (Connor 2026-11-24: people can be in several
 * Cohorts). The home Cohort (partnerCohortId) is changed in the access dialog, not here.
 */
import { NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';
import { adminDb } from '@/lib/firebase/admin';
import { jsonError, requireAuth } from '@/lib/firebase/auth-guard';
import { canManageUser, rolesWith } from '@/lib/auth/rbac';
import { UserRoleSchema } from '@/lib/schemas/domain';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BodySchema = z.object({ uid: z.string().min(1).max(128), member: z.boolean() });

export async function POST(req: Request, { params }: { params: Promise<{ cohortId: string }> }): Promise<NextResponse> {
  const auth = await requireAuth(req, rolesWith('users.editAccess'));
  if (!auth.ok) return auth.response;
  const { cohortId } = await params;
  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, 'VALIDATION_FAILED', 'Send the person and whether they belong to the Cohort.');
  const [cohort, userSnap] = await Promise.all([
    adminDb.collection('cohorts').doc(cohortId).get(),
    adminDb.collection('users').doc(parsed.data.uid).get(),
  ]);
  if (!cohort.exists) return jsonError(404, 'NOT_FOUND', 'This Cohort does not exist.');
  if (!userSnap.exists) return jsonError(404, 'NOT_FOUND', 'This person does not exist.');
  const role = UserRoleSchema.safeParse(userSnap.get('role'));
  const home = userSnap.get('partnerCohortId');
  if (!role.success || typeof home !== 'string') return jsonError(409, 'INVALID_USER', 'This person record is incomplete.');
  if (!canManageUser(auth.user, { uid: parsed.data.uid, role: role.data, partnerCohortId: home }, 'users.editAccess')) {
    return jsonError(403, 'FORBIDDEN', 'You cannot change this person.');
  }
  if (home === cohortId) {
    return jsonError(409, 'HOME_COHORT', 'This is their home Cohort. Change it in Edit access instead.');
  }
  await userSnap.ref.update({
    cohortIds: parsed.data.member ? FieldValue.arrayUnion(cohortId) : FieldValue.arrayRemove(cohortId),
    updatedAt: Date.now(),
  });
  return NextResponse.json({ uid: parsed.data.uid, cohortId, member: parsed.data.member });
}
