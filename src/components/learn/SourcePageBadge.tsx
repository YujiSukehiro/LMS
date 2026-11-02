'use client';

import { useId, useState } from 'react';
import { BookOpen, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SourcePageBadgeProps {
  /** Playbook page numbers that ground this item. Nothing renders when the list is empty. */
  pages: number[];
  /** Controlled expansion state. When omitted the badge manages its own state. */
  expanded?: boolean;
  onToggle?: () => void;
  /** Show the `Space` shortcut hint next to the badge. */
  showShortcut?: boolean;
  className?: string;
}

export function formatPlaybookPages(pages: number[]): string {
  const unique = Array.from(new Set(pages)).sort((a, b) => a - b);
  if (unique.length === 0) return '';
  if (unique.length === 1) return `p. ${unique[0]}`;
  return `pp. ${unique.join(', ')}`;
}

/** `Source: Playbook p. N` citation pill that expands to show the grounding note. */
export function SourcePageBadge({ pages, expanded, onToggle, showShortcut = false, className }: SourcePageBadgeProps) {
  const [ownExpanded, setOwnExpanded] = useState(false);
  const panelId = useId();
  if (pages.length === 0) return null;

  const isOpen = expanded ?? ownExpanded;
  const toggle = () => {
    if (onToggle) onToggle();
    else setOwnExpanded((value) => !value);
  };
  const label = formatPlaybookPages(pages);
  const count = new Set(pages).size;

  return (
    <div className={cn('flex flex-col items-start gap-2', className)}>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={isOpen}
          aria-controls={panelId}
          className="pulse-pill pulse-pill-indigo cursor-pointer transition-colors hover:brightness-125"
        >
          <BookOpen aria-hidden className="size-3.5" />
          <span>
            Source: Playbook <span className="pulse-metric">{label}</span>
          </span>
          <ChevronDown aria-hidden className={cn('size-3.5 transition-transform', isOpen && 'rotate-180')} />
        </button>
        {showShortcut ? (
          <span className="hidden items-center gap-1 text-xs text-pulse-muted sm:inline-flex">
            <kbd className="pulse-kbd">Space</kbd> citation
          </span>
        ) : null}
      </div>
      <div
        id={panelId}
        hidden={!isOpen}
        className="w-full rounded-pulse-md border border-pulse-border bg-pulse-bg px-3 py-2 text-xs leading-relaxed text-pulse-secondary"
      >
        This rule comes directly from the campaign Playbook ({count === 1 ? 'page' : 'pages'}{' '}
        <span className="pulse-metric text-pulse-primary">{Array.from(new Set(pages)).sort((a, b) => a - b).join(', ')}</span>
        ). If the wording is unclear, ask your Trainer to open {count === 1 ? 'that page' : 'those pages'} in the Track
        Studio.
      </div>
    </div>
  );
}
