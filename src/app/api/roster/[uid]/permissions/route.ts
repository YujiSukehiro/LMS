import { NextResponse } from 'next/server';
import { assignableRoles, canManageRole, manageDeniedReason, roleCohortFitError, rolesWith } from '@/lib/auth/rbac';
import { FieldValue } from 'firebase-admin/firestore';
import { adminAuth, adminDb, firebaseErrorCode } from '@/lib/firebase/admin';
import { jsonError, requireAuth } from '@/lib/firebase/auth-guard';
import { claimsForUser, parseStoredUserDoc, writeCustomClaims } from '@/lib/firebase/users';
import {
  RosterUpdatePermissionsRequestSchema,
  RosterUpdatePermissionsResponseSchema,
} from '@/lib/schemas/api';
import type { UserDoc } from '@/lib/schemas/domain';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

class PermissionsError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function safeDecrementDelta(currentCount: unknown): number {
  const count = typeof currentCount === 'number' ? currentCount : 0;
  return count > 0 ? -1 : 0;
}

export async function PATCH(req: Request, { params }: { params: Promise<{ uid: string }> }): Promise<NextResponse> {
  const auth = await requireAuth(req, rolesWith('users.editAccess'));
  if (!auth.ok) return auth.response;
  const actor = auth.user;
  const { uid } = await params;

  const body: unknown = await req.json().catch(() => null);
  const parsed = RosterUpdatePermissionsRequestSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return jsonError(400, 'VALIDATION_FAILED', first ? first.message : 'Check the access fields and try again.');
  }
  const input = parsed.data;

  let existingUser: UserDoc;
  let updatedUser: UserDoc;
  try {
    const result = await adminDb.runTransaction(async (tx) => {
      const userRef = adminDb.collection('users').doc(uid);
      const userSnap = await tx.get(userRef);
      if (!userSnap.exists) throw new PermissionsError(404, 'NOT_FOUND', 'This user does not exist.');
      const existing = parseStoredUserDoc(uid, userSnap.data() ?? {});

      if (uid === actor.uid && (input.role !== existing.role || input.partnerCohortId !== existing.partnerCohortId)) {
        throw new PermissionsError(400, 'CANNOT_CHANGE_SELF', 'You cannot change your own role or Cohort.');
      }
      // Hierarchy: manage only roles below your own (Super Admins manage everyone), and grant only those roles.
      if (uid !== actor.uid && !canManageRole(actor.role, existing.role)) {
        throw new PermissionsError(403, 'FORBIDDEN', manageDeniedReason(actor.role, existing.role));
      }
      if (input.role !== existing.role && !assignableRoles(actor.role).includes(input.role)) {
        throw new PermissionsError(403, 'FORBIDDEN', manageDeniedReason(actor.role, input.role));
      }

      const nextCohortRef = adminDb.collection('cohorts').doc(input.partnerCohortId);
      const nextCohortSnap = await tx.get(nextCohortRef);
      if (!nextCohortSnap.exists) {
        throw new PermissionsError(400, 'INVALID_COHORT', `Cohort "${input.partnerCohortId}" does not exist.`);
      }
      const fitError = roleCohortFitError(input.role, nextCohortSnap.get('isInternal') === true);
      if (fitError) throw new PermissionsError(400, 'ROLE_COHORT_MISMATCH', fitError);

      const cohortChanged = existing.partnerCohortId !== input.partnerCohortId;
      const oldCohortRef = adminDb.collection('cohorts').doc(existing.partnerCohortId);
      const oldCohortSnap = cohortChanged ? await tx.get(oldCohortRef) : null;

      const now = Date.now();
      const nextDisplayName = input.displayName ?? existing.displayName;
      const divisionIds = Array.from(new Set(input.divisionIds));
      const updated: UserDoc = {
        ...existing,
        displayName: nextDisplayName,
        role: input.role,
        partnerCohortId: input.partnerCohortId,
        divisionIds,
        updatedAt: now,
      };

      tx.update(userRef, {
        displayName: nextDisplayName,
        role: input.role,
        partnerCohortId: input.partnerCohortId,
        divisionIds,
        updatedAt: now,
      });

      const wasActiveAgent = existing.active && existing.role === 'AGENT';
      const isActiveAgent = existing.active && input.role === 'AGENT';

      if (!cohortChanged) {
        if (!wasActiveAgent && isActiveAgent) {
          tx.update(nextCohortRef, { activeAgentCount: FieldValue.increment(1), updatedAt: now });
        } else if (wasActiveAgent && !isActiveAgent) {
          const delta = safeDecrementDelta(nextCohortSnap.get('activeAgentCount'));
          if (delta !== 0) {
            tx.update(nextCohortRef, { activeAgentCount: FieldValue.increment(delta), updatedAt: now });
          }
        }
      } else {
        if (wasActiveAgent && oldCohortSnap?.exists) {
          const delta = safeDecrementDelta(oldCohortSnap.get('activeAgentCount'));
          if (delta !== 0) {
            tx.update(oldCohortRef, { activeAgentCount: FieldValue.increment(delta), updatedAt: now });
          }
        }
        if (isActiveAgent) {
          tx.update(nextCohortRef, { activeAgentCount: FieldValue.increment(1), updatedAt: now });
        }
      }

      return { existing, updated };
    });
    existingUser = result.existing;
    updatedUser = result.updated;
  } catch (error) {
    if (error instanceof PermissionsError) return jsonError(error.status, error.code, error.message);
    console.error('[roster/permissions] Firestore update failed', error);
    return jsonError(500, 'PERMISSIONS_UPDATE_FAILED', 'Access could not be updated. Try again.');
  }

  const claimsChanged =
    existingUser.role !== updatedUser.role ||
    existingUser.partnerCohortId !== updatedUser.partnerCohortId ||
    existingUser.divisionIds.join(',') !== updatedUser.divisionIds.join(',');
  const shouldRevoke = claimsChanged && uid !== actor.uid;

  try {
    await writeCustomClaims(uid, claimsForUser(updatedUser, updatedUser.active));
    if (updatedUser.displayName !== existingUser.displayName) {
      await adminAuth.updateUser(uid, { displayName: updatedUser.displayName });
    }
    if (shouldRevoke) {
      await adminAuth.revokeRefreshTokens(uid);
    }
  } catch (error) {
    if (firebaseErrorCode(error) === 'auth/user-not-found') {
      return NextResponse.json(
        RosterUpdatePermissionsResponseSchema.parse({ ok: true, user: updatedUser, sessionRevoked: false }),
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }
    console.error('[roster/permissions] Auth sync failed', error);
    return jsonError(
      500,
      'AUTH_SYNC_FAILED',
      'The roster record changed, but Firebase Auth permissions did not finish syncing. Save again to retry.',
    );
  }

  return NextResponse.json(
    RosterUpdatePermissionsResponseSchema.parse({ ok: true, user: updatedUser, sessionRevoked: shouldRevoke }),
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
