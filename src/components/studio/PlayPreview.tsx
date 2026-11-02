'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { CircleCheck, ExternalLink, Lock, RotateCw, TriangleAlert } from 'lucide-react';
import type {
  CompetencyPillar,
  PublicSimScenario,
  SecretSimScenarioConfig,
  TrackUnit,
} from '@/lib/schemas/curriculum';
import type { DrillResult } from '@/lib/schemas/api';
import type { DivisionId } from '@/lib/schemas/domain';
import { BriefingDeck } from '@/components/learn/BriefingDeck';
import { DrillRunner } from '@/components/learn/DrillRunner';
import { CallTicketHeader } from '@/components/simulation/CallTicketHeader';
import { cn } from '@/lib/utils';

type UnitPhase = { kind: 'briefing' } | { kind: 'drills' } | { kind: 'done'; results: DrillResult[] };

/** Plays one Unit exactly as an agent sees it. Nothing is posted to the progress API. */
export function UnitPlayPreview({
  unit,
  unitNumber,
  pillars,
  trackId,
}: {
  unit: TrackUnit;
  unitNumber: number;
  pillars: CompetencyPillar[];
  trackId: string;
}) {
  const [phase, setPhase] = useState<UnitPhase>({ kind: 'briefing' });
  const [round, setRound] = useState(0);

  const restart = () => {
    setPhase({ kind: 'briefing' });
    setRound((r) => r + 1);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="pulse-label">Checkpoint {unitNumber} · Test-play</p>
          <h2 className="text-lg font-semibold tracking-tight">{unit.title}</h2>
        </div>
        <div className="flex items-center gap-2">
          <PhaseTab active={phase.kind === 'briefing'} onClick={() => setPhase({ kind: 'briefing' })}>
            Briefing Cards
          </PhaseTab>
          <PhaseTab active={phase.kind !== 'briefing'} onClick={() => setPhase({ kind: 'drills' })}>
            Drills
          </PhaseTab>
          <button type="button" className="pulse-btn pulse-btn-ghost px-2" onClick={restart} aria-label="Restart this Checkpoint">
            <RotateCw aria-hidden className="size-4" />
          </button>
        </div>
      </div>
      <div className="pulse-cq">
        {phase.kind === 'briefing' ? (
          <BriefingDeck
            key={`deck-${unit.id}-${round}`}
            cards={unit.briefingCards}
            onComplete={() => setPhase({ kind: 'drills' })}
            completeLabel="Start Drills"
          />
        ) : phase.kind === 'drills' ? (
          <DrillRunner
            key={`drills-${unit.id}-${round}`}
            drills={unit.drills}
            pillars={pillars}
            seed={`${trackId}:${unit.id}:studio:${round}`}
            trackId={trackId}
            versionId="draft"
            unitId={unit.id}
            onComplete={(results) => setPhase({ kind: 'done', results })}
          />
        ) : (
          <PreviewResult results={phase.results} onRestart={restart} />
        )}
      </div>
    </div>
  );
}

function PhaseTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-pulse-sm px-2.5 py-1 text-xs font-semibold transition-colors',
        active ? 'bg-pulse-surface-2 text-pulse-primary' : 'text-pulse-muted hover:text-pulse-secondary',
      )}
    >
      {children}
    </button>
  );
}

function PreviewResult({ results, onRestart }: { results: DrillResult[]; onRestart: () => void }) {
  const firstTry = results.filter((r) => r.passedFirstTry).length;
  const pct = results.length === 0 ? 0 : Math.round((firstTry / results.length) * 100);
  return (
    <div className="pulse-card flex flex-col items-center gap-3 p-8 text-center">
      <CircleCheck aria-hidden className="size-10 text-pulse-emerald" />
      <p className="text-lg font-semibold">Checkpoint complete</p>
      <p className="text-sm text-pulse-muted">
        First-try accuracy <span className="pulse-metric font-semibold text-pulse-primary">{pct}%</span> ({firstTry} of {results.length}{' '}
        Drills). Test-play results are not saved.
      </p>
      <button type="button" className="pulse-btn" onClick={onRestart}>
        <RotateCw aria-hidden className="size-4" />
        Play again
      </button>
    </div>
  );
}

/** Live Call Sim preview: ticket header, opening message and the hidden persona + rubric summary for trainers. */
export function ScenarioPlayPreview({
  scenario,
  secret,
  trackId,
  campaignCode,
  divisionId,
  hasUnsavedChanges,
}: {
  scenario: PublicSimScenario;
  secret: SecretSimScenarioConfig | undefined;
  trackId: string;
  campaignCode: string;
  divisionId: DivisionId;
  hasUnsavedChanges: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="pulse-cq overflow-hidden rounded-pulse-lg border border-pulse-border-subtle">
        <CallTicketHeader scenario={scenario} campaignCode={campaignCode} divisionId={divisionId} turnCount={0} disabled />
        <div className="flex flex-col gap-3 bg-pulse-surface-1 p-4">
          <div className="max-w-[85%] rounded-pulse-lg rounded-tl-sm bg-pulse-surface-2 px-4 py-3">
            <p className="pulse-label mb-1">{scenario.counterpartyRoleLabel}</p>
            <p className="text-sm leading-relaxed text-pulse-primary">{scenario.openingMessage}</p>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-pulse-border-subtle pt-3">
            <p className="text-xs text-pulse-muted">
              The test-play uses the saved draft. Draft sessions never change enrollments or analytics.
            </p>
            <Link
              href={`/learn/${encodeURIComponent(trackId)}/sim/${encodeURIComponent(scenario.id)}?version=draft`}
              className="pulse-btn pulse-btn-primary"
              target="_blank"
              rel="noopener"
            >
              Test-Play This Simulation
              <ExternalLink aria-hidden className="size-4" />
            </Link>
          </div>
          {hasUnsavedChanges ? (
            <p className="flex items-center gap-1.5 text-xs text-pulse-amber">
              <TriangleAlert aria-hidden className="size-3.5" />
              You have unsaved changes. Save the draft first so the test-play uses them.
            </p>
          ) : null}
        </div>
      </div>

      <section className="pulse-card flex flex-col gap-4 p-4">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">Hidden persona and rubric</h3>
          <span className="pulse-pill pulse-pill-amber text-[0.68rem]">
            <Lock aria-hidden className="size-3" />
            Trainers only
          </span>
        </div>
        {secret ? (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-3 text-sm">
              <Detail label="Persona">{secret.personaName}</Detail>
              <Detail label="Backstory and mood">{secret.personaBackstoryAndMood}</Detail>
              <Detail label="Expected disposition">
                <span className="pulse-pill pulse-pill-emerald">{secret.expectedDisposition}</span>
              </Detail>
              <ListDetail label="Hidden facts" items={secret.hiddenFactsToRevealOnlyWhenAsked} />
              <ListDetail label="Caller behaviors" items={secret.conditionalBehaviors} />
              <ListDetail label="Auto-fail triggers" items={secret.autoFailTriggers} tone="crimson" />
            </div>
            <div className="flex flex-col gap-2">
              <p className="pulse-label">Rubric criteria</p>
              <ul className="flex flex-col gap-2">
                {secret.rubricCriteria.map((criterion) => (
                  <li key={criterion.id} className="rounded-pulse-md border border-pulse-border-subtle p-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-semibold">{criterion.criterionLabel}</p>
                      <span className="pulse-metric pulse-pill">{criterion.weight}%</span>
                    </div>
                    <p className="mt-1 text-xs text-pulse-secondary">{criterion.evaluationRule}</p>
                    {criterion.sourcePages.length > 0 ? (
                      <p className="pulse-metric mt-1 text-[0.68rem] text-pulse-muted">Playbook p. {criterion.sourcePages.join(', ')}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
              <p className="pulse-metric text-xs text-pulse-muted">
                Pass score {scenario.passScoreThreshold}% · up to {scenario.maxTurns} turns
              </p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-pulse-amber">This Live Call Sim has no hidden persona or rubric yet. Add them in Edit mode.</p>
        )}
      </section>
    </div>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="pulse-label mb-0.5">{label}</p>
      <div className="text-pulse-secondary">{children}</div>
    </div>
  );
}

function ListDetail({ label, items, tone }: { label: string; items: string[]; tone?: 'crimson' }) {
  return (
    <div>
      <p className="pulse-label mb-0.5">{label}</p>
      {items.length === 0 ? (
        <p className="text-xs text-pulse-muted">None.</p>
      ) : (
        <ul className={cn('list-disc space-y-0.5 pl-4 text-pulse-secondary', tone === 'crimson' && 'marker:text-pulse-crimson')}>
          {items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
