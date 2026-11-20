import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase/admin';
import { jsonError, requireAuth } from '@/lib/firebase/auth-guard';
import { RosterCohortResponseSchema, RosterUpdateCohortRequestSchema } from '@/lib/schemas/api';
import { ROSTER_ADMIN_ROLES } from '@/lib/schemas/constants';
import { CohortDocSchema } from '@/lib/schemas/domain';
import { generateUniqueJoinCode } from '@/lib/services/cohort-join-code';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, { params }: { params: Promise<{ cohortId: string }> }): Promise<NextResponse> {
  const auth = await requireAuth(req, ROSTER_ADMIN_ROLES);
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
