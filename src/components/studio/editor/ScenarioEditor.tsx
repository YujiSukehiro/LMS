'use client';

import type { ReactNode } from 'react';
import { Lock, Plus, Trash } from 'lucide-react';
import type {
  CompetencyPillar,
  PublicSimScenario,
  RubricCriterion,
  SecretSimScenarioConfig,
} from '@/lib/schemas/curriculum';
import { cn } from '@/lib/utils';
import {
  EditorSection,
  IconButton,
  NumberField,
  SelectField,
  SourcePagesField,
  StringListField,
  TextAreaField,
  TextField,
  newItemId,
} from './fields';
import { ScenarioContextEvidenceEditor } from './ScenarioContextEvidenceEditor';
import { ScenarioQASection } from './ScenarioQASection';

export const DIFFICULTY_LABELS: Record<PublicSimScenario['difficulty'], string> = {
  STANDARD: 'Standard',
  EDGE_CASE: 'Edge Case',
  HIGH_PRESSURE: 'High Pressure',
};

export function emptySecretConfig(scenario: PublicSimScenario, pillars: CompetencyPillar[]): SecretSimScenarioConfig {
  const pillarId = pillars[0]?.id ?? '';
  const criterion = (weight: number): RubricCriterion => ({
    id: newItemId('crit'),
    competencyPillarId: pillarId,
    criterionLabel: '',
    evaluationRule: '',
    weight,
    sourcePages: [],
  });
  return {
    scenarioId: scenario.id,
    personaName: '',
    personaBackstoryAndMood: '',
    hiddenFactsToRevealOnlyWhenAsked: [],
    conditionalBehaviors: [],
    expectedDisposition: scenario.dispositionOptions[0] ?? '',
    autoFailTriggers: [],
    rubricCriteria: [criterion(34), criterion(33), criterion(33)],
  };
}

export function rubricWeightTotal(secret: SecretSimScenarioConfig | undefined): number {
  return (secret?.rubricCriteria ?? []).reduce((sum, c) => sum + (Number.isFinite(c.weight) ? c.weight : 0), 0);
}

export function ScenarioEditor({
  scenario,
  secret,
  index,
  pillars,
  onScenarioChange,
  onSecretChange,
  regenerate,
}: {
  scenario: PublicSimScenario;
  secret: SecretSimScenarioConfig | undefined;
  index: number;
  pillars: CompetencyPillar[];
  onScenarioChange: (scenario: PublicSimScenario) => void;
  onSecretChange: (secret: SecretSimScenarioConfig) => void;
  regenerate: ReactNode;
}) {
  const setPublic = <K extends keyof PublicSimScenario>(key: K, value: PublicSimScenario[K]) =>
    onScenarioChange({ ...scenario, [key]: value });

  return (
    <div className="flex flex-col gap-4">
      <EditorSection
        title={`Live Call Sim ${index + 1} — what the agent sees`}
        badge={<span className="pulse-pill text-[0.68rem]">Public</span>}
        actions={regenerate}
      >
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_12rem]">
          <TextField label="Scenario title" value={scenario.title} max={80} onChange={(v) => setPublic('title', v)} />
          <SelectField
            label="Difficulty"
            value={scenario.difficulty}
            options={Object.entries(DIFFICULTY_LABELS).map(([value, label]) => ({ value, label }))}
            onChange={(v) => setPublic('difficulty', v as PublicSimScenario['difficulty'])}
          />
        </div>
        <TextField
          label="Caller role label"
          value={scenario.counterpartyRoleLabel}
          max={60}
          placeholder="Telehealth Patient"
          onChange={(v) => setPublic('counterpartyRoleLabel', v)}
        />
        <TextAreaField
          label="Context ticket"
          value={scenario.contextTicketSummary}
          max={280}
          rows={2}
          hint="Queue, campaign and channel that the agent sees in the ticket header."
          onChange={(v) => setPublic('contextTicketSummary', v)}
        />
        <TextAreaField
          label="Opening message from the caller"
          value={scenario.openingMessage}
          max={350}
          rows={3}
          onChange={(v) => setPublic('openingMessage', v)}
        />
        <StringListField
          label="Disposition options"
          values={scenario.dispositionOptions}
          minItems={3}
          maxItems={6}
          maxLength={80}
          addLabel="Add disposition"
          onChange={(v) => setPublic('dispositionOptions', v)}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <NumberField label="Maximum turns" value={scenario.maxTurns} min={6} max={12} hint="6 to 12." onChange={(v) => setPublic('maxTurns', v)} />
          <NumberField
            label="Pass score (%)"
            value={scenario.passScoreThreshold}
            min={60}
            max={95}
            hint="60 to 95."
            onChange={(v) => setPublic('passScoreThreshold', v)}
          />
        </div>
      </EditorSection>

      <ScenarioContextEvidenceEditor scenario={scenario} onChange={onScenarioChange} />

      {secret ? (
        <>
          <SecretEditor scenario={scenario} secret={secret} pillars={pillars} onChange={onSecretChange} />
          <ScenarioQASection scenario={scenario} secret={secret} onChange={onSecretChange} />
        </>
      ) : (
        <EditorSection title="Hidden persona and rubric" badge={<SecretBadge />}>
          <p className="text-sm text-pulse-amber">This Live Call Sim has no hidden persona or grading rubric yet.</p>
          <button
            type="button"
            className="pulse-btn w-fit"
            onClick={() => onSecretChange(emptySecretConfig(scenario, pillars))}
          >
            <Plus aria-hidden className="size-4" />
            Add persona and rubric
          </button>
        </EditorSection>
      )}
    </div>
  );
}

function SecretBadge() {
  return (
    <span className="pulse-pill pulse-pill-amber text-[0.68rem]">
      <Lock aria-hidden className="size-3" />
      Trainers only
    </span>
  );
}

function SecretEditor({
  scenario,
  secret,
  pillars,
  onChange,
}: {
  scenario: PublicSimScenario;
  secret: SecretSimScenarioConfig;
  pillars: CompetencyPillar[];
  onChange: (secret: SecretSimScenarioConfig) => void;
}) {
  const set = <K extends keyof SecretSimScenarioConfig>(key: K, value: SecretSimScenarioConfig[K]) =>
    onChange({ ...secret, [key]: value });
  const total = rubricWeightTotal(secret);
  const criteria = secret.rubricCriteria;
  const setCriterion = (id: string, patch: Partial<RubricCriterion>) =>
    set(
      'rubricCriteria',
      criteria.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    );

  return (
    <EditorSection title="Hidden persona and rubric" badge={<SecretBadge />}>
      <p className="text-xs text-pulse-muted">
        Agents never see these fields. The Live Call Sim caller and the rubric judge use them.
      </p>
      <TextField label="Persona name" value={secret.personaName} onChange={(v) => set('personaName', v)} />
      <TextAreaField
        label="Persona backstory and mood"
        value={secret.personaBackstoryAndMood}
        max={400}
        rows={3}
        onChange={(v) => set('personaBackstoryAndMood', v)}
      />
      <StringListField
        label="Hidden facts (revealed only when the agent asks)"
        values={secret.hiddenFactsToRevealOnlyWhenAsked}
        maxLength={180}
        addLabel="Add hidden fact"
        onChange={(v) => set('hiddenFactsToRevealOnlyWhenAsked', v)}
      />
      <StringListField
        label="Caller behaviors"
        values={secret.conditionalBehaviors}
        maxLength={220}
        addLabel="Add behavior"
        hint="Example: If the agent offers 25% first, push back and ask for a full refund."
        onChange={(v) => set('conditionalBehaviors', v)}
      />
      <SelectField
        label="Expected disposition"
        value={secret.expectedDisposition}
        options={scenario.dispositionOptions.filter(Boolean).map((d) => ({ value: d, label: d }))}
        onChange={(v) => set('expectedDisposition', v)}
      />
      <StringListField
        label="Auto-fail triggers"
        tone="crimson"
        values={secret.autoFailTriggers}
        maxLength={180}
        addLabel="Add auto-fail trigger"
        onChange={(v) => set('autoFailTriggers', v)}
      />

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-xs font-semibold text-pulse-secondary">Rubric criteria ({criteria.length}/6)</span>
          <span
            role="status"
            className={cn('pulse-metric text-xs font-semibold', total === 100 ? 'text-pulse-emerald' : 'text-pulse-crimson')}
          >
            Weights total {total} / 100{total === 100 ? '' : ' — must equal 100'}
          </span>
        </div>
        <ol className="flex flex-col gap-3">
          {criteria.map((criterion, i) => (
            <li key={criterion.id} className="rounded-pulse-md border border-pulse-border-subtle p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="pulse-label">Criterion {i + 1}</span>
                <IconButton
                  label={`Remove criterion ${i + 1}`}
                  disabled={criteria.length <= 3}
                  onClick={() => set('rubricCriteria', criteria.filter((c) => c.id !== criterion.id))}
                >
                  <Trash aria-hidden className="size-3.5" />
                </IconButton>
              </div>
              <div className="flex flex-col gap-3">
                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_7rem]">
                  <TextField
                    label="Criterion"
                    value={criterion.criterionLabel}
                    max={100}
                    onChange={(v) => setCriterion(criterion.id, { criterionLabel: v })}
                  />
                  <NumberField
                    label="Weight"
                    value={criterion.weight}
                    min={10}
                    max={50}
                    onChange={(v) => setCriterion(criterion.id, { weight: v })}
                  />
                </div>
                <TextAreaField
                  label="Evaluation rule (from the Playbook)"
                  value={criterion.evaluationRule}
                  max={300}
                  rows={2}
                  onChange={(v) => setCriterion(criterion.id, { evaluationRule: v })}
                />
                <div className="grid gap-3 md:grid-cols-2">
                  <SelectField
                    label="CompetencyPillar"
                    value={criterion.competencyPillarId}
                    options={pillars.map((p) => ({ value: p.id, label: p.label }))}
                    onChange={(v) => setCriterion(criterion.id, { competencyPillarId: v })}
                  />
                  <SourcePagesField
                    value={criterion.sourcePages}
                    onChange={(v) => setCriterion(criterion.id, { sourcePages: v })}
                  />
                </div>
              </div>
            </li>
          ))}
        </ol>
        {criteria.length < 6 ? (
          <button
            type="button"
            className="pulse-btn pulse-btn-ghost w-fit px-2 py-1 text-xs"
            onClick={() =>
              set('rubricCriteria', [
                ...criteria,
                {
                  id: newItemId('crit'),
                  competencyPillarId: pillars[0]?.id ?? '',
                  criterionLabel: '',
                  evaluationRule: '',
                  weight: Math.max(10, Math.min(50, 100 - total)),
                  sourcePages: [],
                },
              ])
            }
          >
            <Plus aria-hidden className="size-3.5" />
            Add criterion
          </button>
        ) : null}
      </div>
    </EditorSection>
  );
}
