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
import type { ClaimEvidence } from '@/lib/schemas/source-truth';
import { replaceRubricEvidence } from '@/lib/services/evidence-approvals';
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
import { ManualJudgeExchange } from './ManualJudgeExchange';
import { TrainerQaPanel } from './TrainerQaPanel';
import { addDrill, fetchDraftSecrets, patchTrackDraft, regenerateItem } from './api-client';
import { AddDrillButton, TrackAttentionBanner, UnitAttentionPanel } from './UnitAttentionPanel';
import { appendDrill, refreshUnitReviewNotes } from './unit-review';
import { TRAINING_POLICY } from '@/lib/policy/training-policy';
import { DIVISION_LABELS } from '@/lib/schemas/constants';
import { crossUnitRepeatNotes } from '@/lib/services/drill-label';
import { ensureVerbalScenarioDefaults, ensureVerbalSecretDefaults } from '@/lib/services/verbal-defaults';
import { DEPTH_LIMITS } from '@/lib/ai/pipeline/content-depth';
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
  focusDrillId,
}: {
  track: TrackDoc;
  draft: TrackVersionDoc;
  initialSecrets: SecretSimScenarioConfig[];
  cohorts: PublishCohortOption[];
  /** Open the Checkpoint that holds this Drill in Edit mode (links from "Top missed items"). */
  focusDrillId?: string | null;
}) {
  const focusUnitId = focusDrillId ? draft.units.find((unit) => unit.drills.some((drill) => drill.id === focusDrillId))?.id ?? null : null;
  const [title, setTitle] = useState(track.title);
  const [units, setUnits] = useState<TrackUnit[]>(() => [...draft.units].sort((a, b) => a.orderIndex - b.orderIndex));
  const [scenarios, setScenarios] = useState<PublicSimScenario[]>(draft.simScenarios);
  const [secrets, setSecrets] = useState<SecretSimScenarioConfig[]>(initialSecrets);
  const [dirty, setDirty] = useState(false);
  const [mode, setMode] = useState<'play' | 'edit' | 'source'>(focusUnitId ? 'edit' : 'play');
  const [selection, setSelection] = useState<StudioSelection | null>(() =>
    focusUnitId
      ? { kind: 'unit', unitId: focusUnitId }
      : draft.units.length > 0
      ? { kind: 'unit', unitId: [...draft.units].sort((a, b) => a.orderIndex - b.orderIndex)[0].id }
      : draft.simScenarios[0]
        ? { kind: 'scenario', scenarioId: draft.simScenarios[0].id }
        : null,
  );
  const [saveState, setSaveState] = useState<SaveState>({ kind: 'idle' });
  const [issues, setIssues] = useState<StudioIssue[]>([]);
  const [playRevision, setPlayRevision] = useState(0);
  // Follows a server-side "rebind draft to current approved revision" (Source Review).
  const [sourceRevision, setSourceRevision] = useState(draft.sourceRevision);

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
    const verbalOnly = TRAINING_POLICY.simulationInteractionMode === 'verbal_only';
    const nextScenarios = verbalOnly
      ? scenarios.map((sc) =>
          ensureVerbalScenarioDefaults(sc, {
            divisionId: track.divisionId,
            product: title.trim() || track.title,
            sourceRevision,
            curriculumVersion: draft.versionId,
          }),
        )
      : scenarios;
    const keptSecrets = secrets.filter((s) => nextScenarios.some((sc) => sc.id === s.scenarioId));
    const nextSecrets = verbalOnly
      ? keptSecrets.map((sec) => {
          const matching = nextScenarios.find((sc) => sc.id === sec.scenarioId);
          return matching ? ensureVerbalSecretDefaults(matching, sec) : sec;
        })
      : keptSecrets;

    const found = validateStudioDraft({
      title,
      units,
      simScenarios: nextScenarios,
      secretScenarios: nextSecrets,
      pillars,
    });
    setIssues(found);
    if (found.length > 0) {
      setSaveState({ kind: 'error', message: `${found.length} problem${found.length === 1 ? '' : 's'} to fix before saving.` });
      return false;
    }
    setSaveState({ kind: 'saving' });
    try {
      // Shortfall notes the trainer has since fixed (for example by adding Drills) are dropped on save.
      const ordered = units.map((unit, index) => ({ ...refreshUnitReviewNotes(unit), orderIndex: index }));
      const updatedAt = await patchTrackDraft(track.id, {
        title: title.trim(),
        units: ordered,
        simScenarios: nextScenarios,
        secretScenarios: nextSecrets,
      });
      if (verbalOnly) {
        setScenarios(nextScenarios);
        setSecrets(nextSecrets);
      }
      setDirty(false);
      setSaveState({ kind: 'saved', at: updatedAt });
      return true;
    } catch (err) {
      setSaveState({ kind: 'error', message: err instanceof Error ? err.message : 'The draft did not save.' });
      return false;
    }
  }, [title, units, scenarios, secrets, pillars, track.id, track.divisionId, track.title, sourceRevision, draft.versionId]);

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
      if (!scenario.success) {
        throw new Error(
          TRAINING_POLICY.simulationInteractionMode === 'verbal_only'
            ? 'The server sent an item that is not a Verbal Practice scenario.'
            : 'The server sent an item that is not a Live Call Sim.',
        );
      }
      const normalizedScenario =
        TRAINING_POLICY.simulationInteractionMode === 'verbal_only'
          ? ensureVerbalScenarioDefaults(scenario.data, {
              divisionId: track.divisionId,
              product: title.trim() || track.title,
              sourceRevision,
              curriculumVersion: draft.versionId,
            })
          : scenario.data;
      setScenarios((prev) => prev.map((s) => (s.id === target.itemId ? normalizedScenario : s)));
      if (normalizedScenario.id !== target.itemId) {
        setSelection({ kind: 'scenario', scenarioId: normalizedScenario.id });
      }
      // The server also rewrites the hidden persona and rubric; read them back.
      const fresh = await fetchDraftSecrets(track.id);
      if (fresh) {
        const updated = fresh.find((s) => s.scenarioId === normalizedScenario.id);
        if (updated) {
          const normalizedSecret =
            TRAINING_POLICY.simulationInteractionMode === 'verbal_only'
              ? ensureVerbalSecretDefaults(normalizedScenario, updated)
              : updated;
          setSecrets((prev) => [
            ...prev.filter((s) => s.scenarioId !== target.itemId && s.scenarioId !== normalizedScenario.id),
            normalizedSecret,
          ]);
        }
      }
    }
    setPlayRevision((r) => r + 1);
  }

  async function addDrillTo(unitId: string) {
    // The server appends to the saved draft, so unsaved edits are saved first.
    if (dirty && !(await save())) throw new Error('Save the draft (fix the problems above) before adding a Drill.');
    const { drill } = await addDrill(track.id, unitId);
    // Splice in only the new Drill: replacing the whole Unit with the server copy would wipe edits the
    // trainer made while the AI call ran.
    setUnits((prev) => prev.map((u) => (u.id === unitId ? appendDrill(u, drill) : u)));
    setPlayRevision((r) => r + 1);
  }

  // Source Review records approvals on the server; mirror the verified evidence locally without marking the draft dirty.
  function onEvidenceApproved(evidence: ClaimEvidence) {
    const swap = <T extends { evidence?: ClaimEvidence[] }>(items: T[]): T[] =>
      items.map((item) => (item.evidence?.some((e) => e.id === evidence.id)
        ? { ...item, evidence: item.evidence.map((e) => (e.id === evidence.id ? evidence : e)) }
        : item));
    setUnits((prev) => prev.map((unit) => ({ ...unit, briefingCards: swap(unit.briefingCards), drills: swap(unit.drills) })));
    setSecrets((prev) => replaceRubricEvidence(prev, evidence.id, evidence));
  }

  function onDraftRebound(next: string) {
    setSourceRevision(next);
    setScenarios((prev) =>
      prev.map((scenario) => (scenario.context ? { ...scenario, context: { ...scenario.context, sourceRevision: next } } : scenario)),
    );
  }

  const repeatNotes = useMemo(() => crossUnitRepeatNotes(units), [units]);
  const renderAttention = (unit: TrackUnit, unitNumber: number, withAddDrill: boolean) => (
    <UnitAttentionPanel
      unit={unit}
      unitNumber={unitNumber}
      extraNotes={repeatNotes.get(unitNumber - 1)}
      onOpenSourceReview={() => setMode('source')}
      action={withAddDrill && unit.drills.length < DEPTH_LIMITS.minDrills ? (
        <AddDrillButton unit={unit} disabled={saveState.kind === 'saving'} onAdd={() => addDrillTo(unit.id)} />
      ) : undefined}
    />
  );

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
            // First publish starts with nothing picked; a re-publish keeps the current assignment.
            initialCohortIds={track.publishedVersionId ? track.assignedCohortIds : []}
            divisionLabel={DIVISION_LABELS[track.divisionId]}
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

      <TrackAttentionBanner
        units={units}
        onSelectUnit={(unitId) => {
          setSelection({ kind: 'unit', unitId });
          if (mode === 'source') setMode('edit');
        }}
      />

      <div className="grid gap-5 lg:grid-cols-[17rem_minmax(0,1fr)]">
        <aside className="pulse-card h-fit p-3 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto">
          <OutlineTree units={units} scenarios={scenarios} selection={selection} onSelect={setSelection} issueKeys={issueKeys} />
        </aside>

        <div className="min-w-0">
          {mode === 'source' ? (
            <div className="flex flex-col gap-5">
              <SourceReview
                trackId={track.id}
                draft={{ ...draft, sourceRevision, units, simScenarios: scenarios }}
                secrets={secrets}
                hasUnsavedChanges={dirty}
                onDraftRebound={onDraftRebound}
                onEvidenceApproved={onEvidenceApproved}
              />
              <ManualJudgeExchange />
              <TrainerQaPanel trackId={track.id} />
            </div>
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
                  attention={renderAttention(selectedUnit, selectedUnitIndex + 1, false)}
                  addDrill={
                    <AddDrillButton unit={selectedUnit} disabled={saveState.kind === 'saving'} onAdd={() => addDrillTo(selectedUnit.id)} />
                  }
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
                      itemLabel={`${TRAINING_POLICY.simulationInteractionMode === 'verbal_only' ? 'Verbal Practice' : 'Live Call Sim'} ${selectedScenarioIndex + 1}`}
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
              attention={renderAttention(selectedUnit, selectedUnitIndex + 1, true)}
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
        active ? 'bg-pulse-indigo text-pulse-on-accent' : 'text-pulse-muted hover:text-pulse-primary',
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
      Select a Checkpoint or a{' '}
      {TRAINING_POLICY.simulationInteractionMode === 'verbal_only' ? 'Verbal Practice scenario' : 'Live Call Sim'} in the
      outline.
    </div>
  );
}
