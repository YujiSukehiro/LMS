'use client';

import Link from 'next/link';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  Images,
  Lightbulb,
  Link2,
  ListOrdered,
  LoaderCircle,
  Play,
  Search,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { guideHref, guideRoleParam } from '@/lib/guides/access';
import { VIDEO_FOR_GUIDE, formatClock, type VideoRole } from '@/lib/guides/media';
import type { HowToRoleBlock, HowToRoleContent } from '@/lib/guides/how-to-data';
import { filterGuide } from '@/lib/guides/search';
import type { GuideChapter, GuideRoleId, GuideSection } from '@/lib/guides/types';
import { GuideText } from './guide-text';
import { markGuideSeen } from './guide-banner-cookie';

// NOTE: this component never imports the guide data. Everything it shows arrives as props (or from
// /api/how-to/[role]), so a reader's bundle and page never contain a guide above their role.

const VIDEO_LABEL: Record<VideoRole, string> = { agent: 'Agent', supervisor: 'Supervisor', trainer: 'Trainer', admin: 'Admin' };

/** DOM id of a section. Section ids repeat across guides ("home"), so the role is part of the anchor. */
export function sectionAnchor(role: GuideRoleId, sectionId: string): string {
  return `${guideRoleParam(role)}--${sectionId}`;
}

function resolveHref(href: string, uid: string): string {
  return href.replace(':uid', encodeURIComponent(uid));
}

/** What a block's player shows. Null until someone asks for it. */
interface PlayerRequest {
  video: VideoRole;
  start: number;
  nonce: number;
}

export function HowToView({ uid, blocks: initialBlocks, focus }: { uid: string; blocks: HowToRoleBlock[]; focus: GuideRoleId }) {
  const [blocks, setBlocks] = useState(initialBlocks);
  const [open, setOpen] = useState<Set<GuideRoleId>>(() => new Set([initialBlocks[0].role, focus]));
  const [loading, setLoading] = useState<GuideRoleId | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [players, setPlayers] = useState<Partial<Record<GuideRoleId, PlayerRequest>>>({});
  const [highlight, setHighlight] = useState<string | null>(null);
  const searchId = useId();
  const own = initialBlocks[0];

  useEffect(() => {
    markGuideSeen(uid);
  }, [uid]);

  const openPlayer = useCallback((role: GuideRoleId, video: VideoRole, start: number) => {
    setPlayers((prev) => ({ ...prev, [role]: { video, start, nonce: (prev[role]?.nonce ?? 0) + 1 } }));
    requestAnimationFrame(() => document.getElementById(`player-${role}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }, []);

  // Deep links: ?role=x#section opens role x (if allowed; the server already fell back to the reader's role),
  // scrolls to the section and highlights it; &play=1 opens that block's player at the section's chapter (the browser may wait for a click to
  // start it, since playback has sound).
  useEffect(() => {
    function goTo(fromLoad: boolean) {
      const raw = decodeURIComponent(window.location.hash.slice(1));
      if (!raw) return;
      const anchor = raw.includes('--') ? raw : sectionAnchor(focus, raw);
      const el = document.getElementById(anchor);
      if (!el) return;
      el.scrollIntoView({ behavior: fromLoad ? 'auto' : 'smooth', block: 'start' });
      setHighlight(anchor);
      window.setTimeout(() => setHighlight((current) => (current === anchor ? null : current)), 2600);
      if (fromLoad && new URLSearchParams(window.location.search).get('play') === '1') {
        const block = initialBlocks.find((b) => b.role === focus);
        const sectionId = anchor.split('--')[1];
        const media = block?.content?.media[sectionId];
        if (media) openPlayer(focus, media.video, media.start);
      }
    }
    goTo(true);
    const onHash = () => goTo(false);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [focus, initialBlocks, openPlayer]);

  async function toggle(role: GuideRoleId) {
    if (open.has(role)) {
      setOpen((prev) => new Set([...prev].filter((r) => r !== role)));
      return;
    }
    setLoadError(null);
    const block = blocks.find((b) => b.role === role);
    if (block && !block.content) {
      setLoading(role);
      try {
        const response = await fetch(`/api/how-to/${guideRoleParam(role)}`, { cache: 'no-store' });
        if (!response.ok) throw new Error(response.status === 403 ? 'This guide is not available to you.' : 'The guide did not load. Try again.');
        const content = (await response.json()) as HowToRoleContent;
        setBlocks((prev) => prev.map((b) => (b.role === role ? { ...b, content } : b)));
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : 'The guide did not load. Try again.');
        setLoading(null);
        return;
      }
      setLoading(null);
    }
    setOpen((prev) => new Set([...prev, role]));
  }

  const openBlocks = blocks.filter((b) => open.has(b.role) && b.content);
  const filtered = useMemo(
    () => openBlocks.map((b) => ({ block: b, chapters: filterGuide(b.content!.guide, query) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- openBlocks is derived from blocks + open
    [blocks, open, query],
  );
  const matchCount = filtered.reduce((sum, f) => sum + f.chapters.reduce((s, c) => s + c.sections.length, 0), 0);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <p className="pulse-label flex items-center gap-1.5">
          <BookOpen aria-hidden className="size-3.5 text-pulse-indigo" />
          How To
        </p>
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{own.title}</h1>
        {own.content ? <p className="max-w-3xl text-sm text-pulse-muted">{own.content.guide.intro}</p> : null}
      </div>

      <div className="grid gap-5 lg:grid-cols-[15rem_minmax(0,1fr)] xl:grid-cols-[17rem_minmax(0,1fr)]">
        <aside className="flex min-w-0 flex-col gap-3 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:self-start lg:overflow-y-auto">
          <div className="relative">
            <label htmlFor={searchId} className="sr-only">
              Search the open guides
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
          <JumpLinks groups={filtered.map((f) => ({ role: f.block.role, label: f.block.label, chapters: f.chapters }))} multiple={filtered.length > 1} />
        </aside>

        <div className="flex min-w-0 flex-col gap-6">
          {blocks.map((block, index) => {
            const isOwn = index === 0;
            const isOpen = open.has(block.role) && Boolean(block.content);
            const f = filtered.find((x) => x.block.role === block.role);
            return (
              <section key={block.role} aria-labelledby={`block-${block.role}`} className="flex flex-col gap-4">
                {isOwn ? (
                  <h2 id={`block-${block.role}`} className="sr-only">
                    {block.title}
                  </h2>
                ) : (
                  <button
                    type="button"
                    id={`block-${block.role}`}
                    aria-expanded={isOpen}
                    aria-controls={`panel-${block.role}`}
                    onClick={() => void toggle(block.role)}
                    className="pulse-card flex w-full items-center gap-3 px-4 py-3 text-left hover:border-pulse-border"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{block.title}</span>
                      <span className="block text-xs text-pulse-muted">
                        What {block.label === 'Agent' ? 'your agents' : `${block.label.toLowerCase()}s`} see · {block.sectionCount} sections
                      </span>
                    </span>
                    {loading === block.role ? <LoaderCircle aria-hidden className="size-4 animate-spin text-pulse-muted" /> : null}
                    <ChevronDown aria-hidden className={cn('size-5 text-pulse-muted transition-transform', isOpen && 'rotate-180')} />
                  </button>
                )}
                {isOpen && block.content ? (
                  <div id={`panel-${block.role}`} className="flex flex-col gap-6">
                    {!isOwn ? <p className="max-w-3xl text-sm text-pulse-muted">{block.content.guide.intro}</p> : null}
                    <VideoPlayer
                      role={block.role}
                      content={block.content}
                      request={players[block.role] ?? null}
                      onStart={() => openPlayer(block.role, VIDEO_FOR_GUIDE[block.role], 0)}
                    />
                    {f && f.chapters.length === 0 ? (
                      <div className="rounded-pulse-lg border border-dashed border-pulse-border px-6 py-8 text-center">
                        <p className="text-sm font-semibold text-pulse-secondary">Nothing in the {block.label} guide matches “{query}”.</p>
                      </div>
                    ) : (
                      (f?.chapters ?? []).map((chapter) => (
                        <section key={chapter.id} aria-labelledby={`chapter-${block.role}-${chapter.id}`} className="flex flex-col gap-3">
                          <h3 id={`chapter-${block.role}-${chapter.id}`} className="pulse-label">
                            {chapter.title}
                          </h3>
                          {chapter.sections.map((section) => {
                            const media = block.content!.media[section.id];
                            const anchor = sectionAnchor(block.role, section.id);
                            return (
                              <SectionCard
                                key={section.id}
                                role={block.role}
                                anchor={anchor}
                                section={section}
                                uid={uid}
                                highlighted={highlight === anchor}
                                watch={media ? { start: media.start, onWatch: () => openPlayer(block.role, media.video, media.start) } : null}
                                screenshots={block.content!.screenshots[section.id] ?? []}
                              />
                            );
                          })}
                        </section>
                      ))
                    )}
                  </div>
                ) : null}
              </section>
            );
          })}
          {loadError ? (
            <p role="alert" className="text-sm text-pulse-crimson">
              {loadError}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * Click-to-play. Before a click there is no <video> and no poster request. Playback starts with sound at half
 * volume (narration can be loud on some devices); the reader's own volume change is kept after that.
 * The narration is also burned into the video as a caption band; the WebVTT track is there for the CC button.
 */
/** Players open at half volume. */
const PLAYER_START_VOLUME = 0.5;

function VideoPlayer({
  role,
  content,
  request,
  onStart,
}: {
  role: GuideRoleId;
  content: HowToRoleContent;
  request: PlayerRequest | null;
  onStart: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const video = request?.video ?? VIDEO_FOR_GUIDE[role];
  const entry = content.videos[video];

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !request) return;
    el.muted = false;
    if (!el.dataset.volumeSet) {
      el.volume = PLAYER_START_VOLUME;
      el.dataset.volumeSet = '1';
    }
    const seek = () => {
      el.currentTime = request.start;
      void el.play().catch(() => undefined);
    };
    if (el.readyState >= 1) seek();
    else el.addEventListener('loadedmetadata', seek, { once: true });
  }, [request]);

  if (!entry) return null;
  return (
    <div id={`player-${role}`} className="scroll-mt-20">
      <section aria-label={`${VIDEO_LABEL[video]} video`} className="pulse-card overflow-hidden">
        {request ? (
          <div className="relative">
            <video
              key={entry.url}
              ref={videoRef}
              className="aspect-[1280/928] w-full bg-black"
              controls
              playsInline
              preload="metadata"
              poster={entry.posterUrl}
              src={entry.url}
            >
              {entry.vttUrl ? <track kind="subtitles" srcLang="en" label="English" src={entry.vttUrl} /> : null}
              Your browser cannot play this video.
            </video>
          </div>
        ) : (
          <button
            type="button"
            onClick={onStart}
            className="group flex aspect-[16/7] w-full flex-col items-center justify-center gap-3 bg-gradient-to-br from-pulse-indigo/15 via-pulse-surface-2 to-pulse-surface-1 text-center"
          >
            <span className="grid size-14 place-items-center rounded-full bg-pulse-indigo text-pulse-on-accent shadow-lg transition-transform group-hover:scale-105">
              <Play aria-hidden className="ml-0.5 size-6" />
            </span>
            <span className="text-base font-semibold">Watch the {VIDEO_LABEL[video]} video</span>
            <span className="pulse-metric text-xs text-pulse-muted">{formatClock(entry.duration)} · narrated · on-screen text</span>
          </button>
        )}
        <p className="flex flex-wrap items-center justify-between gap-2 border-t border-pulse-border-subtle px-3 py-2 text-xs text-pulse-muted">
          <span>
            {VIDEO_LABEL[video]} video{request ? ` · from ${formatClock(request.start)}` : ''}
          </span>
          <span>Each section&apos;s Watch button jumps to its part.</span>
        </p>
      </section>
    </div>
  );
}

function JumpLinks({ groups, multiple }: { groups: Array<{ role: GuideRoleId; label: string; chapters: GuideChapter[] }>; multiple: boolean }) {
  if (groups.every((g) => g.chapters.length === 0)) return null;
  const list = (
    <div className="flex flex-col gap-4">
      {groups.map((group) => (
        <div key={group.role}>
          {multiple ? <p className="px-2 pb-1 text-xs font-semibold text-pulse-primary">{group.label}</p> : null}
          <ul className="flex flex-col gap-3">
            {group.chapters.map((chapter) => (
              <li key={chapter.id}>
                <p className="pulse-label px-2 pb-1">{chapter.title}</p>
                <ul className="flex flex-col">
                  {chapter.sections.map((section) => (
                    <li key={section.id}>
                      <a
                        href={`#${sectionAnchor(group.role, section.id)}`}
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
        </div>
      ))}
    </div>
  );
  return (
    <nav aria-label="Jump to a section">
      <details className="pulse-card px-3 py-2 lg:hidden">
        <summary className="cursor-pointer text-sm font-semibold">Jump to a section</summary>
        <div className="pt-2">{list}</div>
      </details>
      <div className="hidden lg:block">{list}</div>
    </nav>
  );
}

function CopyLinkButton({ role, sectionId, title }: { role: GuideRoleId; sectionId: string; title: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    const url = `${window.location.origin}${guideHref(role, sectionId)}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      window.history.replaceState(null, '', guideHref(role, sectionId));
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }
  return (
    <button
      type="button"
      onClick={() => void copy()}
      aria-label={copied ? `Link to ${title} copied` : `Copy link to ${title}`}
      title={copied ? 'Link copied' : 'Copy link to this section'}
      className="grid size-7 shrink-0 place-items-center rounded-pulse-sm text-pulse-muted hover:bg-pulse-surface-2 hover:text-pulse-primary"
    >
      {copied ? <Check aria-hidden className="size-3.5 text-pulse-emerald" /> : <Link2 aria-hidden className="size-3.5" />}
    </button>
  );
}

function SectionCard({
  role,
  anchor,
  section,
  uid,
  highlighted,
  watch,
  screenshots,
}: {
  role: GuideRoleId;
  anchor: string;
  section: GuideSection;
  uid: string;
  highlighted: boolean;
  watch: { start: number; onWatch: () => void } | null;
  screenshots: string[];
}) {
  const [shotsOpen, setShotsOpen] = useState(false);
  const shotsId = useId();
  return (
    <article
      id={anchor}
      className={cn(
        'pulse-card scroll-mt-20 flex flex-col gap-3 p-4 transition-shadow duration-500 md:p-5',
        highlighted && 'ring-2 ring-pulse-indigo ring-offset-2 ring-offset-pulse-bg',
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="min-w-0 flex-1 text-base font-semibold tracking-tight">{section.title}</h4>
        {watch ? (
          <button type="button" onClick={watch.onWatch} className="pulse-btn px-2 py-1 text-xs">
            <Play aria-hidden className="size-3.5" />
            Watch ({formatClock(watch.start)})
          </button>
        ) : null}
        <CopyLinkButton role={role} sectionId={section.id} title={section.title} />
      </div>
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
      {screenshots.length > 0 ? (
        <div>
          <button
            type="button"
            aria-expanded={shotsOpen}
            aria-controls={shotsId}
            onClick={() => setShotsOpen((value) => !value)}
            className="flex items-center gap-1.5 text-sm font-medium text-pulse-indigo-text hover:underline"
          >
            <Images aria-hidden className="size-4" />
            {shotsOpen ? 'Hide screenshots' : `Show screenshots (${screenshots.length})`}
            <ChevronDown aria-hidden className={cn('size-4 transition-transform', shotsOpen && 'rotate-180')} />
          </button>
          {/* Not in the DOM until opened, so nothing downloads for readers who never look. */}
          {shotsOpen ? (
            <div id={shotsId} className="mt-2 grid gap-2 sm:grid-cols-2">
              {screenshots.map((src, index) => (
                // eslint-disable-next-line @next/next/no-img-element -- role-checked media route, already sized WebP.
                <img
                  key={src}
                  src={src}
                  alt={`${section.title}, screenshot ${index + 1} of ${screenshots.length}`}
                  loading="lazy"
                  decoding="async"
                  width={1000}
                  height={725}
                  className="h-auto w-full rounded-pulse-md border border-pulse-border-subtle"
                />
              ))}
            </div>
          ) : null}
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
