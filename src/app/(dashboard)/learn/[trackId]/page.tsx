import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, Brain, Eye } from 'lucide-react';
import { CheckpointMap, type CheckpointMapScenario, type CheckpointMapUnit } from '@/components/learn/CheckpointMap';
import { LearningEvidencePanel } from '@/components/learn/LearningEvidencePanel';
import { ServiceError } from '@/lib/services/errors';
import { loadLearningEvidenceForUser, type LearningEvidenceView } from '@/lib/services/learning-evidence';
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

  let evidence: LearningEvidenceView | null = null;
  let legacyEvidenceOnly = false;
  if (!isPreview) {
    try {
      evidence = await loadLearningEvidenceForUser({ user: ctx.user, trackId });
    } catch (error) {
      if (error instanceof ServiceError && error.code === 'ASSESSMENT_BLUEPRINT_MISSING') legacyEvidenceOnly = true;
      else throw error;
    }
  }

  const units = sortUnits(version.units);
  const completedUnitIds = enrollment?.completedUnitIds ?? [];
  const states = computeUnitStates(units, completedUnitIds);
  const unitsComplete = allUnitsComplete(units, completedUnitIds);
  const passedScenarioIds = new Set(
    evidence
      ? evidence.scenarioCoverage.filter((coverage) => coverage.status === 'passed').map((coverage) => coverage.scenarioId)
      : (enrollment?.passedScenarioIds ?? []),
  );
  const certified = evidence?.certification?.status === 'certified';
  const masteryPct = evidence?.analytics.currentMastery.ratio === null || !evidence
    ? null
    : evidence.analytics.currentMastery.ratio * 100;
  const bestScores = isPreview ? {} : await loadBestScenarioScores(ctx.user.uid, trackId);

  const ruleLabels: Record<string, string> = {};
  for (const unit of units) {
    for (const drill of unit.drills) {
      for (const ruleId of drill.ruleIds ?? []) ruleLabels[ruleId] ??= unit.title;
    }
  }

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
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 pb-12">
      <Link href="/" className="inline-flex w-fit items-center gap-1.5 text-xs text-pulse-muted hover:text-pulse-primary">
        <ArrowLeft aria-hidden className="size-4" />
        All Tracks
      </Link>

      <TrackHeader
        track={track}
        masteryPct={masteryPct}
        xpEarned={enrollment?.xpEarned ?? 0}
        certified={certified}
        isPreview={isPreview}
        versionNumber={version.versionNumber}
      />

      {isPreview ? (
        <p className="flex items-start gap-2 rounded-pulse-md border border-pulse-amber/40 bg-pulse-amber/10 px-4 py-3 text-sm text-pulse-amber">
          <Eye aria-hidden className="mt-0.5 size-4 shrink-0" />
          Draft preview. Progress is not saved and every Checkpoint is open.
        </p>
      ) : null}
      {legacyEvidenceOnly ? (
        <p role="note" className="rounded-pulse-md border border-pulse-amber/40 bg-pulse-amber/10 px-4 py-3 text-sm text-pulse-secondary">
          <strong>Your earlier progress is saved but not verified.</strong> It does not count toward mastery or certification on this
          version of the Track. A Trainer must publish a new version with assessment rules; your next attempts will then count.
        </p>
      ) : null}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section aria-labelledby="checkpoint-path-heading" className="min-w-0">
          <h2 id="checkpoint-path-heading" className="pulse-label mb-3">
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
        <aside className="flex min-w-0 flex-col gap-3 lg:sticky lg:top-20">
          {!isPreview &&
          evidence &&
          (evidence.analytics.delayedRetention.due > 0 || evidence.analytics.upcomingReviews.length > 0) ? (
            <section
              aria-label="Track Knowledge Retention"
              className="pulse-card flex flex-wrap items-center justify-between gap-3 px-4 py-2.5"
            >
              <div className="flex items-start gap-2.5">
                <Brain aria-hidden className="mt-0.5 size-4 shrink-0 text-pulse-indigo" />
                <div>
                  <p className="text-sm font-semibold text-pulse-primary">
                    {evidence.analytics.delayedRetention.due > 0
                      ? `${evidence.analytics.delayedRetention.due} review${evidence.analytics.delayedRetention.due === 1 ? '' : 's'} due for this Track`
                      : `${evidence.analytics.upcomingReviews.length} review${evidence.analytics.upcomingReviews.length === 1 ? '' : 's'} scheduled`}
                  </p>
                </div>
              </div>
              <Link
                href={`/learn/review?trackId=${encodeURIComponent(trackId)}`}
                className={evidence.analytics.delayedRetention.due > 0 ? 'pulse-btn pulse-btn-primary text-xs' : 'pulse-btn text-xs'}
              >
                Review now <ArrowRight aria-hidden className="size-3.5" />
              </Link>
            </section>
          ) : null}

          {evidence ? (
            <LearningEvidencePanel
              analytics={evidence.analytics}
              certification={evidence.certification}
              scenarioCoverage={evidence.scenarioCoverage}
              scenarioLabels={evidence.scenarioLabels}
              ruleLabels={ruleLabels}
            />
          ) : null}
        </aside>
      </div>
    </div>
  );
}
