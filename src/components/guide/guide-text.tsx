import { Fragment, type ReactNode } from 'react';

/** Render guide text: `**Label**` becomes bold (an exact UI label); everything else is plain text. */
export function GuideText({ text }: { text: string }): ReactNode {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return parts.map((part, index) =>
    index % 2 === 1 ? (
      <strong key={index} className="font-semibold text-pulse-primary">
        {part}
      </strong>
    ) : (
      <Fragment key={index}>{part}</Fragment>
    ),
  );
}

/** Plain text of a guide string (bold markers removed), for search. */
export function plainGuideText(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, '$1');
}
