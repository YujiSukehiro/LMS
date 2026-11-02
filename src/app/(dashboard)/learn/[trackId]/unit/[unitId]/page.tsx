import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { UnitRunner } from '../../../_components/UnitRunner';
import { loadLearnContext, readVersionParam } from '../../../_lib/learn-context';
import { allUnitsComplete, computeUnitStates, previewSuffix, sortUnits } from '../../../_lib/unit-states';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Checkpoint' };

interface PageProps {
  params: Promise<{ trackId: string; unitId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function UnitPage({ params, searchParams }: PageProps) {
  const { trackId, unitId } = await params;
  const query = await searchParams;
  const ctx = await loadLearnContext(trackId, readVersionParam(query.version));
  const { track, version, enrollment, isPreview, staffAccess, versionId } = ctx;

  const units = sortUnits(version.units);
  const index = units.findIndex((unit) => unit.id === unitId);
  if (index === -1) notFound();
  const unit = units[index];

  const suffix = previewSuffix(isPreview);
  const encodedTrack = encodeURIComponent(trackId);
  const mapHref = `/learn/${encodedTrack}${suffix}`;

  const completedUnitIds = enrollment?.completedUnitIds ?? [];
  const states = computeUnitStates(units, completedUnitIds);
  if (states[index] === 'locked' && !staffAccess) redirect(mapHref);

  const nextUnit = units[index + 1] ?? null;
  const nextUnitHref = nextUnit ? `/learn/${encodedTrack}/unit/${encodeURIComponent(nextUnit.id)}${suffix}` : null;

  const completedAfterThis = Array.from(new Set([...completedUnitIds, unit.id]));
  const firstScenario = version.simScenarios[0];
  const simHref =
    !nextUnit && firstScenario && (allUnitsComplete(units, completedAfterThis) || staffAccess)
      ? `/learn/${encodedTrack}/sim/${encodeURIComponent(firstScenario.id)}${suffix}`
      : null;

  const attempts = enrollment?.unitScores[unit.id]?.attemptsCount ?? 0;
  const seed = `${trackId}:${versionId}:${unit.id}:${attempts}`;

  return (
    <UnitRunner
      trackId={trackId}
      trackTitle={track.title}
      campaignCode={track.campaignCode}
      versionId={versionId}
      isPreview={isPreview}
      unit={unit}
      unitNumber={index + 1}
      unitCount={units.length}
      pillars={version.competencyPillars}
      seed={seed}
      mapHref={mapHref}
      nextUnitHref={nextUnitHref}
      simHref={simHref}
    />
  );
}
