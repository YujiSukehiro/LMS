'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ArrowLeft, CircleAlert, CircleCheck, FileText, LoaderCircle, Pencil, Play, Save, ShieldCheck } from 'lucide-react';
import {
  BriefingCardSchema,
  DrillItemSchema,
  PublicSimScenarioSchema,
  type PublicSimScenario,
  type SecretSimScenarioConfig,
  type TrackDoc,
  type TrackUnit,
  type TrackVersionDoc,
} from '@/lib/schemas/curriculum';
import { cn } from '@/lib/utils';
import { DivisionPill } from '@/components/layout/DivisionPill';
import { TrackStatusPill } from './TrackStatusPill';
import { OutlineTree, type StudioSelection } from './OutlineTree';
import { InlineUnitEditor } from './InlineUnitEditor';
import { ScenarioEditor } from './editor/ScenarioEditor';
import { TextField } from './editor/fields';
import { ScenarioPlayPreview, UnitPlayPreview } from './PlayPreview';
import { RegenerateItemButton } from './RegenerateItemButton';
import { PublishDialog, type PublishCohortOption } from './PublishDialog';
import { RevisedPlaybookDialog } from './RevisedPlaybookDialog';
import { SourceReview } from './SourceReview';
import { fetchDraftSecrets, patchTrackDraft, regenerateItem } from './api-client';
import { issueTargetsKey, validateStudioDraft, type StudioIssue } from './validation';

type SaveState = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved'; at: number } | { kind: 'error'; message: string };

/**
 * Split-pane Track Studio: outline tree, Play / Edit center column, Save Draft, Publish & Assign.
 * Rendered only for internal ops (the page checks the role), so the secret Simulation configs are safe here.
 */
export function TrackStudio({
  track,
  draft,
  initialSecrets,
  cohorts,
}: {
  track: TrackDoc;
  draft: TrackVersionDoc;
  initialSecrets: SecretSimScenarioConfig[];
  cohorts: PublishCohortOption[];
}) {
  const [title, setTitle] = useState(track.title);
  const [units, setUnits] = useState<TrackUnit[]>(() => [...draft.units].sort((a, b) => a.orderIndex - b.orderIndex));
  const [scenarios, setScenarios] = useState<PublicSimScenario[]>(draft.simScenarios);
  const [secrets, setSecrets] = useState<SecretSimScenarioConfig[]>(initialSecrets);
  const [dirty, setDirty] = useState(false);
  const [mode, setMode] = useState<'play' | 'edit' | 'source'>('play');
  const [selection, setSelection] = useState<StudioSelection | null>(() =>
    draft.units.length > 0
      ? { kind: 'unit', unitId: [...draft.units].sort((a, b) => a.orderIndex - b.orderIndex)[0].id }
      : draft.simScenarios[0]
        ? { kind: 'scenario', scenarioId: draft.simScenarios[0].id }
        : null,
  );
  const [saveState, setSaveState] = useState<SaveState>({ kind: 'idle' });
  const [issues, setIssues] = useState<StudioIssue[]>([]);
  const [playRevision, setPlayRevision] = useState(0);

  const pillars = draft.competencyPillars.length > 0 ? draft.competencyPillars : track.competencyPillars;
  const issueKeys = useMemo(() => new Set(issues.map((i) => issueTargetsKey(i.target))), [issues]);

  const markDirty = () => {
    setDirty(true);
    if (saveState.kind === 'saved') setSaveState({ kind: 'idle' });
  };

  // Warn before the tab closes with unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const save = useCallback(async (): Promise<boolean> => {
    const found = validateStudioDraft({ title, units, simScenarios: scenarios, secretScenarios: secrets, pillars });
    setIssues(found);
    if (found.length > 0) {
      setSaveState({ kind: 'error', message: `${found.length} problem${found.length === 1 ? '' : 's'} to fix before saving.` });
      return false;
    }
    setSaveState({ kind: 'saving' });
    try {
      const ordered = units.map((unit, index) => ({ ...unit, orderIndex: index }));
      const updatedAt = await patchTrackDraft(track.id, {
        title: title.trim(),
        units: ordered,
        simScenarios: scenarios,
        secretScenarios: secrets.filter((s) => scenarios.some((sc) => sc.id === s.scenarioId)),
      });
      setDirty(false);
      setSaveState({ kind: 'saved', at: updatedAt });
      return true;
    } catch (err) {
      setSaveState({ kind: 'error', message: err instanceof Error ? err.message : 'The draft did not save.' });
      return false;
    }
  }, [title, units, scenarios, secrets, pillars, track.id]);

  // Ctrl/Cmd + S saves the draft.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (dirty) void save();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [dirty, save]);

  const beforePublish = useCallback(async () => (dirty ? save() : true), [dirty, save]);

  async function regenerate(
    target: { targetType: 'CARD' | 'DRILL'; itemId: string; unitId: string } | { targetType: 'SCENARIO'; itemId: string },
    hint: string | undefined,
  ) {
    const item = await regenerateItem(track.id, {
      targetType: target.targetType,
      itemId: target.itemId,
      unitId: target.targetType === 'SCENARIO' ? undefined : target.unitId,
      trainerHint: hint,
    });
    if (target.targetType === 'CARD') {
      const card = BriefingCardSchema.safeParse(item);
      if (!card.success) throw new Error('The server sent an item that is not a Briefing Card.');
      setUnits((prev) =>
        prev.map((u) =>
          u.id === target.unitId
            ? { ...u, briefingCards: u.briefingCards.map((c) => (c.id === target.itemId ? card.data : c)) }
            : u,
        ),
      );
    } else if (target.targetType === 'DRILL') {
      const drill = DrillItemSchema.safeParse(item);
      if (!drill.success) throw new Error('The server sent an item that is not a Drill.');
      setUnits((prev) =>
        prev.map((u) =>
          u.id === target.unitId ? { ...u, drills: u.drills.map((d) => (d.id === target.itemId ? drill.data : d)) } : u,
        ),
      );
    } else {
      const scenario = PublicSimScenarioSchema.safeParse(item);
      if (!scenario.success) throw new Error('The server sent an item that is not a Live Call Sim.');
      setScenarios((prev) => prev.map((s) => (s.id === target.itemId ? scenario.data : s)));
      if (scenario.data.id !== target.itemId) {
        setSelection({ kind: 'scenario', scenarioId: scenario.data.id });
      }
      // The server also rewrites the hidden persona and rubric; read them back.
      const fresh = await fetchDraftSecrets(track.id);
      if (fresh) {
        const updated = fresh.find((s) => s.scenarioId === scenario.data.id);
        if (updated) {
          setSecrets((prev) => [
            ...prev.filter((s) => s.scenarioId !== target.itemId && s.scenarioId !== scenario.data.id),
            updated,
          ]);
        }
      }
    }
    setPlayRevision((r) => r + 1);
  }

  const selectedUnitIndex = selection?.kind === 'unit' ? units.findIndex((u) => u.id === selection.unitId) : -1;
  const selectedUnit = selectedUnitIndex >= 0 ? units[selectedUnitIndex] : null;
  const selectedScenarioIndex =
    selection?.kind === 'scenario' ? scenarios.findIndex((s) => s.id === selection.scenarioId) : -1;
  const selectedScenario = selectedScenarioIndex >= 0 ? scenarios[selectedScenarioIndex] : null;
  const selectedSecret = selectedScenario ? secrets.find((s) => s.scenarioId === selectedScenario.id) : undefined;

  return (
    <div className="flex flex-col gap-5">
      <Link href="/studio" className="inline-flex w-fit items-center gap-1.5 text-sm text-pulse-muted hover:text-pulse-primary">
        <ArrowLeft aria-hidden className="size-4" />
        Track Studio
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <DivisionPill divisionId={track.divisionId} />
            <TrackStatusPill status={track.status} />
            {track.campaignCode ? <span className="pulse-pill pulse-metric">{track.campaignCode}</span> : null}
          </div>
          <h1 className="mt-2 text-2xl font-bold tracking-tight">{title || track.title}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-pulse-muted">
            <span className="pulse-metric">Draft v{draft.versionNumber}</span>
            {track.publishedVersionId ? <span className="pulse-metric">Published {track.publishedVersionId}</span> : null}
            <span className="flex items-center gap-1">
              <FileText aria-hidden className="size-3.5" />
              {track.sourcePdfFileName} · {track.sourcePageCount} pages
            </span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Studio mode" className="flex rounded-pulse-md border border-pulse-border bg-pulse-surface-1 p-0.5">
            <ModeButton active={mode === 'play'} onClick={() => setMode('play')} icon={<Play aria-hidden className="size-4" />}>
              Play
            </ModeButton>
            <ModeButton active={mode === 'edit'} onClick={() => setMode('edit')} icon={<Pencil aria-hidden className="size-4" />}>
              Edit
            </ModeButton>
            <ModeButton active={mode === 'source'} onClick={() => setMode('source')} icon={<ShieldCheck aria-hidden className="size-4" />}>
              Source Review
            </ModeButton>
          </div>
          <SaveIndicator dirty={dirty} state={saveState} />
          <button type="button" className="pulse-btn" onClick={() => void save()} disabled={!dirty || saveState.kind === 'saving'}>
            {saveState.kind === 'saving' ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : <Save aria-hidden className="size-4" />}
            Save Draft
          </button>
          <RevisedPlaybookDialog
            trackId={track.id}
            title={title.trim() || track.title}
            campaignCode={track.campaignCode}
            divisionId={track.divisionId}
            hasUnsavedChanges={dirty}
          />
          <PublishDialog
            trackId={track.id}
            trackTitle={title || track.title}
            cohorts={cohorts}
            initialCohortIds={track.assignedCohortIds}
            beforePublish={beforePublish}
            onOpenSourceReview={() => setMode('source')}
            disabled={saveState.kind === 'saving'}
          />
        </div>
      </header>

      {issues.length > 0 ? (
        <section role="alert" className="rounded-pulse-lg border border-pulse-crimson/40 bg-pulse-crimson/5 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-pulse-crimson">
            <CircleAlert aria-hidden className="size-4" />
            Fix {issues.length === 1 ? 'this problem' : `these ${issues.length} problems`} to save the draft
          </p>
          <ul className="mt-2 flex max-h-48 flex-col gap-1 overflow-y-auto text-sm">
            {issues.map((issue, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-2">
                {issue.target.kind !== 'track' ? (
                  <button
                    type="button"
                    className="font-medium text-pulse-primary underline-offset-2 hover:underline"
                    onClick={() => {
                      const target = issue.target;
                      if (target.kind === 'unit') setSelection({ kind: 'unit', unitId: target.unitId });
                      else if (target.kind === 'scenario') setSelection({ kind: 'scenario', scenarioId: target.scenarioId });
                      setMode('edit');
                    }}
                  >
                    {issue.where}
                  </button>
                ) : (
                  <span className="font-medium text-pulse-primary">{issue.where}</span>
                )}
                <span className="text-pulse-secondary">{issue.message}.</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[17rem_minmax(0,1fr)]">
        <aside className="pulse-card h-fit p-3 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto">
          <OutlineTree units={units} scenarios={scenarios} selection={selection} onSelect={setSelection} issueKeys={issueKeys} />
        </aside>

        <div className="min-w-0">
          {mode === 'source' ? (
            <SourceReview trackId={track.id} draft={{ ...draft, units, simScenarios: scenarios }} />
          ) : mode === 'edit' ? (
            <div className="flex flex-col gap-4">
              <div className="pulse-card p-4">
                <TextField
                  label="Track title"
                  value={title}
                  max={100}
                  onChange={(v) => {
                    setTitle(v);
                    markDirty();
                  }}
                />
              </div>
              {selectedUnit ? (
                <InlineUnitEditor
                  key={selectedUnit.id}
                  unit={selectedUnit}
                  unitNumber={selectedUnitIndex + 1}
                  pillars={pillars}
                  onChange={(next) => {
                    setUnits((prev) => prev.map((u) => (u.id === next.id ? next : u)));
                    markDirty();
                  }}
                  renderRegenerate={({ targetType, itemId, itemLabel }) => (
                    <RegenerateItemButton
                      itemLabel={itemLabel}
                      onRegenerate={(hint) => regenerate({ targetType, itemId, unitId: selectedUnit.id }, hint)}
                    />
                  )}
                />
              ) : selectedScenario ? (
                <ScenarioEditor
                  key={selectedScenario.id}
                  scenario={selectedScenario}
                  secret={selectedSecret}
                  index={selectedScenarioIndex}
                  pillars={pillars}
                  onScenarioChange={(next) => {
                    setScenarios((prev) => prev.map((s) => (s.id === next.id ? next : s)));
                    markDirty();
                  }}
                  onSecretChange={(next) => {
                    setSecrets((prev) =>
                      prev.some((s) => s.scenarioId === next.scenarioId)
                        ? prev.map((s) => (s.scenarioId === next.scenarioId ? next : s))
                        : [...prev, next],
                    );
                    markDirty();
                  }}
                  regenerate={
                    <RegenerateItemButton
                      itemLabel={`Live Call Sim ${selectedScenarioIndex + 1}`}
                      onRegenerate={(hint) => regenerate({ targetType: 'SCENARIO', itemId: selectedScenario.id }, hint)}
                    />
                  }
                />
              ) : (
                <NothingSelected />
              )}
            </div>
          ) : selectedUnit ? (
            <UnitPlayPreview
              key={`${selectedUnit.id}-${playRevision}`}
              unit={selectedUnit}
              unitNumber={selectedUnitIndex + 1}
              pillars={pillars}
              trackId={track.id}
            />
          ) : selectedScenario ? (
            <ScenarioPlayPreview
              scenario={selectedScenario}
              secret={selectedSecret}
              trackId={track.id}
              campaignCode={track.campaignCode}
              divisionId={track.divisionId}
              hasUnsavedChanges={dirty}
            />
          ) : (
            <NothingSelected />
          )}
        </div>
      </div>
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 rounded-pulse-sm px-3 py-1.5 text-sm font-semibold transition-colors',
        active ? 'bg-pulse-indigo text-white' : 'text-pulse-muted hover:text-pulse-primary',
      )}
    >
      {icon}
      {children}
    </button>
  );
}

function SaveIndicator({ dirty, state }: { dirty: boolean; state: SaveState }) {
  if (state.kind === 'saving') {
    return <span className="text-xs text-pulse-muted">Saving…</span>;
  }
  if (state.kind === 'error') {
    return (
      <span role="status" className="max-w-56 text-xs text-pulse-crimson">
        {state.message}
      </span>
    );
  }
  if (dirty) {
    return (
      <span role="status" className="flex items-center gap-1.5 text-xs text-pulse-amber">
        <span aria-hidden className="size-2 rounded-full bg-pulse-amber" />
        Unsaved changes
      </span>
    );
  }
  return (
    <span role="status" className="flex items-center gap-1.5 text-xs text-pulse-muted">
      <CircleCheck aria-hidden className="size-3.5 text-pulse-emerald" />
      {state.kind === 'saved' ? 'Draft saved' : 'All changes saved'}
    </span>
  );
}

function NothingSelected() {
  return (
    <div className="pulse-card p-8 text-center text-sm text-pulse-muted">
      Select a Checkpoint or a Live Call Sim in the outline.
    </div>
  );
}
