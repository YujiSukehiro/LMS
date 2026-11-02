'use client';

import type { ReactNode } from 'react';
import type { BriefingCard, CompetencyPillar, DrillItem, TrackUnit } from '@/lib/schemas/curriculum';
import { BriefingCardEditor } from './editor/BriefingCardEditor';
import { DrillEditor } from './editor/DrillEditor';
import { EditorSection, NumberField, TextAreaField, TextField } from './editor/fields';

/** Plain-English form editor for one Unit (Checkpoint): its header, Briefing Cards and Drills. */
export function InlineUnitEditor({
  unit,
  unitNumber,
  pillars,
  onChange,
  renderRegenerate,
}: {
  unit: TrackUnit;
  unitNumber: number;
  pillars: CompetencyPillar[];
  onChange: (unit: TrackUnit) => void;
  renderRegenerate: (target: { targetType: 'CARD' | 'DRILL'; itemId: string; itemLabel: string }) => ReactNode;
}) {
  const setCard = (card: BriefingCard) =>
    onChange({ ...unit, briefingCards: unit.briefingCards.map((c) => (c.id === card.id ? card : c)) });
  const setDrill = (drill: DrillItem) =>
    onChange({ ...unit, drills: unit.drills.map((d) => (d.id === drill.id ? drill : d)) });

  return (
    <div className="flex flex-col gap-4">
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
          regenerate={renderRegenerate({ targetType: 'CARD', itemId: card.id, itemLabel: `Briefing Card ${i + 1}` })}
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
          regenerate={renderRegenerate({ targetType: 'DRILL', itemId: drill.id, itemLabel: `Drill ${i + 1}` })}
        />
      ))}
    </div>
  );
}
