import { NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { rolesWith } from '@/lib/auth/rbac';
import { adminDb } from '@/lib/firebase/admin';
import { jsonError, requireAuth } from '@/lib/firebase/auth-guard';
import { RosterCohortResponseSchema, RosterUpdateCohortRequestSchema } from '@/lib/schemas/api';
import { CohortDocSchema } from '@/lib/schemas/domain';
import { ALL_COHORTS_ID } from '@/lib/schemas/constants';
import { generateUniqueJoinCode } from '@/lib/services/cohort-join-code';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, { params }: { params: Promise<{ cohortId: string }> }): Promise<NextResponse> {
  const auth = await requireAuth(req, rolesWith('cohorts.edit'));
  if (!auth.ok) return auth.response;
  const { cohortId } = await params;

  const body: unknown = await req.json().catch(() => null);
  const parsed = RosterUpdateCohortRequestSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return jsonError(400, 'VALIDATION_FAILED', first ? first.message : 'Check the Cohort update fields and try again.');
  }
  const input = parsed.data;

  const ref = adminDb.collection('cohorts').doc(cohortId);
  const snap = await ref.get();
  if (!snap.exists) return jsonError(404, 'NOT_FOUND', `Cohort "${cohortId}" does not exist.`);

  const parsedCohort = CohortDocSchema.safeParse({ id: snap.id, ...snap.data() });
  if (!parsedCohort.success) return jsonError(500, 'INVALID_COHORT_DOC', 'The stored Cohort record is invalid.');
  const existing = parsedCohort.data;

  if (
    existing.isInternal &&
    (input.action === 'rotate_join_code' || (input.action === 'toggle_join_code' && input.enabled))
  ) {
    return jsonError(
      400,
      'INTERNAL_INVITE_ONLY',
      'Internal staff cohorts are invite-only and cannot use public join codes.',
    );
  }

  const now = Date.now();
  let updated = existing;

  if (input.action === 'rotate_join_code') {
    const allCohorts = await adminDb.collection('cohorts').get();
    const existingCodes = new Set(
      allCohorts.docs
        .map((doc) => doc.get('joinCode'))
        .filter((code): code is string => typeof code === 'string' && code.length > 0),
    );
    if (existing.joinCode) existingCodes.add(existing.joinCode);
    updated = {
      ...existing,
      joinCode: generateUniqueJoinCode(existing.id, existingCodes),
      joinCodeEnabled: true,
      updatedAt: now,
    };
  } else if (input.action === 'toggle_join_code') {
    let nextCode = existing.joinCode;
    if (input.enabled && !nextCode) {
      const allCohorts = await adminDb.collection('cohorts').get();
      const existingCodes = new Set(
        allCohorts.docs
          .map((doc) => doc.get('joinCode'))
          .filter((code): code is string => typeof code === 'string' && code.length > 0),
      );
      nextCode = generateUniqueJoinCode(existing.id, existingCodes);
    }
    updated = {
      ...existing,
      joinCode: nextCode,
      joinCodeEnabled: input.enabled,
      updatedAt: now,
    };
  } else {
    updated = {
      ...existing,
      name: input.name,
      defaultDivisionIds: Array.from(new Set(input.defaultDivisionIds)),
      updatedAt: now,
    };
  }

  await ref.update({
    name: updated.name,
    defaultDivisionIds: updated.defaultDivisionIds,
    joinCode: updated.joinCode,
    joinCodeEnabled: updated.joinCodeEnabled,
    updatedAt: updated.updatedAt,
  });

  return NextResponse.json(
    RosterCohortResponseSchema.parse({ ok: true, cohort: updated }),
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

/**
 * DELETE /api/roster/cohorts/[cohortId] — remove an empty Cohort.
 * Refuses while any user or pending invite still belongs to it, or while a Track is assigned only to it,
 * so nobody is orphaned. Other Track assignments drop the Cohort; learner history keeps its old Cohort id.
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ cohortId: string }> }): Promise<NextResponse> {
  const auth = await requireAuth(req, rolesWith('cohorts.delete'));
  if (!auth.ok) return auth.response;
  const { cohortId } = await params;
  if (!cohortId || cohortId.includes('/') || cohortId === ALL_COHORTS_ID) {
    return jsonError(400, 'VALIDATION_FAILED', 'This Cohort cannot be deleted.');
  }

  const ref = adminDb.collection('cohorts').doc(cohortId);
  const snap = await ref.get();
  if (!snap.exists) return jsonError(404, 'NOT_FOUND', `Cohort "${cohortId}" does not exist.`);
  const cohort = CohortDocSchema.safeParse({ id: snap.id, ...snap.data() });
  if (cohort.success && cohort.data.isInternal) {
    return jsonError(400, 'INTERNAL_COHORT', 'The internal staff Cohort cannot be deleted.');
  }

  const [usersCount, invitesSnap, tracksSnap] = await Promise.all([
    adminDb.collection('users').where('partnerCohortId', '==', cohortId).count().get(),
    adminDb.collection('rosterInvites').where('partnerCohortId', '==', cohortId).where('status', '==', 'PENDING').limit(50).get(),
    adminDb.collection('tracks').where('assignedCohortIds', 'array-contains', cohortId).get(),
  ]);
  const userCount = usersCount.data().count;
  if (userCount > 0) {
    return jsonError(
      409,
      'COHORT_NOT_EMPTY',
      `${userCount} user${userCount === 1 ? '' : 's'} still belong${userCount === 1 ? 's' : ''} to this Cohort (including deactivated users). Move them to another Cohort with Access first.`,
    );
  }
  if (!invitesSnap.empty) {
    return jsonError(409, 'COHORT_HAS_INVITES', `Revoke the ${invitesSnap.size} pending invite${invitesSnap.size === 1 ? '' : 's'} for this Cohort first.`);
  }
  const onlyHere = tracksSnap.docs.filter((doc) => {
    const ids = doc.get('assignedCohortIds');
    return Array.isArray(ids) && ids.length === 1;
  });
  if (onlyHere.length > 0) {
    const titles = onlyHere.map((doc) => `"${String(doc.get('title') ?? doc.id)}"`).join(', ');
    return jsonError(409, 'COHORT_ONLY_TRACK_ASSIGNMENT', `${titles} ${onlyHere.length === 1 ? 'is' : 'are'} assigned only to this Cohort. Assign ${onlyHere.length === 1 ? 'it' : 'them'} to another Cohort before deleting.`);
  }

  const batch = adminDb.batch();
  for (const doc of tracksSnap.docs) {
    batch.update(doc.ref, { assignedCohortIds: FieldValue.arrayRemove(cohortId), updatedAt: Date.now() });
  }
  batch.delete(ref);
  await batch.commit();

  return NextResponse.json(
    { ok: true, cohortId, removedFromTrackIds: tracksSnap.docs.map((doc) => doc.id) },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
