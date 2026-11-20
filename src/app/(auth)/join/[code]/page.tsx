import type { Metadata } from 'next';
import Link from 'next/link';
import { headers } from 'next/headers';
import { adminDb } from '@/lib/firebase/admin';
import { CohortDocSchema } from '@/lib/schemas/domain';
import { clientKey, joinCodeLimiter } from '@/lib/services/attempt-limiter';
import { JoinForm } from './JoinForm';
import { normalizeJoinCode, resolveJoinPage, type CohortLookup } from './join-lookup';

export const metadata: Metadata = { title: 'Claim Access' };
export const dynamic = 'force-dynamic';

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
  const joinCode = normalizeJoinCode(code);
  // clientKey reads the proxy headers from a Request; wrap the incoming headers in one.
  const client = clientKey(new Request('http://join.local/', { headers: await headers() }));
  const lookup = await resolveJoinPage({ joinCode, client, limiter: joinCodeLimiter, lookup: lookupCohort });

  if (lookup.status === 'rate_limited') {
    const minutes = Math.max(1, Math.ceil(lookup.retryAfterSeconds / 60));
    const wait = `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
    return (
      <div className="pulse-card p-6 sm:p-8">
        <h1 className="text-xl font-semibold tracking-tight">Too Many Join Codes Tried</h1>
        <p className="mt-2 text-sm text-pulse-secondary">
          Too many wrong join codes came from this connection. Wait about {wait}, then try again, or ask your
          supervisor for the current code.
        </p>
        <Link href="/login" className="pulse-btn mt-6 w-full justify-center">
          Back to Sign-In
        </Link>
      </div>
    );
  }

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
