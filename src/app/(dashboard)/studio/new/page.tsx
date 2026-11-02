import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { requirePageUser } from '@/lib/firebase/auth-guard';
import { INTERNAL_OPS_ROLES } from '@/lib/schemas/constants';
import { loadTrack, trackNeedsBuild } from '@/components/analytics/server-data';
import { NewTrackForm } from '@/components/studio/NewTrackForm';
import { GenerationStepper } from '@/components/studio/GenerationStepper';

export const metadata: Metadata = { title: 'New Campaign Track' };
export const dynamic = 'force-dynamic';

export default async function NewTrackPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePageUser(INTERNAL_OPS_ROLES);
  const params = await searchParams;
  const trackIdParam = typeof params.trackId === 'string' ? params.trackId : null;

  // A build that is already running (for example after a revised Playbook upload): show its live stepper.
  if (trackIdParam) {
    const track = await loadTrack(trackIdParam);
    if (track && !trackNeedsBuild(track)) redirect(`/studio/${encodeURIComponent(track.id)}`);
    if (track) {
      return (
        <div className="mx-auto flex max-w-2xl flex-col gap-5">
          <BackLink />
          <GenerationStepper trackId={track.id} trackTitle={track.title} initialProgress={track.generationProgress} />
        </div>
      );
    }
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <BackLink />
      <div>
        <p className="pulse-label">New Campaign Track</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">Upload a Playbook. Get an interactive Track.</h1>
        <p className="mt-1 text-sm text-pulse-muted">
          Three inputs. Pulse builds the Checkpoints, Briefing Cards, Drills and Live Call Sims from your Playbook PDF.
        </p>
      </div>
      <NewTrackForm />
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/studio" className="inline-flex w-fit items-center gap-1.5 text-sm text-pulse-muted hover:text-pulse-primary">
      <ArrowLeft aria-hidden className="size-4" />
      Track Studio
    </Link>
  );
}
