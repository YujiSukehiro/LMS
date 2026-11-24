/**
 * PUT { trackIds } -> exactly these published Tracks are assigned to the Cohort (Connor 2026-11-24: assign trainings
 * from the Cohort page). Tracks assigned to every Cohort ('ALL') are left alone.
 */
import { NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';
import { adminDb } from '@/lib/firebase/admin';
import { jsonError, requireAuth } from '@/lib/firebase/auth-guard';
import { rolesWith } from '@/lib/auth/rbac';
import { ALL_COHORTS_ID } from '@/lib/schemas/constants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BodySchema = z.object({ trackIds: z.array(z.string().min(1)).max(200) });

export async function PUT(req: Request, { params }: { params: Promise<{ cohortId: string }> }): Promise<NextResponse> {
  const auth = await requireAuth(req, rolesWith('tracks.publish'));
  if (!auth.ok) return auth.response;
  const { cohortId } = await params;
  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, 'VALIDATION_FAILED', 'Send the Tracks to assign.');
  const cohort = await adminDb.collection('cohorts').doc(cohortId).get();
  if (!cohort.exists) return jsonError(404, 'NOT_FOUND', 'This Cohort does not exist.');

  const wanted = new Set(parsed.data.trackIds);
  const published = await adminDb.collection('tracks').where('status', '==', 'PUBLISHED').get();
  const unknown = [...wanted].filter((id) => !published.docs.some((doc) => doc.id === id));
  if (unknown.length > 0) return jsonError(400, 'VALIDATION_FAILED', 'Only published Tracks can be assigned.');

  const batch = adminDb.batch();
  const now = Date.now();
  let changed = 0;
  for (const doc of published.docs) {
    const assigned: string[] = Array.isArray(doc.get('assignedCohortIds')) ? doc.get('assignedCohortIds') : [];
    if (assigned.includes(ALL_COHORTS_ID)) continue;
    const has = assigned.includes(cohortId);
    if (wanted.has(doc.id) && !has) {
      batch.update(doc.ref, { assignedCohortIds: FieldValue.arrayUnion(cohortId), updatedAt: now });
      changed += 1;
    } else if (!wanted.has(doc.id) && has) {
      batch.update(doc.ref, { assignedCohortIds: FieldValue.arrayRemove(cohortId), updatedAt: now });
      changed += 1;
    }
  }
  if (changed > 0) await batch.commit();
  return NextResponse.json({ cohortId, trackIds: [...wanted], changed });
}
