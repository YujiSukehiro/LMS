'use client';

import type { ReactNode } from 'react';
import { Trash2 } from 'lucide-react';
import type { BriefingCard, CompetencyPillar, DrillItem, TrackUnit } from '@/lib/schemas/curriculum';
import { BriefingCardEditor } from './editor/BriefingCardEditor';
import { DrillEditor } from './editor/DrillEditor';
import { EditorSection, NumberField, TextAreaField, TextField } from './editor/fields';
import { EvidenceReviewBadge } from './UnitAttentionPanel';
import { itemNeedsEvidenceReview } from './unit-review';
import { DEPTH_LIMITS } from '@/lib/ai/pipeline/content-depth';

/** Plain-English form editor for one Unit (Checkpoint): its header, Briefing Cards and Drills. */
export function InlineUnitEditor({
  unit,
  unitNumber,
  pillars,
  onChange,
  renderRegenerate,
  attention,
  addDrill,
}: {
  unit: TrackUnit;
  unitNumber: number;
  pillars: CompetencyPillar[];
  onChange: (unit: TrackUnit) => void;
  renderRegenerate: (target: { targetType: 'CARD' | 'DRILL'; itemId: string; itemLabel: string }) => ReactNode;
  /** Review notes / shortfall panel for this Checkpoint. */
  attention?: ReactNode;
  /** "Add a Drill" control, shown under the Drills. */
  addDrill?: ReactNode;
}) {
  const withBadge = (item: { evidence?: BriefingCard['evidence'] }, control: ReactNode) =>
    itemNeedsEvidenceReview(item) ? (
      <div className="flex flex-wrap items-center justify-end gap-2">
        <EvidenceReviewBadge />
        {control}
      </div>
    ) : (
      control
    );
  // A trainer must be able to drop a duplicate or unfixable item, but never below the publishable minimum.
  const removeControl = (label: string, canRemove: boolean, onRemove: () => void) => (
    <button
      type="button"
      className="pulse-btn pulse-btn-ghost px-2.5 py-1 text-xs"
      disabled={!canRemove}
      title={canRemove ? undefined : 'A Checkpoint needs at least this many items. Add one before removing this one.'}
      aria-label={`Remove ${label}`}
      onClick={() => {
        if (window.confirm(`Remove ${label} from this Checkpoint? Save the draft to keep the change.`)) onRemove();
      }}
    >
      <Trash2 aria-hidden className="size-3.5" /> Remove
    </button>
  );
  const withRemove = (control: ReactNode, remove: ReactNode) => (
    <div className="flex flex-wrap items-start justify-end gap-2">
      {remove}
      {control}
    </div>
  );
  const setCard = (card: BriefingCard) =>
    onChange({ ...unit, briefingCards: unit.briefingCards.map((c) => (c.id === card.id ? card : c)) });
  const setDrill = (drill: DrillItem) =>
    onChange({ ...unit, drills: unit.drills.map((d) => (d.id === drill.id ? drill : d)) });

  return (
    <div className="flex flex-col gap-4">
      {attention}
      <EditorSection title={`Checkpoint ${unitNumber}`}>
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_10rem]">
          <TextField label="Checkpoint title" value={unit.title} max={80} onChange={(v) => onChange({ ...unit, title: v })} />
          <NumberField
            label="Estimated minutes"
            value={unit.estimatedMinutes}
            min={2}
            max={10}
            hint="2 to 10."
            onChange={(v) => onChange({ ...unit, estimatedMinutes: v })}
          />
        </div>
        <TextAreaField label="Summary" value={unit.summary} max={180} rows={2} onChange={(v) => onChange({ ...unit, summary: v })} />
      </EditorSection>

      <h3 className="pulse-label mt-2">Briefing Cards ({unit.briefingCards.length})</h3>
      {unit.briefingCards.map((card, i) => (
        <BriefingCardEditor
          key={card.id}
          anchorId={`card-${card.id}`}
          card={card}
          index={i}
          onChange={setCard}
          regenerate={withRemove(
            withBadge(card, renderRegenerate({ targetType: 'CARD', itemId: card.id, itemLabel: `Briefing Card ${i + 1}` })),
            removeControl(`Briefing Card ${i + 1}`, unit.briefingCards.length > DEPTH_LIMITS.minCards, () =>
              onChange({ ...unit, briefingCards: unit.briefingCards.filter((c) => c.id !== card.id) })),
          )}
        />
      ))}

      <h3 className="pulse-label mt-2">Drills ({unit.drills.length})</h3>
      {unit.drills.map((drill, i) => (
        <DrillEditor
          key={drill.id}
          anchorId={`drill-${drill.id}`}
          drill={drill}
          index={i}
          pillars={pillars}
          onChange={setDrill}
          regenerate={withRemove(
            withBadge(drill, renderRegenerate({ targetType: 'DRILL', itemId: drill.id, itemLabel: `Drill ${i + 1}` })),
            removeControl(`Drill ${i + 1}`, unit.drills.length > DEPTH_LIMITS.minDrills, () =>
              onChange({ ...unit, drills: unit.drills.filter((d) => d.id !== drill.id) })),
          )}
        />
      ))}
      {addDrill ? <div className="flex justify-end">{addDrill}</div> : null}
    </div>
  );
}
