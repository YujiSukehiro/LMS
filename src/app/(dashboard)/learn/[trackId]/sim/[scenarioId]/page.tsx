import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { PublicSimScenarioSchema } from '@/lib/schemas/curriculum';
import { SimulationRunner } from '../../../_components/SimulationRunner';
import { loadLearnContext, readVersionParam } from '../../../_lib/learn-context';
import { allUnitsComplete, previewSuffix } from '../../../_lib/unit-states';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Live Call Sim' };

interface PageProps {
  params: Promise<{ trackId: string; scenarioId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function SimulationPage({ params, searchParams }: PageProps) {
  const { trackId, scenarioId } = await params;
  const query = await searchParams;
  const ctx = await loadLearnContext(trackId, readVersionParam(query.version));
  const { track, version, enrollment, isPreview, staffAccess, versionId } = ctx;

  const rawScenario = version.simScenarios.find((scenario) => scenario.id === scenarioId);
  if (!rawScenario) notFound();

  const mapHref = `/learn/${encodeURIComponent(trackId)}${previewSuffix(isPreview)}`;
  if (!staffAccess && !allUnitsComplete(version.units, enrollment?.completedUnitIds ?? [])) redirect(mapHref);

  // Re-parse so only the public scenario fields ever reach the browser.
  const scenario = PublicSimScenarioSchema.parse(rawScenario);
  const pillarLabels = Object.fromEntries(version.competencyPillars.map((pillar) => [pillar.id, pillar.label]));

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
    />
  );
}
