import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase/admin';
import { jsonError, requireAuth } from '@/lib/firebase/auth-guard';
import { RosterCohortResponseSchema, RosterCreateCohortRequestSchema } from '@/lib/schemas/api';
import { ALL_COHORTS_ID, ROSTER_ADMIN_ROLES } from '@/lib/schemas/constants';
import { CohortDocSchema } from '@/lib/schemas/domain';
import { generateUniqueJoinCode } from '@/lib/services/cohort-join-code';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<NextResponse> {
  const auth = await requireAuth(req, ROSTER_ADMIN_ROLES);
  if (!auth.ok) return auth.response;

  const body: unknown = await req.json().catch(() => null);
  const parsed = RosterCreateCohortRequestSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return jsonError(400, 'VALIDATION_FAILED', first ? first.message : 'Check the Cohort fields and try again.');
  }
  const input = parsed.data;

  if (input.id === ALL_COHORTS_ID) {
    return jsonError(400, 'RESERVED_COHORT_ID', '"ALL" is reserved for cross-Cohort Track assignments.');
  }

  const cohortSnaps = await adminDb.collection('cohorts').get();
  if (cohortSnaps.docs.some((doc) => doc.id === input.id)) {
    return jsonError(409, 'COHORT_EXISTS', `Cohort "${input.id}" already exists.`);
  }

  const existingCodes = new Set(
    cohortSnaps.docs
      .map((doc) => doc.get('joinCode'))
      .filter((code): code is string => typeof code === 'string' && code.length > 0),
  );

  const now = Date.now();
  const cohort = CohortDocSchema.parse({
    id: input.id,
    name: input.name,
    isInternal: false,
    defaultDivisionIds: Array.from(new Set(input.defaultDivisionIds)),
    activeAgentCount: 0,
    joinCode: generateUniqueJoinCode(input.id, existingCodes),
    joinCodeEnabled: input.joinCodeEnabled,
    createdAt: now,
    updatedAt: now,
  });

  await adminDb.collection('cohorts').doc(cohort.id).create(cohort);

  return NextResponse.json(
    RosterCohortResponseSchema.parse({ ok: true, cohort }),
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
