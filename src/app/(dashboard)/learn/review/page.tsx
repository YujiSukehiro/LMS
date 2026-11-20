import type { Metadata } from 'next';
import { requirePageUser } from '@/lib/firebase/auth-guard';
import { loadRetentionQueueForUser } from '@/lib/services/retention-queue';
import { RetentionRunner } from '../_components/RetentionRunner';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Knowledge Retention' };

export default async function RetentionReviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePageUser();
  const query = await searchParams;
  const rawTrackId = Array.isArray(query.trackId) ? query.trackId[0] : query.trackId;
  const initialTrackId = typeof rawTrackId === 'string' && rawTrackId.trim().length > 0 ? rawTrackId.trim() : null;

  const queue = await loadRetentionQueueForUser(user);

  return <RetentionRunner queue={queue} initialTrackId={initialTrackId} />;
}
