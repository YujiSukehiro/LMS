import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { PublicSimScenarioSchema } from '@/lib/schemas/curriculum';
import { SimulationRunner } from '../../../_components/SimulationRunner';
import { loadLearnContext, readVersionParam } from '../../../_lib/learn-context';
import { allUnitsComplete, previewSuffix } from '../../../_lib/unit-states';
import { findResumableSession } from '@/lib/services/sim-resume';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Verbal Practice' };

interface PageProps {
  params: Promise<{ trackId: string; scenarioId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function SimulationPage({ params, searchParams }: PageProps) {
  const { trackId, scenarioId } = await params;
  const query = await searchParams;
  const ctx = await loadLearnContext(trackId, readVersionParam(query.version));
  const { track, version, enrollment, isPreview, staffAccess, versionId, user } = ctx;

  const rawScenario = version.simScenarios.find((scenario) => scenario.id === scenarioId);
  if (!rawScenario) notFound();

  const mapHref = `/learn/${encodeURIComponent(trackId)}${previewSuffix(isPreview)}`;
  if (!staffAccess && !allUnitsComplete(version.units, enrollment?.completedUnitIds ?? [])) redirect(mapHref);

  // Re-parse so only the public scenario fields ever reach the browser.
  const scenario = PublicSimScenarioSchema.parse(rawScenario);
  const pillarLabels = Object.fromEntries(version.competencyPillars.map((pillar) => [pillar.id, pillar.label]));
  // Start resumes this run (200), so the intro can say so after a reload. Best effort: never blocks the page.
  const resumable = await findResumableSession(user.uid, trackId, versionId, scenarioId).catch(() => null);

  return (
    <SimulationRunner
      trackId={trackId}
      trackTitle={track.title}
      versionId={versionId}
      isPreview={isPreview}
      scenario={scenario}
      campaignCode={track.campaignCode}
      divisionId={track.divisionId}
      pillarLabels={pillarLabels}
      mapHref={mapHref}
      resumeTurnCount={resumable ? resumable.turnCount : null}
    />
  );
}
