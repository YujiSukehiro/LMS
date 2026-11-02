import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, Eye } from 'lucide-react';
import { CheckpointMap, type CheckpointMapScenario, type CheckpointMapUnit } from '@/components/learn/CheckpointMap';
import { TrackHeader } from '../_components/TrackHeader';
import { loadBestScenarioScores, loadLearnContext, readVersionParam } from '../_lib/learn-context';
import { allUnitsComplete, computeUnitStates, previewSuffix, sortUnits } from '../_lib/unit-states';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Track Map' };

interface PageProps {
  params: Promise<{ trackId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function TrackMapPage({ params, searchParams }: PageProps) {
  const { trackId } = await params;
  const query = await searchParams;
  const ctx = await loadLearnContext(trackId, readVersionParam(query.version));
  const { track, version, enrollment, isPreview, staffAccess } = ctx;

  const units = sortUnits(version.units);
  const completedUnitIds = enrollment?.completedUnitIds ?? [];
  const states = computeUnitStates(units, completedUnitIds);
  const unitsComplete = allUnitsComplete(units, completedUnitIds);
  const passedScenarioIds = new Set(enrollment?.passedScenarioIds ?? []);
  const certified = !isPreview && enrollment?.status === 'CERTIFIED';
  const bestScores = isPreview ? {} : await loadBestScenarioScores(ctx.user.uid, trackId);

  const mapUnits: CheckpointMapUnit[] = units.map((unit, index) => ({
    id: unit.id,
    title: unit.title,
    summary: unit.summary,
    estimatedMinutes: unit.estimatedMinutes,
    state: states[index],
    firstTryAccuracyPct: enrollment?.unitScores[unit.id]?.firstTryAccuracyPct ?? null,
  }));

  const mapScenarios: CheckpointMapScenario[] = version.simScenarios.map((scenario) => ({
    id: scenario.id,
    title: scenario.title,
    difficulty: scenario.difficulty,
    counterpartyRoleLabel: scenario.counterpartyRoleLabel,
    passScoreThreshold: scenario.passScoreThreshold,
    bestScorePct: bestScores[scenario.id] ?? null,
    passed: passedScenarioIds.has(scenario.id),
  }));

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 pb-12">
      <Link href="/" className="inline-flex w-fit items-center gap-1.5 text-sm text-pulse-muted hover:text-pulse-primary">
        <ArrowLeft aria-hidden className="size-4" />
        All Tracks
      </Link>

      <TrackHeader
        track={track}
        masteryPct={enrollment?.progressPct ?? 0}
        xpEarned={enrollment?.xpEarned ?? 0}
        certified={certified}
        isPreview={isPreview}
        versionNumber={version.versionNumber}
      />

      {isPreview ? (
        <p className="flex items-start gap-2 rounded-pulse-md border border-pulse-amber/40 bg-pulse-amber/10 px-4 py-3 text-sm text-pulse-amber">
          <Eye aria-hidden className="mt-0.5 size-4 shrink-0" />
          Preview only — you are playing the draft TrackVersion. Progress is not recorded and every Checkpoint is open.
        </p>
      ) : null}

      <section aria-labelledby="checkpoint-path-heading">
        <h2 id="checkpoint-path-heading" className="pulse-label mb-4">
          Checkpoint Path · <span className="pulse-metric">{completedUnitIds.filter((id) => units.some((u) => u.id === id)).length}</span>/
          <span className="pulse-metric">{units.length}</span> complete
        </h2>
        <CheckpointMap
          trackId={trackId}
          units={mapUnits}
          scenarios={mapScenarios}
          simUnlocked={unitsComplete || staffAccess}
          certified={certified}
          hrefSuffix={previewSuffix(isPreview)}
          staffAccess={staffAccess}
        />
      </section>
    </div>
  );
}
