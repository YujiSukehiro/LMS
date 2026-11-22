import type { Metadata } from 'next';
import Link from 'next/link';
import { DIVISION_LABELS, ROLE_LABELS } from '@/lib/schemas/constants';
import { adminDb } from '@/lib/firebase/admin';
import { findInviteByToken, INVITE_LOOKUP_MESSAGES } from '@/lib/services/invite-lookup';
import { InviteSetupForm } from './InviteSetupForm';

export const metadata: Metadata = { title: 'Set up your account', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function InviteSetupPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const lookup = await findInviteByToken(token).catch(() => null);

  if (!lookup || !lookup.ok) {
    return (
      <div className="pulse-card p-6 sm:p-8">
        <h1 className="text-xl font-semibold tracking-tight">Invite not available</h1>
        <p className="mt-2 text-sm text-pulse-secondary">
          {lookup ? INVITE_LOOKUP_MESSAGES[lookup.reason] : 'This invite could not be checked right now. Try again in a minute.'}
        </p>
        <Link href="/login" className="pulse-btn mt-5">Go to sign in</Link>
      </div>
    );
  }

  const { invite } = lookup;
  const cohortSnap = await adminDb.collection('cohorts').doc(invite.partnerCohortId).get().catch(() => null);
  const cohortName = (cohortSnap?.get('name') as string | undefined) ?? invite.partnerCohortId;

  return (
    <div className="pulse-card p-6 sm:p-8">
      <h1 className="text-xl font-semibold tracking-tight">Welcome, {invite.displayName}</h1>
      <p className="mt-1 text-sm text-pulse-secondary">
        You&rsquo;ve been invited to LogiCall Pulse as <span className="font-medium text-pulse-primary">{ROLE_LABELS[invite.role]}</span> in{' '}
        <span className="font-medium text-pulse-primary">{cohortName}</span>
        {invite.divisionIds.length > 0 ? ` (${invite.divisionIds.map((id) => DIVISION_LABELS[id]).join(', ')})` : ''}.
      </p>
      <InviteSetupForm token={token} email={invite.email ?? ''} />
    </div>
  );
}
