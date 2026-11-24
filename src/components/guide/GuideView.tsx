'use client';

import Link from 'next/link';
import { useEffect, useId, useMemo, useState } from 'react';
import { ArrowRight, BookOpen, Lightbulb, ListOrdered, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { GUIDES } from '@/lib/guides';
import { guideRoleParam } from '@/lib/guides/access';
import { filterGuide } from '@/lib/guides/search';
import type { GuideChapter, GuideRoleId, GuideSection } from '@/lib/guides/types';
import { GuideText } from './guide-text';
import { markGuideSeen } from './guide-banner-cookie';

function resolveHref(href: string, uid: string): string {
  return href.replace(':uid', encodeURIComponent(uid));
}

export function GuideView({
  uid,
  roles,
  initialRole,
}: {
  uid: string;
  /** Guides this reader may open, own guide first. */
  roles: GuideRoleId[];
  initialRole: GuideRoleId;
}) {
  const [active, setActive] = useState<GuideRoleId>(initialRole);
  const [query, setQuery] = useState('');
  const searchId = useId();
  const guide = GUIDES[active];
  const chapters = useMemo(() => filterGuide(guide, query), [guide, query]);
  const matchCount = chapters.reduce((sum, chapter) => sum + chapter.sections.length, 0);

  // Opening the guide counts as reading it: the "New here?" banner stops showing.
  useEffect(() => {
    markGuideSeen(uid);
  }, [uid]);

  function chooseRole(role: GuideRoleId) {
    setActive(role);
    const url = new URL(window.location.href);
    url.searchParams.set('role', guideRoleParam(role));
    url.hash = '';
    window.history.replaceState(null, '', url);
    window.scrollTo({ top: 0 });
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <p className="pulse-label flex items-center gap-1.5">
          <BookOpen aria-hidden className="size-3.5 text-pulse-indigo" />
          How to use LogiCall Pulse
        </p>
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{guide.title}</h1>
        <p className="max-w-3xl text-sm text-pulse-muted">{guide.intro}</p>
      </div>

      {roles.length > 1 ? (
        <div role="tablist" aria-label="Guides by role" className="flex flex-wrap gap-1 border-b border-pulse-border-subtle">
          {roles.map((role, index) => {
            const selected = role === active;
            return (
              <button
                key={role}
                type="button"
                role="tab"
                id={`guide-tab-${role}`}
                aria-selected={selected}
                aria-controls="guide-panel"
                onClick={() => chooseRole(role)}
                className={cn(
                  '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                  selected
                    ? 'border-pulse-indigo text-pulse-primary'
                    : 'border-transparent text-pulse-muted hover:text-pulse-secondary',
                )}
              >
                {GUIDES[role].label}
                {index === 0 ? <span className="ml-1.5 text-xs font-normal text-pulse-muted">(you)</span> : null}
              </button>
            );
          })}
        </div>
      ) : null}

      <div
        id="guide-panel"
        role={roles.length > 1 ? 'tabpanel' : undefined}
        aria-labelledby={roles.length > 1 ? `guide-tab-${active}` : undefined}
        className="grid gap-5 lg:grid-cols-[15rem_minmax(0,1fr)] xl:grid-cols-[17rem_minmax(0,1fr)]"
      >
        <aside className="flex min-w-0 flex-col gap-3 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:self-start lg:overflow-y-auto">
          <div className="relative">
            <label htmlFor={searchId} className="sr-only">
              Search this guide
            </label>
            <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-pulse-muted" />
            <input
              id={searchId}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search this guide"
              className="pulse-input w-full pl-8 pr-8"
              autoComplete="off"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear search"
                className="absolute right-1.5 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-pulse-sm text-pulse-muted hover:text-pulse-primary"
              >
                <X aria-hidden className="size-3.5" />
              </button>
            ) : null}
          </div>
          {query ? (
            <p role="status" className="text-xs text-pulse-muted">
              {matchCount === 0 ? 'No sections match.' : `${matchCount} section${matchCount === 1 ? '' : 's'} match.`}
            </p>
          ) : null}
          <JumpLinks chapters={chapters} />
        </aside>

        <div className="flex min-w-0 flex-col gap-6">
          {chapters.length === 0 ? (
            <div className="rounded-pulse-lg border border-dashed border-pulse-border px-6 py-10 text-center">
              <p className="text-sm font-semibold text-pulse-secondary">Nothing in this guide matches “{query}”.</p>
              <p className="mt-1 text-sm text-pulse-muted">Try a shorter word, or check another role&apos;s guide.</p>
            </div>
          ) : (
            chapters.map((chapter) => (
              <section key={chapter.id} aria-labelledby={`chapter-${chapter.id}`} className="flex flex-col gap-3">
                <h2 id={`chapter-${chapter.id}`} className="pulse-label">
                  {chapter.title}
                </h2>
                {chapter.sections.map((section) => (
                  <SectionCard key={section.id} section={section} uid={uid} />
                ))}
              </section>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function JumpLinks({ chapters }: { chapters: GuideChapter[] }) {
  const list = (
    <ul className="flex flex-col gap-3">
      {chapters.map((chapter) => (
        <li key={chapter.id}>
          <p className="pulse-label px-2 pb-1">{chapter.title}</p>
          <ul className="flex flex-col">
            {chapter.sections.map((section) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  className="block rounded-pulse-sm px-2 py-1 text-sm text-pulse-secondary hover:bg-pulse-surface-2 hover:text-pulse-primary"
                >
                  {section.title}
                </a>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
  if (chapters.length === 0) return null;
  return (
    <nav aria-label="Jump to a section">
      {/* Phones and tablets: collapsed so the guide starts above the fold. */}
      <details className="pulse-card px-3 py-2 lg:hidden">
        <summary className="cursor-pointer text-sm font-semibold">Jump to a section</summary>
        <div className="pt-2">{list}</div>
      </details>
      <div className="hidden lg:block">{list}</div>
    </nav>
  );
}

function SectionCard({ section, uid }: { section: GuideSection; uid: string }) {
  return (
    <article id={section.id} className="pulse-card scroll-mt-20 flex flex-col gap-3 p-4 md:p-5">
      <h3 className="text-base font-semibold tracking-tight">{section.title}</h3>
      <dl className="grid gap-2 text-sm sm:grid-cols-2 sm:gap-4">
        <div>
          <dt className="pulse-label">What it is</dt>
          <dd className="mt-0.5 text-pulse-secondary">
            <GuideText text={section.what} />
          </dd>
        </div>
        <div>
          <dt className="pulse-label">When to use it</dt>
          <dd className="mt-0.5 text-pulse-secondary">
            <GuideText text={section.when} />
          </dd>
        </div>
      </dl>
      {section.steps.length > 0 ? (
        <div>
          <p className="pulse-label flex items-center gap-1.5">
            <ListOrdered aria-hidden className="size-3.5" />
            How to
          </p>
          <ol className="mt-1.5 flex flex-col gap-1.5 text-sm">
            {section.steps.map((step, index) => (
              <li key={index} className="flex gap-2.5">
                <span
                  aria-hidden
                  className="pulse-metric mt-px grid size-5 shrink-0 place-items-center rounded-full bg-pulse-indigo/12 text-[0.7rem] font-semibold text-pulse-indigo-text"
                >
                  {index + 1}
                </span>
                <span className="min-w-0 text-pulse-secondary">
                  <GuideText text={step} />
                </span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
      {section.tips && section.tips.length > 0 ? (
        <div className="rounded-pulse-md border border-pulse-border-subtle bg-pulse-surface-2/60 px-3 py-2.5">
          <p className="pulse-label flex items-center gap-1.5">
            <Lightbulb aria-hidden className="size-3.5 text-pulse-amber" />
            Tips
          </p>
          <ul className="mt-1 flex list-disc flex-col gap-1 pl-5 text-sm text-pulse-secondary">
            {section.tips.map((tip, index) => (
              <li key={index}>
                <GuideText text={tip} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {section.links && section.links.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {section.links.map((link) => (
            <Link key={link.href + link.label} href={resolveHref(link.href, uid)} className="pulse-btn text-xs">
              {link.label}
              <ArrowRight aria-hidden className="size-3.5" />
            </Link>
          ))}
        </div>
      ) : null}
    </article>
  );
}
