/**
 * PATCH { assignedCohortIds, assignedUserIds } -> change who must take a published Track without publishing a new
 * version (Connor 2026-11-24: assign to Cohorts or specific people from the training page).
 */
import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase/admin';
import { jsonError, requireAuth } from '@/lib/firebase/auth-guard';
import { rolesWith } from '@/lib/auth/rbac';
import { TrackAssignmentRequestSchema } from '@/lib/schemas/api';
import { ServiceError } from '@/lib/services/errors';
import { resolveTrackAssignment } from '@/lib/services/track-assignment';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, { params }: { params: Promise<{ trackId: string }> }): Promise<NextResponse> {
  const auth = await requireAuth(req, rolesWith('tracks.publish'));
  if (!auth.ok) return auth.response;
  const { trackId } = await params;
  const parsed = TrackAssignmentRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, 'VALIDATION_FAILED', 'Send the Cohorts and people to assign.');
  try {
    const assignment = await resolveTrackAssignment({ cohortIds: parsed.data.assignedCohortIds, userIds: parsed.data.assignedUserIds });
    const ref = adminDb.collection('tracks').doc(trackId);
    const snap = await ref.get();
    if (!snap.exists) return jsonError(404, 'NOT_FOUND', 'This Track does not exist.');
    if (snap.get('status') !== 'PUBLISHED') {
      return jsonError(409, 'NOT_PUBLISHED', 'Publish the Track first; the Publish dialog sets who takes it.');
    }
    await ref.update({ ...assignment, updatedAt: Date.now() });
    return NextResponse.json({ trackId, ...assignment });
  } catch (error) {
    if (error instanceof ServiceError) return jsonError(error.status, error.code, error.message);
    console.error('[tracks/assignment] update failed', error);
    return jsonError(500, 'ASSIGNMENT_FAILED', 'The assignment was not saved. Try again.');
  }
}
