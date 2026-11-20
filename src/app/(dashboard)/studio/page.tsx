import type { Metadata } from 'next';
import Link from 'next/link';
import { Layers, Plus } from 'lucide-react';
import { requirePageUser } from '@/lib/firebase/auth-guard';
import { INTERNAL_OPS_ROLES } from '@/lib/schemas/constants';
import { loadAllTracks } from '@/components/analytics/server-data';
import { EmptyState } from '@/components/analytics/KpiStrip';
import { TrackCatalogTable } from '@/components/studio/TrackCatalogTable';
import { SIM_COPY } from '@/lib/policy/training-policy';

export const metadata: Metadata = { title: 'Track Studio' };
export const dynamic = 'force-dynamic';

export default async function StudioCatalogPage() {
  await requirePageUser(INTERNAL_OPS_ROLES);
  const tracks = await loadAllTracks();

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="pulse-label">Track Studio</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">Campaign Tracks</h1>
          <p className="mt-1 text-sm text-pulse-muted">
            {tracks.length} Track{tracks.length === 1 ? '' : 's'} · Select a Track to test-play, edit or publish it.
          </p>
        </div>
        <Link href="/studio/new" className="pulse-btn pulse-btn-primary">
          <Plus aria-hidden className="size-4" />
          New Campaign Track
        </Link>
      </div>
      {tracks.length === 0 ? (
        <EmptyState
          icon={<Layers aria-hidden className="size-6" />}
          title="No Tracks yet"
          body={`Upload a Playbook PDF. Pulse builds the Checkpoints, Drills and ${SIM_COPY.plural} for you.`}
          action={
            <Link href="/studio/new" className="pulse-btn pulse-btn-primary">
              <Plus aria-hidden className="size-4" />
              New Campaign Track
            </Link>
          }
        />
      ) : (
        <TrackCatalogTable tracks={tracks} />
      )}
    </div>
  );
}
