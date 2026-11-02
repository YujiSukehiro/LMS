import type { Metadata } from 'next';
import Link from 'next/link';
import { adminDb } from '@/lib/firebase/admin';
import { CohortDocSchema } from '@/lib/schemas/domain';
import { JoinForm } from './JoinForm';

export const metadata: Metadata = { title: 'Claim Access' };
export const dynamic = 'force-dynamic';

type CohortLookup = { status: 'found'; cohortName: string } | { status: 'invalid' } | { status: 'unknown' };

async function lookupCohort(joinCode: string): Promise<CohortLookup> {
  try {
    const snap = await adminDb.collection('cohorts').where('joinCode', '==', joinCode).limit(1).get();
    const doc = snap.docs[0];
    if (!doc) return { status: 'invalid' };
    const parsed = CohortDocSchema.safeParse({ id: doc.id, ...doc.data() });
    if (!parsed.success || !parsed.data.joinCodeEnabled) return { status: 'invalid' };
    return { status: 'found', cohortName: parsed.data.name };
  } catch (error) {
    // The claim API validates the code again, so the form can still work.
    console.error('[join] Cohort lookup failed', error);
    return { status: 'unknown' };
  }
}

export default async function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  let joinCode: string;
  try {
    joinCode = decodeURIComponent(code).trim().toUpperCase();
  } catch {
    joinCode = code.trim().toUpperCase();
  }
  const lookup = await lookupCohort(joinCode);

  if (lookup.status === 'invalid') {
    return (
      <div className="pulse-card p-6 sm:p-8">
        <h1 className="text-xl font-semibold tracking-tight">Join Code Not Active</h1>
        <p className="mt-2 text-sm text-pulse-secondary">
          The join code <span className="pulse-kbd">{joinCode}</span> is not valid or is no longer active. Ask your
          supervisor for the current code.
        </p>
        <Link href="/login" className="pulse-btn mt-6 w-full justify-center">
          Back to Sign-In
        </Link>
      </div>
    );
  }

  return <JoinForm joinCode={joinCode} cohortName={lookup.status === 'found' ? lookup.cohortName : null} />;
}
