/**
 * Append-only audit log for account actions (server only). Each event is one doc in `auditEvents`; nothing updates
 * or deletes them. Clients have no Firestore access to this collection (deny-by-default rules).
 */
import { adminDb } from '@/lib/firebase/admin';
import type { UserRole } from '@/lib/schemas/domain';

export type AuditEventType = 'password.reset_by_staff' | 'password.changed_by_user' | 'sims.daily_limit_reset_by_staff';

export interface AuditEvent {
  type: AuditEventType;
  actorUid: string;
  actorRole: UserRole;
  targetUid: string;
  /** Cohort of the target user, so a Cohort's events can be listed later. */
  partnerCohortId: string;
  at: number;
}

export async function recordAuditEvent(event: Omit<AuditEvent, 'at'> & { at?: number }): Promise<void> {
  await adminDb.collection('auditEvents').add({ ...event, at: event.at ?? Date.now() });
}
