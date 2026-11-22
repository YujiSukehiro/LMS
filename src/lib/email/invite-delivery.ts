/** Send (or skip) the invite email for a freshly issued setup link. Server only. */
import { adminDb } from '@/lib/firebase/admin';
import { ROLE_LABELS } from '@/lib/schemas/constants';
import type { RosterInviteDoc } from '@/lib/schemas/domain';
import { inviteSetupPath } from '@/lib/services/invite-token';
import { renderInviteEmail } from './invite-email';
import { sendEmail, type EmailSendResult } from './send';

/** Public origin for links in emails: APP_BASE_URL when set (behind proxies), else the request's own origin. */
export function publicOrigin(req: Request, env: Readonly<Record<string, string | undefined>> = process.env): string {
  const configured = env.APP_BASE_URL?.trim().replace(/\/+$/, '');
  if (configured) return configured;
  return new URL(req.url).origin;
}

export async function deliverInviteEmail(args: {
  req: Request;
  invite: RosterInviteDoc;
  token: string;
  inviterName: string;
}): Promise<EmailSendResult> {
  if (!args.invite.email) return { status: 'failed', reason: 'invite has no email' };
  const cohortSnap = await adminDb.collection('cohorts').doc(args.invite.partnerCohortId).get().catch(() => null);
  const cohortName = (cohortSnap?.get('name') as string | undefined) ?? args.invite.partnerCohortId;
  const email = renderInviteEmail({
    displayName: args.invite.displayName,
    inviterName: args.inviterName,
    roleLabel: ROLE_LABELS[args.invite.role],
    cohortName,
    setupUrl: `${publicOrigin(args.req)}${inviteSetupPath(args.token)}`,
    expiresAt: args.invite.expiresAt,
    supportEmail: process.env.EMAIL_REPLY_TO?.trim() || undefined,
  });
  const result = await sendEmail({ to: args.invite.email, ...email });
  if (result.status === 'failed') console.error('[invite-email] send failed', { inviteId: args.invite.id, reason: result.reason });
  return result;
}
