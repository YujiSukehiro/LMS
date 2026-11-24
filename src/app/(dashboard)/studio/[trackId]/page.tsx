import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft, TriangleAlert } from 'lucide-react';
import { requirePageUser } from '@/lib/firebase/auth-guard';
import { INTERNAL_OPS_ROLES } from '@/lib/schemas/constants';
import { loadAllAgents, loadCohortOptions, loadDraftWithSecrets, loadTrack, trackNeedsBuild } from '@/components/analytics/server-data';
import type { PublishCohortOption, PublishPersonOption } from '@/components/studio/PublishDialog';
import { GenerationStepper } from '@/components/studio/GenerationStepper';
import { newTrackViewFor } from '@/components/studio/generation-view';
import { TrackStudio } from '@/components/studio/TrackStudio';
import { SIM_COPY } from '@/lib/policy/training-policy';

export const metadata: Metadata = { title: 'Track Studio' };
export const dynamic = 'force-dynamic';

export default async function TrackStudioPage({
  params,
  searchParams,
}: {
  params: Promise<{ trackId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Internal ops only: this page serializes the secret Simulation configs to the browser.
  await requirePageUser(INTERNAL_OPS_ROLES);
  const { trackId } = await params;
  const rawDrill = (await searchParams).drill;
  const focusDrillId = typeof rawDrill === 'string' && rawDrill.trim() ? rawDrill.trim() : null;
  const track = await loadTrack(trackId);
  if (!track) notFound();

  if (trackNeedsBuild(track)) {
    // An uploaded source that was never built goes through the Content map, not straight into a build.
    if (newTrackViewFor(track.generationProgress) === 'content-map') redirect(`/studio/new?trackId=${encodeURIComponent(track.id)}`);
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-5">
        <BackLink />
        <GenerationStepper trackId={track.id} trackTitle={track.title} initialProgress={track.generationProgress} />
      </div>
    );
  }

  const [{ draft, secrets }, cohortOptions, agents] = await Promise.all([
    loadDraftWithSecrets(track.id),
    loadCohortOptions(),
    loadAllAgents(),
  ]);
  // Publish & Assign lists each Cohort with how many active agents it would reach (Cohort + the Track's Division).
  const reachByCohort = new Map<string, number>();
  for (const agent of agents) {
    if (!agent.active || !agent.divisionIds.includes(track.divisionId)) continue;
    // Home Cohort and extra Cohorts both receive the Track.
    for (const cohortId of new Set([agent.partnerCohortId, ...(agent.cohortIds ?? [])])) {
      reachByCohort.set(cohortId, (reachByCohort.get(cohortId) ?? 0) + 1);
    }
  }
  const cohorts: PublishCohortOption[] = cohortOptions.map((cohort) => ({ ...cohort, reach: reachByCohort.get(cohort.id) ?? 0 }));
  const cohortNames = new Map(cohortOptions.map((cohort) => [cohort.id, cohort.name]));
  // People who can be assigned one by one: active agents with the Track's Division (others would not see it).
  const people: PublishPersonOption[] = agents
    .filter((agent) => agent.active && agent.divisionIds.includes(track.divisionId))
    .map((agent) => ({
      uid: agent.uid,
      name: agent.displayName,
      detail: [agent.lcNumber ?? agent.email, cohortNames.get(agent.partnerCohortId) ?? agent.partnerCohortId].filter(Boolean).join(' · '),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

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
            The build did not finish. Start the build again to create the Checkpoints and {SIM_COPY.plural} from the Playbook.
          </p>
          <GenerationStepper trackId={track.id} trackTitle={track.title} initialProgress={track.generationProgress} />
        </div>
      </div>
    );
  }

  return <TrackStudio track={track} draft={draft} initialSecrets={secrets} cohorts={cohorts} people={people} focusDrillId={focusDrillId} />;
}

function BackLink() {
  return (
    <Link href="/studio" className="inline-flex w-fit items-center gap-1.5 text-sm text-pulse-muted hover:text-pulse-primary">
      <ArrowLeft aria-hidden className="size-4" />
      Track Studio
    </Link>
  );
}
