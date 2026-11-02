'use client';

import { useId, type ReactNode } from 'react';
import { Plus, Trash } from 'lucide-react';
import {
  FILL_BLANK_TOKEN,
  type CompetencyPillar,
  type DrillItem,
  type DrillKind,
  type FillBlankChoiceDrill,
  type MatchPairsDrill,
  type MultipleChoiceDrill,
  type SequenceOrderDrill,
  type TrueFalseSpotDrill,
} from '@/lib/schemas/curriculum';
import { cn } from '@/lib/utils';
import {
  EditorSection,
  IconButton,
  MoveButtons,
  SelectField,
  SourcePagesField,
  TextAreaField,
  newItemId,
} from './fields';

export const DRILL_KIND_LABELS: Record<DrillKind, string> = {
  MULTIPLE_CHOICE: 'Scenario Multiple Choice',
  TRUE_FALSE_SPOT: 'Compliant or Violation',
  SEQUENCE_ORDER: 'Call-Flow Step Order',
  MATCH_PAIRS: 'Matching Pairs',
  FILL_BLANK_CHOICE: 'Tap-to-Fill Sentence',
};

export function DrillEditor({
  drill,
  index,
  pillars,
  onChange,
  regenerate,
  anchorId,
}: {
  drill: DrillItem;
  index: number;
  pillars: CompetencyPillar[];
  onChange: (drill: DrillItem) => void;
  regenerate: ReactNode;
  anchorId?: string;
}) {
  return (
    <EditorSection
      id={anchorId}
      title={`Drill ${index + 1}`}
      badge={<span className="pulse-pill pulse-pill-indigo text-[0.68rem]">{DRILL_KIND_LABELS[drill.kind]}</span>}
      actions={regenerate}
    >
      <TextAreaField
        label="Prompt"
        value={drill.prompt}
        max={300}
        rows={2}
        hint="The situation or instruction the agent reads first."
        onChange={(v) => onChange({ ...drill, prompt: v })}
      />
      <KindFields drill={drill} onChange={onChange} />
      <TextAreaField
        label="Explanation (shown after the answer)"
        value={drill.explanation}
        max={350}
        rows={2}
        onChange={(v) => onChange({ ...drill, explanation: v })}
      />
      <div className="grid gap-4 md:grid-cols-2">
        <SelectField
          label="CompetencyPillar"
          value={drill.competencyPillarId}
          options={pillars.map((p) => ({ value: p.id, label: p.label }))}
          onChange={(v) => onChange({ ...drill, competencyPillarId: v })}
        />
        <SourcePagesField value={drill.sourcePages} onChange={(v) => onChange({ ...drill, sourcePages: v })} />
      </div>
    </EditorSection>
  );
}

function KindFields({ drill, onChange }: { drill: DrillItem; onChange: (drill: DrillItem) => void }) {
  switch (drill.kind) {
    case 'MULTIPLE_CHOICE':
      return <MultipleChoiceFields drill={drill} onChange={onChange} />;
    case 'TRUE_FALSE_SPOT':
      return <TrueFalseFields drill={drill} onChange={onChange} />;
    case 'SEQUENCE_ORDER':
      return <SequenceFields drill={drill} onChange={onChange} />;
    case 'MATCH_PAIRS':
      return <PairsFields drill={drill} onChange={onChange} />;
    case 'FILL_BLANK_CHOICE':
      return <FillBlankFields drill={drill} onChange={onChange} />;
  }
}

function MultipleChoiceFields({ drill, onChange }: { drill: MultipleChoiceDrill; onChange: (d: DrillItem) => void }) {
  const group = useId();
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-xs font-semibold text-pulse-secondary">Options — select the correct option</legend>
      {drill.options.map((option, i) => {
        const correct = drill.correctOptionId === option.id;
        return (
          <div
            key={option.id}
            className={cn(
              'flex items-center gap-2 rounded-pulse-md border p-1.5 pl-2.5',
              correct ? 'border-pulse-emerald/50 bg-pulse-emerald/5' : 'border-pulse-border-subtle',
            )}
          >
            <input
              type="radio"
              name={group}
              checked={correct}
              onChange={() => onChange({ ...drill, correctOptionId: option.id })}
              aria-label={`Option ${i + 1} is correct`}
              className="size-4 accent-[var(--pulse-emerald)]"
            />
            <span className="pulse-kbd">{i + 1}</span>
            <input
              aria-label={`Option ${i + 1} text`}
              className={cn('pulse-input', option.text.length > 180 && 'border-pulse-crimson')}
              value={option.text}
              onChange={(e) =>
                onChange({
                  ...drill,
                  options: drill.options.map((o) => (o.id === option.id ? { ...o, text: e.target.value } : o)),
                })
              }
            />
          </div>
        );
      })}
    </fieldset>
  );
}

function TrueFalseFields({ drill, onChange }: { drill: TrueFalseSpotDrill; onChange: (d: DrillItem) => void }) {
  const group = useId();
  return (
    <div className="flex flex-col gap-3">
      <TextAreaField
        label="Statement (agent quote or action)"
        value={drill.statement}
        max={260}
        rows={2}
        onChange={(v) => onChange({ ...drill, statement: v })}
      />
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 text-xs font-semibold text-pulse-secondary">Correct verdict</legend>
        <div className="flex flex-wrap gap-2">
          {[
            { value: true, label: 'Policy Compliant', cls: 'pulse-pill-emerald' },
            { value: false, label: 'Policy Violation', cls: 'pulse-pill-crimson' },
          ].map((opt) => (
            <label
              key={String(opt.value)}
              className={cn('pulse-pill cursor-pointer px-3 py-1.5 text-sm', drill.isCompliant === opt.value && opt.cls)}
            >
              <input
                type="radio"
                name={group}
                className="sr-only"
                checked={drill.isCompliant === opt.value}
                onChange={() => onChange({ ...drill, isCompliant: opt.value })}
              />
              {opt.label}
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}

function SequenceFields({ drill, onChange }: { drill: SequenceOrderDrill; onChange: (d: DrillItem) => void }) {
  const steps = drill.orderedSteps;
  const setSteps = (next: SequenceOrderDrill['orderedSteps']) => onChange({ ...drill, orderedSteps: next });
  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= steps.length) return;
    const next = [...steps];
    [next[index], next[target]] = [next[target], next[index]];
    setSteps(next);
  };
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-semibold text-pulse-secondary">Steps in the correct order (learners see them shuffled)</p>
      <ol className="flex flex-col gap-1.5">
        {steps.map((step, i) => (
          <li key={step.id} className="flex items-start gap-1.5">
            <span className="pulse-kbd mt-2">{i + 1}</span>
            <input
              aria-label={`Step ${i + 1}`}
              className={cn('pulse-input', step.text.length > 140 && 'border-pulse-crimson')}
              value={step.text}
              onChange={(e) => setSteps(steps.map((s) => (s.id === step.id ? { ...s, text: e.target.value } : s)))}
            />
            <MoveButtons
              label={`step ${i + 1}`}
              onUp={() => move(i, -1)}
              onDown={() => move(i, 1)}
              upDisabled={i === 0}
              downDisabled={i === steps.length - 1}
            />
            <IconButton label={`Remove step ${i + 1}`} disabled={steps.length <= 3} onClick={() => setSteps(steps.filter((s) => s.id !== step.id))}>
              <Trash aria-hidden className="size-3.5" />
            </IconButton>
          </li>
        ))}
      </ol>
      {steps.length < 5 ? (
        <button
          type="button"
          className="pulse-btn pulse-btn-ghost w-fit px-2 py-1 text-xs"
          onClick={() => setSteps([...steps, { id: newItemId('step'), text: '' }])}
        >
          <Plus aria-hidden className="size-3.5" />
          Add step
        </button>
      ) : null}
    </div>
  );
}

function PairsFields({ drill, onChange }: { drill: MatchPairsDrill; onChange: (d: DrillItem) => void }) {
  const pairs = drill.pairs;
  const setPairs = (next: MatchPairsDrill['pairs']) => onChange({ ...drill, pairs: next });
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.25rem] gap-1.5 text-xs font-semibold text-pulse-secondary">
        <span>Left side (trigger)</span>
        <span>Matching right side</span>
        <span />
      </div>
      {pairs.map((pair, i) => (
        <div key={pair.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.25rem] gap-1.5">
          <input
            aria-label={`Pair ${i + 1} left side`}
            className={cn('pulse-input', pair.leftPrompt.length > 100 && 'border-pulse-crimson')}
            value={pair.leftPrompt}
            onChange={(e) => setPairs(pairs.map((p) => (p.id === pair.id ? { ...p, leftPrompt: e.target.value } : p)))}
          />
          <input
            aria-label={`Pair ${i + 1} right side`}
            className={cn('pulse-input', pair.rightMatch.length > 100 && 'border-pulse-crimson')}
            value={pair.rightMatch}
            onChange={(e) => setPairs(pairs.map((p) => (p.id === pair.id ? { ...p, rightMatch: e.target.value } : p)))}
          />
          <IconButton label={`Remove pair ${i + 1}`} disabled={pairs.length <= 3} onClick={() => setPairs(pairs.filter((p) => p.id !== pair.id))}>
            <Trash aria-hidden className="size-3.5" />
          </IconButton>
        </div>
      ))}
      {pairs.length < 4 ? (
        <button
          type="button"
          className="pulse-btn pulse-btn-ghost w-fit px-2 py-1 text-xs"
          onClick={() => setPairs([...pairs, { id: newItemId('pair'), leftPrompt: '', rightMatch: '' }])}
        >
          <Plus aria-hidden className="size-3.5" />
          Add pair
        </button>
      ) : null}
    </div>
  );
}

function FillBlankFields({ drill, onChange }: { drill: FillBlankChoiceDrill; onChange: (d: DrillItem) => void }) {
  const group = useId();
  const correctIndex = drill.wordBank.indexOf(drill.correctWord);
  const blankCount = drill.sentenceTemplate.split(FILL_BLANK_TOKEN).length - 1;
  return (
    <div className="flex flex-col gap-3">
      <TextAreaField
        label="Sentence"
        value={drill.sentenceTemplate}
        max={260}
        rows={2}
        hint={`Type ${FILL_BLANK_TOKEN} where the missing word goes (exactly once).`}
        onChange={(v) => onChange({ ...drill, sentenceTemplate: v })}
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="pulse-btn px-2.5 py-1 text-xs"
          disabled={blankCount > 0}
          onClick={() => onChange({ ...drill, sentenceTemplate: `${drill.sentenceTemplate.trimEnd()} ${FILL_BLANK_TOKEN}`.trim() })}
        >
          Insert blank
        </button>
        <span
          className={cn(
            'text-xs',
            blankCount === 1 ? 'text-pulse-emerald' : 'text-pulse-crimson',
          )}
        >
          {blankCount === 1 ? 'The sentence has one blank.' : blankCount === 0 ? 'The sentence has no blank.' : 'The sentence has more than one blank.'}
        </span>
      </div>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 text-xs font-semibold text-pulse-secondary">Word bank — select the correct word</legend>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {drill.wordBank.map((word, i) => (
            <div
              key={i}
              className={cn(
                'flex items-center gap-2 rounded-pulse-md border p-1.5 pl-2.5',
                i === correctIndex ? 'border-pulse-emerald/50 bg-pulse-emerald/5' : 'border-pulse-border-subtle',
              )}
            >
              <input
                type="radio"
                name={group}
                checked={i === correctIndex}
                onChange={() => onChange({ ...drill, correctWord: word })}
                aria-label={`Word ${i + 1} is correct`}
                className="size-4 accent-[var(--pulse-emerald)]"
              />
              <input
                aria-label={`Word ${i + 1}`}
                className={cn('pulse-input', word.length > 60 && 'border-pulse-crimson')}
                value={word}
                onChange={(e) => {
                  const nextBank = drill.wordBank.map((w, j) => (j === i ? e.target.value : w));
                  onChange({
                    ...drill,
                    wordBank: nextBank,
                    correctWord: i === correctIndex ? e.target.value : drill.correctWord,
                  });
                }}
              />
            </div>
          ))}
        </div>
        {correctIndex === -1 ? <p className="text-xs text-pulse-crimson">Select which word is correct.</p> : null}
      </fieldset>
    </div>
  );
}
