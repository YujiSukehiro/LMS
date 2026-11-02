'use client';

import type { ReactNode } from 'react';
import type { BriefingCard } from '@/lib/schemas/curriculum';
import { EditorSection, SourcePagesField, StringListField, TextAreaField, TextField } from './fields';

export function BriefingCardEditor({
  card,
  index,
  onChange,
  regenerate,
  anchorId,
}: {
  card: BriefingCard;
  index: number;
  onChange: (card: BriefingCard) => void;
  regenerate: ReactNode;
  anchorId?: string;
}) {
  const set = <K extends keyof BriefingCard>(key: K, value: BriefingCard[K]) => onChange({ ...card, [key]: value });
  return (
    <EditorSection
      id={anchorId}
      title={`Briefing Card ${index + 1}`}
      badge={<span className="pulse-pill text-[0.68rem]">Learn</span>}
      actions={regenerate}
    >
      <TextField label="Headline" value={card.headline} max={90} onChange={(v) => set('headline', v)} />
      <TextAreaField
        label="Body"
        value={card.bodyMarkdown}
        max={600}
        rows={4}
        hint="2 to 4 short sentences that state the operational rule."
        onChange={(v) => set('bodyMarkdown', v)}
      />
      <TextField label="Key takeaway" value={card.keyTakeaway} max={160} onChange={(v) => set('keyTakeaway', v)} />
      <div className="grid gap-4 md:grid-cols-2">
        <StringListField
          label="DO"
          tone="emerald"
          values={card.doList}
          maxItems={4}
          maxLength={140}
          addLabel="Add DO line"
          onChange={(v) => set('doList', v)}
        />
        <StringListField
          label="DON'T"
          tone="crimson"
          values={card.dontList}
          maxItems={4}
          maxLength={140}
          addLabel="Add DON'T line"
          onChange={(v) => set('dontList', v)}
        />
      </div>
      <SourcePagesField value={card.sourcePages} onChange={(v) => set('sourcePages', v)} className="max-w-xs" />
    </EditorSection>
  );
}
