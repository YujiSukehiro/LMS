import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, TriangleAlert } from 'lucide-react';
import { requirePageUser } from '@/lib/firebase/auth-guard';
import { INTERNAL_OPS_ROLES } from '@/lib/schemas/constants';
import { loadCohortOptions, loadDraftWithSecrets, loadTrack, trackNeedsBuild } from '@/components/analytics/server-data';
import { GenerationStepper } from '@/components/studio/GenerationStepper';
import { TrackStudio } from '@/components/studio/TrackStudio';

export const metadata: Metadata = { title: 'Track Studio' };
export const dynamic = 'force-dynamic';

export default async function TrackStudioPage({ params }: { params: Promise<{ trackId: string }> }) {
  // Internal ops only: this page serializes the secret Simulation configs to the browser.
  await requirePageUser(INTERNAL_OPS_ROLES);
  const { trackId } = await params;
  const track = await loadTrack(trackId);
  if (!track) notFound();

  if (trackNeedsBuild(track)) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-5">
        <BackLink />
        <GenerationStepper trackId={track.id} trackTitle={track.title} initialProgress={track.generationProgress} />
      </div>
    );
  }

  const [{ draft, secrets }, cohorts] = await Promise.all([loadDraftWithSecrets(track.id), loadCohortOptions()]);

  if (!draft) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-5">
        <BackLink />
        <div className="pulse-card flex flex-col items-start gap-3 p-6">
          <p className="flex items-center gap-2 font-semibold text-pulse-amber">
            <TriangleAlert aria-hidden className="size-5" />
            This Track has no draft yet
          </p>
          <p className="text-sm text-pulse-secondary">
            The build did not finish. Start the build again to create the Checkpoints and Live Call Sims from the Playbook.
          </p>
          <GenerationStepper trackId={track.id} trackTitle={track.title} initialProgress={track.generationProgress} />
        </div>
      </div>
    );
  }

  return <TrackStudio track={track} draft={draft} initialSecrets={secrets} cohorts={cohorts} />;
}

function BackLink() {
  return (
    <Link href="/studio" className="inline-flex w-fit items-center gap-1.5 text-sm text-pulse-muted hover:text-pulse-primary">
      <ArrowLeft aria-hidden className="size-4" />
      Track Studio
    </Link>
  );
}
