'use client';

import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Check, Lightbulb, X } from 'lucide-react';
import type { BriefingCard } from '@/lib/schemas/curriculum';
import { cn } from '@/lib/utils';
import { SourcePageBadge } from './SourcePageBadge';
import { useHotkeys } from './useHotkeys';

export interface BriefingDeckProps {
  cards: BriefingCard[];
  onComplete: () => void;
  /** Label of the button on the last BriefingCard. */
  completeLabel?: string;
  /** Called with the visible BriefingCard index (for an outer progress bar). */
  onIndexChange?: (index: number) => void;
}

/** Inline `**bold**` support for BriefingCard text (no HTML injection). */
function renderInline(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, index) =>
    part.startsWith('**') && part.endsWith('**') && part.length > 4 ? (
      <strong key={index} className="font-semibold text-pulse-primary">
        {part.slice(2, -2)}
      </strong>
    ) : (
      <Fragment key={index}>{part}</Fragment>
    ),
  );
}

/** Minimal Markdown body renderer: paragraphs and `-` / `*` bullet lists. */
function BriefingBody({ markdown }: { markdown: string }) {
  const blocks = markdown
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);
  return (
    <div className="space-y-3 text-[0.95rem] leading-relaxed text-pulse-secondary">
      {blocks.map((block, index) => {
        const lines = block.split('\n').map((line) => line.trim());
        const isList = lines.every((line) => /^[-*•]\s+/.test(line));
        if (isList) {
          return (
            <ul key={index} className="list-disc space-y-1 pl-5">
              {lines.map((line, lineIndex) => (
                <li key={lineIndex}>{renderInline(line.replace(/^[-*•]\s+/, ''))}</li>
              ))}
            </ul>
          );
        }
        return <p key={index}>{renderInline(lines.join(' '))}</p>;
      })}
    </div>
  );
}

/** Phase 1 of a Checkpoint: one BriefingCard at a time with keyboard navigation. */
export function BriefingDeck({ cards, onComplete, completeLabel = 'Start Drills', onIndexChange }: BriefingDeckProps) {
  const [index, setIndex] = useState(0);
  const [citationOpen, setCitationOpen] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);

  const total = cards.length;
  const safeIndex = Math.min(index, Math.max(total - 1, 0));
  const card = cards[safeIndex];
  const isLast = safeIndex >= total - 1;

  useEffect(() => {
    onIndexChange?.(safeIndex);
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus({ preventScroll: false });
  }, [safeIndex, onIndexChange]);

  const goTo = (next: number) => {
    setCitationOpen(false);
    setIndex(Math.max(0, Math.min(total - 1, next)));
  };

  const advance = () => {
    if (isLast) {
      onComplete();
      return;
    }
    goTo(safeIndex + 1);
  };

  useHotkeys((event) => {
    if (event.key === 'ArrowRight' || event.key === 'Enter') {
      advance();
      return true;
    }
    if (event.key === 'ArrowLeft') {
      if (safeIndex > 0) goTo(safeIndex - 1);
      return true;
    }
    if (event.key === ' ') {
      if (card && card.sourcePages.length > 0) setCitationOpen((open) => !open);
      return true;
    }
    return false;
  }, total > 0);

  if (!card) {
    return (
      <div className="pulse-card p-6 text-sm text-pulse-muted">
        <p>This Checkpoint has no BriefingCards.</p>
        <button type="button" className="pulse-btn pulse-btn-primary mt-4" onClick={onComplete}>
          {completeLabel}
        </button>
      </div>
    );
  }

  return (
    <section aria-roledescription="Briefing deck" aria-label="BriefingCards" className="pulse-cq w-full">
      <article
        key={card.id}
        aria-roledescription="BriefingCard"
        aria-label={`BriefingCard ${safeIndex + 1} of ${total}`}
        className="pulse-card-elevated pulse-slide-up flex flex-col gap-5 p-5 @lg:p-7"
      >
        <header className="flex flex-wrap items-center justify-between gap-2">
          <span className="pulse-label">
            Briefing <span className="pulse-metric">{safeIndex + 1}</span> of{' '}
            <span className="pulse-metric">{total}</span>
          </span>
          <SourcePageBadge
            pages={card.sourcePages}
            expanded={citationOpen}
            onToggle={() => setCitationOpen((open) => !open)}
            showShortcut
            className="items-end"
          />
        </header>

        <h2
          ref={headingRef}
          tabIndex={-1}
          className="text-2xl font-bold leading-tight tracking-tight text-pulse-primary outline-none @lg:text-[1.7rem]"
        >
          {card.headline}
        </h2>

        <BriefingBody markdown={card.bodyMarkdown} />

        <div className="flex gap-3 rounded-pulse-md border border-pulse-indigo/40 bg-pulse-indigo/10 px-4 py-3">
          <Lightbulb aria-hidden className="mt-0.5 size-5 shrink-0 text-pulse-indigo" />
          <div>
            <p className="pulse-label text-pulse-indigo">Key Rule</p>
            <p className="mt-0.5 font-semibold text-pulse-primary">{renderInline(card.keyTakeaway)}</p>
          </div>
        </div>

        {card.doList.length > 0 || card.dontList.length > 0 ? (
          <div className="grid gap-3 @lg:grid-cols-2">
            <div className="rounded-pulse-md border border-pulse-emerald/40 bg-pulse-emerald/10 p-4">
              <p className="pulse-label flex items-center gap-1.5 text-pulse-emerald">
                <Check aria-hidden className="size-3.5" /> Do
              </p>
              {card.doList.length > 0 ? (
                <ul className="mt-2 space-y-2 text-sm text-pulse-primary">
                  {card.doList.map((item, itemIndex) => (
                    <li key={itemIndex} className="flex gap-2">
                      <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-pulse-emerald" />
                      <span>{renderInline(item)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-pulse-muted">No specific actions listed.</p>
              )}
            </div>
            <div className="rounded-pulse-md border border-pulse-crimson/40 bg-pulse-crimson/10 p-4">
              <p className="pulse-label flex items-center gap-1.5 text-pulse-crimson">
                <X aria-hidden className="size-3.5" /> Don&apos;t
              </p>
              {card.dontList.length > 0 ? (
                <ul className="mt-2 space-y-2 text-sm text-pulse-primary">
                  {card.dontList.map((item, itemIndex) => (
                    <li key={itemIndex} className="flex gap-2">
                      <X aria-hidden className="mt-0.5 size-4 shrink-0 text-pulse-crimson" />
                      <span>{renderInline(item)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-pulse-muted">No specific restrictions listed.</p>
              )}
            </div>
          </div>
        ) : null}
      </article>

      <nav aria-label="BriefingCard navigation" className="mt-4 flex items-center justify-between gap-3">
        <button
          type="button"
          className="pulse-btn pulse-btn-ghost"
          onClick={() => goTo(safeIndex - 1)}
          disabled={safeIndex === 0}
        >
          <ArrowLeft aria-hidden className="size-4" />
          Back
          <kbd className="pulse-kbd hidden @md:inline-flex">←</kbd>
        </button>

        <ol className="flex items-center gap-1.5" aria-label="BriefingCards">
          {cards.map((item, dotIndex) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => goTo(dotIndex)}
                aria-label={`Go to BriefingCard ${dotIndex + 1}`}
                aria-current={dotIndex === safeIndex ? 'step' : undefined}
                className={cn(
                  'block h-2 rounded-full transition-all',
                  dotIndex === safeIndex
                    ? 'w-6 bg-pulse-indigo'
                    : dotIndex < safeIndex
                      ? 'w-2 bg-pulse-emerald'
                      : 'w-2 bg-pulse-border',
                )}
              />
            </li>
          ))}
        </ol>

        <button type="button" className="pulse-btn pulse-btn-primary" onClick={advance}>
          {isLast ? completeLabel : 'Next'}
          <ArrowRight aria-hidden className="size-4" />
          <kbd className="pulse-kbd hidden border-pulse-on-accent/30 bg-transparent text-pulse-on-accent/80 @md:inline-flex">Enter</kbd>
        </button>
      </nav>
    </section>
  );
}
